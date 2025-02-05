import { v4 as uuidv4 } from "uuid";
import { Schema, model, Document, Model, models } from "mongoose";
import { CostEstimateSchemaDefinition } from "./costEstimate.schema";

interface IAdditionalCost extends Document {
  id: string;
  roomSlugs: string[];
  description: string;
  subDescription?: string;
  cost: number;
  isRequired: boolean;
}

export interface Room {
  cost: number;
  type: "flat" | "hourly" | "custom" | "base";
  description: string;
  includes_projector?: boolean;
}

export interface Resource {
  id: string;
  cost: number | string;
  type: "flat" | "hourly" | "custom" | "base";
  description: string;
  subDescription?: string;
  rooms?: {
    [roomSlug: string]: Room;
  };
}

export interface Condition {
  id: string;
  condition: string;
  cost?: number;
  type?: "flat" | "hourly" | "custom";
  attendeeThreshold?: number;
  description: string;
}

export interface IAdditionalCosts extends Document {
  _id: string;
  resources: Resource[];
  conditions: Condition[];
}

const ConditionSchema = new Schema<Condition>({
  id: {
    type: String,
    required: true,
    default: () => uuidv4(),
    unique: true,
  },
  condition: { type: String, required: true },
  cost: { type: Number },
  type: { type: String, enum: ["flat", "hourly", "custom"] },
  attendeeThreshold: { type: Number },
  description: { type: String, required: true },
});

const ResourceSchema = new Schema<Resource>({
  id: {
    type: String,
    required: true,
    default: () => uuidv4(),
    unique: true,
  },
  cost: { type: Schema.Types.Mixed, required: true },
  type: {
    type: String,
    enum: ["flat", "hourly", "custom", "base"],
    required: true,
  },
  description: { type: String, required: true },
  subDescription: { type: String },
  rooms: {
    type: Map,
    of: new Schema<Room>({
      cost: { type: Number, required: true },
      type: {
        type: String,
        enum: ["flat", "hourly", "custom", "base"],
        required: true,
      },
      description: { type: String, required: true },
      includes_projector: { type: Boolean },
    }),
  },
});

const AdditionalCostSchema = new Schema<IAdditionalCost>({
  id: {
    type: String,
    required: true,
    default: () => uuidv4(),
    unique: true,
  },
  roomSlugs: { type: [String], required: true },
  description: { type: String, required: true },
  subDescription: { type: String },
  cost: { type: Number, required: true },
  isRequired: { type: Boolean },
});

const AdditionalCostsSchema = new Schema<IAdditionalCosts>({
  resources: [ResourceSchema],
  conditions: [ConditionSchema],
});

export const AdditionalCost =
  models.AdditionalCost ||
  model<IAdditionalCost>("AdditionalCost", AdditionalCostSchema);
export const AdditionalCosts =
  models.AdditionalCosts ||
  model<IAdditionalCosts>("AdditionalCosts", AdditionalCostsSchema);
