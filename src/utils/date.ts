export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Inclusive day count between two dates — a same-day span is 1 day, not 0,
// and one calendar day apart is 2 days. Used by src/services/session.ts's
// own computeDurationDays (start_date/end_date, SRS §4.2) — a Session's
// duration genuinely is inclusive of both end dates (a 2-day wedding spans
// two full calendar days of programming). No longer used by Accommodation's
// own computeTotalDays (STORY-070) — a hotel stay is billed by nights, not
// inclusive calendar days spanned, a different real-world concept that only
// coincidentally shared this exact formula until the reference quotations
// (docs/example_quatations/) proved it wrong for check-in/check-out.
export const computeInclusiveDayCount = (start: Date, end: Date): number =>
  Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
