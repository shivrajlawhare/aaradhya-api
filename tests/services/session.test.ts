import { describe, expect, it } from 'vitest';
import { computeDurationDays, computeIsMultiDay } from '../../src/services/session.js';

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
