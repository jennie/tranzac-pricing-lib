// pricing-lib/src/pricingRules.js
import { v4 as uuidv4 } from "uuid";
import {
  getPricingRuleModel,
  getTimePeriodModel,
  getAdditionalCostModel,
  BookingRates,
  CostItem,
  RateDescriptionParams,
} from "./models/pricing.schema";

import { AdditionalCosts } from "./models/additionalCosts.schema"; // Import the interface

import { formatISO, parseISO, isValid, differenceInHours, sub } from "date-fns";
import { format, toZonedTime } from "date-fns-tz";

interface Booking {
  resources: string[];
  isPrivate?: boolean;
  expectedAttendance?: number;
  roomSlugs: string[];
  rooms?: RoomBooking[];
  startTime: string;
  endTime: string;
  date?: string;
  costItems?: any[];
}

interface ResourceDetails {
  roomSlug: string;
  isPrivate: boolean;
  expectedAttendance: number;
  startTime: string;
  endTime: string;
  projectorIncluded: boolean;
}

interface RoomBooking {
  id: any;
  slug: any;
  roomSlug: string;
  additionalCosts?: AdditionalCost[];
  daytimeCostItem: any;
  eveningCostItem: any;
  fullDayCostItem: any;
}

interface AdditionalCost {
  id: string;
  description: string;
  subDescription?: string;
  cost: number;
  roomSlug?: string;
  isRequired?: boolean;
  customLineItem?: boolean;
  isEditable?: boolean;
}

interface BookingDetails {
  resources: string[];
  roomSlugs: string[];
  start: string;
  end: string;
  isPrivate: boolean;
  expectedAttendance: number;
}

interface Cost {
  id?: string;
  description: string;
  subDescription?: string;
  cost: number;
  roomSlug?: string;
  isRequired?: boolean;
  isEditable?: boolean;
  hourlyRate?: number;
  hours?: number;
}

interface CostEstimate {
  id: string;
  date: Date;
  start: Date;
  end: Date;
  estimates: any[];
  perSlotCosts: any[];
  slotTotal: number;
  roomSlugs?: string[];
  isPrivate?: boolean;
  resources?: string[];
  expectedAttendance?: number;
  customLineItems?: any[];
  error?: string;
}

// NEW: Added interface AdditionalCosts to define the expected structure.
interface AdditionalCosts {
  conditions: any[];
  resources: any[];
  // Add additional properties if needed.
}

interface Room {
  id: string;
  name: string;
  slug: string;
  eveningRate?: number;
  daytimeRate?: number;
}

const TORONTO_TIMEZONE = "America/Toronto";
const HST_RATE = 0.13; // 13% HST rate
const SOUTHERN_CROSS_ID = "DhqLkkzvQmKvCDMubndPjw";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(amount);
}

export default class PricingRules {
  private timePeriods: any[] | null;
  private rules: Record<string, any> | null;
  private additionalCosts: AdditionalCosts | null;
  private taxCache = new Map<number, number>();
  private totalWithTaxCache = new Map<number, number>();
  constructor() {
    this.timePeriods = null;
    this.rules = null;
    this.additionalCosts = null;
  }

