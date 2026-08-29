import { roundToCurrency } from '../utils/currency.js';

/**
 * Pure computation for the Payment Record (SRS §4.4) — DB-free, takes/
 * returns plain numbers, unit-testable with no HTTP layer (this story's own
 * requirement). Never wired into src/models/event.ts: balance is never
 * stored, only computed on demand by whatever needs it (a later PATCH
 * endpoint, the Quotation rollup), same reasoning as STORY-018's
 * accommodation totals — nothing derived can drift out of sync with its
 * inputs if it's never persisted.
 */

// total_estimated_amount − advance_paid. Deliberately not clamped at 0 — a
// negative balance (overpayment) must be representable, per this story's
// own AC; the schema instead prevents overpayment's usual root cause
// (advance_paid going negative), not balance going negative.
export const computeBalance = (totalEstimatedAmount: number, advancePaid: number): number =>
  roundToCurrency(totalEstimatedAmount - advancePaid);
