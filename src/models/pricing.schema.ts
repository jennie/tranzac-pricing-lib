import mongoose, { Schema, model, Model } from "mongoose";

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

const TimePeriodSchema = new Schema<ITimePeriod>({
  name: { type: String, required: true },
  startTime: { type: Number, required: true },
  endTime: { type: Number, required: true },
});

const PricingRuleSchema = new Schema<IPricingRule>({
  roomSlug: { type: String, required: true },
  day: { type: String, required: true },
  timePeriod: { type: String, enum: ["daytime", "evening"], required: true },
  isPrivate: { type: Boolean, required: true },
  rate: { type: Number, required: true },
  type: { type: String, enum: ["hourly", "flat"], required: true },
  minimumHours: { type: Number },
});

const AdditionalCostSchema = new Schema<IAdditionalCost>({
  name: { type: String, required: true },
  cost: { type: Number, required: true },
  type: {
    type: String,
    enum: ["flat", "hourly", "base", "custom"],
    required: true,
  },
  description: { type: String },
});

const ResourceSchema = new Schema<IResource>({
  label: { type: String, required: true },
  value: { type: String, required: true },
});

// Factory functions to create models
export function getTimePeriodModel(
  mongoose: mongoose.Mongoose
): Model<ITimePeriod> {
  return (
    mongoose.models.TimePeriod ||
    model<ITimePeriod>("TimePeriod", TimePeriodSchema)
  );
}

export function getPricingRuleModel(
  mongoose: mongoose.Mongoose
): Model<IPricingRule> {
  return (
    mongoose.models.PricingRule ||
    model<IPricingRule>("PricingRule", PricingRuleSchema)
  );
}

export function getAdditionalCostModel(
  mongoose: mongoose.Mongoose
): Model<IAdditionalCost> {
  return (
    mongoose.models.AdditionalCost ||
    model<IAdditionalCost>("AdditionalCost", AdditionalCostSchema)
  );
}

export function getResourceModel(
  mongoose: mongoose.Mongoose
): Model<IResource> {
  return (
    mongoose.models.Resource || model<IResource>("Resource", ResourceSchema)
  );
}
