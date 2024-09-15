// src/models/additionalCosts.ts
import { Schema, model, Document } from "mongoose";

interface IAdditionalCost extends Document {
  roomSlugs: string[];
  description: string;
  subDescription?: string; // Define subDescription as an optional field
  cost: number;
}

export interface Room {
  cost: number;
  type: "flat" | "hourly" | "custom" | "base";
  description: string;
  includes_projector?: boolean; // Optional property
}

export interface Resource {
  id: string;
  cost: number | string; // Can be a number or "Will quote separately"
  type: "flat" | "hourly" | "custom" | "base";
  description: string;
  subDescription?: string;
  rooms?: {
    [roomSlug: string]: Room; // Rooms as an object with room slugs as keys
  };
}

export interface Condition {
  condition: string;
  cost?: number; // Optional, since not all conditions have a cost
  type?: "flat" | "hourly" | "custom"; // Optional, since not all conditions have a type
  attendeeThreshold?: number; // Optional, for conditions like privateEventBar
  description: string;
}

export interface AdditionalCosts {
  _id: string;
  resources: Resource[];
  conditions: Condition[];
}

const AdditionalCostSchema = new Schema<IAdditionalCost>({
  roomSlugs: { type: [String], required: true },
  description: { type: String, required: true },
  subDescription: { type: String }, // Add subDescription to the schema
  cost: { type: Number, required: true },
});

export default model<IAdditionalCost>("AdditionalCost", AdditionalCostSchema);
