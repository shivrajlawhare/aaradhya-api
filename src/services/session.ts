import { SessionStatus } from '../models/event.js';
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

export interface MonthRange {
  monthStart: Date;
  monthEnd: Date;
}

// UTC-midnight Date boundaries for a calendar month, per the finalized
// "store timezone-naive, never let the API layer apply a client's local
// timezone" rule (Spec_Amendment_MultiDate_Sessions.md edge cases) — the
// same convention z.coerce.date() already gives every other date field
// parsed from a plain "YYYY-MM-DD" string. `month` is 1-indexed (as the
// story's own query example, `?month=9`, uses); day 0 of the next month is
// the last day of this one, so no separate "days in month" lookup is needed.
export const computeMonthRange = (month: number, year: number): MonthRange => ({
  monthStart: new Date(Date.UTC(year, month - 1, 1)),
  monthEnd: new Date(Date.UTC(year, month, 0)),
});

interface CalendarSessionFields {
  sessionStatus: SessionStatus;
  startDate?: Date;
  endDate?: Date;
}

// The overlap test itself (this story's own AC + Spec_Amendment's finalized
// calendar rendering rule): a Cancelled session, or one missing either date
// (an incomplete draft — schema-required today, but the exclusion is this
// story's own explicit edge case, so it's enforced here defensively rather
// than assumed away), never matches. Shared by the DB query (as the
// equivalent $elemMatch condition) and the controller's own in-memory
// filter of each matched Event's sessions, so the two can never drift out
// of sync with each other.
export const sessionOverlapsMonth = (session: CalendarSessionFields, range: MonthRange): boolean =>
  session.sessionStatus === SessionStatus.Active &&
  session.startDate !== undefined &&
  session.endDate !== undefined &&
  session.startDate.getTime() <= range.monthEnd.getTime() &&
  session.endDate.getTime() >= range.monthStart.getTime();
