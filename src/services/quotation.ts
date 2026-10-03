import { ItemType } from '../models/event.js';
import { roundToCurrency } from '../utils/currency.js';
import { computeAccommodationGst } from './accommodation.js';
import { computeTotalCost } from './item.js';

// STORY-068 — verified against both reference quotations (docs/
// example_quatations/): Food Cost's own "Total Cost with GST" is exactly
// foodSubtotal × 1.05 in both (597150 × 1.05 = 627007.5; 391500 × 1.05 =
// 411075). Supersedes this function's own previous default of
// config.gstRatePercent (18%, the org-wide rate) — that default predates
// having the reference quotations to verify against. Still overridable
// (SRS Assumption A9: "editable per-quotation if it varies") — this is
// only the default when a caller doesn't supply its own.
export const FOOD_GST_RATE_PERCENT = 5;

export interface QuotationItemInput {
  type: ItemType;
  pax?: number;
  costPerPlate?: number;
  limitedSeating?: boolean;
}

export interface QuotationSessionInput {
  venueCost: number;
  items: QuotationItemInput[];
}

export interface TotalCostSummaryInput {
  sessions: QuotationSessionInput[];
  // Accommodation's Final Amount (services/accommodation.ts: Total Charges
  // less the discount) — taxable, pre-GST. DEV-07 (D2): 5% GST is added here,
  // once, on the whole amount.
  accommodationFinalAmount?: number;
  // SRS FR-QUO-9a / A13 — the manual line items. Since v2.2.0 (V1) these are
  // the only extras: the legacy fixed decoration/photographer/bhatji were
  // migrated into line items and are no longer counted.
  extraLineItems?: { amount: number }[];
  gstRatePercent?: number;
}

export interface TotalCostSummary {
  venueTotal: number;
  foodSubtotal: number;
  foodTotalInclGst: number;
  accommodationTaxable: number;
  accommodationGst: number;
  accommodationTotal: number;
  extrasTotal: number;
  grandTotal: number;
}

/**
 * Pure computation for the Quotation's Total Cost Summary (SRS §5.4,
 * FR-QUO-2) — DB-free, unit-testable with no HTTP layer (this story's own
 * requirement). STORY-041's endpoint is the one that will assemble this
 * function's input from an Event's live sessions/accommodation/extras;
 * this function itself never queries anything.
 */

// Sum of every Session's venue_cost — a separate rollup line from food,
// never folded into it (STORY-039's own Flow lists them as distinct
// fields).
const sumVenueCosts = (sessions: QuotationSessionInput[]): number =>
  roundToCurrency(sessions.reduce((total, session) => total + session.venueCost, 0));

// Only Meal Items carry a total_cost (SRS §4.5 — an Event Item has no cost
// fields at all: no pax, no cost_per_plate). Event Items are filtered out
// rather than passed to computeTotalCost, which is documented as Meal-only.
const sumFoodSubtotal = (sessions: QuotationSessionInput[]): number =>
  roundToCurrency(
    sessions.reduce(
      (total, session) =>
        total +
        session.items
          .filter((item) => item.type === ItemType.Meal)
          .reduce(
            (itemTotal, item) =>
              itemTotal +
              computeTotalCost({
                pax: item.pax ?? 0,
                costPerPlate: item.costPerPlate ?? 0,
                limitedSeating: item.limitedSeating,
              }),
            0
          ),
      0
    )
  );

export const computeTotalCostSummary = ({
  sessions,
  accommodationFinalAmount = 0,
  extraLineItems = [],
  gstRatePercent = FOOD_GST_RATE_PERCENT,
}: TotalCostSummaryInput): TotalCostSummary => {
  const venueTotal = sumVenueCosts(sessions);
  const foodSubtotal = sumFoodSubtotal(sessions);
  // This rate applies only to the food subtotal (SRS Assumption A9) — venue
  // costs and extras are untaxed; Accommodation has its own 5% below.
  const foodTotalInclGst = roundToCurrency(foodSubtotal * (1 + gstRatePercent / 100));
  // example_quatation_3.pdf: 105840 + 5292 = 111132.
  const accommodationTaxable = roundToCurrency(accommodationFinalAmount);
  const accommodationGst = computeAccommodationGst(accommodationTaxable);
  const accommodationTotal = roundToCurrency(accommodationTaxable + accommodationGst);
  const extrasTotal = roundToCurrency(extraLineItems.reduce((total, item) => total + item.amount, 0));
  const grandTotal = roundToCurrency(venueTotal + foodTotalInclGst + accommodationTotal + extrasTotal);

  return {
    venueTotal,
    foodSubtotal,
    foodTotalInclGst,
    accommodationTaxable,
    accommodationGst,
    accommodationTotal,
    extrasTotal,
    grandTotal,
  };
};
