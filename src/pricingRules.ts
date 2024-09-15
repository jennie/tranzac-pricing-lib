// pricing-lib/src/pricingRules.js
import mongoose from "mongoose";

import {
  getPricingRuleModel,
  getTimePeriodModel,
  getAdditionalCostModel,
} from "./models/pricing.schema";

import { AdditionalCosts } from "./models/additionalCosts.schema"; // Import the interface

import { formatISO, parseISO, isValid, differenceInHours } from "date-fns";
import { format, toZonedTime } from "date-fns-tz";

interface Booking {
  resources?: string[];
  private?: boolean;
  expectedAttendance?: number;
  roomSlugs: string[];
  start: string;
  end: string;
}

const TORONTO_TIMEZONE = "America/Toronto";
const HST_RATE = 0.13; // 13% HST rate

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(amount);
}

export default class PricingRules {
  private additionalCosts: AdditionalCosts | null = null;
  private rules: Record<string, any> | null = null;
  private timePeriods: any[] | null = null;

  constructor() {
    this.timePeriods = null;
    this.rules = null;
    this.additionalCosts = null;
  }

  async initialize() {
    if (!this.rules) {
      const maxRetries = 3;
      let retries = 0;
      while (retries < maxRetries) {
        try {
          console.log(
            `Attempting to fetch pricing rules (Attempt ${retries + 1})`
          );
          const PricingRuleModel = await getPricingRuleModel();
          const TimePeriodModel = await getTimePeriodModel();
          const AdditionalCostModel = await getAdditionalCostModel();

          const rulesFromDB = await PricingRuleModel.find()
            .lean()
            .maxTimeMS(30000); // Increase timeout to 30 seconds
          this.rules = rulesFromDB.reduce<Record<string, any>>(
            (acc, rule: any) => {
              acc[rule.roomSlug] = rule.pricing;
              return acc;
            },
            {}
          );

          this.timePeriods = await TimePeriodModel.find()
            .lean()
            .maxTimeMS(30000);
          this.additionalCosts = (await AdditionalCostModel.findOne()
            .lean()
            .maxTimeMS(30000)) as unknown as AdditionalCosts;

          console.log("Successfully fetched pricing rules");
          return; // Exit the function if successful
        } catch (error: any) {
          console.error(
            `Error fetching pricing data (Attempt ${retries + 1}):`,
            error
          );
          retries++;
          if (retries >= maxRetries) {
            throw new Error(
              `Failed to fetch pricing data after ${maxRetries} attempts: ${error.message}`
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds before retrying
        }
      }
    }
  }

  async getPrice(data: any): Promise<{
    costEstimates: any[];
    grandTotal: number;
    tax: number;
    totalWithTax: number;
  }> {
    try {
      await this.initialize();
      const costEstimates = [];
      let grandTotal = 0;

      for (const [date, bookings] of Object.entries(data.rentalDates)) {
        console.log(`Processing bookings for date: ${date}`);

        for (const booking of bookings as any[]) {
          console.log(`Processing booking:`, JSON.stringify(booking, null, 2));

          try {
            const preparedBooking: Booking =
              this.prepareBookingForPricing(booking);
            const { estimates, perSlotCosts, slotTotal } =
              await this.calculatePrice({
                ...preparedBooking,
                date,
                resources: preparedBooking.resources || [],
                isPrivate: preparedBooking.private || false,
                expectedAttendance:
                  Number(preparedBooking.expectedAttendance) || 0,
              });

            costEstimates.push({
              id: booking.id,
              date,
              estimates,
              perSlotCosts,
              slotTotal,
              start: preparedBooking.start,
              end: preparedBooking.end,
            });

            grandTotal += slotTotal;
          } catch (error: any) {
            console.error(
              `Error calculating price for booking ${booking.id}:`,
              error
            );
            console.error(
              `Problematic booking data:`,
              JSON.stringify(booking, null, 2)
            );

            costEstimates.push({
              id: booking.id,
              date,
              error: error.message,
              start: booking.start,
              end: booking.end,
              slotTotal: 0,
            });
          }
        }
      }

      const tax = Number((grandTotal * HST_RATE).toFixed(2));
      const totalWithTax = Number((grandTotal + tax).toFixed(2));

      console.log("Tax calculation:");
      console.log("Grand Total:", grandTotal);
      console.log("Tax Rate:", HST_RATE);
      console.log("Calculated Tax:", tax);
      console.log("Total with Tax:", totalWithTax);

      return { costEstimates, grandTotal, tax, totalWithTax };
    } catch (error: any) {
      console.error("Error in getPrice method:", error);

      return { costEstimates: [], grandTotal: 0, tax: 0, totalWithTax: 0 };
    }
  }

  prepareBookingForPricing(booking: {
    start: string;
    end: string;
    roomSlugs: string[];
  }) {
    const { start, end, roomSlugs } = booking;
    console.log("Booking data:", booking);
    if (!roomSlugs || roomSlugs.length === 0) {
      throw new Error("Room slugs are undefined or empty in booking");
    }

    const startDateTime = toZonedTime(parseISO(start), TORONTO_TIMEZONE);
    const endDateTime = toZonedTime(parseISO(end), TORONTO_TIMEZONE);

    if (!isValid(startDateTime) || !isValid(endDateTime)) {
      console.error("Invalid start or end time in booking data:", {
        start,
        end,
      });
      throw new Error("Invalid start or end time in booking data");
    }

    return {
      ...booking,
      roomSlugs,
      start: dateTimeToISOString(startDateTime),
      end: dateTimeToISOString(endDateTime),
    };
  }

  async calculatePrice(booking: any) {
    const {
      roomSlugs,
      start,
      end,
      isPrivate,
      expectedAttendance,
      resources,
      date,
    } = booking;
    let estimates = [];
    let perSlotCosts = [];

    const startTime = toZonedTime(parseISO(start), "America/Toronto");
    const endTime = toZonedTime(parseISO(end), "America/Toronto");
    const currentDay = format(startTime, "EEEE", {
      timeZone: "America/Toronto",
    });

    // Fetch additional costs related to the booking
    const { perSlotCosts: calculatedPerSlotCosts, additionalCosts } =
      await this.calculateAdditionalCosts({
        roomSlugs,
        start,
        end,
        isPrivate,
        expectedAttendance,
        resources,
      });

    perSlotCosts = calculatedPerSlotCosts;

    for (const roomSlug of roomSlugs) {
      if (!this.rules) throw new Error("Rules are not initialized");
      const roomRules = this.rules[roomSlug];
      if (!roomRules) {
        throw new Error(`No pricing rules found for room: ${roomSlug}`);
      }

      const dayRules: {
        fullDay?: { [key: string]: any };
        daytime?: { [key: string]: any };
        evening?: { [key: string]: any };
        minimumHours?: number;
      } =
        Object.entries(roomRules).find(
          ([day]) =>
            day.toLowerCase() === currentDay.toLowerCase() ||
            day.toLowerCase() === "all"
        )?.[1] || {};

      if (!dayRules) {
        throw new Error(
          `No pricing rules found for room ${roomSlug} on ${currentDay}`
        );
      }

      let totalPrice = 0;
      let daytimePrice = 0;
      let eveningPrice = 0;
      let fullDayPrice = 0;
      let daytimeHours = 0;
      let eveningHours = 0;
      let rateDescription = "";
      let rateSubDescription = "";

      const eveningStartTime = new Date(startTime);
      eveningStartTime.setHours(17, 0, 0, 0);

      const totalBookingHours = differenceInHours(endTime, startTime);
      const bookingCrossesEveningThreshold =
        startTime < eveningStartTime && endTime > eveningStartTime;

      // Full Day Logic
      if (dayRules.fullDay) {
        const fullDayRate = dayRules.fullDay[isPrivate ? "private" : "public"];
        if (dayRules.fullDay.type === "flat") {
          fullDayPrice = fullDayRate; // Set the full-day price for flat rate
          rateDescription = "Full Day Flat Rate";
        } else if (dayRules.fullDay.type === "hourly") {
          const effectiveHours = Math.max(
            totalBookingHours,
            dayRules.fullDay.minimumHours || 0
          );
          fullDayPrice = fullDayRate * effectiveHours; // Set the full-day price for hourly rate
          rateDescription = `Full Day Rate: $${fullDayRate}/hour`;
          if (effectiveHours > totalBookingHours) {
            rateSubDescription = `${dayRules.fullDay.minimumHours}-hour minimum`;
          }
        }
      }

      // If full-day price is set, use it; otherwise, calculate daytime and evening prices
      if (fullDayPrice > 0) {
        totalPrice = fullDayPrice;
      } else {
        // Daytime Calculation
        if (startTime < eveningStartTime && dayRules.daytime) {
          const daytimeEndTime = bookingCrossesEveningThreshold
            ? eveningStartTime
            : endTime;
          daytimeHours = differenceInHours(daytimeEndTime, startTime);

          let daytimeRate = dayRules.daytime[isPrivate ? "private" : "public"];
          let effectiveDaytimeHours = daytimeHours;
          let minimumApplied = false;

          if (
            bookingCrossesEveningThreshold &&
            dayRules.daytime.crossoverRate
          ) {
            daytimeRate = dayRules.daytime.crossoverRate;
            rateSubDescription = "Crossover rate applied";
          } else {
            // Only apply minimum hours if not using crossover rate
            const minimumHours = dayRules.daytime.minimumHours || 0;
            effectiveDaytimeHours = Math.max(daytimeHours, minimumHours);
            minimumApplied = effectiveDaytimeHours > daytimeHours;
          }

          if (dayRules.daytime.type === "hourly") {
            daytimePrice = daytimeRate * effectiveDaytimeHours;
            rateDescription = `Daytime: $${daytimeRate}/hour`;
            if (minimumApplied) {
              rateSubDescription += rateSubDescription ? ", " : "";
              rateSubDescription += `${dayRules.daytime.minimumHours}-hour minimum applied`;
            }
          } else if (dayRules.daytime.type === "flat") {
            daytimePrice = daytimeRate;
            rateDescription = "Flat Daytime Rate";
          }
        }

        // Evening Calculation (keep as is, but ensure it uses the correct evening hours)
        if (endTime > eveningStartTime && dayRules.evening) {
          eveningHours = differenceInHours(endTime, eveningStartTime);
          let eveningRate = dayRules.evening[isPrivate ? "private" : "public"];

          if (dayRules.evening.type === "flat") {
            eveningPrice = eveningRate;
            rateDescription += rateDescription ? " + " : "";
            rateDescription += "Evening (flat rate)";
          } else if (dayRules.evening.type === "hourly") {
            eveningPrice = eveningRate * eveningHours;
            rateDescription += rateDescription ? " + " : "";
            rateDescription += `Evening: $${eveningRate}/hour`;
          }
        }

        totalPrice = daytimePrice + eveningPrice;

        // Apply minimum hours if necessary
        if (
          dayRules.minimumHours &&
          totalBookingHours < dayRules.minimumHours
        ) {
          const rate =
            dayRules.daytime?.[isPrivate ? "private" : "public"] ||
            dayRules.evening?.[isPrivate ? "private" : "public"];
          const minimumPrice = rate * dayRules.minimumHours;
          if (minimumPrice > totalPrice) {
            totalPrice = minimumPrice;
            rateSubDescription = `${dayRules.minimumHours}-hour minimum applied`;
            // Distribute the minimum price proportionally
            if (daytimeHours > 0 && eveningHours > 0) {
              daytimePrice = (daytimeHours / totalBookingHours) * totalPrice;
              eveningPrice = totalPrice - daytimePrice;
            } else if (daytimeHours > 0) {
              daytimePrice = totalPrice;
            } else {
              eveningPrice = totalPrice;
            }
          }
        }
      }

      const roomAdditionalCosts = additionalCosts.filter(
        (cost) => cost.roomSlug === roomSlug
      );
      const roomAdditionalCostTotal = roomAdditionalCosts.reduce(
        (sum, cost) => sum + (typeof cost.cost === "number" ? cost.cost : 0),
        0
      );

      estimates.push({
        roomSlug,
        basePrice: totalPrice,
        daytimeHours,
        eveningHours,
        daytimePrice,
        eveningPrice,
        fullDayPrice, // Include full-day price in the estimate
        daytimeRate: dayRules.daytime?.[isPrivate ? "private" : "public"],
        daytimeRateType: dayRules.daytime?.type || null, // Include rate type in the estimate
        eveningRate: dayRules.evening?.[isPrivate ? "private" : "public"],
        eveningRateType: dayRules.evening?.type || null, // Include rate type in the estimate
        additionalCosts: roomAdditionalCosts,
        totalCost: totalPrice + roomAdditionalCostTotal,
        rateDescription,
        rateSubDescription,
        minimumHours: dayRules.minimumHours || dayRules.fullDay?.minimumHours,
        totalBookingHours,
        isFullDay: !!dayRules.fullDay,
      });
    }

    const perSlotCostTotal = perSlotCosts.reduce(
      (sum, cost) => sum + (typeof cost.cost === "number" ? cost.cost : 0),
      0
    );

    const slotTotal =
      estimates.reduce((sum, estimate) => sum + estimate.totalCost, 0) +
      perSlotCostTotal;

    return { estimates, perSlotCosts, slotTotal };
  }

  async calculateAdditionalCosts(booking: any) {
    const { resources, roomSlugs, start, end, isPrivate, expectedAttendance } =
      booking;

    let perSlotCosts = [];
    let additionalCosts = [];

    // Calculate per-slot costs
    const venueOpeningTime = new Date(start);
    venueOpeningTime.setHours(18, 0, 0, 0); // Assuming Tranzac opens at 6 PM
    const bookingStartTime = new Date(start);

    if (bookingStartTime < venueOpeningTime) {
      const earlyOpenHours = Math.ceil(
        differenceInHours(venueOpeningTime, bookingStartTime)
      );
      if (earlyOpenHours > 0) {
        perSlotCosts.push({
          description: `Early Open Staff (${earlyOpenHours} hours)`,
          cost: earlyOpenHours * 30, // $30 per hour
        });
      }
    }

    if (roomSlugs.includes("parking-lot") || resources.includes("security")) {
      perSlotCosts.push({
        description: "Security",
        subDescription: "Will be quoted separately",
        cost: 0,
      });
    }
    if (resources.includes("food")) {
      const cleaningConfig = this.additionalCosts?.resources?.find(
        (r) => r.id === "food"
      );
      if (cleaningConfig) {
        additionalCosts.push({
          roomSlugs,
          description:
            cleaningConfig.description ||
            "Cleaning (required when food is served)",
          cost: cleaningConfig.cost,
        });
      }
    }

    // Add Door Staff to per-slot costs
    if (resources.includes("door_staff")) {
      if (this.additionalCosts?.resources) {
        const doorStaffConfig = this.additionalCosts.resources.find(
          (r) => r.id === "door_staff"
        );
        if (doorStaffConfig) {
          const hours = differenceInHours(parseISO(end), parseISO(start));
          const doorStaffCost = Number(doorStaffConfig.cost) * Number(hours);
          perSlotCosts.push({
            description: `Door Staff (${hours} hours)`,
            cost: doorStaffCost,
          });
        }
      }
    }

    // Add Piano Tuning to per-slot costs
    if (resources.includes("piano_tuning")) {
      const pianoTuningConfig = this.additionalCosts?.resources?.find(
        (r) => r.id === "piano_tuning"
      );
      if (pianoTuningConfig) {
        perSlotCosts.push({
          description: "Piano Tuning",
          cost: pianoTuningConfig.cost,
        });
      }
    }

    // Calculate additional costs per room
    for (const roomSlug of roomSlugs) {
      const normalizedRoomSlug = roomSlug.replace(/-/g, "_");
      let projectorIncluded = false;

      // Check if backline includes projector
      const backlineResource = resources.find((r: string) => r === "backline");
      if (backlineResource) {
        const backlineConfig = this.additionalCosts?.resources?.find(
          (r) => r.id === "backline"
        );
        if (
          backlineConfig &&
          backlineConfig.rooms &&
          backlineConfig.rooms[normalizedRoomSlug]
        ) {
          const roomConfig = backlineConfig.rooms?.[normalizedRoomSlug];
          projectorIncluded = roomConfig?.includes_projector || false;
        }
      }

      for (const resource of resources) {
        const resourceConfig = this.additionalCosts?.resources.find(
          (r) => r.id === resource
        );

        if (resourceConfig) {
          let cost = resourceConfig.cost;
          let description = resourceConfig.description;
          let subDescription = "";

          switch (resource) {
            case "backline":
              const roomSpecificCost =
                resourceConfig.rooms?.[normalizedRoomSlug];
              if (roomSpecificCost) {
                cost = roomSpecificCost.cost;
                description = roomSpecificCost.description || description;
              } else {
                // If there's no room-specific cost, use the default cost
                cost = resourceConfig.cost;
              }
              break;

            case "bartender":
              if (isPrivate && expectedAttendance > 100) {
                cost = 0;
                subDescription = "Comped for large private event";
              } else {
                const hours = differenceInHours(parseISO(end), parseISO(start));
                if (
                  typeof resourceConfig?.cost === "number" &&
                  typeof hours === "number"
                ) {
                  cost = resourceConfig.cost * hours;
                }
              }
              break;

            case "projector":
              if (projectorIncluded) {
                continue; // Skip if projector is already included in backline
              }
              break;

            case "audio_tech":
              const baseCost = resourceConfig.cost;
              const overtimeConfig = this.additionalCosts?.resources.find(
                (r) => r.id === "audio_tech_overtime"
              );
              const totalHours = differenceInHours(
                parseISO(end),
                parseISO(start)
              );
              const regularHours = Math.min(totalHours, 7); // Only 7 hours max for base
              const overtimeHours = Math.max(0, totalHours - 7); // Anything over 7 hours is overtime

              // Calculate base cost for 7 hours
              additionalCosts.push({
                roomSlug,
                description: `Audio Technician (Base: 7 hours)`,
                cost: baseCost, // Base cost for up to 7 hours is fixed at $275
              });

              // Calculate overtime if there are any overtime hours
              if (overtimeHours > 0 && overtimeConfig) {
                const overtimeCost =
                  Number(overtimeConfig.cost) * Number(overtimeHours);
                additionalCosts.push({
                  roomSlug,
                  description: `Audio Technician Overtime (Overtime: ${overtimeHours} hours)`,
                  cost: overtimeCost,
                });
              }
              continue;

            case "door_staff":
            case "piano_tuning":
              // Skip these as they're now handled as per-slot costs
              continue;

            default:
              if (resourceConfig.type === "hourly") {
                const hours = differenceInHours(parseISO(end), parseISO(start));
                if (
                  typeof resourceConfig?.cost === "number" &&
                  typeof hours === "number"
                ) {
                  cost = resourceConfig.cost * hours;
                }
              }
          }

          additionalCosts.push({
            roomSlug,
            description,
            subDescription,
            cost: typeof cost === "number" ? cost : 0,
          });
        }
      }
    }

    return { perSlotCosts, additionalCosts };
  }

  // Helper method to determine if a given time is during evening hours
  isEveningTime(time: Date) {
    const hour = time.getHours();
    return hour >= 17 || hour < 5;
  }

  // Helper methods remain the same
  // Helper method to determine the end of the current pricing period
  getPeriodEnd(currentTime: Date, endTime: Date) {
    const eveningStart = new Date(currentTime);
    eveningStart.setHours(17, 0, 0, 0);
    const nextDayStart = new Date(currentTime);
    nextDayStart.setDate(nextDayStart.getDate() + 1);
    nextDayStart.setHours(5, 0, 0, 0);

    if (currentTime < eveningStart && eveningStart < endTime) {
      return eveningStart;
    } else if (currentTime >= eveningStart && nextDayStart < endTime) {
      return nextDayStart;
    } else {
      return endTime;
    }
  }

  // Helper method to determine if a given time is during evening hours

  calculatePeriodPrice(
    startTime: Date,
    endTime: Date,
    rules: any,
    isPrivate: boolean
  ) {
    const isEvening = this.isEveningTime(startTime);
    const periodRules = isEvening ? rules.evening : rules.daytime;

    if (!periodRules) {
      throw new Error(
        `No rules found for ${isEvening ? "evening" : "daytime"} period`
      );
    }

    const rate = periodRules[isPrivate ? "private" : "public"];
    const hours = Math.min(
      (Number(endTime) - Number(startTime)) / 3600000,
      isEvening ? 12 : 24 - new Date(startTime).getHours()
    );

    if (periodRules.type === "flat") {
      return { price: rate, hours };
    } else if (periodRules.type === "hourly") {
      const effectiveHours = Math.max(hours, periodRules.minimumHours || 0);
      return { price: effectiveHours * rate, hours };
    }

    throw new Error(
      `Invalid pricing type for ${isEvening ? "evening" : "daytime"} period`
    );
  }
}

function dateTimeToISOString(dateTime: Date): string {
  if (!isValid(dateTime)) {
    throw new Error("Invalid date passed to dateTimeToISOString");
  }
  return formatISO(dateTime);
}
