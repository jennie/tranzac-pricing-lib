// pricing.schema.ts

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
}

export interface IResource {
  label: string;
  value: string;
}

// Declare a module augmentation for the global Process interface
declare global {
  namespace NodeJS {
    interface Process {
      server?: boolean;
    }
  }
}

let mongoose: Mongoose | null = null;

if (typeof process !== "undefined" && process.server) {
  import("mongoose").then((mongooseModule) => {
    mongoose = mongooseModule;
  });
}
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
};

const ResourceSchema: Record<keyof IResource, any> = {
  label: { type: String, required: true },
  value: { type: String, required: true },
};

// Factory functions to create models
// pricing.schema.ts

export const getTimePeriodModel = (
  mongooseInstance: Mongoose
): Model<ITimePeriod> => {
  return (
    mongooseInstance.models.TimePeriod ||
    mongooseInstance.model<ITimePeriod>(
      "TimePeriod",
      new mongooseInstance.Schema(TimePeriodSchema)
    )
  );
};

export const getPricingRuleModel = (
  mongooseInstance: Mongoose
): Model<IPricingRule> => {
  return (
    mongooseInstance.models.PricingRule ||
    mongooseInstance.model<IPricingRule>(
      "PricingRule",
      new mongooseInstance.Schema(PricingRuleSchema)
    )
  );
};

export const getAdditionalCostModel = (
  mongooseInstance: Mongoose
): Model<IAdditionalCost> => {
  return (
    mongooseInstance.models.AdditionalCost ||
    mongooseInstance.model<IAdditionalCost>(
      "AdditionalCost",
      new mongooseInstance.Schema(AdditionalCostSchema)
    )
  );
};

export const getResourceModel = (
  mongooseInstance: Mongoose
): Model<IResource> => {
  return (
    mongooseInstance.models.Resource ||
    mongooseInstance.model<IResource>(
      "Resource",
      new mongooseInstance.Schema(ResourceSchema)
    )
  );
};
