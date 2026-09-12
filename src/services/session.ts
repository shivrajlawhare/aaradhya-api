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

// Either bound may be absent — an omitted `to` means "no upper bound" (an
// open-ended "everything from `from` onward"), not "matches nothing";
// likewise for an omitted `from`. STORY-034's own month query always
// supplies both (computeMonthRange never returns a partial range), so
// sessionOverlapsMonth below is the special case where neither bound is
// ever omitted.
export interface DateRange {
  from?: Date;
  to?: Date;
}

// The one overlap test both STORY-034 (GET /calendar) and STORY-036
// (GET /events/search) share — "the same interval-overlap logic as
// STORY-034" is this story's own AC, made literal by having both call the
// exact same function rather than two implementations that could drift.
// A Cancelled session, or one missing either date (an incomplete draft —
// schema-required today, but the exclusion is STORY-034's own explicit
// edge case, so it's enforced here defensively rather than assumed away),
// never matches. Shared by each caller's DB query (as the equivalent
// $elemMatch condition) and, where the caller needs to flatten to
// individual sessions (STORY-034), an in-memory re-filter — so the two
// layers can never drift out of sync with each other.
export const sessionOverlapsRange = (session: CalendarSessionFields, range: DateRange): boolean =>
  session.sessionStatus === SessionStatus.Active &&
  session.startDate !== undefined &&
  session.endDate !== undefined &&
  (range.to === undefined || session.startDate.getTime() <= range.to.getTime()) &&
  (range.from === undefined || session.endDate.getTime() >= range.from.getTime());

// STORY-034's own month-bounded case — both sides of the range are always
// present (computeMonthRange never returns a partial range), so this is
// just sessionOverlapsRange with monthStart/monthEnd renamed to from/to.
export const sessionOverlapsMonth = (session: CalendarSessionFields, range: MonthRange): boolean =>
  sessionOverlapsRange(session, { from: range.monthStart, to: range.monthEnd });
