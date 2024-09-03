// pricing-lib/src/pricingRules.js
import mongoose from "mongoose";
import {
  getPricingRuleModel,
  getTimePeriodModel,
  getAdditionalCostModel,
} from "./models/pricing.schema";

// Initialize models using the factory functions
const PricingRule = getPricingRuleModel(mongoose);
const TimePeriod = getTimePeriodModel(mongoose);
const AdditionalCost = getAdditionalCostModel(mongoose);

import { formatISO, parseISO, isValid, differenceInHours } from "date-fns";
import { format, toZonedTime } from "date-fns-tz";

const TORONTO_TIMEZONE = "America/Toronto";

export default class PricingRules {
  constructor() {
    this.timePeriods = null;
    this.rules = null;
    this.additionalCosts = null;
  }

  async initialize() {
    if (!this.rules) {
      try {
        const rulesFromDB = await PricingRule.find().lean();
        this.rules = rulesFromDB.reduce((acc, rule) => {
          acc[rule.roomSlug] = rule.pricing;
          return acc;
        }, {});

        this.timePeriods = await TimePeriod.find().lean();
        this.additionalCosts = await AdditionalCost.findOne().lean();
      } catch (error) {
        console.error("Error fetching pricing data from database:", error);
        throw error;
      }
    }
  }

