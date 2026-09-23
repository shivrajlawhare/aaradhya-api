import { type HydratedDocument, model, Schema } from 'mongoose';

// SRS §5.8/§4.6 — organization-wide master list backing the Room Type
// dropdown on a Session's Room Line entry.
export interface RoomTypeAttributes {
  name: string;
  defaultTariff: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roomTypeSchema = new Schema<RoomTypeAttributes>(
  {
    name: { type: String, required: true, trim: true },
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
