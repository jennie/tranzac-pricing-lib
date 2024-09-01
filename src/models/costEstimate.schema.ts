import mongoose, { Schema, Model, Document } from "mongoose";

interface ICostEstimateVersion {
  version: number;
  label: string;
  costEstimates: Array<{
    id: string;
    date: Date;
    start: Date;
    end: Date;
    estimates: Array<{
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
      additionalCosts: Array<{
        description: string;
        subDescription: string;
        cost: number;
      }>;
      totalCost: number;
      rateDescription: string;
      rateSubDescription: string;
      minimumHours: number;
      totalBookingHours: number;
      isFullDay: boolean;
    }>;
    perSlotCosts: Array<{
      description: string;
      cost: number;
    }>;
    slotTotal: number;
  }>;
  totalCost: number;
  createdAt: Date;
}

interface ICostEstimate extends Document {
  rentalRequestId: string;
  versions: ICostEstimateVersion[];
  currentVersion: number;
  status: "draft" | "sent" | "approved" | "rejected";
  stripeEstimateId?: string;
  updatedAt: Date;
}

const CostEstimateVersionSchema = new Schema<ICostEstimateVersion>({
  version: { type: Number, required: true },
  label: { type: String, required: true },
  costEstimates: [
    {
      id: { type: String, required: true },
      date: { type: Date, required: true },
      start: { type: Date, required: true },
      end: { type: Date, required: true },
      estimates: [
        {
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
          additionalCosts: [
            {
              description: { type: String, required: true },
              subDescription: { type: String },
              cost: { type: Number, required: true },
            },
          ],
          totalCost: { type: Number, required: true },
          rateDescription: { type: String, required: true },
          rateSubDescription: { type: String },
          minimumHours: { type: Number },
          totalBookingHours: { type: Number, required: true },
          isFullDay: { type: Boolean, required: true },
        },
      ],
      perSlotCosts: [
        {
          description: { type: String, required: true },
          cost: { type: Number, required: true },
        },
      ],
      slotTotal: { type: Number, required: true },
    },
  ],
  totalCost: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

const CostEstimateSchema = new Schema<ICostEstimate>({
  rentalRequestId: { type: String, required: true },
  versions: [CostEstimateVersionSchema],
  currentVersion: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ["draft", "sent", "approved", "rejected"],
    default: "draft",
  },
  stripeEstimateId: { type: String },
  updatedAt: { type: Date, default: Date.now },
});

export const CostEstimate = mongoose.model<ICostEstimate>(
  "CostEstimate",
  CostEstimateSchema
);

export function getCostEstimateModel(
  connection: mongoose.Connection
): Model<ICostEstimate> {
  if (!connection) {
    throw new Error("No connection provided to getCostEstimateModel");
  }
  return connection.model<ICostEstimate>("CostEstimate", CostEstimateSchema);
}
