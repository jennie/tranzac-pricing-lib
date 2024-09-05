// src/index.ts
export { useRoomMapping } from "./composables/useRoomMapping";

import * as costEstimateSchema from "./models/costEstimate.schema";
import {
  getTimePeriodModel,
  getPricingRuleModel,
  getAdditionalCostModel,
  getResourceModel,
} from "./models/pricing.schema"; // Import the individual model functions
import PricingRules from "./pricingRules";

export {
  costEstimateSchema,
  getTimePeriodModel, // Explicitly export individual model functions
  getPricingRuleModel,
  getAdditionalCostModel,
  getResourceModel,
  PricingRules,
};
export default PricingRules;
