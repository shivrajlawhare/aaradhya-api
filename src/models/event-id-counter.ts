import { Schema, model } from 'mongoose';

interface EventIdCounterAttributes {
  _id: string;
  seq: number;
}

// One document per calendar year (`_id` is the year as a string, e.g.
// "2026") — the Event id format embeds the year (STORY-011:
// `ARD-EVT-2026-001`), so the sequence resets each year rather than
// running as one all-time counter. `_id` is declared `String`, overriding
// Mongoose's default ObjectId `_id`, since the year is the natural key.
// Not used directly outside src/services/event-id.ts.
const eventIdCounterSchema = new Schema<EventIdCounterAttributes>({
  _id: { type: String },
  seq: { type: Number, required: true, default: 0 },
});

export const EventIdCounter = model<EventIdCounterAttributes>(
  'EventIdCounter',
  eventIdCounterSchema,
);
