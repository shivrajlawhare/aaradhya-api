import { Schema, model, type HydratedDocument } from 'mongoose';

// SRS §4.6 — organization-wide, shared across all Events/Sessions/Items.
// `created_via` (the SRS's own field, distinguishing ad-hoc-added-during-
// entry from pre-seeded) is deliberately absent — this story's own AC only
// asks for `name`/`default_cost_per_plate`, not that field.
export interface MenuItemAttributes {
  name: string;
  defaultCostPerPlate: number;
  createdAt: Date;
  updatedAt: Date;
}

const menuItemSchema = new Schema<MenuItemAttributes>(
  {
    // Kept in its as-entered casing (unlike User.username, which normalises
    // to lowercase) — a Menu Item's name is user-facing display text
    // ("Paneer Tikka"), not an internal lookup key, so lowercasing it here
    // would corrupt what's actually shown. Case-insensitive uniqueness is
    // instead enforced by the index below, via collation, not by mangling
    // the stored value.
    name: { type: String, required: true, trim: true },
    defaultCostPerPlate: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

// strength: 2 makes MongoDB's own uniqueness check case-insensitive
// ("Paneer Tikka" and "paneer tikka" collide) without needing a shadow
// lowercase field — this story's own AC: reject a case-insensitive
// duplicate name with 409, not create a second entry.
menuItemSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export type MenuItemDocument = HydratedDocument<MenuItemAttributes>;

export const MenuItem = model<MenuItemAttributes>('MenuItem', menuItemSchema);