  async initialize() {
    if (this.rules && this.timePeriods && this.additionalCosts) {
      return;
    }
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
  calculateTotals(costEstimates: any[]) {
    const grandTotal = costEstimates.reduce(
      (total: any, slot: any) => total + this.calculateSlotTotal(slot),
      0
    );
    const tax = grandTotal * 0.13; // Assuming 13% tax rate
    const totalWithTax = grandTotal + tax;

    return { grandTotal, tax, totalWithTax };
  }

  calculateSlotTotal(slot: { estimates: any[]; perSlotCosts: any[] }) {
    const estimatesTotal = slot.estimates.reduce(
      (total: any, estimate: { totalCost: any }) => total + estimate.totalCost,
      0
    );
    const perSlotCostsTotal = slot.perSlotCosts.reduce(
      (total: number, cost: { cost: any }) => total + (Number(cost.cost) || 0),
      0
    );
    return estimatesTotal + perSlotCostsTotal;
  }
  calculateTax(grandTotal: number): number {
    if (this.taxCache.has(grandTotal)) {
      return this.taxCache.get(grandTotal)!;
    }
    const tax = Number((grandTotal * HST_RATE).toFixed(2));
    this.taxCache.set(grandTotal, tax);
    return tax;
  }

  calculateTotalWithTax(grandTotal: number): number {
    if (this.totalWithTaxCache.has(grandTotal)) {
      return this.totalWithTaxCache.get(grandTotal)!;
    }
    const tax = this.calculateTax(grandTotal);
    const total = Number((grandTotal + tax).toFixed(2));
    this.totalWithTaxCache.set(grandTotal, total);
    return total;
  }

  async getPrice(data: any): Promise<{
    costEstimates: CostEstimate[];
    customLineItems: Record<string, any[]>;
    grandTotal: number;
    tax: number;
    totalWithTax: number;
  }> {
    try {
      await this.initialize();
      const costEstimates: CostEstimate[] = [];
      const customLineItems: Record<string, any[]> = {};

      if (!data.rentalDates || typeof data.rentalDates !== "object") {
        console.error("Invalid rentalDates structure:", data.rentalDates);
        throw new Error("rentalDates is not defined or not an object.");
      }

      // Changed: Replace flatMap with reduce and add explicit types for destructured parameters.
      const bookingPromises = Object.entries(data.rentalDates).reduce(
        (acc: Promise<any>[], [date, bookings]: [string, any]) => {
          if (!Array.isArray(bookings)) {
            console.error(
              `Expected an array of bookings for date ${date}, but got:`,
              bookings
            );
            return acc;
          }
          if (isNaN(new Date(date).getTime())) {
            console.warn("Invalid date found in rentalDates:", date);
          }
          const promises = bookings.map(async (booking: any) => {
            try {
              const preparedBooking: Booking =
                this.prepareBookingForPricing(booking);
              if (process.env.NODE_ENV === "development") {
                console.log("Prepared booking in getPrice:", preparedBooking);
              }
              const {
                estimates,
                perSlotCosts,
                slotTotal,
                slotCustomLineItems,
              } = await this.calculatePrice({
                ...preparedBooking,
                date,
                resources: preparedBooking.resources || [],
                isPrivate: booking.private || false,
                expectedAttendance:
                  Number(preparedBooking.expectedAttendance) || 0,
              });
              if (process.env.NODE_ENV === "development") {
                console.log(
                  "slotCustomLineItems in getPrice:",
                  slotCustomLineItems
                );
              }

              // Inside getPrice method where formattedEstimates is created:

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
                // Add these explicitly
                daytimeMinHours: estimate.daytimeMinHours || 0,
                eveningMinHours: estimate.eveningMinHours || 0,
                additionalCosts: Array.isArray(estimate.additionalCosts)
                  ? estimate.additionalCosts.map((cost: Cost) => ({
                    id: cost.id || uuidv4(),
                    description: cost.description || "",
                    subDescription: cost.subDescription || "",
                    cost: Number(cost.cost) || 0,
                    isRequired: cost.isRequired || false,
                  }))
                  : [],
                totalCost: estimate.totalCost || 0,
                rateDescription: estimate.rateDescription || "",
                totalBookingHours: estimate.totalBookingHours || 0,
                isFullDay: estimate.isFullDay || false,
                daytimeDescription: estimate.daytimeDescription || "",
                eveningDescription: estimate.eveningDescription || "",
                daytimeCostItem: {
                  ...estimate.daytimeCostItem,
                  minimumHours: estimate.daytimeMinHours || 0,
                },
                eveningCostItem: {
                  ...estimate.eveningCostItem,
                  minimumHours: estimate.eveningMinHours || 0,
                },
                fullDayCostItem: estimate.fullDayCostItem,
              }));

              const formattedPerSlotCosts = perSlotCosts.map((cost) => ({
                id: cost.id || uuidv4(),
                description: cost.description,
                subDescription: cost.subDescription,
                cost: Number(cost.cost) || 0,
                isRequired: cost.isRequired || false, // Include isRequired
              }));

              const estimateTotal = formattedEstimates.reduce(
                (total, estimate) => {
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
              console.log("Booking calculation details:", {
                estimateTotal,
                perSlotCostsTotal,
                totalForThisBooking,
                slotTotal
              });

              const costEstimate = {
                id: booking.id || uuidv4(),
                date: new Date(date),
                start: new Date(preparedBooking.startTime),
                end: new Date(preparedBooking.endTime),
                estimates: formattedEstimates,
                perSlotCosts: formattedPerSlotCosts,
                slotTotal,
                roomSlugs: preparedBooking.roomSlugs,
                isPrivate: booking.private,
                resources: preparedBooking.resources,
                expectedAttendance: preparedBooking.expectedAttendance,
                customLineItems: slotCustomLineItems,
              };

              // NEW: Store slotCustomLineItems if they exist
              if (slotCustomLineItems && slotCustomLineItems.length > 0) {
                customLineItems[booking.id] = slotCustomLineItems;
              }

              return costEstimate;
            } catch (error: any) {
              console.error(
                `Error calculating price for booking ${booking.id}:`,
                error
              );
              return {
                id: booking.id || uuidv4(),
                date: new Date(date),
                start: new Date(booking.startTime),
                end: new Date(booking.endTime),
                estimates: [],
                perSlotCosts: [],
                slotTotal: 0,
                error: error.message,
              };
            }
          });
          return acc.concat(promises);
        },
        []
      );

      const resolvedCostEstimates = await Promise.all(bookingPromises);
      costEstimates.push(...resolvedCostEstimates);

      // Calculate grandTotal after all promises have resolved
      const grandTotal = costEstimates.reduce((total, estimate) => total + estimate.slotTotal, 0);

      console.log("Before tax calculation - grandTotal:", grandTotal);
      const tax = this.calculateTax(grandTotal);
      console.log("Calculated tax:", tax);
      const totalWithTax = this.calculateTotalWithTax(grandTotal);
      console.log("Calculated totalWithTax:", totalWithTax);
      console.log("Final costEstimates:", costEstimates);
      console.log("Final customLineItems:", customLineItems);

      return { costEstimates, customLineItems, grandTotal, tax, totalWithTax };
    } catch (error: any) {
      console.error("Error in getPrice method:", error);
      throw error;
    }
  }

