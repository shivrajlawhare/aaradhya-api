import { describe, expect, it } from 'vitest';
import {
  computeRoomLineTotalInclGst,
  computeTotalCharges,
  computeTotalDays,
  computeTotalOccupancy,
  type RoomLineInput,
} from '../../src/services/accommodation.js';

describe('computeTotalDays', () => {
  it('counts a same-day stay as 1 night, not 0', () => {
    const day = new Date('2026-06-15T00:00:00.000Z');

    expect(computeTotalDays(day, day)).toBe(1);
  });

  it('counts one calendar day apart as 1 night', () => {
    const checkIn = new Date('2026-06-15T00:00:00.000Z');
    const checkOut = new Date('2026-06-16T00:00:00.000Z');

    expect(computeTotalDays(checkIn, checkOut)).toBe(1);
  });

  it('counts a multi-day span against exact expected values', () => {
    const checkIn = new Date('2026-06-15T00:00:00.000Z');
    const checkOut = new Date('2026-06-20T00:00:00.000Z');

    expect(computeTotalDays(checkIn, checkOut)).toBe(5);
  });

  it('ignores the time-of-day component, using whole calendar days', () => {
    const checkIn = new Date('2026-06-15T22:00:00.000Z');
    const checkOut = new Date('2026-06-16T02:00:00.000Z');

    // 4 hours apart in wall-clock time, but crosses one calendar-day
    // boundary at UTC — total_days counts elapsed 24h periods, not
    // calendar-date labels, so this is still 1 night (< 24h elapsed,
    // clamped to the minimum).
    expect(computeTotalDays(checkIn, checkOut)).toBe(1);
  });

  // STORY-070 — this exact pair is what exposed the previous formula's bug:
  // computeInclusiveDayCount's "+1" returned 3 here, but both reference
  // quotations print "Total Days: 2" for a 2-calendar-day check-in/check-out
  // gap (docs/example_quatations, aaradhya-api repo).
  it('reproduces both reference quotations’ exact printed Total Days for their own check-in/check-out pairs', () => {
    expect(computeTotalDays(new Date('2026-12-10T00:00:00.000Z'), new Date('2026-12-12T00:00:00.000Z'))).toBe(2);
    expect(computeTotalDays(new Date('2027-02-25T00:00:00.000Z'), new Date('2027-02-27T00:00:00.000Z'))).toBe(2);
  });
});

describe('computeRoomLineTotalInclGst', () => {
  it('applies a known GST rate against tariff × no_of_rooms × total_days', () => {
    // 5000 × 2 rooms × 1 day = 10000, +18% GST = 11800.
    const total = computeRoomLineTotalInclGst({ tariff: 5000, noOfRooms: 2 }, 1, 18);

    expect(total).toBe(11800);
  });

  // Verified against docs/example_quatations/example_quatation_1.pdf's own
  // printed Deluxe line (STORY-068): 2500 tariff × 14 rooms × 2 nights ×
  // 1.05 = 73,500, reproduced identically in both reference quotations for
  // every room type.
  it('multiplies by total_days — reproduces the reference quotations’ exact printed numbers', () => {
    expect(computeRoomLineTotalInclGst({ tariff: 2500, noOfRooms: 14 }, 2)).toBe(73500);
    expect(computeRoomLineTotalInclGst({ tariff: 3500, noOfRooms: 2 }, 2)).toBe(14700);
    expect(computeRoomLineTotalInclGst({ tariff: 5000, noOfRooms: 2 }, 2)).toBe(21000);
  });

  it('computes 0 for a placeholder row with no_of_rooms = 0, not an error', () => {
    const total = computeRoomLineTotalInclGst({ tariff: 5000, noOfRooms: 0 }, 1, 18);

    expect(total).toBe(0);
  });

  it('rounds to the nearest currency unit', () => {
    const total = computeRoomLineTotalInclGst({ tariff: 999.99, noOfRooms: 3 }, 1, 18);

    // 999.99 × 3 = 2999.97, × 1.18 = 3539.9646 → rounds to 3539.96.
    expect(total).toBe(3539.96);
  });

  it('defaults to the Accommodation GST rate (5%) when none is passed', () => {
    const total = computeRoomLineTotalInclGst({ tariff: 1000, noOfRooms: 1 }, 1);

    expect(total).toBe(1050);
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

  it('is not affected by total_days — headcount, unlike cost, does not scale with nights stayed', () => {
    expect(computeTotalOccupancy([line({ occupancy: 2, noOfRooms: 3 })])).toBe(6);
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
    expect(computeTotalCharges([], 1, 18)).toBe(0);
  });

  it("sums each line's GST-inclusive total for a single line", () => {
    expect(computeTotalCharges([line({ tariff: 5000, noOfRooms: 2 })], 1, 18)).toBe(11800);
  });

  it('sums GST-inclusive totals across multiple lines', () => {
    const roomLines = [
      line({ tariff: 5000, noOfRooms: 2 }), // 11800
      line({ tariff: 3000, noOfRooms: 1 }), // 3540
      line({ tariff: 2000, noOfRooms: 0 }), // 0 — placeholder row
    ];

    expect(computeTotalCharges(roomLines, 1, 18)).toBe(15340);
  });

  // Verified against example_quatation_1.pdf's own printed "Total Charges"
  // footer cell (Rs. 1,09,200 /-): Deluxe (2500×14×2×1.05=73500) +
  // Executive (3500×2×2×1.05=14700) + Dormatory (5000×2×2×1.05=21000) +
  // Extra Beds (700×0×2×1.05=0) = 109200.
  it('reproduces the reference quotation’s exact printed Total Charges', () => {
    const roomLines = [
      line({ tariff: 2500, noOfRooms: 14 }),
      line({ tariff: 3500, noOfRooms: 2 }),
      line({ tariff: 5000, noOfRooms: 2 }),
      line({ tariff: 700, noOfRooms: 0 }),
    ];

    expect(computeTotalCharges(roomLines, 2)).toBe(109200);
  });

  it('defaults to the Accommodation GST rate (5%) when none is passed', () => {
    expect(computeTotalCharges([line({ tariff: 1000, noOfRooms: 1 })], 1)).toBe(1050);
  });
});
