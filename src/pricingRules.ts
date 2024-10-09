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
  isPrivate?: boolean;
  expectedAttendance?: number;
  roomSlugs: string[];
  rooms?: RoomBooking[];
  startTime: {
    time: string;
  };
  endTime: {
    time: string;
  };
  date?: string;
  costItems?: any[];
}

interface RoomBooking {
  id: any;
  slug: any;
  roomSlug: string;
  additionalCosts?: AdditionalCost[];
  daytimeCostItem: any;
  eveningCostItem: any;
}

interface AdditionalCost {
  description: string;
  subDescription?: string;
  cost: number;
}

interface BookingRates {
  daytimeHours?: number;
  daytimePrice?: number;
  daytimeRate?: number;
  daytimeRateType?: string;
  eveningHours?: number;
  eveningPrice?: number;
  eveningRate?: number;
  eveningRateType?: string;
  crossoverApplied?: boolean;
  label?: string;
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
      // console.log("Data received in getPrice:", JSON.stringify(data, null, 2));
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
          // console.log("Booking in getPrice:", booking);
          let bookingTotal = 0;
          // console.log(
          //   "Inside getPrice - additionalCosts:",
          //   booking.rooms[0].additionalCosts
          // );

          const { estimates, perSlotCosts, slotTotal } =
            await this.calculatePrice(booking as Booking);

          // for (const estimate of estimates) {
          //   console.log("Estimate additionalCosts:", estimate.additionalCosts);
          //   bookingTotal += estimate.totalCost;
          // }

