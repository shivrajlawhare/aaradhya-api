import { EventIdCounter } from '../models/event-id-counter.js';

const EVENT_ID_PREFIX = 'ARD-EVT';
const SEQUENCE_PAD_LENGTH = 3;

/**
 * Reserves and formats the next Event id for the given year, e.g.
 * `ARD-EVT-2026-001`. `findOneAndUpdate` with `$inc` is atomic at the
 * MongoDB level, so two Events created in the same millisecond still get
 * distinct sequence numbers — there's no read-then-write gap for a race to
 * land in. The sequence resets each year since the format embeds it.
 */
export const generateEventId = async (now: Date = new Date()): Promise<string> => {
  const year = now.getFullYear();
  const counter = await EventIdCounter.findOneAndUpdate(
    { _id: String(year) },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  // Unreachable in practice (`upsert: true, new: true` always returns the
  // post-update document) — guarded instead of asserted past, per
  // docs/typescript-rules.md rule 1.
  if (!counter) {
    throw new Error('Failed to reserve an Event id sequence number.');
  }
  const sequence = String(counter.seq).padStart(SEQUENCE_PAD_LENGTH, '0');
  return `${EVENT_ID_PREFIX}-${year}-${sequence}`;
};
