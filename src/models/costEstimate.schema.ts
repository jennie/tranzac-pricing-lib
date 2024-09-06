import type { Document, Model, Mongoose, Schema } from "mongoose";

let mongoosePromise: Promise<typeof import("mongoose")> | null = null;

mongoosePromise = import("mongoose");

interface ICostEstimateVersion {
  version: number;
  label: string;
  costEstimates: Array<{
    id: string;
    date: Date;
    roomSlug: string;
    basePrice: number;
    daytimeHours: number;
    eveningHours: number;
    daytimePrice: number;
    eveningPrice: number;
    fullDayPrice: number;
    daytimeRate: number;
    daytimeRateType: string;
    eveningRate: number;
    eveningRateType: string;
  }>;
}

interface IStatusHistory {
  status: string;
  timestamp: Date;
  changedBy: string;
}

export interface ICostEstimate extends Document {
  projectId: string;
  versions: ICostEstimateVersion[];
  statusHistory: IStatusHistory[];
}

export const CostEstimateSchemaDefinition = {
  projectId: { type: String, required: true },
  versions: [
    {
      version: { type: Number, required: true },
      label: { type: String, required: true },
      costEstimates: [
        {
          id: { type: String, required: true },
          date: { type: Date, required: true },
          roomSlug: { type: String, required: true },
          basePrice: { type: Number, required: true },
          daytimeHours: { type: Number, required: true },
          eveningHours: { type: Number, required: true },
          daytimePrice: { type: Number, required: true },
          eveningPrice: { type: Number, required: true },
          fullDayPrice: { type: Number, required: true },
          daytimeRate: { type: Number, required: true },
          daytimeRateType: { type: String, required: true },
          eveningRate: { type: Number, required: true },
          eveningRateType: { type: String, required: true },
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
