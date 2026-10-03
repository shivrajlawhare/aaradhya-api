import { Event } from '../models/event.js';

// v2.2.0 (UI Redesign V1): the fixed Decoration / Photographer / Bhatji
// extras are retired — each non-zero amount becomes a manual line item of
// that name, so the quotation prints it and every total counts it once.
interface LegacyExtra {
  field: 'decoration' | 'photographer' | 'bhatji';
  lineItemName: string;
}

export const LEGACY_EXTRAS: LegacyExtra[] = [
  { field: 'decoration', lineItemName: 'Decoration' },
  { field: 'photographer', lineItemName: 'Photographer' },
  { field: 'bhatji', lineItemName: 'Bhatji' },
];

export interface ConvertLegacyExtrasResult {
  eventsUpdated: number;
  lineItemsAdded: number;
}

const ZEROED_EXTRAS = { 'extras.decoration': 0, 'extras.photographer': 0, 'extras.bhatji': 0 };

const toAmount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * One-off data migration (run by scripts/migrate-v220-extras.ts). For every
 * Event with a non-zero legacy extra, appends one line item per non-zero
 * amount (in Decoration, Photographer, Bhatji order, no note) to
 * `extraLineItems`, then resets all three to 0. Idempotent: once zeroed, an
 * Event no longer matches, so a re-run adds nothing.
 *
 * Reads the raw collection (like rename-dormitory-room-type.ts) and writes
 * with a model-level updateOne (no validators run), so an old document is
 * never rejected by validation unrelated to this change.
 */
export const convertLegacyExtrasToLineItems = async (): Promise<ConvertLegacyExtrasResult> => {
  const events = await Event.collection
    .find({ $or: LEGACY_EXTRAS.map(({ field }) => ({ [`extras.${field}`]: { $gt: 0 } })) })
    .toArray();

  let lineItemsAdded = 0;
  for (const event of events) {
    const legacyExtras: Record<string, unknown> = event.extras ?? {};
    const lineItems = LEGACY_EXTRAS.filter(({ field }) => toAmount(legacyExtras[field]) > 0).map(
      ({ field, lineItemName }) => ({ name: lineItemName, amount: toAmount(legacyExtras[field]) })
    );
    await Event.updateOne({ _id: event._id }, { $push: { extraLineItems: { $each: lineItems } }, $set: ZEROED_EXTRAS });
    lineItemsAdded += lineItems.length;
  }

  return { eventsUpdated: events.length, lineItemsAdded };
};
