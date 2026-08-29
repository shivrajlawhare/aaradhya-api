import { computeInclusiveDayCount } from '../utils/date.js';

export interface SessionDateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Pure computation for the finalized multi-day Session model (SRS §4.2,
 * Spec_Amendment_MultiDate_Sessions.md) — DB-free, unit-testable with no HTTP
 * layer (this story's own requirement). Neither value is stored: whatever
 * reads/returns a Session computes these on demand from start_date/end_date,
 * so they can never drift out of sync with the stored dates.
 */

// end_date − start_date + 1, inclusive of both ends: a single-day session
// (start_date === end_date) is 1 day, not 0 (this story's own AC) — the same
// "inclusive of both ends" convention computeTotalDays (STORY-018) already
// established for Accommodation, now shared via computeInclusiveDayCount.
// end_date < start_date (an invalid range) is not guarded here — rejecting
// that is the schema's job (see sessionSchema in src/models/event.ts), not
// this pure-math function's.
export const computeDurationDays = ({ startDate, endDate }: SessionDateRange): number =>
  computeInclusiveDayCount(startDate, endDate);

// duration_days > 1 — a same-day session is never multi-day.
export const computeIsMultiDay = (range: SessionDateRange): boolean => computeDurationDays(range) > 1;
