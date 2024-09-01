import mongoose, { Schema, Model, Document } from "mongoose";

// Define interfaces for the schemas
interface ICostEstimateVersion {
  version: number;
  costEstimates: Array<{
    id: string;
    date: Date;
    roomSlug: string;
    start: Date;
    end: Date;
    basePrice: number;
    daytimeHours: number;
    eveningHours: number;
    daytimePrice: number;
    eveningPrice: number;
    perSlotCosts: Array<{
      description: string;
      cost?: number | null;
    }>;
    additionalCosts: Array<{
      description: string;
      cost?: number | null;
    }>;
    totalCost: number;
  }>;
  totalCost: number;
  createdAt?: Date;
  createdBy?: mongoose.Schema.Types.ObjectId;
}

interface ICostEstimate extends Document {
  rentalRequestId: string;
  versions: ICostEstimateVersion[];
  currentVersion: number;
  status: "draft" | "sent" | "approved" | "rejected";
  stripeEstimateId?: string;
  updatedAt?: Date;
}

// Define the schemas
const CostEstimateVersionSchema = new mongoose.Schema({
  version: Number,
  label: String,
  costEstimates: [
    {
      id: String,
      date: Date,
      roomSlug: String,
      basePrice: { type: Number, required: true },
      daytimeHours: { type: Number, required: true },
      eveningHours: { type: Number, required: true },
      daytimePrice: { type: Number, required: true },
      eveningPrice: { type: Number, required: true },
      start: Date,
      end: Date,
      totalCost: { type: Number, required: true },
      perSlotCosts: [
        {
          description: String,
          cost: Number,
        },
      ],
      additionalCosts: [
        {
          description: String,
          subDescription: String,
          cost: Number,
        },
      ],
    },
  ],
  totalCost: Number,
  createdAt: { type: Date, default: Date.now },
});
const CostEstimateSchema = new mongoose.Schema<ICostEstimate>({
  rentalRequestId: {
    type: String,
    required: true,
  },
  versions: [CostEstimateVersionSchema],
  currentVersion: { type: Number, default: 1 },
  status: {
    type: String,
    enum: ["draft", "sent", "approved", "rejected"],
    default: "draft",
  },
  stripeEstimateId: { type: String },
  updatedAt: { type: Date, default: Date.now },
});
export const CostEstimate = mongoose.model("CostEstimate", CostEstimateSchema);

export function getCostEstimateModel(connection: mongoose.Connection) {
  //   console.log("Inside getCostEstimateModel", connection);
  if (!connection) {
    console.error("No connection provided to getCostEstimateModel");
    return null;
  }
  return connection.model<ICostEstimate>("CostEstimate", CostEstimateSchema);
}
