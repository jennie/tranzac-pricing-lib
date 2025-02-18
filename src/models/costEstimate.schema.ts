import { Document, Model, Mongoose } from "mongoose";

export let mongoosePromise: Promise<typeof import("mongoose")> | null = import(
  "mongoose"
);

export interface ICostEstimateVersion {
  rentalRequestId: string;
  version: number;
  label?: string;
  estimates: Array<{
    id: string;
    date: Date;
    start: Date;
    end: Date;
    estimates: Array<{
      roomSlug: string;
      basePrice: number;
      daytimeHours?: number;
      eveningHours?: number;
      daytimePrice?: number;
      eveningPrice?: number;
      fullDayPrice?: number;
      daytimeRate?: number;
      daytimeRateType?: string;
      eveningRate?: number;
      eveningRateType?: string;
      additionalCosts: Array<{
        description: string;
        subDescription?: string;
        cost: number;
        isRequired: { type: Boolean; default: false };
      }>;
      totalCost: number;
      rateDescription?: string;
      minimumHours?: number;
      totalBookingHours?: number;
      isFullDay?: boolean;
      daytimeCostItem?: {
        description?: string;
        cost?: number;
      };
      eveningCostItem?: {
        description?: string;
        cost?: number;
      };
    }>;
    perSlotCosts: any[];
    slotTotal: number;
  }>;
  tax: number;
  totalWithTax: number;
  statusHistory: IStatusHistory[];
  contractPdf: {
    data: Buffer;
    contentType: string;
  };
  depositInvoiceUrl: string;
  balanceInvoiceUrl: string;
}

export interface IStatusHistory {
  status: string;
  timestamp: Date;
  changedBy: string;
}

export interface ICostEstimate extends Document {
  versions: ICostEstimateVersion[];
  statusHistory: IStatusHistory[];
  rentalRequestId: string;
  createdAt: Date; // Add these
  updatedAt: Date; // timestamp fields
  roomSlug: string;
  basePrice: number;
  daytimeHours?: number;
  eveningHours?: number;
  daytimePrice?: number;
  eveningPrice?: number;
  fullDayPrice?: number;
  daytimeRate?: number;
  daytimeRateType?: string;
  eveningRate?: number;
  eveningRateType?: string;
  daytimeMinHours?: number;
  eveningMinHours?: number;
  daytimeMinimumHours?: number;
  eveningMinimumHours?: number;
  additionalCosts?: any[];
  totalCost: number;
}

export const CostEstimateSchemaDefinition = {
  rentalRequestId: { type: String, required: true },
  versions: [
    {
      version: { type: Number, required: true },
      label: { type: String, required: false },
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
              daytimeHours: { type: Number, default: 0 },
              eveningHours: { type: Number, default: 0 },
              daytimePrice: { type: Number, default: 0 },
              eveningPrice: { type: Number, default: 0 },
              fullDayPrice: { type: Number, default: 0 },
              daytimeRate: { type: Number },
              daytimeRateType: { type: String },
              eveningRate: { type: Number },
              eveningRateType: { type: String },
              additionalCosts: [
                {
                  id: { type: String, required: true },
                  description: { type: String, required: true },
                  subDescription: { type: String },
                  cost: { type: Number, required: true },
                  isRequired: { type: Boolean, default: false },
                },
              ],
              totalCost: { type: Number, required: true },
              rateDescription: { type: String },
              minimumHours: { type: Number },
              totalBookingHours: { type: Number },
              isFullDay: { type: Boolean },
              daytimeCostItem: {
                description: { type: String },
                cost: { type: Number },
              },
              eveningCostItem: {
                description: { type: String },
                cost: { type: Number },
              },
            },
          ],
          perSlotCosts: [
            {
              id: { type: String, required: true },
              description: { type: String, required: true },
              subDescription: { type: String },
              cost: { type: Number, required: true },
              isRequired: { type: Boolean, default: false },
            },
          ],
          customLineItems: [
            {
              id: String,
              description: String,
              subDescription: String,
              cost: Number,
              isEditable: Boolean,
              isRequired: Boolean,
            },
          ],
          slotTotal: { type: Number, required: true },
        },
      ],
      totalCost: { type: Number, required: true },
      createdAt: { type: Date, required: true },
      depositInvoiceUrl: { type: String, default: null },
      balanceInvoiceUrl: { type: String, default: null },
      contractPdf: {
        data: { type: Buffer },
        contentType: { type: String },
      },
      statusHistory: [
        {
          status: { type: String, required: true },
          changedBy: { type: String, required: true },
          timestamp: { type: Date, default: Date.now },
        },
      ],
    },
  ],
  currentVersion: { type: Number, required: true },
  status: { type: String, required: true },
  roomSlug: { type: String, required: true },
  basePrice: { type: Number, required: true },
  daytimeHours: Number,
  eveningHours: Number,
  daytimePrice: Number,
  eveningPrice: Number,
  fullDayPrice: Number,
  daytimeRate: Number,
  daytimeRateType: String,
  eveningRate: Number,
  eveningRateType: String,
  daytimeMinHours: Number,
  eveningMinHours: Number,
  daytimeMinimumHours: Number,
  eveningMinimumHours: Number,
  additionalCosts: Array,
  totalCost: { type: Number, required: true },
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
      new mongoose.Schema(CostEstimateSchemaDefinition, { timestamps: true }) // Add timestamps option
    )
  );
};