  prepareBookingForPricing(booking: Booking) {
    const {
      startTime,
      endTime,
      date,
      roomSlugs,
      resources = [],
      expectedAttendance = 0,
      isPrivate = false,
    } = booking;

    if (process.env.NODE_ENV === "development") {
      console.log("Booking in prepareBookingForPricing:", booking);
    }

    if (!roomSlugs || roomSlugs.length === 0) {
      throw new Error("Room slugs are undefined or empty in booking");
    }

    if (!date) {
      throw new Error("Date is missing in booking data");
    }

    // If `startTime` and `endTime` are already full ISO strings, use them directly
    const fullStartTime = startTime.includes("T")
      ? startTime
      : `${date.split("T")[0]}T${startTime}:00`;
    const fullEndTime = endTime.includes("T")
      ? endTime
      : `${date.split("T")[0]}T${endTime}:00`;

    booking.startTime = fullStartTime;
    booking.endTime = fullEndTime;

    // Log the full date-time strings before parsing
    if (process.env.NODE_ENV === "development") {
      console.log("Full start time string:", fullStartTime);
      console.log("Full end time string:", fullEndTime);
    }

    // Use parseISO to parse the full date-time strings
    const startDateTime = toZonedTime(
      parseISO(fullStartTime),
      TORONTO_TIMEZONE
    );
    const endDateTime = toZonedTime(parseISO(fullEndTime), TORONTO_TIMEZONE);

    // Log the parsed Date objects
    if (process.env.NODE_ENV === "development") {
      console.log("Parsed startDateTime:", startDateTime);
      console.log("Parsed endDateTime:", endDateTime);
    }

    // Validate the parsed date-time strings
    if (!isValid(startDateTime) || !isValid(endDateTime)) {
      console.error("Invalid start or end time in booking data:", {
        startTime,
        endTime,
        fullStartTime,
        fullEndTime,
        startDateTime,
        endDateTime,
      });
      throw new Error("Invalid start or end time in booking data");
    }

    // Convert the Date objects back to ISO strings
    const formattedStartTime = formatISO(startDateTime);
    const formattedEndTime = formatISO(endDateTime);

    // Return the updated booking object with ISO startTime and endTime
    return {
      ...booking,
      resources,
      expectedAttendance,
      isPrivate,
      rooms: (booking.rooms || []).map((room) => ({
        ...room,
        daytimeCostItem: room.daytimeCostItem || null,
        eveningCostItem: room.eveningCostItem || null,
        fullDayCostItem: room.fullDayCostItem || null,
      })),
      startTime: formattedStartTime,
      endTime: formattedEndTime,
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
    slotCustomLineItems: any[];
  }> {
    // Add validation for Southern Cross
    const SOUTHERN_CROSS_ID = 'southern-cross'; // Replace with actual slug
    if (booking.roomSlugs.includes(SOUTHERN_CROSS_ID)) {
      const startTime = new Date(booking.startTime);
      const endTime = new Date(booking.endTime);

      // Check if booking is on a weekend
      const day = startTime.getDay();
      if (day === 0 || day === 6) {
        throw new Error('Southern Cross is not available for weekend bookings');
      }

      // Check if booking includes evening hours
      const startHour = startTime.getHours();
      const endHour = endTime.getHours();
      const endMinute = endTime.getMinutes();

      // Allow bookings that end exactly at 5:00 PM (17:00) but not after
      if (startHour >= 17 || (endHour > 17 || (endHour === 17 && endMinute > 0)) || startHour < 5 || endHour < 5) {
        throw new Error('Southern Cross is only available during daytime hours (before 5 PM)');
      }
    }

    if (
      !booking.startTime ||
      !booking.endTime ||
      !booking.roomSlugs ||
      booking.roomSlugs.length === 0 ||
      !booking.date
    ) {
      console.error("Booking is missing required fields:", {
        startTime: booking.startTime,
        endTime: booking.endTime,
        roomSlugs: booking.roomSlugs,
        date: booking.date,
      });
      throw new Error("Invalid booking: " + JSON.stringify(booking, null, 2));
    }

    const {
      roomSlugs,
      startTime,
      endTime,
      isPrivate = false,
      expectedAttendance = 0,
      resources,
      date,
    } = booking;

    const estimates: any[] = [];
    let slotTotal = 0;

    const startDateTime = toZonedTime(parseISO(startTime), TORONTO_TIMEZONE);
    const endDateTime = toZonedTime(parseISO(endTime), TORONTO_TIMEZONE);
    const currentDay = format(startDateTime, "EEEE", {
      timeZone: TORONTO_TIMEZONE,
    });

    const { perSlotCosts, additionalCosts, customLineItems } =
      await this.calculateAdditionalCosts(booking);
    console.log("DEBUG: Additional costs calculated:", {
      perSlotCosts,
      additionalCosts, // These are the backline costs
      customLineItems,
    });

    const slotCustomLineItems = [...customLineItems];

    // Ensure date is valid before passing to getDayRules
    const bookingDate = new Date(date);
    if (isNaN(bookingDate.getTime())) {
      throw new Error(`Invalid date: ${date}`);
    }

    for (const roomSlug of roomSlugs) {
      if (!this.rules) throw new Error("Rules are not initialized");
      const roomRules = this.rules[roomSlug];
      if (!roomRules)
        throw new Error(`No pricing rules found for room: ${roomSlug}`);

      const dayRules = this.getDayRules(roomRules, bookingDate);
      if (!dayRules)
        throw new Error(
          `No pricing rules found for room ${roomSlug} on ${currentDay}`
        );

      const {
        basePrice,
        daytimePrice,
        eveningPrice,
        fullDayPrice,
        daytimeHours,
        eveningHours,
        daytimeRate,
        eveningRate,
        daytimeRateType,
        eveningRateType,
        crossoverApplied,
      } = this.calculateRoomPrice(
        startDateTime,
        endDateTime,
        dayRules,
        isPrivate,
        roomSlug
      );

      const roomAdditionalCosts = additionalCosts.filter(
        (cost) => cost.roomSlug === roomSlug
      );
      console.log(
        `DEBUG: Additional costs for room ${roomSlug}:`,
        roomAdditionalCosts
      );

      const roomAdditionalCostsTotal = roomAdditionalCosts.reduce(
        (sum, cost) => sum + (Number(cost.cost) || 0),
        0
      );

      const totalBookingHours = differenceInHours(endDateTime, startDateTime);

      // Inside calculatePrice method, where estimates are created:

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
        // Add these explicitly from dayRules
        daytimeMinHours: dayRules?.daytime?.minimumHours || 0,
        eveningMinHours: dayRules?.evening?.minimumHours || 0,
        daytimeCostItem: {
          description: dayRules.fullDay ? "Full Day Rate" : "Daytime Hours",
          cost: daytimePrice || 0,
          rateType: daytimeRateType || "hourly",
          hours: daytimeHours || 0,
          rate: daytimeRate || 0,
          crossoverApplied: crossoverApplied || false,
          isFullDay: !!dayRules.fullDay,
          minimumHours: dayRules?.daytime?.minimumHours || 0,
        },
        eveningCostItem: {
          description: "Evening Hours",
          cost: eveningPrice || 0,
          rateType: eveningRateType || "hourly",
          hours: eveningHours || 0,
          rate: eveningRate || 0,
          minimumHours: dayRules?.evening?.minimumHours || 0,
        },
        fullDayCostItem: this.createCostItem(
          "Full Day Rate",
          fullDayPrice || 0,
          this.generateRateDescription({
            basePrice: 0,
            isFullDay: true,
            fullDayPrice: fullDayPrice || 0,
          })
        ),
        minimumHours: dayRules.minimumHours,
        totalBookingHours,
        isFullDay: !!dayRules.fullDay,
      });

      slotTotal += basePrice + roomAdditionalCostsTotal;
    }

