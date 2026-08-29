const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Inclusive day count between two dates — a same-day span is 1 day, not 0,
// and one calendar day apart is 2 days. Shared by
// src/services/accommodation.ts (check_in/check_out, SRS §4.3) and
// src/services/session.ts (start_date/end_date, SRS §4.2) — both use this
// exact "end − start + 1" formula; extracted here once a second real caller
// needed it (directory-structure.md: "only extract to utils/ once a pattern
// genuinely repeats"), same reasoning already applied to roundToCurrency.
export const computeInclusiveDayCount = (start: Date, end: Date): number =>
  Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
