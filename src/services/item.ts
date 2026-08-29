import { roundToCurrency } from '../utils/currency.js';

export interface MealItemCostInput {
  pax: number;
  costPerPlate: number;
}

/**
 * Pure computation for a Meal Item's total_cost (SRS §4.5) — DB-free,
 * unit-testable with no HTTP layer (this story's own requirement). Never
 * wired into src/models/event.ts: total_cost is never stored, only
 * computed on demand, same "derived, never trusted from the client"
 * convention totalDays/totalInclGst/balance/durationDays already
 * established.
 */

// pax × cost_per_plate, rounded to the nearest currency unit — this
// story's own edge case: a decimal cost_per_plate (e.g. 33.33 × 3) must
// not accumulate a floating-point error in the result, the same
// "round after multiplying" fix computeRoomLineTotalInclGst already
// applies for its own GST multiplication. A pax of 0 is a valid
// placeholder row (this story's own edge case, decided as "allowed") and
// simply computes to 0, not an error.
export const computeTotalCost = ({ pax, costPerPlate }: MealItemCostInput): number =>
  roundToCurrency(pax * costPerPlate);
