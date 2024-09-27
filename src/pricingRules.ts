// pricing-lib/src/pricingRules.js
import { v4 as uuidv4 } from "uuid";

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
  rooms?: any[];
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

          // console.log(console.log("Successfully fetched pricing rules"););
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

  calculateTax(grandTotal: number): number {
    return Number((grandTotal * HST_RATE).toFixed(2));
  }

  calculateTotalWithTax(grandTotal: number): number {
    const tax = this.calculateTax(grandTotal);
    return Number((grandTotal + tax).toFixed(2));
  }

  // async getPrice(data: any): Promise<{
  //   costEstimates: any[];
  //   grandTotal: number;
  //   tax: number;
  //   totalWithTax: number;
  // }> {
  //   try {
  //     await this.initialize();
  //     const costEstimates = [];
  //     let grandTotal = 0;

  //     for (const [date, bookings] of Object.entries(data.rentalDates)) {
  //       for (const booking of bookings as any[]) {
  //         try {
  //           const preparedBooking: Booking =
  //             this.prepareBookingForPricing(booking);
  //           const { estimates, perSlotCosts, slotTotal } =
  //             await this.calculatePrice({
  //               ...preparedBooking,
  //               date,
  //               resources: preparedBooking.resources || [],
  //               isPrivate: preparedBooking.private || false,
  //               expectedAttendance:
  //                 Number(preparedBooking.expectedAttendance) || 0,
  //             });

  //           const formattedEstimates = estimates.map((estimate) => ({
  //             roomSlug: estimate.roomSlug,
  //             basePrice: estimate.basePrice,
  //             daytimeHours: estimate.daytimeHours || 0,
  //             eveningHours: estimate.eveningHours || 0,
  //             daytimePrice: estimate.daytimePrice || 0,
  //             eveningPrice: estimate.eveningPrice || 0,
  //             fullDayPrice: estimate.fullDayPrice || 0,
  //             daytimeRate: estimate.daytimeRate,
  //             daytimeRateType: estimate.daytimeRateType,
  //             eveningRate: estimate.eveningRate,
  //             eveningRateType: estimate.eveningRateType,
  //             additionalCosts: (estimate.additionalCosts || []).map((cost) => ({
  //               description: cost.description,
  //               subDescription: cost.subDescription,
  //               cost: cost.cost,
  //             })),
  //             totalCost: estimate.totalCost,
  //             rateDescription: estimate.rateDescription,
  //             rateSubDescription: estimate.rateSubDescription,
  //             totalBookingHours: estimate.totalBookingHours,
  //             isFullDay: estimate.isFullDay,
  //           }));

  //           const formattedPerSlotCosts = perSlotCosts.map((cost) => ({
  //             description: cost.description,
  //             subDescription: cost.subDescription,
  //             cost: cost.cost,
  //           }));

  //           const estimateTotal = formattedEstimates.reduce(
  //             (total, estimate) => {
  //               const additionalCostsTotal = estimate.additionalCosts.reduce(
  //                 (sum, cost) => sum + cost.cost,
  //                 0
  //               );
  //               return total + estimate.totalCost + additionalCostsTotal;
  //             },
  //             0
  //           );

  //           const perSlotCostsTotal = formattedPerSlotCosts.reduce(
  //             (total, cost) => total + cost.cost,
  //             0
  //           );

  //           const totalForThisBooking = estimateTotal + perSlotCostsTotal;

  //           costEstimates.push({
  //             id: uuidv4(),
  //             date: new Date(date),
  //             start: new Date(preparedBooking.start),
  //             end: new Date(preparedBooking.end),
  //             estimates: formattedEstimates,
  //             perSlotCosts: formattedPerSlotCosts,
  //             slotTotal: totalForThisBooking,
  //           });

  //           grandTotal += totalForThisBooking;
  //         } catch (error: any) {
  //           console.error(
  //             `Error calculating price for booking ${booking.id}:`,
  //             error
  //           );
  //           costEstimates.push({
  //             id: uuidv4(),
  //             date: new Date(date),
  //             start: new Date(booking.start),
  //             end: new Date(booking.end),
  //             estimates: [],
  //             perSlotCosts: [],
  //             slotTotal: 0,
  //             error: error.message,
  //           });
  //         }
  //       }
  //     }

  //     const tax = this.calculateTax(grandTotal);
  //     const totalWithTax = this.calculateTotalWithTax(grandTotal);

  //     return { costEstimates, grandTotal, tax, totalWithTax };
  //   } catch (error: any) {
  //     console.error("Error in getPrice method:", error);
  //     return { costEstimates: [], grandTotal: 0, tax: 0, totalWithTax: 0 };
  //   }
  // }
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
      console.log("Data received in getPrice:", JSON.stringify(data, null, 2));
      if (!data.rentalDates || typeof data.rentalDates !== "object") {
        console.error("Invalid rentalDates structure:", data.rentalDates);
        throw new Error("rentalDates is not defined or not an object.");
      }

      for (const [date, bookings] of Object.entries(data.rentalDates)) {
        if (!Array.isArray(bookings)) {
          console.error(
            `Expected an array of bookings for date ${date}, but got:`,
            bookings
          );
          continue;
        }
        if (isNaN(new Date(date).getTime())) {
          console.warn("Invalid date found in rentalDates:", date);
        }

        for (const booking of bookings as any[]) {
          console.log("Booking in getPrice:", booking);
          let bookingTotal = 0;
          console.log(
            "Inside getPrice - additionalCosts:",
            booking.rooms[0].additionalCosts
          );

          const { estimates } = await this.calculatePrice(booking);
          for (const estimate of estimates) {
            console.log("Estimate additionalCosts:", estimate.additionalCosts);
            bookingTotal += estimate.totalCost;
          }

          try {
            // Use preparedBooking for validated and adjusted data
            const preparedBooking: Booking =
              this.prepareBookingForPricing(booking);

            console.log(
              "Prepared booking for pricing:",
              preparedBooking.rooms?.[0]?.additionalCosts
            );
            const { estimates, perSlotCosts, slotTotal } =
              await this.calculatePrice({
                ...preparedBooking,
                date,
                resources: preparedBooking.resources || [],
                isPrivate: booking.private || false, // Use original booking's isPrivate
                expectedAttendance:
                  Number(preparedBooking.expectedAttendance) || 0,
              });
            console.log("Estimates after calculatePrice:", estimates);

            const formattedEstimates = estimates.map((estimate) => ({
              roomSlug: estimate.roomSlug || "",
              basePrice: estimate.basePrice || 0,
              daytimeHours: estimate.daytimeHours || 0,
              eveningHours: estimate.eveningHours || 0,
              daytimePrice: estimate.daytimePrice || 0,
              eveningPrice: estimate.eveningPrice || 0,
              fullDayPrice: estimate.fullDayPrice || 0,
              daytimeRate: estimate.daytimeRate || 0,
              daytimeRateType: estimate.daytimeRateType || "",
              eveningRate: estimate.eveningRate || 0,
              eveningRateType: estimate.eveningRateType || "",
              additionalCosts: Array.isArray(estimate.additionalCosts)
                ? estimate.additionalCosts.map((cost) => ({
                    description: cost.description || "",
                    subDescription: cost.subDescription || "",
                    cost: cost.cost || 0,
                  }))
                : [],
              totalCost: estimate.totalCost || 0,
              rateDescription: estimate.rateDescription || "",
              rateSubDescription: estimate.rateSubDescription || "",
              totalBookingHours: estimate.totalBookingHours || 0,
              isFullDay: estimate.isFullDay || false,
            }));
            console.log("Formatted estimates:", formattedEstimates);
            const formattedPerSlotCosts = perSlotCosts.map((cost) => ({
              description: cost.description,
              subDescription: cost.subDescription,
              cost: cost.cost,
            }));

            const estimateTotal = formattedEstimates.reduce(
              (total, estimate) => {
                console.log(`Estimate:`, estimate);

                const additionalCostsTotal = estimate.additionalCosts.reduce(
                  (sum, cost) =>
                    sum + (typeof cost.cost === "number" ? cost.cost : 0),
                  0
                );

                return total + estimate.totalCost + additionalCostsTotal;
              },
              0
            );

            const perSlotCostsTotal = formattedPerSlotCosts.reduce(
              (total: any, cost: { cost: any }) => total + cost.cost,
              0
            );

            const totalForThisBooking = estimateTotal + perSlotCostsTotal;

            // Accumulate the booking total
            for (const costItem of booking.costItems || []) {
              bookingTotal += costItem.cost;
            }
            console.log("Formatted perSlotCosts:", formattedPerSlotCosts);

            // Push to costEstimates
            costEstimates.push({
              id: booking.id || uuidv4(), // Use original booking id
              date: new Date(date), // Use `date` derived from `rentalDates` key
              start: new Date(preparedBooking.start),
              end: new Date(preparedBooking.end),
              estimates: formattedEstimates,
              perSlotCosts: formattedPerSlotCosts,
              costItems: booking.costItems || [], // Use costItems from original booking
              slotTotal: totalForThisBooking,
              roomSlugs: preparedBooking.roomSlugs,
              isPrivate: booking.private, // Use `isPrivate` from original booking
              resources: preparedBooking.resources,
              expectedAttendance: preparedBooking.expectedAttendance,
            });

            grandTotal += totalForThisBooking;
          } catch (error: any) {
            console.error(
              `Error calculating price for booking ${booking.id}:`,
              error
            );
            costEstimates.push({
              id: booking.id || uuidv4(),
              date: new Date(date),
              start: new Date(booking.start),
              end: new Date(booking.end),
              estimates: [],
              perSlotCosts: [],
              slotTotal: 0,
              error: error.message,
            });
          }
        }
      }

      const tax = this.calculateTax(grandTotal);
      const totalWithTax = this.calculateTotalWithTax(grandTotal);
      console.log(
        "Cost estimates before returning from getPrice:",
        costEstimates
      );

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
    rooms?: any[];
    costItems?: Array<{
      description: string;
      subDescription?: string;
      cost: number;
    }>;
    resources?: string[];
    expectedAttendance?: number;
    private?: boolean;
  }) {
    const {
      start,
      end,
      roomSlugs,
      resources = [],
      expectedAttendance = 0,
      private: isPrivate = false,
      costItems = [],
    } = booking;
    console.log("Booking in prepareBookingForPricing:", booking);

    // Validate `roomSlugs`
    if (!roomSlugs || roomSlugs.length === 0) {
      throw new Error("Room slugs are undefined or empty in booking");
    }

    // Parse `start` and `end` times into proper date objects
    const startDateTime = toZonedTime(parseISO(start), TORONTO_TIMEZONE);
    const endDateTime = toZonedTime(parseISO(end), TORONTO_TIMEZONE);

    // Validate `startDateTime` and `endDateTime`
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
      costItems,
      resources,
      expectedAttendance,
      isPrivate, // Align `private` field as `isPrivate`
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
      rooms,
    } = booking;
    let estimates = [];
    let perSlotCosts = [];

    const startTime = toZonedTime(parseISO(start), "America/Toronto");
    const endTime = toZonedTime(parseISO(end), "America/Toronto");
    const currentDay = format(startTime, "EEEE", {
      timeZone: "America/Toronto",
    });

    // Fetch additional costs related to the booking

    const { perSlotCosts: calculatedPerSlotCosts, additionalCosts = [] } =
      await this.calculateAdditionalCosts({
        roomSlugs,
        start,
        end,
        date,
        rooms,
        isPrivate,
        expectedAttendance,
        resources,
      });

    console.log(
      "Additional costs returned from calculateAdditionalCosts:",
      additionalCosts
    );

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
      let slotTotal = 0;

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
        (sum: any, cost: { cost: any }) =>
          sum + (typeof cost.cost === "number" ? cost.cost : 0),
        0
      );
      slotTotal += roomAdditionalCosts.reduce(
        (sum, cost) => sum + (Number(cost.cost) || 0),
        0
      );

      estimates.push({
        roomSlug,
        basePrice: totalPrice,
        daytimeHours,
        eveningHours,
        daytimePrice,
        eveningPrice,
        fullDayPrice,
        daytimeRate: dayRules.daytime?.[isPrivate ? "private" : "public"],
        daytimeRateType: dayRules.daytime?.type || null,
        eveningRate: dayRules.evening?.[isPrivate ? "private" : "public"],
        eveningRateType: dayRules.evening?.type || null,
        additionalCosts: roomAdditionalCosts, // Ensure this line is included
        totalCost:
          totalPrice +
          roomAdditionalCosts.reduce(
            (sum, cost) => sum + (Number(cost.cost) || 0),
            0
          ),
        rateDescription,
        rateSubDescription,
        minimumHours: dayRules.minimumHours || dayRules.fullDay?.minimumHours,
        totalBookingHours,
        isFullDay: !!dayRules.fullDay,
      });
    }
    let slotTotal = 0;
    slotTotal += perSlotCosts.reduce(
      (sum, cost) => sum + (Number(cost.cost) || 0),
      0
    );

    const perSlotCostTotal = perSlotCosts.reduce(
      (sum, cost) => sum + (typeof cost.cost === "number" ? cost.cost : 0),
      0
    );
    return { estimates, perSlotCosts, slotTotal };
  }

  async calculateAdditionalCosts(booking: any) {
    const { resources, roomSlugs, start, end, isPrivate, expectedAttendance } =
      booking;

    let perSlotCosts = [];
    let additionalCosts = [];
    const venueOpeningTime = new Date(start);
    venueOpeningTime.setHours(18, 0, 0, 0);
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

    if (roomSlugs.includes("parking-lot")) {
      // console.log(console.log("Parking Lot Booking Detected"););
      perSlotCosts.push({
        description: "Security (required)",
        subDescription: "Will quote separately",
        cost: 0,
      });
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

          // console.log(console.log("Cleaning resource config:", resourceConfig););

          switch (resource) {
            case "food":
              additionalCosts.push({
                roomSlug,
                description: resourceConfig.description,
                subDescription: resourceConfig.subDescription, // Ensure this is included
                cost: resourceConfig.cost,
              });
              break;

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
              additionalCosts.push({
                roomSlug,
                description,
                subDescription: resourceConfig.subDescription,
                cost,
              });
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
              additionalCosts.push({
                roomSlug,
                description: resourceConfig.description,
                subDescription,
                cost,
              });
              break;

            case "projector":
              if (projectorIncluded) {
                break; // Skip if projector is already included in backline
              }
              additionalCosts.push({
                roomSlug,
                description: resourceConfig.description,
                subDescription: resourceConfig.subDescription,
                cost: resourceConfig.cost,
              });
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
                description: resourceConfig.description,
                subDescription: resourceConfig.subDescription,
                cost: baseCost, // Base cost for up to 7 hours is fixed at $275
              });

              // Calculate overtime if there are any overtime hours
              if (overtimeHours > 0 && overtimeConfig) {
                const overtimeCost =
                  Number(overtimeConfig.cost) * Number(overtimeHours);
                additionalCosts.push({
                  roomSlug,
                  description: overtimeConfig.description,
                  subDescription: overtimeConfig.subDescription,
                  cost: overtimeCost,
                });
              }
              break;

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
              additionalCosts.push({
                roomSlug,
                description: resourceConfig.description,
                subDescription: resourceConfig.subDescription,
                cost: typeof cost === "number" ? cost : 0,
              });
              break;
          }
        }
      }
    }
    perSlotCosts = perSlotCosts.map((cost) => ({
      id: uuidv4(), // Add a unique id to each per-slot cost
      ...cost,
    }));
    console.log("Booking Data:", booking);
    console.log("Room Slugs:", roomSlugs);
    console.log("Final Costs:", {
      perSlotCosts: perSlotCosts || [],
      additionalCosts: additionalCosts || [],
    });

    return {
      perSlotCosts: perSlotCosts || [],
      additionalCosts: additionalCosts || [],
    };
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
