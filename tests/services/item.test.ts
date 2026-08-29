import { describe, expect, it } from 'vitest';
import { computeTotalCost } from '../../src/services/item.js';

describe('computeTotalCost', () => {
  it('multiplies pax by cost_per_plate', () => {
    expect(computeTotalCost({ pax: 100, costPerPlate: 500 })).toBe(50000);
  });

  it('computes 0 for a placeholder row with pax = 0, not an error', () => {
    expect(computeTotalCost({ pax: 0, costPerPlate: 500 })).toBe(0);
  });

  it('rounds a decimal cost_per_plate to the nearest currency unit, without a floating-point error', () => {
    // 33.33 × 3 = 99.99 exactly — a naive floating-point multiplication
    // (33.33 * 3) actually yields 99.98999999999999 in JS, so this asserts
    // the rounding step actually fixes that, not just that the math is
    // "close enough".
    expect(computeTotalCost({ pax: 3, costPerPlate: 33.33 })).toBe(99.99);
  });

  it('rounds to the nearest currency unit for a larger decimal multiplication', () => {
    expect(computeTotalCost({ pax: 7, costPerPlate: 142.857 })).toBe(1000);
  });
});