  async getPrice(data) {
    try {
      await this.initialize();
      const costEstimates = [];
      let grandTotal = 0;

      for (const [date, bookings] of Object.entries(data.rentalDates)) {
        for (const booking of bookings) {
          try {
            const preparedBooking = this.prepareBookingForPricing(booking);
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
          } catch (error) {
            console.error(
              `Error calculating price for booking ${booking.id}:`,
              error
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

      return { costEstimates, grandTotal };
    } catch (error) {
      console.error("Error in getPrice method:", error);
      return { costEstimates: [], grandTotal: 0, error: error.message };
    }
  }

  prepareBookingForPricing(booking) {
    const { start, end, roomSlugs } = booking;

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

  async calculatePrice(booking) {
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
      const roomRules = this.rules[roomSlug];
      if (!roomRules) {
        throw new Error(`No pricing rules found for room: ${roomSlug}`);
      }

      let totalPrice = 0;
      let daytimePrice = 0;
      let eveningPrice = 0;
      let daytimeHours = 0;
      let eveningHours = 0;

      const startTime = toZonedTime(parseISO(start), TORONTO_TIMEZONE);
      const endTime = toZonedTime(parseISO(end), TORONTO_TIMEZONE);
      const currentDay = format(startTime, "EEEE", {
        timeZone: TORONTO_TIMEZONE,
      });
      const dayRules = Object.entries(roomRules).find(
        ([day]) =>
          day.toLowerCase() === currentDay.toLowerCase() ||
          day.toLowerCase() === "all"
      )?.[1];

      if (!dayRules) {
        throw new Error(
          `No pricing rules found for room ${roomSlug} on ${currentDay}`
        );
      }

      if (
        dayRules.fullDay &&
        typeof dayRules.fullDay[isPrivate ? "private" : "public"] === "number"
      ) {
        // Apply full day rate if it exists and is a number
        totalPrice = dayRules.fullDay[isPrivate ? "private" : "public"];
        const totalHours = differenceInHours(endTime, startTime);
        if (this.isEveningTime(startTime)) {
          eveningHours = totalHours;
          eveningPrice = totalPrice;
        } else {
          daytimeHours = totalHours;
          daytimePrice = totalPrice;
        }
      } else {
        const eveningStartTime = new Date(startTime);
        eveningStartTime.setHours(17, 0, 0, 0);

        const bookingCrossesEveningThreshold =
          startTime < eveningStartTime && endTime > eveningStartTime;

        if (startTime < eveningStartTime) {
          // Calculate daytime price
          const daytimeEndTime = bookingCrossesEveningThreshold
            ? eveningStartTime
            : endTime;
          daytimeHours = differenceInHours(daytimeEndTime, startTime);
          const daytimeRate = bookingCrossesEveningThreshold
            ? dayRules.daytime.crossoverRate ||
              dayRules.daytime[isPrivate ? "private" : "public"]
            : dayRules.daytime[isPrivate ? "private" : "public"];

          if (dayRules.daytime.type === "hourly") {
            if (bookingCrossesEveningThreshold) {
              // Apply crossover rate without minimum hours
              daytimePrice = daytimeRate * daytimeHours;
            } else {
              // Apply regular rate with minimum hours
              daytimePrice =
                daytimeRate *
                Math.max(daytimeHours, dayRules.daytime.minimumHours || 0);
            }
          } else {
            // Flat rate
            daytimePrice = daytimeRate;
          }
        }

        if (endTime > eveningStartTime) {
          // Calculate evening price
          eveningHours = differenceInHours(endTime, eveningStartTime);
          if (dayRules.evening.type === "hourly") {
            eveningPrice =
              dayRules.evening[isPrivate ? "private" : "public"] * eveningHours;
          } else {
            // Flat rate
            eveningPrice = dayRules.evening[isPrivate ? "private" : "public"];
          }
        }

        totalPrice = daytimePrice + eveningPrice;
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
        additionalCosts: roomAdditionalCosts,
        totalCost: totalPrice + roomAdditionalCostTotal,
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

  // Helper method to determine if a given time is during evening hours
  isEveningTime(time) {
    const hour = time.getHours();
    return hour >= 17 || hour < 5;
  }

  // Helper methods remain the same
  // Helper method to determine the end of the current pricing period
  getPeriodEnd(currentTime, endTime) {
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

  calculatePeriodPrice(startTime, endTime, rules, isPrivate) {
    const isEvening = this.isEveningTime(startTime);
    const periodRules = isEvening ? rules.evening : rules.daytime;

    if (!periodRules) {
      throw new Error(
        `No rules found for ${isEvening ? "evening" : "daytime"} period`
      );
    }

    const rate = periodRules[isPrivate ? "private" : "public"];
    const hours = Math.min(
      (endTime - startTime) / 3600000,
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

  async calculateAdditionalCosts(booking) {
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
        description: "Security – will be quoted separately",
        cost: 0,
      });
    }

    // Add Door Staff to per-slot costs
    if (resources.includes("door_staff")) {
      const doorStaffConfig = this.additionalCosts.resources.find(
        (r) => r.id === "door_staff"
      );
      if (doorStaffConfig) {
        const hours = differenceInHours(parseISO(end), parseISO(start));
        const doorStaffCost = doorStaffConfig.cost * hours;
        perSlotCosts.push({
          description: `Door Staff (${hours} hours)`,
          cost: doorStaffCost,
        });
      }
    }

    // Add Piano Tuning to per-slot costs
    if (resources.includes("piano_tuning")) {
      const pianoTuningConfig = this.additionalCosts.resources.find(
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
      const backlineResource = resources.find((r) => r === "backline");
      if (backlineResource) {
        const backlineConfig = this.additionalCosts.resources.find(
          (r) => r.id === "backline"
        );
        if (backlineConfig && backlineConfig.rooms[normalizedRoomSlug]) {
          projectorIncluded =
            backlineConfig.rooms[normalizedRoomSlug].includes_projector ||
            false;
        }
      }

      for (const resource of resources) {
        const resourceConfig = this.additionalCosts.resources.find(
          (r) => r.id === resource
        );

        if (resourceConfig) {
          let cost = resourceConfig.cost;
          let description = resourceConfig.description;
          let subDescription = "";

          switch (resource) {
            case "backline":
              const roomSpecificCost = resourceConfig.rooms[normalizedRoomSlug];
              if (roomSpecificCost) {
                cost = roomSpecificCost.cost;
                description = roomSpecificCost.description || description;
              } else {
                cost = "Will be quoted separately";
              }
              break;

            case "bartender":
              if (isPrivate && expectedAttendance > 100) {
                cost = 0;
                subDescription = "Comped for large private event";
              } else {
                const hours = differenceInHours(parseISO(end), parseISO(start));
                cost = resourceConfig.cost * hours;
              }
              break;

            case "projector":
              if (projectorIncluded) {
                continue; // Skip if projector is already included in backline
              }
              break;

            case "audio_tech":
              const baseCost = resourceConfig.cost;
              const overtimeConfig = this.additionalCosts.resources.find(
                (r) => r.id === "audio_tech_overtime"
              );
              const totalHours = differenceInHours(
                parseISO(end),
                parseISO(start)
              );
              const overtimeHours = Math.max(0, totalHours - 7);
              cost = baseCost + overtimeHours * overtimeConfig.cost;
              description += ` (${Math.ceil(totalHours)} hours)`;
              break;

            case "door_staff":
            case "piano_tuning":
              // Skip these as they're now handled as per-slot costs
              continue;

            default:
              if (resourceConfig.type === "hourly") {
                const hours = differenceInHours(parseISO(end), parseISO(start));
                cost = resourceConfig.cost * hours;
              }
          }

          additionalCosts.push({
            roomSlug,
            description,
            subDescription,
            cost:
              cost === "Will quote separately"
                ? "Will be quoted separately"
                : cost,
          });
        }
      }
    }

    return { perSlotCosts, additionalCosts };
  }
}

function dateTimeToISOString(dateTime) {
  if (!isValid(dateTime)) {
    throw new Error("Invalid date passed to dateTimeToISOString");
  }
  return formatISO(dateTime);
}
