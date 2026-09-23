import { type HydratedDocument, model, Schema } from 'mongoose';

// SRS §5.8/§4.6 — organization-wide master list backing the Venue dropdown
// on Session entry (STORY-062's Settings screen manages it; STORY-061 is
// just the schema/endpoints).
export interface VenueAttributes {
  name: string;
  defaultVenueCost: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const venueSchema = new Schema<VenueAttributes>(
  {
    // As-entered casing kept (display text, not a lookup key) — same
    // reasoning as MenuItem.name; case-insensitive uniqueness comes from
    // the collation on the index below, not from mangling the stored value.
    name: { type: String, required: true, trim: true },
    defaultVenueCost: { type: Number, required: true, min: 0 },
    // Deactivating never deletes or cascades (this story's own AC) — a
    // Session that already copied a Venue's name/cost at selection time
    // keeps displaying what it copied, since it never held a live
    // reference to this document in the first place.
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Unique only among currently-active entries (partialFilterExpression) —
// this story's own recommended edge-case resolution: reject a
// case-insensitive duplicate name among active Venues, but allow
// reintroducing a name that was previously deactivated.
venueSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { active: true } }
);

export type VenueDocument = HydratedDocument<VenueAttributes>;

export const Venue = model<VenueAttributes>('Venue', venueSchema);
