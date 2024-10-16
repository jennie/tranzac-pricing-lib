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
  id?: string; // Add the id property
  roomSlug: string;
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
  fullDayPrice?: number;
  isFullDay?: boolean;
}

interface BookingDetails {
  resources: string[];
  rooms: Array<{ roomSlug: string; additionalCosts?: any[] }>;
  isPrivate?: boolean; // Make isPrivate optional
  expectedAttendance?: number; // Make expectedAttendance optional
  start: string;
  end: string;
}

interface Cost {
  description: string;
  subDescription?: string;
  cost: number;
  roomSlug?: string; // Make roomSlug optional in the Cost interface
  isRequired?: boolean;
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
  private additionalCosts: any;
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
    customLineItems: Record<string, any[]>; // NEW: Added to return type
    grandTotal: number;
    tax: number;
    totalWithTax: number;
  }> {
    try {
      await this.initialize();
      const costEstimates = [];
      let grandTotal = 0;
      const customLineItems: Record<string, any[]> = {}; // NEW: Added to store custom line items

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
          let bookingTotal = 0;

          try {
            const preparedBooking: Booking =
              this.prepareBookingForPricing(booking);

            // CHANGED: Destructure slotCustomLineItems from calculatePrice result
            const { estimates, perSlotCosts, slotTotal, slotCustomLineItems } =
              await this.calculatePrice({
                ...preparedBooking,
                date,
                resources: preparedBooking.resources || [],
                isPrivate: booking.private || false,
                expectedAttendance:
                  Number(preparedBooking.expectedAttendance) || 0,
              });

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
              fullDayCostItem: estimate.fullDayCostItem,
            }));

            const formattedPerSlotCosts = perSlotCosts.map((cost) => ({
              description: cost.description,
              subDescription: cost.subDescription,
              cost: cost.cost,
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
        }
      }

      const tax = this.calculateTax(grandTotal);
      const totalWithTax = this.calculateTotalWithTax(grandTotal);

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
    const startDateTime = toZonedTime(parseISO(startTime), TORONTO_TIMEZONE);
    const endDateTime = toZonedTime(parseISO(endTime), TORONTO_TIMEZONE);

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
        fullDayCostItem: room.fullDayCostItem || null,
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
      throw new Error("booking:" + JSON.stringify(booking, null, 2));
    }

    const {
      roomSlugs,
      startTime,
      endTime,
      isPrivate = false,
      expectedAttendance = 0,
      resources,
      date,
      rooms,
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

    const slotCustomLineItems = customLineItems;

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

      const eveningStartTime = new Date(startDateTime);
      eveningStartTime.setHours(17, 0, 0, 0);

      const totalBookingHours = differenceInHours(endDateTime, startDateTime);

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
          daytimeHours = differenceInHours(daytimeEndTime, startDateTime);
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
          eveningHours = differenceInHours(endDateTime, eveningStartTime);
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

      const formattedFullDayDescription = this.generateRateDescription({
        isFullDay: true,
        fullDayPrice,
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
        fullDayCostItem:
          fullDayPrice > 0
            ? {
                id: uuidv4(),
                description: "Full Day Rate",
                subDescription: formattedFullDayDescription || "",
                cost: fullDayPrice,
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

    return { estimates, perSlotCosts, slotTotal, slotCustomLineItems };
  }

  async calculateAdditionalCosts(booking: Booking): Promise<{
    perSlotCosts: Cost[];
    additionalCosts: Cost[];
    customLineItems: any[]; // Add customLineItems to the return type
  }> {
    const {
      resources,
      rooms,
      roomSlugs,
      isPrivate = false,
      expectedAttendance = 0,
      startTime,
      endTime,
    } = booking;
    const additionalCosts: Cost[] = [];
    let perSlotCosts: Cost[] = [];

    if (!rooms) {
      throw new Error("Rooms are undefined in booking");
    }
    for (const room of rooms) {
      const roomSlug = room.slug;

      let projectorIncluded = false;

      // Check if backline includes projector
      if (resources.includes("backline")) {
        const backlineConfig = this.additionalCosts?.resources?.find(
          (r: any) => r.id === "backline"
        );
        if (backlineConfig?.rooms?.[roomSlug]?.includes_projector) {
          projectorIncluded = true;
        }
      }

      // Calculate resource-based costs
      for (const resource of resources) {
        const cost = this.calculateResourceCost(resource, {
          roomSlug: roomSlug,
          isPrivate,
          expectedAttendance,
          startTime,
          endTime,
          projectorIncluded,
        });
        if (cost) {
          if (Array.isArray(cost)) {
            additionalCosts.push(...cost.map((c) => ({ ...c, roomSlug })));
          } else {
            additionalCosts.push({ ...cost, roomSlug });
          }
        }
      }

      // Add any pre-existing additional costs for the room
      if (room.additionalCosts && Array.isArray(room.additionalCosts)) {
        additionalCosts.push(
          ...room.additionalCosts.map((cost: any) => ({
            ...cost,
            roomSlug,
          }))
        );
      }
    }

    // Calculate per-slot costs
    perSlotCosts = this.calculatePerSlotCosts(booking);

    // Add unique IDs to perSlotCosts
    perSlotCosts = perSlotCosts.map((cost) => ({
      id: uuidv4(),
      ...cost,
    }));

    console.log(
      "calculateAdditionalCosts - Result:",
      JSON.stringify({ perSlotCosts, additionalCosts }, null, 2)
    );
    return { perSlotCosts, additionalCosts, customLineItems: [] }; // Ensure customLineItems is returned
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

    let cost: number = resourceConfig.cost || 0;
    let description: string = resourceConfig.description || "";
    let subDescription: string = resourceConfig.subDescription || "";

    switch (resource) {
      case "food":
        return {
          description,
          subDescription,
          cost,
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
          cost = (resourceConfig.cost || 0) * hours;
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
        const baseCost = resourceConfig.cost || 0;
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
            cost: baseCost, // Base cost for up to 7 hours is fixed at $275
          },
        ];

        if (overtimeHours > 0 && overtimeConfig) {
          const overtimeCost = (overtimeConfig.cost || 0) * overtimeHours;
          costs.push({
            description: overtimeConfig.description || "Overtime",
            subDescription: overtimeConfig.subDescription || "",
            cost: overtimeCost,
          });
        }

        return costs;

      default:
        if (resourceConfig.type === "hourly") {
          const hours = differenceInHours(
            parseISO(endTime),
            parseISO(startTime)
          );
          cost = (resourceConfig.cost || 0) * hours;
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
          cost: earlyOpenHours * 30,
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
    // Ensure default values for missing properties
    let rateDescription = "";

    if (isFullDay) {
      rateDescription = `$${fullDayPrice}/day`;
    } else if ((daytimeHours ?? 0) > 0) {
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
