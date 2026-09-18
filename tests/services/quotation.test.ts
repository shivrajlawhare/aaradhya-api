import { describe, expect, it } from 'vitest';
import { ItemType } from '../../src/models/event.js';
import { computeTotalCostSummary, type QuotationSessionInput } from '../../src/services/quotation.js';

describe('computeTotalCostSummary', () => {
  // Fixture Event: 2 sessions, known venue costs, known Meal Item costs (one
  // Event Item mixed in to prove it contributes nothing), known GST%, known
  // accommodation total, known extras — this story's own AC-1 fixture shape.
  const fixtureSessions: QuotationSessionInput[] = [
    {
      venueCost: 5000,
      items: [
        { type: ItemType.Meal, pax: 10, costPerPlate: 200 }, // 2000
        { type: ItemType.Event }, // Muhurta — no cost fields, contributes 0
      ],
    },
    {
      venueCost: 3000,
      items: [
        { type: ItemType.Meal, pax: 5, costPerPlate: 300 }, // 1500
        { type: ItemType.Meal, pax: 2, costPerPlate: 100 }, // 200
      ],
    },
  ];

  it('matches exact expected numbers for a known fixture Event (AC-1)', () => {
    // venueTotal = 5000 + 3000 = 8000.
    // foodSubtotal = 2000 + 1500 + 200 = 3700.
    // foodTotalInclGst = 3700 × 1.18 = 4366.
    // accommodationTotal = 11800 (passed through as-is).
    // extrasTotal = 1000 + 1500 + 500 = 3000.
    // grandTotal = 8000 + 4366 + 11800 + 3000 = 27166.
    const summary = computeTotalCostSummary({
      sessions: fixtureSessions,
      accommodationTotalCharges: 11800,
      extras: { decoration: 1000, photographer: 1500, bhatji: 500 },
      gstRatePercent: 18,
    });

    expect(summary).toEqual({
      venueTotal: 8000,
      foodSubtotal: 3700,
      foodTotalInclGst: 4366,
      accommodationTotal: 11800,
      extrasTotal: 3000,
      grandTotal: 27166,
    });
  });

  it('applies GST only to the food subtotal, leaving venue/accommodation/extras untouched (AC-3)', () => {
    const summary = computeTotalCostSummary({
      sessions: fixtureSessions,
      accommodationTotalCharges: 11800,
      extras: { decoration: 1000, photographer: 1500, bhatji: 500 },
      gstRatePercent: 18,
    });

    // venueTotal, accommodationTotal, and extrasTotal each equal their raw,
    // pre-GST inputs exactly — none of them was scaled by the 18% rate that
    // did change foodSubtotal (3700) into foodTotalInclGst (4366).
    expect(summary.venueTotal).toBe(8000);
    expect(summary.accommodationTotal).toBe(11800);
    expect(summary.extrasTotal).toBe(3000);
  });

  it('excludes Event Items from the food subtotal, since they carry no cost fields', () => {
    const summary = computeTotalCostSummary({
      sessions: [{ venueCost: 0, items: [{ type: ItemType.Event }] }],
    });

    expect(summary.foodSubtotal).toBe(0);
  });

  it('computes an all-zero summary for an Event with zero sessions, not NaN or an error', () => {
    const summary = computeTotalCostSummary({ sessions: [] });

    expect(summary).toEqual({
      venueTotal: 0,
      foodSubtotal: 0,
      foodTotalInclGst: 0,
      accommodationTotal: 0,
      extrasTotal: 0,
      grandTotal: 0,
    });
  });

  it('defaults accommodationTotalCharges and extras to 0 when omitted', () => {
    const summary = computeTotalCostSummary({ sessions: [] });

    expect(summary.accommodationTotal).toBe(0);
    expect(summary.extrasTotal).toBe(0);
  });

  it('produces a grand total equal to the pre-GST food subtotal plus everything else at a 0% GST rate', () => {
    const summary = computeTotalCostSummary({
      sessions: fixtureSessions,
      accommodationTotalCharges: 11800,
      extras: { decoration: 1000, photographer: 1500, bhatji: 500 },
      gstRatePercent: 0,
    });

    expect(summary.foodTotalInclGst).toBe(summary.foodSubtotal);
    expect(summary.grandTotal).toBe(8000 + 3700 + 11800 + 3000);
  });

  it('defaults to the configured org GST rate when none is passed', () => {
    // config.gstRatePercent defaults to 18 (no GST_RATE_PERCENT env var set
    // in the test environment).
    const summary = computeTotalCostSummary({
      sessions: [{ venueCost: 0, items: [{ type: ItemType.Meal, pax: 1, costPerPlate: 100 }] }],
    });

    expect(summary.foodTotalInclGst).toBe(118);
  });

  it('fixes pax at 1 for a limited_seating Meal Item, per FR-QUO-8/9', () => {
    const summary = computeTotalCostSummary({
      sessions: [{ venueCost: 0, items: [{ type: ItemType.Meal, pax: 200, costPerPlate: 500, limitedSeating: true }] }],
      gstRatePercent: 0,
    });

    // Not 200 × 500 = 100000 — the literal headcount is ignored.
    expect(summary.foodSubtotal).toBe(500);
  });
});
