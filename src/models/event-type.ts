import { type HydratedDocument, model, Schema } from 'mongoose';

// SRS §5.8/§4.6 — organization-wide master list backing the Event Type
// dropdown (Event creation's event_family_type). No default-cost field —
// unlike Venue/RoomType, an Event Type carries no monetary default.
export interface EventTypeAttributes {
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const eventTypeSchema = new Schema<EventTypeAttributes>(
  {
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// See venue.ts for why this is a partial (active-only) unique index rather
// than a plain one — same recommended edge-case resolution, reused here.
eventTypeSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { active: true } }
);

export type EventTypeDocument = HydratedDocument<EventTypeAttributes>;

export const EventType = model<EventTypeAttributes>('EventType', eventTypeSchema);
