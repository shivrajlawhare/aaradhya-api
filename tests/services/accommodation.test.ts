import { describe, expect, it } from 'vitest';
import {
  computeRoomLineTotalInclGst,
  computeTotalCharges,
  computeTotalDays,
  computeTotalOccupancy,
  type RoomLineInput,
} from '../../src/services/accommodation.js';

describe('computeTotalDays', () => {
  it('counts a same-day stay as 1 day, not 0', () => {
    const day = new Date('2026-06-15T00:00:00.000Z');

    expect(computeTotalDays(day, day)).toBe(1);
  });

  it('counts one calendar day apart as 2 days', () => {
    const checkIn = new Date('2026-06-15T00:00:00.000Z');
    const checkOut = new Date('2026-06-16T00:00:00.000Z');

    expect(computeTotalDays(checkIn, checkOut)).toBe(2);
  });

  it('counts a multi-day span against exact expected values', () => {
    const checkIn = new Date('2026-06-15T00:00:00.000Z');
    const checkOut = new Date('2026-06-20T00:00:00.000Z');

    expect(computeTotalDays(checkIn, checkOut)).toBe(6);
  });

  it('ignores the time-of-day component, using whole calendar days', () => {
    const checkIn = new Date('2026-06-15T22:00:00.000Z');
    const checkOut = new Date('2026-06-16T02:00:00.000Z');

    // 4 hours apart in wall-clock time, but crosses one calendar-day
    // boundary at UTC — total_days counts elapsed 24h periods, not
    // calendar-date labels, so this is still 1 day (< 24h elapsed).
    expect(computeTotalDays(checkIn, checkOut)).toBe(1);
  });
});

describe('computeRoomLineTotalInclGst', () => {
  it('applies a known GST rate against tariff × no_of_rooms', () => {
    // 5000 × 2 rooms = 10000, +18% GST = 11800.
    const total = computeRoomLineTotalInclGst({ tariff: 5000, noOfRooms: 2 }, 18);

    expect(total).toBe(11800);
  });

  it('computes 0 for a placeholder row with no_of_rooms = 0, not an error', () => {
    const total = computeRoomLineTotalInclGst({ tariff: 5000, noOfRooms: 0 }, 18);

    expect(total).toBe(0);
  });

  it('rounds to the nearest currency unit', () => {
    const total = computeRoomLineTotalInclGst({ tariff: 999.99, noOfRooms: 3 }, 18);

    // 999.99 × 3 = 2999.97, × 1.18 = 3539.9646 → rounds to 3539.96.
    expect(total).toBe(3539.96);
  });

  it('defaults to the configured org GST rate when none is passed', () => {
    // config.gstRatePercent defaults to 18 (no GST_RATE_PERCENT env var set
    // in the test environment).
    const total = computeRoomLineTotalInclGst({ tariff: 1000, noOfRooms: 1 });

    expect(total).toBe(1180);
  });
});

describe('computeTotalOccupancy', () => {
  const line = (overrides: Partial<RoomLineInput> = {}): RoomLineInput => ({
    occupancy: 2,
    tariff: 5000,
    noOfRooms: 1,
    ...overrides,
  });

  it('is 0 for zero room lines', () => {
    expect(computeTotalOccupancy([])).toBe(0);
  });

  it('multiplies occupancy by no_of_rooms for a single line', () => {
    expect(computeTotalOccupancy([line({ occupancy: 2, noOfRooms: 3 })])).toBe(6);
  });

  it('sums occupancy × no_of_rooms across multiple lines', () => {
    const roomLines = [
      line({ occupancy: 2, noOfRooms: 3 }), // 6
      line({ occupancy: 4, noOfRooms: 1 }), // 4
      line({ occupancy: 1, noOfRooms: 0 }), // 0 — placeholder row
    ];

    expect(computeTotalOccupancy(roomLines)).toBe(10);
  });
});

describe('computeTotalCharges', () => {
  const line = (overrides: Partial<RoomLineInput> = {}): RoomLineInput => ({
    occupancy: 2,
    tariff: 5000,
    noOfRooms: 1,
    ...overrides,
  });

  it('is 0 for zero room lines', () => {
    expect(computeTotalCharges([], 18)).toBe(0);
  });

  it("sums each line's GST-inclusive total for a single line", () => {
    expect(computeTotalCharges([line({ tariff: 5000, noOfRooms: 2 })], 18)).toBe(11800);
  });

  it('sums GST-inclusive totals across multiple lines', () => {
    const roomLines = [
      line({ tariff: 5000, noOfRooms: 2 }), // 11800
      line({ tariff: 3000, noOfRooms: 1 }), // 3540
      line({ tariff: 2000, noOfRooms: 0 }), // 0 — placeholder row
    ];

    expect(computeTotalCharges(roomLines, 18)).toBe(15340);
  });
});