          try {
            // Use preparedBooking for validated and adjusted data`
            const preparedBooking: Booking =
              this.prepareBookingForPricing(booking);

            // console.log(
            //   "Prepared booking for pricing:",
            //   preparedBooking.rooms?.[0]?.additionalCosts
            // );
            const { estimates, perSlotCosts, slotTotal } =
              await this.calculatePrice({
                ...preparedBooking,
                date,
                resources: preparedBooking.resources || [],
                isPrivate: booking.private || false, // Use original booking's isPrivate
                expectedAttendance:
                  Number(preparedBooking.expectedAttendance) || 0,
              });
            // console.log("Estimates after calculatePrice:", estimates);

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
                ? estimate.additionalCosts.map(
                    (cost: {
                      description: any;
                      subDescription: any;
                      cost: any;
                    }) => ({
                      description: cost.description || "",
                      subDescription: cost.subDescription || "",
                      cost: cost.cost || 0,
                    })
                  )
                : [],
              totalCost: estimate.totalCost || 0,
              rateDescription: estimate.rateDescription || "",
              totalBookingHours: estimate.totalBookingHours || 0,
              isFullDay: estimate.isFullDay || false,
              daytimeDescription: estimate.daytimeDescription || "",
              eveningDescription: estimate.eveningDescription || "",
              daytimeCostItem: estimate.daytimeCostItem,
              eveningCostItem: estimate.eveningCostItem,
            }));
            // console.log("Formatted Estimates in getPrice:", formattedEstimates);
            const formattedPerSlotCosts = perSlotCosts.map((cost) => ({
              description: cost.description,
              subDescription: cost.subDescription,
              cost: cost.cost,
            }));

            const estimateTotal = formattedEstimates.reduce(
              (total, estimate) => {
                // console.log(`Estimate:`, estimate);

                const additionalCostsTotal = estimate.additionalCosts.reduce(
                  (sum: any, cost: { cost: any }) =>
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
            // console.log("Formatted perSlotCosts:", formattedPerSlotCosts);

            // Push to costEstimates
            costEstimates.push({
              id: booking.id || uuidv4(), // Use original booking id
              date: new Date(date), // Use `date` derived from `rentalDates` key
              start: new Date(preparedBooking.startTime.time),
              end: new Date(preparedBooking.endTime.time),
              estimates: formattedEstimates,
              perSlotCosts: formattedPerSlotCosts,
              costItems: booking.costItems || [], // Use costItems from original booking
              slotTotal: slotTotal,
              roomSlugs: preparedBooking.roomSlugs,
              isPrivate: booking.private, // Use `isPrivate` from original booking
              resources: preparedBooking.resources,
              expectedAttendance: preparedBooking.expectedAttendance,
            });

            grandTotal += slotTotal;
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
      // console.log(
      //   "Cost estimates before returning from getPrice:",
      //   costEstimates
      // );

      return { costEstimates, grandTotal, tax, totalWithTax };
    } catch (error: any) {
      console.error("Error in getPrice method:", error);
      return { costEstimates: [], grandTotal: 0, tax: 0, totalWithTax: 0 };
    }
  }

  prepareBookingForPricing(booking: Booking) {
    const {
      startTime,
      endTime,
      roomSlugs,
      resources = [],
      expectedAttendance = 0,
      isPrivate = false,
      costItems = [],
    } = booking;

    if (!roomSlugs || roomSlugs.length === 0) {
      throw new Error("Room slugs are undefined or empty in booking");
    }

    // Use startTime.time and endTime.time
    const startDateTime = toZonedTime(
      parseISO(startTime.time),
      TORONTO_TIMEZONE
    );
    const endDateTime = toZonedTime(parseISO(endTime.time), TORONTO_TIMEZONE);

    if (!isValid(startDateTime) || !isValid(endDateTime)) {
      console.error("Invalid start or end time in booking data:", {
        startTime,
        endTime,
      });
      throw new Error("Invalid start or end time in booking data");
    }

    return {
      ...booking,
      resources, // Include resources explicitly
      expectedAttendance, // Include expectedAttendance explicitly
      isPrivate, // Include isPrivate explicitly
      rooms: (booking.rooms || []).map((room) => ({
        ...room,
        daytimeCostItem: room.daytimeCostItem || null,
        eveningCostItem: room.eveningCostItem || null,
      })),
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

  async calculatePrice(booking: Booking): Promise<{
    estimates: any[];
    perSlotCosts: any[];
    slotTotal: number;
  }> {
    // Validate the input booking object
    if (
      !booking.startTime?.time ||
      !booking.endTime?.time ||
      !booking.roomSlugs ||
      booking.roomSlugs.length === 0
    ) {
      throw new Error(
        "Booking data is missing required fields:" +
          JSON.stringify(booking, null, 2)
      );
    }

    const {
      roomSlugs,
      startTime,
      endTime,
      isPrivate,
      expectedAttendance,
      resources,
      date,
      rooms,
    } = booking;

    const estimates: any[] = [];

    // Use .time to access the actual time values
    const startDateTime = toZonedTime(
      parseISO(startTime.time),
      TORONTO_TIMEZONE
    );
    const endDateTime = toZonedTime(parseISO(endTime.time), TORONTO_TIMEZONE);

    const currentDay = format(startDateTime, "EEEE", {
      timeZone: TORONTO_TIMEZONE,
    });

    const { perSlotCosts, additionalCosts } =
      await this.calculateAdditionalCosts(booking);

    let slotTotal = 0;

    for (const roomSlug of roomSlugs) {
      if (!this.rules) throw new Error("Rules are not initialized");
      const roomRules = this.rules[roomSlug];
      if (!roomRules) {
        throw new Error(`No pricing rules found for room: ${roomSlug}`);
      }

      const dayRules = roomRules[currentDay] || roomRules["all"];
      if (!dayRules) {
        throw new Error(
          `No pricing rules found for room ${roomSlug} on ${currentDay}`
        );
      }

      let basePrice = 0;
      let daytimeHours = 0;
      let eveningHours = 0;
      let daytimePrice = dayRules.daytime
        ? dayRules.daytime[isPrivate ? "private" : "public"] || 0
        : 0;
      let eveningPrice = 0;
      let fullDayPrice = 0;
      let daytimeRate = 0;
      let eveningRate = 0;
      let daytimeRateType = "";
      let eveningRateType = "";
      let crossoverApplied = false;

      const eveningStartTime = new Date(startDateTime); // Corrected
      eveningStartTime.setHours(17, 0, 0, 0);

      const totalBookingHours = differenceInHours(endDateTime, startDateTime); // Corrected

      const bookingCrossesEveningThreshold =
        startDateTime < eveningStartTime && endDateTime > eveningStartTime;

      // Full Day Logic
      if (dayRules.fullDay) {
        const fullDayRate = dayRules.fullDay[isPrivate ? "private" : "public"];
        if (dayRules.fullDay.type === "flat") {
          fullDayPrice = fullDayRate;
          basePrice = fullDayPrice;
        } else if (dayRules.fullDay.type === "hourly") {
          const effectiveHours = Math.max(
            totalBookingHours,
            dayRules.fullDay.minimumHours || 0
          );
          fullDayPrice = fullDayRate * effectiveHours;
          basePrice = fullDayPrice;
        }
      } else {
        // Daytime Calculation
        if (startDateTime < eveningStartTime && dayRules.daytime) {
          const daytimeEndTime = bookingCrossesEveningThreshold
            ? eveningStartTime
            : endDateTime;
          daytimeHours = differenceInHours(daytimeEndTime, startDateTime); // Corrected
          daytimeRate = dayRules.daytime[isPrivate ? "private" : "public"];
          daytimeRateType = dayRules.daytime.type;

          // Check if a crossover rate applies
          if (
            bookingCrossesEveningThreshold &&
            dayRules.daytime.crossoverRate
          ) {
            daytimeRate = dayRules.daytime.crossoverRate;
            crossoverApplied = true;
          }

          daytimePrice = daytimeRate * daytimeHours;
          basePrice += daytimePrice;
        }

        // Evening Calculation
        if (endDateTime > eveningStartTime && dayRules.evening) {
          eveningHours = differenceInHours(endDateTime, eveningStartTime); // Corrected
          eveningRate = dayRules.evening[isPrivate ? "private" : "public"];
          eveningRateType = dayRules.evening.type;

          if (eveningRateType === "flat") {
            eveningPrice = eveningRate;
          } else if (eveningRateType === "hourly") {
            eveningPrice = eveningRate * eveningHours;
          }

          basePrice += eveningPrice;
        }

        // Apply minimum hours if necessary
        if (
          dayRules.minimumHours &&
          totalBookingHours < dayRules.minimumHours
        ) {
          const minimumPrice =
            basePrice * (dayRules.minimumHours / totalBookingHours);
          if (minimumPrice > basePrice) {
            basePrice = minimumPrice;
          }
        }
      }

      const formattedDaytimeDescription = this.generateRateDescription({
        daytimeHours,
        daytimePrice,
        daytimeRate,
        daytimeRateType,
        crossoverApplied,
      });

      const formattedEveningDescription = this.generateRateDescription({
        eveningHours,
        eveningRate,
        eveningPrice,
        eveningRateType,
      });

      slotTotal += basePrice;
      const roomAdditionalCosts = additionalCosts.filter(
        (cost) => cost.roomSlug === roomSlug
      );
      const roomAdditionalCostsTotal = roomAdditionalCosts.reduce(
        (sum, cost) => sum + (Number(cost.cost) || 0),
        0
      );

      estimates.push({
        roomSlug,
        basePrice,
        daytimeHours,
        eveningHours,
        daytimePrice,
        eveningPrice,
        fullDayPrice,
        daytimeRate,
        eveningRate,
        daytimeRateType,
        eveningRateType,
        additionalCosts: roomAdditionalCosts,
        totalCost: basePrice + roomAdditionalCostsTotal,
        daytimeCostItem:
          daytimePrice > 0
            ? {
                id: uuidv4(),
                description: "Daytime Hours",
                subDescription: formattedDaytimeDescription || "",
                cost: daytimePrice,
              }
            : null,
        eveningCostItem:
          eveningPrice > 0
            ? {
                id: uuidv4(),
                description: "Evening Hours",
                subDescription: formattedEveningDescription || "",
                cost: eveningPrice,
              }
            : null,
        minimumHours: dayRules.minimumHours,
        totalBookingHours,
        isFullDay: !!dayRules.fullDay,
      });
    }
    const perSlotCostsTotal = perSlotCosts.reduce(
      (sum, cost) => sum + (Number(cost.cost) || 0),
      0
    );
    slotTotal += perSlotCostsTotal;

    return { estimates, perSlotCosts, slotTotal };
  }

  async calculateAdditionalCosts(booking: any) {
    // console.log(
    //   "calculateAdditionalCosts - Input booking:",
    //   JSON.stringify(booking, null, 2)
    // );

    const {
      resources,
      roomSlugs,
      start,
      end,
      isPrivate,
      expectedAttendance,
      rooms,
    } = booking;
    let perSlotCosts = [];
    let additionalCosts = [];

    const venueOpeningTime = new Date(start);
    venueOpeningTime.setHours(18, 0, 0, 0);
    const bookingStartTime = new Date(start);
    const bookingEndTime = new Date(end);

    // const isSouthernCrossExempt =
    //   roomSlugs.includes("southern-cross") &&
    //   bookingStartTime.getHours() < 16 &&
    //   bookingEndTime.getHours() >= 11;

    if (bookingStartTime < venueOpeningTime) {
      let earlyOpenEndTime = venueOpeningTime; // Default to venue opening time

      // Check for Southern Cross exemption
      // if (isSouthernCrossExempt) {
      //   if (bookingStartTime.getHours() < 11) {
      //     earlyOpenEndTime = new Date(start);
      //     earlyOpenEndTime.setHours(11, 0, 0, 0);
      //   } else if (bookingEndTime.getHours() > 16) {
      //     earlyOpenEndTime = new Date(start);
      //     earlyOpenEndTime.setHours(venueOpeningTime.getHours(), 0, 0, 0);
      //   } else {
      //     // Fully exempt from early open fee if completely within 11 am - 4 pm
      //     earlyOpenEndTime = bookingStartTime;
      //   }
      // }

      // Calculate early open hours only if there's a valid period before earlyOpenEndTime
      const earlyOpenHours = Math.ceil(
        differenceInHours(earlyOpenEndTime, bookingStartTime)
      );

      if (earlyOpenHours > 0) {
        perSlotCosts.push({
          description: `Early Open Staff (${earlyOpenHours} hours)`,
          subDescription: "Additional staff for early opening",
          cost: earlyOpenHours * 30,
        });
      }
    }

    if (roomSlugs.includes("parking-lot")) {
      perSlotCosts.push({
        description: "Security (required)",
        subDescription: "Will quote separately",
        cost: 0,
      });
    }
    if (resources.includes("food")) {
      const foodConfig = this.additionalCosts?.resources?.find(
        (r) => r.id === "food"
      );
      if (foodConfig) {
        perSlotCosts.push({
          description: foodConfig.description,
          subDescription: foodConfig.subDescription,
          cost: foodConfig.cost,
        });
      }
    }
    // Door Staff calculation
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
            subDescription: "Dedicated staff for entrance management",
            cost: doorStaffCost,
          });
        }
      }
    }
    // Piano Tuning
    if (resources.includes("piano_tuning")) {
      const pianoTuningConfig = this.additionalCosts?.resources?.find(
        (r) => r.id === "piano_tuning"
      );
      if (pianoTuningConfig) {
        perSlotCosts.push({
          description: "Piano Tuning",
          subDescription: "One-time tuning service",
          cost: pianoTuningConfig.cost,
        });
      }
    }

    // Process room-specific additional costs
    for (const room of rooms) {
      if (room.additionalCosts && Array.isArray(room.additionalCosts)) {
        // Filter out any door staff costs from room additional costs
        const roomCosts = room.additionalCosts.filter(
          (cost: any) => !cost.description.toLowerCase().includes("door staff")
        );
        additionalCosts.push(
          ...roomCosts.map((cost: any) => ({
            ...cost,
            roomSlug: room.roomSlug,
          }))
        );
      }
    }

    // console.log(
    //   "calculateAdditionalCosts - Result:",
    //   JSON.stringify({ perSlotCosts, additionalCosts }, null, 2)
    // );

    return {
      perSlotCosts: perSlotCosts.map((cost) => ({ ...cost, id: uuidv4() })),
      additionalCosts: additionalCosts.map((cost) => ({
        ...cost,
        id: cost.id || uuidv4(),
      })),
    };
  }
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
  generateRateDescription({
    daytimeHours,
    daytimePrice,
    daytimeRate,
    daytimeRateType,
    eveningHours = 0,
    eveningPrice,
    eveningRate,
    eveningRateType,
    crossoverApplied,
  }: BookingRates): string {
    // Ensure default values for missing properties
    let rateDescription = "";

    if ((daytimeHours ?? 0) > 0) {
      const hourlyRate = ((daytimePrice ?? 0) / (daytimeHours ?? 0)).toFixed(2);
      rateDescription = `$${hourlyRate}/hour`;
      if (crossoverApplied) {
        rateDescription += " (crossover rate)";
      }
    } else if (eveningRateType === "flat") {
      rateDescription = "Flat rate";
    } else if (eveningHours > 0) {
      const hourlyEveningRate = ((eveningPrice ?? 0) / eveningHours).toFixed(2);
      rateDescription = `$${hourlyEveningRate}/hour`;
    }

    return rateDescription;
  }
}

function dateTimeToISOString(dateTime: Date): string {
  if (!isValid(dateTime)) {
    throw new Error("Invalid date passed to dateTimeToISOString");
  }
  return formatISO(dateTime);
}
