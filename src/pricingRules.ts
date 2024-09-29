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
  start: string;
  end: string;
  date?: string;
  costItems?: any[];
}

interface RoomBooking {
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

  private cache: Map<string, any> = new Map();

  private async getCachedData(key: string, fetchFunction: () => Promise<any>) {
    if (!this.cache.has(key)) {
      const data = await fetchFunction();
      this.cache.set(key, data);
    }
    return this.cache.get(key);
  }
  private async fetchAllPricingData() {
    if (this.cache.has("allPricingData")) {
      return this.cache.get("allPricingData");
    }

    const PricingRuleModel = await getPricingRuleModel();
    const TimePeriodModel = await getTimePeriodModel();
    const AdditionalCostModel = await getAdditionalCostModel();

    const [pricingRules, timePeriods, additionalCosts] = await Promise.all([
      PricingRuleModel.find().lean().maxTimeMS(30000),
      TimePeriodModel.find().lean().maxTimeMS(30000),
      AdditionalCostModel.findOne().lean().maxTimeMS(30000),
    ]);

    const formattedRules = pricingRules.reduce(
      (acc: Record<string, any>, rule) => {
        acc[rule.roomSlug] = rule.pricing;
        return acc;
      },
      {}
    );

    const allData = {
      rules: formattedRules,
      timePeriods,
      additionalCosts,
    };

    this.cache.set("allPricingData", allData);
    return allData;
  }
  async initialize() {
    try {
      const allData = await this.fetchAllPricingData();
      this.rules = allData.rules;
      this.timePeriods = allData.timePeriods;
      this.additionalCosts = allData.additionalCosts as AdditionalCosts;
    } catch (error) {
      console.error("Error fetching pricing data:", error);
      if (error instanceof Error) {
        throw new Error(`Failed to fetch pricing data: ${error.message}`);
      } else {
        throw new Error("Failed to fetch pricing data: Unknown error");
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
              start: new Date(preparedBooking.start),
              end: new Date(preparedBooking.end),
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
      start,
      end,
      roomSlugs,
      resources = [],
      expectedAttendance = 0,
      isPrivate = false,
      costItems = [],
    } = booking;
    // console.log("Booking in prepareBookingForPricing:", booking);

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

  private calculateRoomPrice(
    startTime: Date,
    endTime: Date,
    dayRules: any,
    isPrivate: boolean
  ) {
    const eveningStartTime = new Date(startTime);
    eveningStartTime.setHours(17, 0, 0, 0);

    const totalBookingHours = differenceInHours(endTime, startTime);
    const bookingCrossesEveningThreshold =
      startTime < eveningStartTime && endTime > eveningStartTime;

    let basePrice = 0;
    let daytimeHours = 0;
    let eveningHours = 0;
    let daytimePrice = 0;
    let eveningPrice = 0;
    let fullDayPrice = 0;
    let daytimeRate = 0;
    let eveningRate = 0;
    let daytimeRateType = "";
    let eveningRateType = "";
    let crossoverApplied = false;
    let isFullDay = false;

    // Full Day Logic
    if (dayRules.fullDay) {
      isFullDay = true;
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
      if (startTime < eveningStartTime && dayRules.daytime) {
        const daytimeEndTime = bookingCrossesEveningThreshold
          ? eveningStartTime
          : endTime;
        daytimeHours = differenceInHours(daytimeEndTime, startTime);
        daytimeRate = dayRules.daytime[isPrivate ? "private" : "public"];
        daytimeRateType = dayRules.daytime.type;

        // Check if a crossover rate applies
        if (bookingCrossesEveningThreshold && dayRules.daytime.crossoverRate) {
          daytimeRate = dayRules.daytime.crossoverRate;
          crossoverApplied = true;
        }

        daytimePrice = daytimeRate * daytimeHours;
        basePrice += daytimePrice;
      }

      // Evening Calculation
      if (endTime > eveningStartTime && dayRules.evening) {
        eveningHours = differenceInHours(endTime, eveningStartTime);
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
      if (dayRules.minimumHours && totalBookingHours < dayRules.minimumHours) {
        const minimumPrice =
          basePrice * (dayRules.minimumHours / totalBookingHours);
        if (minimumPrice > basePrice) {
          basePrice = minimumPrice;
        }
      }
    }

    const daytimeDescription = this.generateRateDescription({
      daytimeHours,
      daytimePrice,
      daytimeRate,
      daytimeRateType,
      crossoverApplied,
    });

    const eveningDescription = this.generateRateDescription({
      eveningHours,
      eveningRate,
      eveningPrice,
      eveningRateType,
    });

    return {
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
      isFullDay,
      totalBookingHours,
      minimumHours: dayRules.minimumHours,
      daytimeCostItem:
        daytimePrice > 0
          ? {
              id: uuidv4(),
              description: "Daytime Hours",
              subDescription: daytimeDescription,
              cost: daytimePrice,
            }
          : null,
      eveningCostItem:
        eveningPrice > 0
          ? {
              id: uuidv4(),
              description: "Evening Hours",
              subDescription: eveningDescription,
              cost: eveningPrice,
            }
          : null,
    };
  }

  async calculatePrice(booking: Booking): Promise<{
    estimates: any[];
    perSlotCosts: any[];
    slotTotal: number;
  }> {
    await this.initialize(); // Ensure data is loaded

    if (
      !booking.start ||
      !booking.end ||
      !booking.roomSlugs ||
      booking.roomSlugs.length === 0
    ) {
      throw new Error("Booking data is missing required fields");
    }

    const { roomSlugs, start, end, isPrivate } = booking;
    const startTime = toZonedTime(parseISO(start), "America/Toronto");
    const endTime = toZonedTime(parseISO(end), "America/Toronto");
    const currentDay = format(startTime, "EEEE", {
      timeZone: "America/Toronto",
    });

    const { perSlotCosts, additionalCosts } =
      await this.calculateAdditionalCosts(booking);

    let slotTotal = 0;
    const estimates = await Promise.all(
      roomSlugs.map(async (roomSlug) => {
        const roomRules = this.rules?.[roomSlug];
        if (!roomRules) {
          throw new Error(`No pricing rules found for room: ${roomSlug}`);
        }

        const dayRules = roomRules[currentDay] || roomRules["all"];
        if (!dayRules) {
          throw new Error(
            `No pricing rules found for room ${roomSlug} on ${currentDay}`
          );
        }

        const priceEstimate = this.calculateRoomPrice(
          startTime,
          endTime,
          dayRules,
          isPrivate ?? false
        );
        const roomAdditionalCosts = additionalCosts.filter(
          (cost) => cost.roomSlug === roomSlug
        );
        const roomAdditionalCostsTotal = roomAdditionalCosts.reduce(
          (sum, cost) => sum + (Number(cost.cost) || 0),
          0
        );

        slotTotal += priceEstimate.basePrice + roomAdditionalCostsTotal;

        return {
          roomSlug,
          ...priceEstimate,
          additionalCosts: roomAdditionalCosts,
          totalCost: priceEstimate.basePrice + roomAdditionalCostsTotal,
        };
      })
    );

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
    await this.initialize();

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

    // Early Open Staff calculation
    if (bookingStartTime < venueOpeningTime) {
      const earlyOpenHours = Math.ceil(
        differenceInHours(venueOpeningTime, bookingStartTime)
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
