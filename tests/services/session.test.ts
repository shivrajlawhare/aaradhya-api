import { describe, expect, it } from 'vitest';
import { SessionStatus } from '../../src/models/event.js';
import { computeDurationDays, computeIsMultiDay, computeMonthRange, sessionOverlapsMonth } from '../../src/services/session.js';

describe('computeDurationDays', () => {
  it('counts a same-day session as 1 day, not 0', () => {
    const day = new Date('2026-06-15T00:00:00.000Z');

    expect(computeDurationDays({ startDate: day, endDate: day })).toBe(1);
  });

  it('counts a 3-day session against the exact expected value', () => {
    const startDate = new Date('2026-06-15T00:00:00.000Z');
    const endDate = new Date('2026-06-17T00:00:00.000Z');

    expect(computeDurationDays({ startDate, endDate })).toBe(3);
  });

  it('computes correctly across a month boundary using real date arithmetic', () => {
    // This story's own edge case: 2026-09-29 to 2026-10-01 is 3 days, not
    // something a string/month-field comparison would get wrong.
    const startDate = new Date('2026-09-29T00:00:00.000Z');
    const endDate = new Date('2026-10-01T00:00:00.000Z');

    expect(computeDurationDays({ startDate, endDate })).toBe(3);
  });

  it('computes correctly across a year boundary', () => {
    const startDate = new Date('2026-12-30T00:00:00.000Z');
    const endDate = new Date('2027-01-02T00:00:00.000Z');

    expect(computeDurationDays({ startDate, endDate })).toBe(4);
  });
});

describe('computeIsMultiDay', () => {
  it('is false for a 1-day session', () => {
    const day = new Date('2026-06-15T00:00:00.000Z');

    expect(computeIsMultiDay({ startDate: day, endDate: day })).toBe(false);
  });

  it('is true for a 3-day session', () => {
    const startDate = new Date('2026-06-15T00:00:00.000Z');
    const endDate = new Date('2026-06-17T00:00:00.000Z');

    expect(computeIsMultiDay({ startDate, endDate })).toBe(true);
  });

  it('is true for exactly 2 days', () => {
    const startDate = new Date('2026-06-15T00:00:00.000Z');
    const endDate = new Date('2026-06-16T00:00:00.000Z');

    expect(computeIsMultiDay({ startDate, endDate })).toBe(true);
  });
});

describe('computeMonthRange', () => {
  it('spans the full first-to-last day of a 30-day month, UTC-midnight', () => {
    const range = computeMonthRange(9, 2026);

    expect(range.monthStart.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(range.monthEnd.toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });

  it('spans the full first-to-last day of a 31-day month', () => {
    const range = computeMonthRange(10, 2026);

    expect(range.monthStart.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(range.monthEnd.toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });

  it('handles February in a leap year', () => {
    const range = computeMonthRange(2, 2028);

    expect(range.monthEnd.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
});

describe('sessionOverlapsMonth', () => {
  const september2026 = computeMonthRange(9, 2026);

  it('matches an Active session whose range falls entirely inside the month', () => {
    const session = {
      sessionStatus: SessionStatus.Active,
      startDate: new Date('2026-09-12T00:00:00.000Z'),
      endDate: new Date('2026-09-14T00:00:00.000Z'),
    };

    expect(sessionOverlapsMonth(session, september2026)).toBe(true);
  });

  it('matches a session spanning into the month from a prior month (partial overlap, not containment)', () => {
    const session = {
      sessionStatus: SessionStatus.Active,
      startDate: new Date('2026-08-29T00:00:00.000Z'),
      endDate: new Date('2026-09-02T00:00:00.000Z'),
    };

    expect(sessionOverlapsMonth(session, september2026)).toBe(true);
  });

  it('matches a session spanning out of the month into the next one', () => {
    const session = {
      sessionStatus: SessionStatus.Active,
      startDate: new Date('2026-09-29T00:00:00.000Z'),
      endDate: new Date('2026-10-02T00:00:00.000Z'),
    };

    expect(sessionOverlapsMonth(session, september2026)).toBe(true);
  });

  it('excludes a session entirely outside the month', () => {
    const session = {
      sessionStatus: SessionStatus.Active,
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-08-05T00:00:00.000Z'),
    };

    expect(sessionOverlapsMonth(session, september2026)).toBe(false);
  });

  it('excludes a Cancelled session even though its dates fall in range', () => {
    const session = {
      sessionStatus: SessionStatus.Cancelled,
      startDate: new Date('2026-09-12T00:00:00.000Z'),
      endDate: new Date('2026-09-12T00:00:00.000Z'),
    };

    expect(sessionOverlapsMonth(session, september2026)).toBe(false);
  });

  it('excludes a session missing start_date or end_date — an incomplete draft, per this story edge case', () => {
    const missingStart = { sessionStatus: SessionStatus.Active, endDate: new Date('2026-09-12T00:00:00.000Z') };
    const missingEnd = { sessionStatus: SessionStatus.Active, startDate: new Date('2026-09-12T00:00:00.000Z') };

    expect(sessionOverlapsMonth(missingStart, september2026)).toBe(false);
    expect(sessionOverlapsMonth(missingEnd, september2026)).toBe(false);
  });
});