    const perSlotCostsTotal = perSlotCosts.reduce(
      (sum, cost) => sum + (Number(cost.cost) || 0),
      0
    );
    slotTotal += perSlotCostsTotal;

    const customLineItemsTotal = slotCustomLineItems.reduce(
      (sum, item) => sum + (Number(item.cost) || 0),
      0
    );
    slotTotal += customLineItemsTotal;

    console.log("DEBUG: Final estimates with additional costs:", estimates);

    if (process.env.NODE_ENV === "development") {
      console.log("Final calculation:");
      console.log(
        "Room costs:",
        slotTotal - perSlotCostsTotal - customLineItemsTotal
      );
      console.log("Per-slot costs total:", perSlotCostsTotal);
      console.log("Custom line items total:", customLineItemsTotal);
      console.log("Final slot total:", slotTotal);
    }

    return { estimates, perSlotCosts, slotTotal, slotCustomLineItems };
  }

  private calculateRoomPrice(
    startDateTime: Date,
    endDateTime: Date,
    dayRules: any,
    isPrivate: boolean,
    roomSlug: string
  ): BookingRates {
    if (!dayRules) {
      throw new Error("No pricing rules found for the specified day");
    }

    // Initialize all variables first
    let basePrice = 0;
    let daytimePrice = 0;
    let eveningPrice = 0;
    let daytimeHours = 0;
    let eveningHours = 0;
    let daytimeRate = 0;
    let eveningRate = 0;
    let crossoverApplied = false;
    let daytimeCostItem = null;
    let eveningCostItem = null;
    let eveningRateType = "";
    let daytimeRateType = "";

    const eveningStartTime = new Date(startDateTime);
    eveningStartTime.setHours(17, 0, 0, 0); // 5 PM

    const totalBookingHours = differenceInHours(endDateTime, startDateTime);
    const bookingCrossesEveningThreshold =
      startDateTime < eveningStartTime && endDateTime > eveningStartTime;

    // Add logging to track behavior
    const isEveningOnly = this.isEveningTime(startDateTime) && this.isEveningTime(endDateTime);

    console.log('[PricingRules] Calculating price:', {
      roomSlug,
      startDateTime,
      endDateTime,
      isEveningOnly,
      startHour: startDateTime.getHours(),
      endHour: endDateTime.getHours()
    });

    // NEW: Handle full-day pricing if available (e.g. for parking-lot)
    if (dayRules.fullDay) {
      const fullDayPrice = dayRules.fullDay[isPrivate ? "private" : "public"];
      return {
        basePrice: fullDayPrice,
        daytimeHours: 0,
        eveningHours: 0,
        daytimePrice: 0,
        eveningPrice: 0,
        daytimeRate: 0,
        eveningRate: 0,
        daytimeRateType: "flat",
        eveningRateType: "flat",
        daytimeMinHours: 0,
        eveningMinHours: 0,
        daytimeCostItem: {
          description: "Full Day Rate",
          cost: fullDayPrice,
          rateType: "flat",
          rate: fullDayPrice,
          minimumHours: 0,
          crossoverApplied: false,
        },
        eveningCostItem: {
          description: "Full Day Rate",
          cost: fullDayPrice,
          rateType: "flat",
          rate: fullDayPrice,
          minimumHours: 0,
          crossoverApplied: false,
        },
        additionalCosts: [],
        totalCost: fullDayPrice,
        rateDescription: `$${fullDayPrice}/day`,
        totalBookingHours: differenceInHours(endDateTime, startDateTime),
        isFullDay: true,
        fullDayPrice: fullDayPrice,
      };
    }

    // Calculate daytime pricing if applicable
    if (!isEveningOnly && startDateTime < eveningStartTime && dayRules.daytime) {
      const daytimeEndTime = bookingCrossesEveningThreshold
        ? eveningStartTime
        : endDateTime;
      const pricingRate = dayRules.daytime[isPrivate ? "private" : "public"];
      const {
        hours,
        cost,
        hourlyRate,
        crossoverApplied: isCrossover,
      } = this.calculateHoursAndCost(
        startDateTime,
        daytimeEndTime,
        pricingRate,
        dayRules.daytime.type,
        dayRules.daytime.crossoverRate,
        roomSlug
      );

      daytimeHours = hours;
      daytimePrice = cost;
      daytimeRate = hourlyRate || pricingRate;
      crossoverApplied = isCrossover;
      basePrice += daytimePrice;
    }

    // Add evening pricing calculation
    if (endDateTime > eveningStartTime && dayRules.evening) {
      const eveningStartDateTime = bookingCrossesEveningThreshold
        ? eveningStartTime
        : startDateTime;
      const pricingRate = dayRules.evening[isPrivate ? "private" : "public"];
      const {
        hours,
        cost,
        hourlyRate,
        crossoverApplied: isCrossover,
      } = this.calculateHoursAndCost(
        eveningStartDateTime,
        endDateTime,
        pricingRate,
        dayRules.evening.type,
        dayRules.evening.crossoverRate,
        roomSlug
      );

      eveningHours = hours;
      eveningPrice = cost;
      eveningRate = hourlyRate || pricingRate;
      eveningRateType = dayRules.evening.type;
      basePrice += eveningPrice;
    }

    // Rest of the function remains the same...

    return {
      basePrice,
      daytimeHours,
      eveningHours,
      daytimePrice,
      eveningPrice,
      daytimeRate,
      eveningRate,
      daytimeRateType,
      eveningRateType,
      crossoverApplied,
      totalCost: basePrice + eveningPrice,
      rateDescription: this.generateRateDescription({
        basePrice: 0,
        isFullDay: false,
        fullDayPrice: 0,
        daytimeHours,
        daytimePrice,
        daytimeRate,
        daytimeRateType,
        eveningHours,
        eveningPrice,
        eveningRate,
        eveningRateType,
        crossoverApplied,
      }),
      totalBookingHours: daytimeHours + eveningHours,
      isFullDay: false,
      fullDayPrice: 0,
      daytimeMinHours: dayRules?.daytime?.minimumHours || 0,
      eveningMinHours: dayRules?.evening?.minimumHours || 0,
      daytimeCostItem: {
        description: this.formatDescription(dayRules?.daytime),
        cost: daytimePrice,
        minimumHours: dayRules?.daytime?.minimumHours || 0,
        rate: dayRules?.daytime?.rate || 0,
        rateType: dayRules?.daytime?.type || "hourly",
        crossoverApplied: false,
      },
      eveningCostItem: {
        description: this.formatDescription(dayRules?.evening),
        cost: eveningPrice,
        minimumHours: dayRules?.evening?.minimumHours || 0,
        rate: dayRules?.evening?.rate || 0,
        rateType: dayRules?.evening?.type || "hourly",
        crossoverApplied: false,
      },
      additionalCosts: [],
    };
  }

  // Add helper method for security handling
  private handleSecurityItem(booking: Booking): Cost | null {
    // If no additional costs initialized, return null
    if (!this.additionalCosts) return null;

    // Check both conditions that require security
    const needsSecurity = booking.resources?.includes('security') ||
      booking.roomSlugs?.includes('parking-lot');

    if (!needsSecurity) return null;

    // Find security configuration
    const securityConfig = this.additionalCosts.resources.find(
      (r) => r.id === "security"
    );

    if (!securityConfig) return null;

    // Create single security cost item
    return {
      id: uuidv4(),
      description: securityConfig.description,
      subDescription: securityConfig.subDescription || "Will quote separately",
      cost: 0,
      isEditable: true,
      isRequired: booking.roomSlugs?.includes('parking-lot'),
    };
  }

  async calculateAdditionalCosts(booking: Booking): Promise<{
    perSlotCosts: Cost[];
    additionalCosts: Cost[];
    customLineItems: Cost[];
  }> {
    const perSlotCosts: Cost[] = [];
    const additionalCosts: Cost[] = [];
    const customLineItems: Cost[] = [];

    if (!this.additionalCosts) {
      console.warn("Additional costs not initialized");
      return { perSlotCosts, additionalCosts, customLineItems };
    }

    if (!booking.resources) {
      return { perSlotCosts, additionalCosts, customLineItems };
    }

    const resourceDetails: ResourceDetails = {
      roomSlug: booking.roomSlugs[0],
      isPrivate: booking.isPrivate || false,
      expectedAttendance: Number(booking.expectedAttendance) || 0,
      startTime: booking.startTime,
      endTime: booking.endTime,
      projectorIncluded: booking.resources.includes('backline')
    };

    // Process each resource
    for (const resourceId of booking.resources) {
      const resource = this.additionalCosts.resources.find(
        (r) => r.id === resourceId
      );

      if (!resource) {
        console.warn(`Resource ${resourceId} not found in additional costs`);
        continue;
      }

      // Skip security as it's handled separately
      if (resourceId === 'security') continue;

      // Handle food cleaning fee
      if (resourceId === 'food') {
        const calculatedCost = this.calculateResourceCost(resourceId, resourceDetails);
        if (calculatedCost && !Array.isArray(calculatedCost)) {
          perSlotCosts.push({
            ...calculatedCost,
            id: uuidv4(),
            isRequired: true,
            subDescription: "Required when food is served"
          });
        }
        continue;
      }

      // Handle backline specially since it's room-specific
      if (resourceId === "backline") {
        // Convert hyphenated room slug to underscore format for config lookup
        const configRoomSlug = resourceDetails.roomSlug.replace(/-/g, '_');
        const roomConfig = this.additionalCosts.resources.find(r => r.id === 'backline')?.rooms?.[configRoomSlug];
        console.log("[DEBUG] Backline room config:", {
          roomSlug: resourceDetails.roomSlug,
          configRoomSlug,
          roomConfig
        });
        if (roomConfig) {
          const cost: Cost = {
            id: uuidv4(),
            description: roomConfig.description || 'Backline',
            cost: roomConfig.cost,
            isRequired: false,
            isEditable: false
          };
          console.log("[DEBUG] Created backline cost:", cost);

          // If this room's backline includes projector, remove projector cost if it exists
          if (roomConfig.includes_projector) {
            const projectorCosts = perSlotCosts.filter(c => c.description?.includes('Projector'));
            projectorCosts.forEach(pc => {
              const index = perSlotCosts.indexOf(pc);
              if (index > -1) {
                perSlotCosts.splice(index, 1);
              }
            });
          }

          perSlotCosts.push(cost);
          console.log("[DEBUG] perSlotCosts after adding backline:", perSlotCosts);
        }
        continue;
      }

      // Handle audio tech and overtime
      if (resourceId === 'audio_tech') {
        const calculatedCosts = this.calculateResourceCost(resourceId, resourceDetails);
        if (Array.isArray(calculatedCosts)) {
          calculatedCosts.forEach(cost => {
            perSlotCosts.push({
              ...cost,
              id: uuidv4(),
              isRequired: false
            });
          });
        }
        continue;
      }

      // Handle bartender with hourly calculation
      if (resourceId === 'bartender') {
        const bartenderCost = this.calculateResourceCost(resourceId, resourceDetails);
        if (bartenderCost && !Array.isArray(bartenderCost)) {
          perSlotCosts.push({
            ...bartenderCost,
            id: uuidv4(),
            isRequired: false
          });
        }
        continue;
      }

      // Handle standard hourly resources
      if (resource.type === 'hourly') {
        const hours = differenceInHours(
          parseISO(booking.endTime),
          parseISO(booking.startTime)
        );
        const hourlyCost = this.calculateResourceCost(resourceId, resourceDetails);
        if (hourlyCost && !Array.isArray(hourlyCost)) {
          perSlotCosts.push({
            ...hourlyCost,
            id: uuidv4(),
            isRequired: false,
            subDescription: `${hours} hours @ ${formatCurrency(resource.cost)}/hour`
          });
        }
        continue;
      }

      // Handle flat rate resources
      if (resource.type === 'flat') {
        const flatCost = this.calculateResourceCost(resourceId, resourceDetails);
        if (flatCost && !Array.isArray(flatCost)) {
          perSlotCosts.push({
            ...flatCost,
            id: uuidv4(),
            isRequired: false
          });
        }
        continue;
      }

      // Handle custom line items
      if (resource.type === 'custom') {
        const customCost = this.calculateResourceCost(resourceId, resourceDetails);
        if (customCost && !Array.isArray(customCost)) {
          customLineItems.push({
            ...customCost,
            id: uuidv4(),
            isRequired: false,
            isEditable: true
          });
        }
      }
    }

    // Early Open Staff calculation
    const venueOpeningTime = new Date(booking.startTime);
    venueOpeningTime.setHours(18, 0, 0, 0);

    if (new Date(booking.startTime) < venueOpeningTime) {
      const earlyOpenHours = Math.ceil(
        differenceInHours(venueOpeningTime, new Date(booking.startTime))
      );
      if (earlyOpenHours > 0) {
        perSlotCosts.push({
          id: uuidv4(),
          description: `Early Open Staff (${earlyOpenHours} hours)`,
          subDescription: "Additional staff for early opening",
          cost: Number(earlyOpenHours) * 30,
          isRequired: true,
        });
      }
    }

    // Handle security with consolidated logic
    const securityItem = this.handleSecurityItem(booking);
    if (securityItem) {
      customLineItems.push(securityItem);
    }

    // Room-specific additional costs
    if (booking.roomSlugs) {
      for (const roomSlug of booking.roomSlugs) {
        const roomAdditionalCosts = this.additionalCosts.conditions
          ?.filter(condition => condition.roomSlug === roomSlug)
          ?.map(condition => ({
            id: uuidv4(),
            description: condition.description,
            subDescription: condition.subDescription,
            cost: condition.cost || 0,
            roomSlug: roomSlug,
            isRequired: condition.isRequired || false
          })) || [];

        additionalCosts.push(...roomAdditionalCosts);
      }
    }

    return { perSlotCosts, additionalCosts, customLineItems };
  }

  private calculateResourceCost(
    resourceId: string,
    details: ResourceDetails
  ): Cost | Cost[] | null {
    const {
      roomSlug,
      isPrivate,
      expectedAttendance,
      startTime,
      endTime,
      projectorIncluded,
    } = details;
    const resourceConfig = this.additionalCosts?.resources.find(
      (r: any) => r.id === resourceId
    );
    if (!resourceConfig) return null;

    let cost: number = Number(resourceConfig?.cost) || 0;
    let description: string = resourceConfig?.description || "";
    let subDescription: string = resourceConfig?.subDescription || "";

    switch (resourceId) {
      case "food":
        return {
          description,
          subDescription,
          cost,
          isRequired: true,
        };

      case "backline":
        const roomSpecificCost = resourceConfig.rooms?.[roomSlug];
        if (roomSpecificCost) {
          cost = roomSpecificCost.cost || 0;
          description = roomSpecificCost.description || description;
          if (roomSpecificCost.includes_projector) {
            subDescription = "Includes projector";
          }
        }
        return {
          description,
          subDescription,
          cost,
          isRequired: false,
          isEditable: false
        };

      case "bartender":
        if (isPrivate && expectedAttendance > 100) {
          return {
            id: uuidv4(),
            description: resourceConfig?.description || "Bartender",
            subDescription: "Comped for large private event",
            cost: 0,
            isRequired: true,
          };
        } else {
          const hours = differenceInHours(parseISO(endTime), parseISO(startTime));
          cost = (Number(resourceConfig?.cost) || 0) * hours;
          return {
            id: uuidv4(),
            description: resourceConfig?.description || "Bartender",
            subDescription: `${hours} hours @ ${formatCurrency(resourceConfig?.cost || 0)}/hour`,
            cost,
          };
        }

      case "projector":
        if (projectorIncluded) {
          return null; // Skip if projector is already included in backline
        }
        return {
          description,
          subDescription,
          cost,
        };

      case "audio_tech":
        const baseCost = resourceConfig?.cost || 0;
        const overtimeConfig = this.additionalCosts?.resources.find(
          (r: any) => r.id === "audio_tech_overtime"
        );
        const totalHours = differenceInHours(
          parseISO(endTime),
          parseISO(startTime)
        );
        const regularHours = Math.min(totalHours, 7); // Only 7 hours max for base
        const overtimeHours = Math.max(0, totalHours - 7); // Anything over 7 hours is overtime

        const costs: Cost[] = [
          {
            description,
            subDescription,
            cost: Number(baseCost) || 0, // Base cost for up to 7 hours is fixed at $275
          },
        ];

        if (overtimeHours > 0 && overtimeConfig) {
          const overtimeCost =
            (Number(overtimeConfig?.cost) || 0) * overtimeHours;
          costs.push({
            description: overtimeConfig?.description || "Overtime",
            subDescription: overtimeConfig?.subDescription || "",
            cost: Number(overtimeCost) || 0,
          });
        }

        return costs;

      default:
        if (resourceConfig.type === "hourly") {
          const hours = differenceInHours(
            parseISO(endTime),
            parseISO(startTime)
          );
          cost = Number(resourceConfig?.cost || 0) * hours;
        }
        return {
          description,
          subDescription,
          cost,
        };
    }
  }

  calculatePerSlotCosts(booking: Booking): Cost[] {
    const perSlotCosts: Cost[] = [];
    const { startTime, endTime } = booking;

    // Early Open Staff calculation
    const venueOpeningTime = new Date(startTime);
    venueOpeningTime.setHours(18, 0, 0, 0);

    if (new Date(startTime) < venueOpeningTime) {
      const earlyOpenHours = Math.ceil(
        differenceInHours(venueOpeningTime, new Date(startTime))
      );
      if (earlyOpenHours > 0) {
        perSlotCosts.push({
          description: `Early Open Staff (${earlyOpenHours} hours)`,
          subDescription: "Additional staff for early opening",
          cost: Number(earlyOpenHours) * 30,
          isRequired: true,
        } as Cost);
      }
    }

    // Add any other per-slot costs here

    return perSlotCosts;
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
  generateRateDescription(params: RateDescriptionParams): string {
    if (params.isFullDay) {
      return `$${params.fullDayPrice || 0}/day`;
    }

    const formatRate = (price: number, hours: number, type: string) => {
      if (type === "flat") return "Flat rate";
      const rate = price / hours;
      return `$${rate.toFixed(2)}/hour`;
    };

    if ((params.daytimeHours || 0) > 0) {
      const rateStr = formatRate(
        params.daytimePrice || 0,
        params.daytimeHours || 0,
        params.daytimeRateType || ""
      );
      return params.crossoverApplied ? `${rateStr} (crossover rate)` : rateStr;
    }

    if ((params.eveningHours || 0) > 0) {
      return formatRate(
        params.eveningPrice || 0,
        params.eveningHours || 0,
        params.eveningRateType || ""
      );
    }

    return "";
  }

  // NEW: Added helper method to create a cost item.
  private createCostItem(
    description: string,
    periodCost: any,
    rateType: string
  ): any {
    console.log("[PricingRules] Creating cost item:", {
      description,
      periodCost,
      rateType,
    });

    const costItem = {
      description,
      cost: periodCost.price,
      rateType,
      hours: periodCost.hours,
      rate: periodCost.rate,
      minimumHours: periodCost.minimumHours,
      minimumApplied: periodCost.minimumApplied,
      type: periodCost.type || rateType
    };

    console.log("[PricingRules] Created cost item:", costItem);

    return costItem;
  }

  private calculatePeriodCost(
    startTime: Date,
    endTime: Date,
    periodRules: any,
    isEvening: boolean,
    isPrivate: boolean,
    roomSlug: string
  ): {
    price: number;
    hours: number;
    minimumHours?: number;
    rate: number;
    minimumApplied?: boolean;
    type: string;
  } {
    console.log("[PricingRules] Period rules received:", {
      periodRules,
      parent: periodRules.parent,
      minimumHours: periodRules.minimumHours,
      parentMinimumHours: periodRules.parent?.minimumHours,
    });

    if (!periodRules) {
      throw new Error(
        `No rules found for ${isEvening ? "evening" : "daytime"} period`
      );
    }

    const rate = periodRules[isPrivate ? "private" : "public"];
    const actualHours = (Number(endTime) - Number(startTime)) / 3600000;
    const hours = Math.min(
      actualHours,
      isEvening ? 12 : 24 - new Date(startTime).getHours()
    );

    // Check if this is Southern Cross during 11am-4pm
    const isSouthernCrossSpecialHours = roomSlug === SOUTHERN_CROSS_ID &&
      startTime.getHours() >= 11 &&
      endTime.getHours() <= 16;

    // Get minimumHours from parent rules if not found in period rules
    // Set to 0 for Southern Cross during special hours
    const minimumHours = isSouthernCrossSpecialHours ? 0 :
      (periodRules.minimumHours || periodRules.parent?.minimumHours || 0);

    console.log("[PricingRules] Calculated minimum hours:", {
      periodMinimumHours: periodRules.minimumHours,
      parentMinimumHours: periodRules.parent?.minimumHours,
      finalMinimumHours: minimumHours,
      actualHours,
      minimumApplied: actualHours < minimumHours,
      isSouthernCrossSpecialHours,
      roomSlug,
      timeRange: `${startTime.getHours()}:00-${endTime.getHours()}:00`
    });

    // Check if this is a crossover period and use crossover rate if applicable
    const isCrossoverPeriod = this.isCrossoverPeriod(startTime, endTime);
    const effectiveRate =
      isCrossoverPeriod && periodRules.crossoverRate
        ? periodRules.crossoverRate
        : rate;

    if (periodRules.type === "flat") {
      return {
        price: effectiveRate,
        hours,
        rate: effectiveRate,
        minimumHours: 0,
        type: "flat"
      };
    } else if (periodRules.type === "hourly") {
      // Apply minimum hours to price calculation
      const effectiveHours = Math.max(hours, minimumHours);
      const price = effectiveHours * effectiveRate;

      return {
        price,
        hours: actualHours,
        rate: effectiveRate,
        minimumHours,
        minimumApplied: actualHours < minimumHours,
        type: "hourly"
      };
    }

    throw new Error(
      `Invalid pricing type for ${isEvening ? "evening" : "daytime"} period`
    );
  }

  // Add helper method to check for crossover period
  private isCrossoverPeriod(startTime: Date, endTime: Date): boolean {
    // Define your crossover period logic here
    // For example, if crossover is between regular hours and evening hours
    const startHour = startTime.getHours();
    const endHour = endTime.getHours();

    // Example: Consider it a crossover if the booking spans regular hours (before 5pm)
    // and evening hours (after 5pm)
    return startHour < 17 && endHour >= 17;
  }

  // Add logging for rate determination
  private getEffectiveRate(
    room: Room,
    isEvening: boolean,
    isPrivate: boolean
  ): number {
    const rate = isEvening ? room.eveningRate : room.daytimeRate;
    console.log(`[PricingRules] Getting effective rate for ${room.name}:`, {
      isEvening,
      isPrivate,
      baseRate: rate,
      room,
    });
    return rate || 0;
  }

  // When getting the day rules, pass the parent rules to the period rules
  private getDayRules(roomRules: any, date: Date): any {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      throw new Error("Invalid date passed to getDayRules");
    }

    const dayOfWeek = format(date, "EEEE");
    const rules = roomRules[dayOfWeek] || roomRules["all"];

    if (!rules) return null;

    console.log("[PricingRules] Day rules before processing:", {
      dayOfWeek,
      rules,
      eveningMinHours: rules.evening?.minimumHours,
      daytimeMinHours: rules.daytime?.minimumHours,
    });

    // If minimumHours is at the top level, move it to the periods
    if (rules.minimumHours) {
      if (rules.evening) {
        rules.evening.minimumHours =
          rules.evening.minimumHours || rules.minimumHours;
      }
      if (rules.daytime) {
        rules.daytime.minimumHours =
          rules.daytime.minimumHours || rules.minimumHours;
      }
      // Remove top-level minimumHours after distributing
      delete rules.minimumHours;
    }

    // Add parent reference to period rules
    if (rules.daytime) {
      rules.daytime.parent = rules;
    }
    if (rules.evening) {
      rules.evening.parent = rules;
    }

    console.log("[PricingRules] Day rules after processing:", {
      dayOfWeek,
      rules,
      eveningMinHours: rules.evening?.minimumHours,
      daytimeMinHours: rules.daytime?.minimumHours,
    });

    return rules;
  }

  private calculateHoursAndCost(
    start: Date,
    end: Date,
    rate: number,
    rateType: string,
    crossoverRate?: number,
    roomSlug?: string
  ) {
    const hours = differenceInHours(end, start);

    // Check for Southern Cross special hours
    const isSouthernCrossSpecialHours = roomSlug === SOUTHERN_CROSS_ID &&
      start.getHours() >= 11 &&
      end.getHours() <= 16;

    const effectiveRate =
      this.isCrossoverPeriod(start, end) && crossoverRate
        ? crossoverRate
        : rate;

    return {
      hours,
      cost: rateType === "flat" ? rate : effectiveRate * hours,
      hourlyRate: rateType === "flat" ? null : effectiveRate,
      crossoverApplied: effectiveRate !== rate,
      isSouthernCrossSpecialHours
    };
  }

  private formatDescription(rules: any): string {
    if (!rules) return "N/A";
    return rules.type === "flat" ? "Flat Rate" : "Hourly Rate";
  }
}

function dateTimeToISOString(dateTime: Date): string {
  if (!isValid(dateTime)) {
    throw new Error("Invalid date passed to dateTimeToISOString");
  }
  return formatISO(dateTime);
}
