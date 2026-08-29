import { describe, expect, it } from 'vitest';
import { computeBalance } from '../../src/services/payment.js';

describe('computeBalance', () => {
  it('subtracts advance_paid from total_estimated_amount against exact expected values', () => {
    expect(computeBalance(50000, 20000)).toBe(30000);
  });

  it('returns the full total_estimated_amount when advance_paid is 0', () => {
    expect(computeBalance(50000, 0)).toBe(50000);
  });

  it('returns a negative balance, not a clamped or errored one, when advance_paid exceeds the estimate', () => {
    expect(computeBalance(50000, 60000)).toBe(-10000);
  });

  it('returns 0 when advance_paid exactly equals total_estimated_amount', () => {
    expect(computeBalance(50000, 50000)).toBe(0);
  });

  it('rounds to the nearest currency unit', () => {
    expect(computeBalance(100.1, 0.2)).toBe(99.9);
  });
});
