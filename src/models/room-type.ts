import { type HydratedDocument, model, Schema } from 'mongoose';

// SRS §5.8/§4.6 — organization-wide master list backing the Room Type
// dropdown on a Session's Room Line entry.
export interface RoomTypeAttributes {
  name: string;
  // Guests per room (DEV-07, D2): the master value every Event room line
  // snapshots at save time — e.g. Delux 2, Family Room 6, Extra Beds 0.
  occupancy: number;
  defaultTariff: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roomTypeSchema = new Schema<RoomTypeAttributes>(
  {
    name: { type: String, required: true, trim: true },
    // default 0 so a Room Type saved before DEV-07 still reads as a number
    // until the DEV-07 migration / Settings fills it in.
    occupancy: { type: Number, required: true, min: 0, default: 0 },
    defaultTariff: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// See venue.ts for why this is a partial (active-only) unique index rather
// than a plain one — same recommended edge-case resolution, reused here.
roomTypeSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { active: true } }
);

export type RoomTypeDocument = HydratedDocument<RoomTypeAttributes>;

export const RoomType = model<RoomTypeAttributes>('RoomType', roomTypeSchema);
