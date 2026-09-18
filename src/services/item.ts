import { roundToCurrency } from '../utils/currency.js';

export interface MealItemCostInput {
  pax: number;
  costPerPlate: number;
  // Glossary's "Limited Seating (L.S.)" — when set, this Item is priced as
  // a single flat amount for the whole gathering, so pax is fixed at 1 for
  // this computation regardless of the literal headcount (FR-QUO-8).
  limitedSeating?: boolean;
}

/**
 * Pure computation for a Meal Item's total_cost (SRS §4.5) — DB-free,
 * unit-testable with no HTTP layer (this story's own requirement). Never
 * wired into src/models/event.ts: total_cost is never stored, only
 * computed on demand, same "derived, never trusted from the client"
 * convention totalDays/totalInclGst/balance/durationDays already
 * established.
 */

// pax × cost_per_plate (pax forced to 1 when limited_seating is set),
// rounded to the nearest currency unit — this story's own edge case: a
// decimal cost_per_plate (e.g. 33.33 × 3) must not accumulate a
// floating-point error in the result, the same "round after multiplying"
// fix computeRoomLineTotalInclGst already applies for its own GST
// multiplication. A pax of 0 is a valid placeholder row (this story's own
// edge case, decided as "allowed") and simply computes to 0, not an error
// (limited_seating overrides this the same way it overrides any other pax).
export const computeTotalCost = ({ pax, costPerPlate, limitedSeating }: MealItemCostInput): number =>
  roundToCurrency((limitedSeating ? 1 : pax) * costPerPlate);
