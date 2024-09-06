import type { Document, Model, Mongoose, Schema } from "mongoose";

let mongoosePromise: Promise<typeof import("mongoose")> | null = null;

mongoosePromise = import("mongoose");

interface ICostEstimateVersion {
  version: number;
  label: string;
  estimates: Array<{
    id: string;
    date: Date;
    roomSlug: string;
    basePrice: number;
    daytimeHours?: number; // Optional fields, if not always present
    eveningHours?: number;
    daytimePrice?: number;
    eveningPrice?: number;
    fullDayPrice?: number;
    daytimeRate?: number;
    daytimeRateType?: string;
    eveningRate?: number;
    eveningRateType?: string;
  }>;
}

interface IStatusHistory {
  status: string;
  timestamp: Date;
  changedBy: string;
}

export interface ICostEstimate extends Document {
  versions: ICostEstimateVersion[];
  statusHistory: IStatusHistory[];
}

export const CostEstimateSchemaDefinition = {
  versions: [
    {
      version: { type: Number, required: true },
      label: { type: String, required: true },
      estimates: [
        {
          id: { type: String, required: true },
          date: { type: Date, required: true },
          roomSlug: { type: String },
          basePrice: { type: Number },
          daytimeHours: { type: Number, default: 0 }, // Default to 0
          eveningHours: { type: Number, default: 0 },
          daytimePrice: { type: Number, default: 0 },
          eveningPrice: { type: Number, default: 0 },
          fullDayPrice: { type: Number, default: 0 },
          daytimeRate: { type: Number, default: null }, // Optional fields, default to null
          daytimeRateType: { type: String, default: null },
          eveningRate: { type: Number, default: null },
          eveningRateType: { type: String, default: null },
        },
      ],
    },
  ],
  statusHistory: [
    {
      status: { type: String, required: true },
      timestamp: { type: Date, required: true },
      changedBy: { type: String, required: true },
    },
  ],
};

// Factory functions to create models
async function getMongoose(): Promise<Mongoose> {
  if (!mongoosePromise) {
    throw new Error("Mongoose is not initialized");
  }
  const { default: mongoose } = await mongoosePromise;
  return mongoose;
}

export const getCostEstimateModel = async (): Promise<Model<ICostEstimate>> => {
  const mongoose = await getMongoose();
  return (
    mongoose.models.CostEstimate ||
    mongoose.model<ICostEstimate>(
      "CostEstimate",
      new mongoose.Schema(CostEstimateSchemaDefinition)
    )
  );
};
