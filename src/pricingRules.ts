// pricing-lib/src/pricingRules.js
import { v4 as uuidv4 } from "uuid";
import {
  getPricingRuleModel,
  getTimePeriodModel,
  getAdditionalCostModel,
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
  fullDayPrice?: number;
  isFullDay?: boolean;
}

interface Cost {
  id?: string; // Add the id property
  description: string;
  subDescription?: string;
  cost: number;
  roomSlug?: string; // Make roomSlug optional in the Cost interface
  isRequired?: boolean;
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

const TORONTO_TIMEZONE = "America/Toronto";
const HST_RATE = 0.13; // 13% HST rate

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
    customLineItems: Record<string, any[]>; // NEW: Added to return type
    grandTotal: number;
    tax: number;
    totalWithTax: number;
  }> {
    try {
      await this.initialize();
      const costEstimates: CostEstimate[] = [];
      let grandTotal = 0;
      const customLineItems: Record<string, any[]> = {}; // NEW: Added to store custom line items

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
                daytimeCostItem: estimate.daytimeCostItem,
                eveningCostItem: estimate.eveningCostItem,
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

              costEstimates.push({
                id: booking.id || uuidv4(),
                date: new Date(date),
                start: new Date(preparedBooking.startTime),
                end: new Date(preparedBooking.endTime),
                estimates: formattedEstimates,
                perSlotCosts: formattedPerSlotCosts,
                slotTotal: slotTotal,
                roomSlugs: preparedBooking.roomSlugs,
                isPrivate: booking.private,
                resources: preparedBooking.resources,
                expectedAttendance: preparedBooking.expectedAttendance,
                customLineItems: slotCustomLineItems,
              });

              // NEW: Store slotCustomLineItems if they exist
              if (slotCustomLineItems && slotCustomLineItems.length > 0) {
                customLineItems[booking.id] = slotCustomLineItems;
              }

              grandTotal += slotTotal;
            } catch (error: any) {
              console.error(
                `Error calculating price for booking ${booking.id}:`,
                error
              );
              costEstimates.push({
                id: booking.id || uuidv4(),
                date: new Date(date),
                start: new Date(booking.startTime),
                end: new Date(booking.endTime),
                estimates: [],
                perSlotCosts: [],
                slotTotal: 0,
                error: error.message,
              });
            }
          });
          return acc.concat(promises);
        },
        []
      );

      const parallelResults = await Promise.all(bookingPromises);
      const tax = this.calculateTax(grandTotal);
      const totalWithTax = this.calculateTotalWithTax(grandTotal);
      console.log("Final costEstimates:", costEstimates);
      console.log("Final customLineItems:", customLineItems);
      // CHANGED: Added customLineItems to the return object
      return { costEstimates, customLineItems, grandTotal, tax, totalWithTax };
    } catch (error: any) {
      console.error("Error in getPrice method:", error);
      // CHANGED: Added customLineItems to the error return
      return {
        costEstimates: [],
        customLineItems: {},
        grandTotal: 0,
        tax: 0,
        totalWithTax: 0,
      };
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
    if (
      !booking.startTime ||
      !booking.endTime ||
      !booking.roomSlugs ||
      booking.roomSlugs.length === 0
    ) {
      console.error("Booking is missing required fields:", {
        startTime: booking.startTime,
        endTime: booking.endTime,
        roomSlugs: booking.roomSlugs,
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
    if (process.env.NODE_ENV === "development") {
      console.log(
        "Custom line items from calculateAdditionalCosts:",
        customLineItems
      );
      console.log("Per-slot costs:", perSlotCosts);
      console.log("Additional costs:", additionalCosts);
    }

    const slotCustomLineItems = [...customLineItems];

    // Handle security
    if (resources.includes("security") || roomSlugs.includes("parking-lot")) {
      const securityConfig = this.additionalCosts?.resources.find(
        (r) => r.id === "security"
      );
      if (securityConfig) {
        slotCustomLineItems.push({
          id: uuidv4(),
          description: securityConfig.description,
          subDescription:
            securityConfig.subDescription || "Will quote separately",
          cost: 0,
          isEditable: true,
          isRequired: roomSlugs.includes("parking-lot"),
        });
      }
    }

    for (const roomSlug of roomSlugs) {
      if (!this.rules) throw new Error("Rules are not initialized");
      const roomRules = this.rules[roomSlug];
      if (!roomRules)
        throw new Error(`No pricing rules found for room: ${roomSlug}`);

      const dayRules = roomRules[currentDay] || roomRules["all"];
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
        isPrivate
      );

      const roomAdditionalCosts = additionalCosts.filter(
        (cost) => cost.roomSlug === roomSlug
      );
      const roomAdditionalCostsTotal = roomAdditionalCosts.reduce(
        (sum, cost) => sum + (Number(cost.cost) || 0),
        0
      );

      const totalBookingHours = differenceInHours(endDateTime, startDateTime);

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
        daytimeCostItem: {
          // Changed: Replace "estimate.isFullDay" with check on dayRules.fullDay.
          description: dayRules.fullDay ? "Full Day Rate" : "Daytime Hours",
          cost: daytimePrice || 0,
          rateType: daytimeRateType || "hourly",
          hours: daytimeHours || 0,
          rate: daytimeRate || 0,
          crossoverApplied: crossoverApplied || false,
          isFullDay: !!dayRules.fullDay,
        },
        eveningCostItem: {
          description: "Evening Hours",
          cost: eveningPrice || 0,
          rateType: eveningRateType || "hourly",
          hours: eveningHours || 0,
          rate: eveningRate || 0,
        },
        fullDayCostItem: this.createCostItem(
          "Full Day Rate",
          fullDayPrice,
          this.generateRateDescription({ isFullDay: true, fullDayPrice })
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
    isPrivate: boolean
  ) {
    const calculateHoursAndCost = (
      start: Date,
      end: Date,
      rate: number,
      rateType: string
    ) => {
      const hours = differenceInHours(end, start);
      return {
        hours,
        cost: rateType === "flat" ? rate : rate * hours,
        hourlyRate: rateType === "flat" ? null : rate,
      };
    };

    const eveningStartTime = new Date(startDateTime);
    eveningStartTime.setHours(17, 0, 0, 0);

    const totalBookingHours = differenceInHours(endDateTime, startDateTime);
    const bookingCrossesEveningThreshold =
      startDateTime < eveningStartTime && endDateTime > eveningStartTime;

    if (dayRules.fullDay) {
      const rate = dayRules.fullDay[isPrivate ? "private" : "public"];
      const { hours, cost } = calculateHoursAndCost(
        startDateTime,
        endDateTime,
        rate,
        dayRules.fullDay.type
      );
      return {
        basePrice: cost,
        fullDayPrice: cost,
        daytimeHours: hours,
        eveningHours: 0,
        daytimePrice: cost,
        eveningPrice: 0,
        daytimeRate: rate,
        eveningRate: 0,
        daytimeRateType: dayRules.fullDay.type,
        eveningRateType: "",
        crossoverApplied: false,
      };
    }

    let basePrice = 0;
    let daytimePrice = 0;
    let eveningPrice = 0;
    let daytimeHours = 0;
    let eveningHours = 0;
    let daytimeRate = 0;
    let eveningRate = 0;
    let crossoverApplied = false;

    if (startDateTime < eveningStartTime && dayRules.daytime) {
      const daytimeEndTime = bookingCrossesEveningThreshold
        ? eveningStartTime
        : endDateTime;
      const pricingRate = dayRules.daytime[isPrivate ? "private" : "public"];
      daytimeRate = pricingRate;

      if (bookingCrossesEveningThreshold && dayRules.daytime.crossoverRate) {
        crossoverApplied = true;
        const { hours, cost } = calculateHoursAndCost(
          startDateTime,
          daytimeEndTime,
          dayRules.daytime.crossoverRate,
          dayRules.daytime.type
        );
        daytimeHours = hours;
        daytimePrice = cost;
      } else {
        const { hours, cost } = calculateHoursAndCost(
          startDateTime,
          daytimeEndTime,
          pricingRate,
          dayRules.daytime.type
        );
        daytimeHours = hours;
        daytimePrice = cost;
      }
      basePrice += daytimePrice;
    }

    if (endDateTime > eveningStartTime && dayRules.evening) {
      const effectiveStart =
        startDateTime > eveningStartTime ? startDateTime : eveningStartTime;
      const { hours, cost } = calculateHoursAndCost(
        effectiveStart,
        endDateTime,
        dayRules.evening[isPrivate ? "private" : "public"],
        dayRules.evening.type
      );
      eveningHours = hours;
      eveningPrice = cost;
      basePrice += eveningPrice;
    }

    if (dayRules.minimumHours && totalBookingHours < dayRules.minimumHours) {
      const ratio = dayRules.minimumHours / totalBookingHours;
      basePrice *= ratio;
      daytimePrice *= ratio;
      eveningPrice *= ratio;
    }

    return {
      basePrice,
      daytimePrice,
      eveningPrice,
      fullDayPrice: 0,
      daytimeHours,
      eveningHours,
      daytimeRate,
      eveningRate,
      daytimeRateType: dayRules.daytime?.type || "",
      eveningRateType: dayRules.evening?.type || "",
      crossoverApplied,
    };
  }

  async calculateAdditionalCosts(booking: any): Promise<{
    perSlotCosts: AdditionalCost[];
    additionalCosts: AdditionalCost[];
    customLineItems: any[];
  }> {
    const {
      resources,
      roomSlugs,
      startTime,
      endTime,
      isPrivate,
      expectedAttendance,
    } = booking;
    if (process.env.NODE_ENV === "development") {
      console.log(
        "=============Booking in calculateAdditionalCosts:===============",
        booking
      );
    }
    let perSlotCosts: AdditionalCost[] = [];
    let additionalCosts: AdditionalCost[] = [];
    const customLineItems: any[] = [];

    // Early Open Staff calculation
    const venueOpeningTime = new Date(startTime);
    venueOpeningTime.setHours(18, 0, 0, 0); // Assuming venue opens at 6 PM
    const bookingStartTime = new Date(startTime);

    if (bookingStartTime < venueOpeningTime) {
      const earlyOpenHours = Math.ceil(
        differenceInHours(venueOpeningTime, bookingStartTime)
      );
      if (earlyOpenHours > 0) {
        const earlyOpenConfig = this.additionalCosts?.conditions.find(
          (c) => c.condition === "earlyOpen"
        );
        if (earlyOpenConfig) {
          perSlotCosts.push({
            id: uuidv4(),
            description: earlyOpenConfig.description,
            subDescription: `${earlyOpenHours} hours`,
            cost: earlyOpenConfig?.cost
              ? earlyOpenConfig.cost * earlyOpenHours
              : 0,
            isRequired: true,
          });
        }
      }
    }

    const bookingHours = differenceInHours(
      parseISO(endTime),
      parseISO(startTime)
    );

    // Per-slot resources
    const perSlotResources = ["door_staff", "piano_tuning"];

    const resourceConfigMap = this.additionalCosts?.resources.reduce(
      (map, resource) => {
        map[resource.id] = resource;
        return map;
      },
      {} as Record<string, any>
    );

    // Replace nested loops with single pass over resources:
    for (const resourceId of resources) {
      const config = resourceConfigMap && resourceConfigMap[resourceId];
      if (!config) continue;

      // Calculate costs for per-slot resources
      if (perSlotResources.includes(resourceId)) {
        let cost =
          config.type === "hourly"
            ? config?.cost
              ? Number(config.cost) * bookingHours || 0
              : 0
            : config?.cost || 0;
        perSlotCosts.push({
          id: uuidv4(),
          description: config.description,
          subDescription: config.subDescription,
          cost: Number(cost) || 0,
          isRequired: false,
        });
      }

      // Handle other resources
      for (const roomSlug of roomSlugs) {
        const backlineConfig = resourceConfigMap["backline"];
        const projectorConfig = resourceConfigMap["projector"];

        let projectorIncluded = false;

        // Handle backline
        if (
          resourceId === "backline" &&
          backlineConfig &&
          backlineConfig.rooms
        ) {
          const roomBacklineConfig = backlineConfig.rooms[roomSlug];
          if (roomBacklineConfig) {
            additionalCosts.push({
              id: uuidv4(),
              roomSlug,
              description:
                roomBacklineConfig.description || backlineConfig.description,
              cost: Number(roomBacklineConfig.cost) || 0,
            });
            projectorIncluded = roomBacklineConfig.includes_projector || false;
          }
        }

        // Handle projector
        if (
          resourceId === "projector" &&
          !projectorIncluded &&
          projectorConfig
        ) {
          additionalCosts.push({
            id: uuidv4(),
            roomSlug,
            description: projectorConfig.description,
            cost: Number(projectorConfig.cost) || 0,
          });
        }

        // Handle other resources
        if (
          !perSlotResources.includes(resourceId) &&
          resourceId !== "backline" &&
          resourceId !== "projector"
        ) {
          let cost = config?.cost || 0;
          let description = config?.description || "";
          let subDescription = config?.subDescription || "";

          switch (resourceId) {
            case "bartender":
              if (isPrivate && expectedAttendance > 100) {
                cost = 0;
                subDescription = "Comped for large private event";
              } else if (config.type === "hourly") {
                cost = Number(config.cost) * bookingHours;
                subDescription = `${bookingHours} hours at $${config.cost}/hour`;
              }
              break;
            case "audio_tech":
              const regularHours = Math.min(bookingHours, 7);
              const overtimeHours = Math.max(0, bookingHours - 7);

              additionalCosts.push({
                id: uuidv4(),
                roomSlug,
                description,
                subDescription,
                cost: Number(config.cost) || 0, // Base cost for up to 7 hours
              });

              if (overtimeHours > 0) {
                const overtimeConfig = resourceConfigMap["audio_tech_overtime"];
                if (overtimeConfig) {
                  additionalCosts.push({
                    id: uuidv4(),
                    roomSlug,
                    description: overtimeConfig.description,
                    subDescription: overtimeConfig.subDescription,
                    cost: Number(overtimeConfig?.cost)
                      ? Number(overtimeConfig.cost) * overtimeHours
                      : 0,
                  });
                }
              }
              continue;
            default:
              if (config.type === "hourly") {
                cost = Number(cost) * bookingHours;
              }
          }

          additionalCosts.push({
            id: uuidv4(),
            roomSlug,
            description,
            subDescription,
            cost: Number(cost),
          });
        }
      }
    }

    if (process.env.NODE_ENV === "development") {
      console.log("Final perSlotCosts:", perSlotCosts);
      console.log("Final additionalCosts:", additionalCosts);
      console.log("Final customLineItems:", customLineItems);
    }
    return { perSlotCosts, additionalCosts, customLineItems };
  }

  calculateResourceCost(
    resource: string,
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
      (r: any) => r.id === resource
    );
    if (!resourceConfig) return null;

    let cost: number = Number(resourceConfig?.cost) || 0;
    let description: string = resourceConfig?.description || "";
    let subDescription: string = resourceConfig?.subDescription || "";

    switch (resource) {
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
        }
        return {
          description,
          subDescription,
          cost,
        };

      case "bartender":
        if (isPrivate && expectedAttendance > 100) {
          return {
            description,
            subDescription: "Comped for large private event",
            cost: 0,
          };
        } else {
          const hours = differenceInHours(
            parseISO(endTime),
            parseISO(startTime)
          );
          cost = (Number(resourceConfig?.cost) || 0) * hours;
          return {
            description,
            subDescription,
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
    fullDayPrice,
    isFullDay,
  }: BookingRates): string {
    if (isFullDay) {
      return `$${fullDayPrice}/day`;
    }

    const formatRate = (price: number, hours: number, type: string) => {
      if (type === "flat") return "Flat rate";
      const rate = price / hours;
      return `$${rate.toFixed(2)}/hour`;
    };

    if ((daytimeHours || 0) > 0) {
      const rateStr = formatRate(
        daytimePrice || 0,
        daytimeHours || 0,
        daytimeRateType || ""
      );
      return crossoverApplied ? `${rateStr} (crossover rate)` : rateStr;
    }

    if (eveningHours > 0) {
      return formatRate(eveningPrice || 0, eveningHours, eveningRateType || "");
    }

    return "";
  }

  // NEW: Added helper method to create a cost item.
  private createCostItem(
    description: string,
    cost: number,
    rateDescription: string
  ) {
    return { description, cost, rateDescription };
  }

  private calculatePeriodCost(
    startTime: Date,
    endTime: Date,
    periodRules: any,
    isEvening: boolean,
    isPrivate: boolean
  ): { price: number; hours: number } {
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

    // Check if this is a crossover period and use crossover rate if applicable
    const isCrossoverPeriod = this.isCrossoverPeriod(startTime, endTime);
    const effectiveRate =
      isCrossoverPeriod && periodRules.crossoverRate
        ? periodRules.crossoverRate
        : rate;

    if (periodRules.type === "flat") {
      return { price: effectiveRate, hours };
    } else if (periodRules.type === "hourly") {
      const effectiveHours = Math.max(hours, periodRules.minimumHours || 0);
      return { price: effectiveHours * effectiveRate, hours };
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
}

function dateTimeToISOString(dateTime: Date): string {
  if (!isValid(dateTime)) {
    throw new Error("Invalid date passed to dateTimeToISOString");
  }
  return formatISO(dateTime);
}
