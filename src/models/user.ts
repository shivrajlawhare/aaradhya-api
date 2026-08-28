import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * The four fixed roles from SRS §3. Stored as their string values so a document
 * is readable without a lookup table. When `POST /users` (STORY-005) lands, the
 * contract's Zod schema becomes the source of truth and this enum is derived
 * from it (see docs/typescript-rules.md rule 3).
 */
export enum Role {
  EventManager = 'EventManager',
  FnBHead = 'FnBHead',
  Housekeeping = 'Housekeeping',
  Reception = 'Reception',
}

export const ROLE_VALUES: Role[] = Object.values(Role);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // Normalised to trimmed lowercase on write, so username uniqueness is
    // case-insensitive (`Admin` and `admin` collide). Display casing lives in
    // `name`, which is left as entered.
    username: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ROLE_VALUES },
    // Deactivation without deleting history (SRS §4.9); flips both ways.
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

userSchema.index({ username: 1 }, { unique: true });

export type UserAttributes = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<UserAttributes>;

export const User = model('User', userSchema);
