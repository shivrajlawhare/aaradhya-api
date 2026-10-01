import { describe, expect, it } from 'vitest';
import {
  computeAccommodationGst,
  computeAccommodationTotals,
  computeDiscountAmount,
  computeFinalAmount,
  computeRoomLineTaxable,
  computeTotalCharges,
  computeTotalNights,
  computeTotalOccupancy,
  type RoomLineInput,
} from '../../src/services/accommodation.js';

const line = (overrides: Partial<RoomLineInput> = {}): RoomLineInput => ({
  occupancy: 2,
  tariff: 5000,
  noOfRooms: 1,
  ...overrides,
});

// example_quatation_3.pdf (DEV-07): 13/05/2027 → 15/05/2027 = 2 nights.
const EXAMPLE_3_LINES: RoomLineInput[] = [
  { occupancy: 2, tariff: 2800, noOfRooms: 14 }, // Delux 78400
  { occupancy: 3, tariff: 3800, noOfRooms: 2 }, // Executive 15200
  { occupancy: 6, tariff: 6000, noOfRooms: 2 }, // Family Room 24000
  { occupancy: 0, tariff: 700, noOfRooms: 0 }, // Extra Beds 0
];

describe('computeTotalNights', () => {
  it('counts a same-day stay as 1 night, not 0', () => {
    const day = new Date('2026-06-15T00:00:00.000Z');

    expect(computeTotalNights(day, day)).toBe(1);
  });

  it('counts a multi-day span against exact expected values', () => {
    expect(computeTotalNights(new Date('2026-06-15T00:00:00.000Z'), new Date('2026-06-20T00:00:00.000Z'))).toBe(5);
  });

  it('counts elapsed whole days — under 24 h is still the 1-night minimum', () => {
    expect(computeTotalNights(new Date('2026-06-15T22:00:00.000Z'), new Date('2026-06-16T02:00:00.000Z'))).toBe(1);
  });

  // STORY-070: a hotel stay is billed by nights, not inclusive calendar days.
  it('reproduces the reference quotations’ printed nights', () => {
    expect(computeTotalNights(new Date('2026-12-10T00:00:00.000Z'), new Date('2026-12-12T00:00:00.000Z'))).toBe(2);
    expect(computeTotalNights(new Date('2027-05-13T00:00:00.000Z'), new Date('2027-05-15T00:00:00.000Z'))).toBe(2);
  });
});

describe('computeRoomLineTaxable', () => {
  it('is tariff × no_of_rooms × nights with no GST (example 3’s printed Total Taxable Amounts)', () => {
    expect(computeRoomLineTaxable({ tariff: 2800, noOfRooms: 14 }, 2)).toBe(78400);
    expect(computeRoomLineTaxable({ tariff: 3800, noOfRooms: 2 }, 2)).toBe(15200);
    expect(computeRoomLineTaxable({ tariff: 6000, noOfRooms: 2 }, 2)).toBe(24000);
    expect(computeRoomLineTaxable({ tariff: 700, noOfRooms: 0 }, 2)).toBe(0);
  });

  it('rounds to the nearest currency unit', () => {
    // 999.995 × 1 × 1 = 999.995 → 1000.00 (paise rounding).
    expect(computeRoomLineTaxable({ tariff: 999.995, noOfRooms: 1 }, 1)).toBe(1000);
  });
});

describe('computeTotalOccupancy', () => {
  it('is 0 for zero room lines', () => {
    expect(computeTotalOccupancy([])).toBe(0);
  });

  it('sums occupancy × no_of_rooms across lines — example 3 prints Total Occ. 46', () => {
    expect(computeTotalOccupancy(EXAMPLE_3_LINES)).toBe(46);
  });

  it('counts a placeholder line (no_of_rooms 0) as 0', () => {
    expect(computeTotalOccupancy([line({ occupancy: 2, noOfRooms: 3 }), line({ occupancy: 1, noOfRooms: 0 })])).toBe(6);
  });
});

describe('computeTotalCharges', () => {
  it('is 0 for zero room lines', () => {
    expect(computeTotalCharges([], 1)).toBe(0);
  });

  it('sums each line’s taxable amount — example 3 prints ₹ 1,17,600', () => {
    expect(computeTotalCharges(EXAMPLE_3_LINES, 2)).toBe(117600);
  });
});

describe('discount and Final Amount (D3)', () => {
  it('reproduces example 3: 10% of 1,17,600 = 11,760 → Final Amount 1,05,840', () => {
    const discountAmount = computeDiscountAmount(117600, 10);

    expect(discountAmount).toBe(11760);
    expect(computeFinalAmount(117600, discountAmount)).toBe(105840);
  });

  it('is no discount at 0%, and the whole amount at 100%', () => {
    expect(computeDiscountAmount(117600, 0)).toBe(0);
    expect(computeDiscountAmount(117600, 100)).toBe(117600);
  });

  it('rounds the discount to the rupee', () => {
    // 7% of 1001 = 70.07 → 70.
    expect(computeDiscountAmount(1001, 7)).toBe(70);
  });

  it('adds 5% GST on the Final Amount in the summary: 1,05,840 → 5,292', () => {
    expect(computeAccommodationGst(105840)).toBe(5292);
  });
});

describe('computeAccommodationTotals', () => {
  it('rolls example 3 up in one call', () => {
    expect(computeAccommodationTotals(EXAMPLE_3_LINES, 2, 10)).toEqual({
      totalOccupancy: 46,
      totalCharges: 117600,
      discountAmount: 11760,
      finalAmount: 105840,
    });
  });
});
