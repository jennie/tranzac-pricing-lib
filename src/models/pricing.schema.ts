import type { Model, Mongoose, Schema } from "mongoose";

export interface ITimePeriod {
  name: string;
  startTime: number;
  endTime: number;
}

export interface IPricingRule {
  roomSlug: string;
  day: string;
  timePeriod: "daytime" | "evening";
  isPrivate: boolean;
  rate: number;
  type: "hourly" | "flat";
  minimumHours?: number;
  pricing: any;
}

export interface IAdditionalCost {
  name: string;
  cost: number;
  type: "flat" | "hourly" | "base" | "custom";
  description?: string;
  subDescription?: string;
}

export interface IResource {
  label: string;
  value: string;
}

export interface BookingRates {
  basePrice: number;
  daytimeHours: number;
  eveningHours: number;
  daytimePrice: number;
  eveningPrice: number;
  daytimeRate: number;
  eveningRate: number;
  daytimeRateType: string;
  eveningRateType: string;
  daytimeMinHours: number;
  eveningMinHours: number;
  daytimeCostItem: CostItem;
  eveningCostItem: CostItem;
  additionalCosts: any[];
  totalCost: number;
  rateDescription: string;
  totalBookingHours: number;
  isFullDay: boolean;
  crossoverApplied?: boolean;
  fullDayPrice: number;
}

export interface CostItem {
  description: string;
  cost: number;
  minimumHours: number;
  rate: number;
  rateType: string;
  crossoverApplied: boolean;
}

// Add this new interface
export interface RateDescriptionParams {
  basePrice: number;
  isFullDay: boolean;
  fullDayPrice: number;
  daytimeHours?: number;
  daytimePrice?: number;
  daytimeRate?: number;
  daytimeRateType?: string;
  eveningHours?: number;
  eveningPrice?: number;
  eveningRate?: number;
  eveningRateType?: string;
  crossoverApplied?: boolean;
}

// Declare a module augmentation for the global Process interface
declare global {
  namespace NodeJS {
    interface Process {
      server?: boolean;
    }
  }
}

// Replace global mongoose promise with explicit export
export let mongoosePromise: Promise<typeof import("mongoose")> | null = import(
  "mongoose"
);

// Define schemas as plain objects
const TimePeriodSchema: Record<keyof ITimePeriod, any> = {
  name: { type: String, required: true },
  startTime: { type: Number, required: true },
  endTime: { type: Number, required: true },
};

const PricingRuleSchema: Record<keyof IPricingRule, any> = {
  roomSlug: { type: String, required: true },
  pricing: { type: "Mixed", required: true },
  day: { type: String, required: true },
  timePeriod: { type: String, enum: ["daytime", "evening"], required: true },
  isPrivate: { type: Boolean, required: true },
  rate: { type: Number, required: true },
  type: { type: String, enum: ["hourly", "flat"], required: true },
  minimumHours: { type: Number },
};

const AdditionalCostSchema: Record<keyof IAdditionalCost, any> = {
  name: { type: String, required: true },
  cost: { type: Number, required: true },
  type: {
    type: String,
    enum: ["flat", "hourly", "base", "custom"],
    required: true,
  },
  description: { type: String },
  subDescription: { type: String },
};

const ResourceSchema: Record<keyof IResource, any> = {
  label: { type: String, required: true },
  value: { type: String, required: true },
};

// Factory functions to create models
async function getMongoose(): Promise<Mongoose> {
  if (!mongoosePromise) {
    throw new Error("Mongoose is not initialized");
  }
  const { default: mongoose } = await mongoosePromise;
  return mongoose;
}

export const getTimePeriodModel = async (): Promise<Model<ITimePeriod>> => {
  const mongoose = await getMongoose();
  return (
    mongoose.models.TimePeriod ||
    mongoose.model<ITimePeriod>(
      "TimePeriod",
      new mongoose.Schema(TimePeriodSchema)
    )
  );
};

export const getPricingRuleModel = async (): Promise<Model<IPricingRule>> => {
  const mongoose = await getMongoose();
  return (
    mongoose.models.PricingRule ||
    mongoose.model<IPricingRule>(
      "PricingRule",
      new mongoose.Schema(PricingRuleSchema)
    )
  );
};

export const getAdditionalCostModel = async (): Promise<
  Model<IAdditionalCost>
> => {
  const mongoose = await getMongoose();
  return (
    mongoose.models.AdditionalCost ||
    mongoose.model<IAdditionalCost>(
      "AdditionalCost",
      new mongoose.Schema(AdditionalCostSchema)
    )
  );
};

export const getResourceModel = async (): Promise<Model<IResource>> => {
  const mongoose = await getMongoose();
  return (
    mongoose.models.Resource ||
    mongoose.model<IResource>("Resource", new mongoose.Schema(ResourceSchema))
  );
};
