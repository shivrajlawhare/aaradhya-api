import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { generateEventId } from '../../src/services/event-id.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';

beforeAll(connectTestDb);
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('generateEventId', () => {
  it('formats the first id of a year as ARD-EVT-<year>-001', async () => {
    const eventId = await generateEventId(new Date('2026-01-01T00:00:00.000Z'));

    expect(eventId).toBe('ARD-EVT-2026-001');
  });

  it('increments sequentially across repeated calls in the same year', async () => {
    const now = new Date('2026-06-15T12:00:00.000Z');

    const first = await generateEventId(now);
    const second = await generateEventId(now);
    const third = await generateEventId(now);

    expect([first, second, third]).toEqual(['ARD-EVT-2026-001', 'ARD-EVT-2026-002', 'ARD-EVT-2026-003']);
  });

  it('resets the sequence for a different year rather than continuing the count', async () => {
    // Deliberately midday, mid-year — a date near a day/year boundary
    // (e.g. Dec 31 23:59 UTC) can land in a different calendar year once
    // `Date#getFullYear()` reads it back in the local timezone, which
    // would make this test flaky rather than testing the actual behavior.
    await generateEventId(new Date('2026-06-15T12:00:00.000Z'));

    const firstOfNextYear = await generateEventId(new Date('2027-06-15T12:00:00.000Z'));

    expect(firstOfNextYear).toBe('ARD-EVT-2027-001');
  });

  it('never issues the same id twice under concurrent creation', async () => {
    const now = new Date('2026-03-01T00:00:00.000Z');

    const ids = await Promise.all(Array.from({ length: 10 }, () => generateEventId(now)));

    expect(new Set(ids).size).toBe(10);
    for (const id of ids) {
      expect(id).toMatch(/^ARD-EVT-2026-\d{3}$/);
    }
  });
});
