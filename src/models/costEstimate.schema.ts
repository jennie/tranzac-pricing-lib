import { Document, Model, Mongoose } from "mongoose";

export let mongoosePromise: Promise<typeof import("mongoose")> | null = import(
  "mongoose"
);

export interface IStatusHistory {
  status: string;
  timestamp: Date;
  changedBy: string;
}

// Removing ICostEstimateVersion and directly using its fields in ICostEstimate
export interface ICostEstimate extends Document {
  rentalRequestId: string;
  createdAt: Date;
  updatedAt: Date;
  memberId?: string;
  userId?: string;

  // Core cost estimates data (moved from versions)
  costEstimates: Array<{
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

  // Financial info (moved from versions)
  totalCost: number;
  tax: number;
  totalWithTax: number;
  discountValue?: number;
  discountType?: 'flat' | 'percentage';
  discountDescription?: string;
  depositInvoiceUrl?: string;
  balanceInvoiceUrl?: string;
  depositInvoicePdfUrl?: string;
  balanceInvoicePdfUrl?: string;
  stripeCustomerId?: string;
  depositPaid?: boolean;
  depositPaidAt?: Date;
  depositPaidAmount?: number;
  balancePaid?: boolean;
  balancePaidAt?: Date;
  balancePaidAmount?: number;

  // Contract data (moved from versions)
  contractPdf?: {
    data: Buffer;
    contentType: string;
  };

  // Status tracking
  status: string;
  statusHistory: IStatusHistory[];

  // Room info (preserved from original)
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
  acceptanceToken?: string;
}

export const CostEstimateSchemaDefinition = {
  rentalRequestId: { type: String, required: true },
  memberId: { type: String },
  userId: { type: String },

  // Cost estimates (moved from versions)
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

  // Financial info (moved from versions)
  totalCost: { type: Number, required: true },
  tax: { type: Number, default: 0 },
  totalWithTax: { type: Number, default: 0 },
  discountValue: { type: Number },
  discountType: { type: String, enum: ['flat', 'percentage'] },
  discountDescription: { type: String },
  depositInvoiceUrl: { type: String, default: null },
  balanceInvoiceUrl: { type: String, default: null },
  depositInvoicePdfUrl: { type: String, default: null },
  balanceInvoicePdfUrl: { type: String, default: null },
  stripeCustomerId: { type: String, default: null },
  depositPaid: { type: Boolean, default: false },
  depositPaidAt: { type: Date, default: null },
  depositPaidAmount: { type: Number, default: 0 },
  balancePaid: { type: Boolean, default: false },
  balancePaidAt: { type: Date, default: null },
  balancePaidAmount: { type: Number, default: 0 },

  // Contract data (moved from versions)
  contractPdf: {
    data: Buffer,
    contentType: String,
  },

  // Status tracking
  status: { type: String, required: true },
  statusHistory: [
    {
      status: { type: String, required: true },
      changedBy: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
    },
  ],

  // Room info (preserved from original)
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
  acceptanceToken: { type: String }
};

// Factory functions to create models
async function getMongoose(): Promise<Mongoose> {
  console.log('[DEBUG] Initializing Mongoose connection')
  if (!mongoosePromise) {
    console.error('[DEBUG] Mongoose is not initialized - mongoosePromise is null')
    throw new Error("Mongoose is not initialized")
  }
  try {
    const { default: mongoose } = await mongoosePromise
    console.log('[DEBUG] Mongoose connection status:', {
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name
    })
    return mongoose
  } catch (error) {
    console.error('[DEBUG] Error initializing Mongoose:', error)
    throw error
  }
}

export const getCostEstimateModel = async (): Promise<Model<ICostEstimate>> => {
  console.log('[DEBUG] Getting CostEstimate model')
  try {
    const mongoose = await getMongoose()
    console.log('[DEBUG] Checking for existing CostEstimate model')

    if (mongoose.models.CostEstimate) {
      console.log('[DEBUG] Using existing CostEstimate model')
      return mongoose.models.CostEstimate
    }

    console.log('[DEBUG] Creating new CostEstimate model with timestamps')
    return mongoose.model<ICostEstimate>(
      "CostEstimate",
      new mongoose.Schema(CostEstimateSchemaDefinition, { timestamps: true })
    )
  } catch (error) {
    console.error('[DEBUG] Error getting CostEstimate model:', error)
    throw error
  }
}
