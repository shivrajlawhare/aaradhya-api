import { Schema, model, Types, type HydratedDocument } from 'mongoose';
import { Role, User } from './user.js';
import { generateEventId } from '../services/event-id.js';

/** SRS §5.1 FR-EVT-6 — the only four states an Event can be in. */
export enum EventStatus {
  Tentative = 'Tentative',
  Confirmed = 'Confirmed',
  Completed = 'Completed',
  Cancelled = 'Cancelled',
}

export const EVENT_STATUS_VALUES: EventStatus[] = Object.values(EventStatus);

/** SRS §5.3 — the default rows a Client Contact can be, plus a free-form one. */
export enum ClientContactRole {
  Bride = 'Bride',
  Groom = 'Groom',
  POC = 'POC',
  Custom = 'Custom',
}

export const CLIENT_CONTACT_ROLE_VALUES: ClientContactRole[] = Object.values(ClientContactRole);

export interface ClientContactAttributes {
  name: string;
  contactNumber: string;
  role: ClientContactRole;
}

// SRS §4.3 — one Room Line within an Accommodation Block. total_incl_gst is
// deliberately absent here: it's a derived value (src/services/
// accommodation.ts), never stored, so it can never drift out of sync with
// tariff/no_of_rooms.
export interface RoomLineAttributes {
  roomType: string;
  occupancy: number;
  tariff: number;
  noOfRooms: number;
}

// SRS §4.3 — the single event-level Accommodation Block. Optional on the
// Event as a whole (STORY-012's create flow doesn't populate it — it's
// added/edited later via STORY-019's dedicated endpoint), and roomLines can
// be empty (not every Event needs guest rooms, per STORY-019's own edge
// case) — total_days/total_occupancy/total_charges are likewise never
// stored, computed on demand from checkIn/checkOut/roomLines.
export interface AccommodationAttributes {
  checkIn?: Date;
  checkOut?: Date;
  roomLines: RoomLineAttributes[];
}

// SRS §4.4 — the single event-level Payment Record, Event Manager
// visibility only (enforced by whichever endpoint/response shape reads
// this, not by the schema itself). Unlike accommodation, this sub-object
// always exists with defaulted fields (see the `default: () => ({})`
// below) — the story's own AC frames it as fields defaulting to 0/unset,
// not the whole record being absent. `balance` is deliberately absent
// here: it's derived (src/services/payment.ts), never stored.
export interface PaymentAttributes {
  totalEstimatedAmount: number;
  advanceRequired: number;
  advancePaid: number;
  advancePaidDate?: Date;
  // Free text, not an enum — SRS gives no fixed list for this field
  // (unlike, say, event_family_type), so the schema stays open.
  paymentMode?: string;
}

// SRS §4.8 — the fixed, server-defined set of Document Checklist Item keys.
// Never extended via the API (STORY-024's own AC: reject any key outside
// this list) — a flat object with one boolean per fixed key, not an
// array-of-{key,value} items, since the set can never grow or shrink; this
// is functionally the same "fixed set of Document Checklist Items" the SRS
// describes, just the simpler shape for something that's never dynamic.
export const DOCUMENT_CHECKLIST_ITEM_KEYS = [
  'aadharCard',
  'panCard',
  'leavingBirthCertificate',
  'rationCard',
  'passportPhotos',
  'weddingCard',
] as const;

export type DocumentChecklistItemKey = (typeof DOCUMENT_CHECKLIST_ITEM_KEYS)[number];

export type DocumentsChecklistAttributes = Record<DocumentChecklistItemKey, boolean>;

export interface EventAttributes {
  eventId: string;
  // Free text, not an enum — FR-EVT-1 wants a "dropdown + custom" input, so
  // the schema stays open to whatever value the UI's custom option sends.
  eventFamilyType: string;
  status: EventStatus;
  eventManager: Types.ObjectId;
  clientContacts: ClientContactAttributes[];
  accommodation?: AccommodationAttributes;
  payment: PaymentAttributes;
  documentsChecklist: DocumentsChecklistAttributes;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const clientContactSchema = new Schema<ClientContactAttributes>({
  name: { type: String, required: true, trim: true },
  contactNumber: { type: String, required: true, trim: true },
  role: { type: String, required: true, enum: CLIENT_CONTACT_ROLE_VALUES },
});

// no_of_rooms: 0 is a valid placeholder row (STORY-018's own edge case,
// decided as "allowed") — min: 0 rejects only negative values.
const roomLineSchema = new Schema<RoomLineAttributes>({
  roomType: { type: String, required: true, trim: true },
  occupancy: { type: Number, required: true, min: 0 },
  tariff: { type: Number, required: true, min: 0 },
  noOfRooms: { type: Number, required: true, min: 0 },
});

const accommodationSchema = new Schema<AccommodationAttributes>(
  {
    checkIn: { type: Date },
    checkOut: { type: Date },
    roomLines: { type: [roomLineSchema], default: [] },
  },
  { _id: false },
);

// min: 0 on every money field — "money in can't be negative" (this story's
// own edge case, stated for advance_paid) applies just as much to the
// estimate and the required advance; none of the three can sensibly be
// negative.
const paymentSchema = new Schema<PaymentAttributes>(
  {
    totalEstimatedAmount: { type: Number, required: true, default: 0, min: 0 },
    advanceRequired: { type: Number, required: true, default: 0, min: 0 },
    advancePaid: { type: Number, required: true, default: 0, min: 0 },
    advancePaidDate: { type: Date },
    paymentMode: { type: String, trim: true },
  },
  { _id: false },
);

// Each item defaults to false ("not received yet") — a brand-new Event
// reads every item as false, never null/error (this story's own edge
// case), the same "always instantiated with defaulted fields" shape
// STORY-021 already used for payment (not accommodation's "may be entirely
// absent" shape — every Event genuinely has this checklist from day one).
const documentsChecklistSchema = new Schema<DocumentsChecklistAttributes>(
  {
    aadharCard: { type: Boolean, required: true, default: false },
    panCard: { type: Boolean, required: true, default: false },
    leavingBirthCertificate: { type: Boolean, required: true, default: false },
    rationCard: { type: Boolean, required: true, default: false },
    passportPhotos: { type: Boolean, required: true, default: false },
    weddingCard: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

// event_manager must point at a real User Account whose role is
// EventManager — any other user's id (or a nonexistent one) is rejected at
// the schema level, not left to the create-endpoint to police.
const isValidEventManagerReference = async (userId: Types.ObjectId): Promise<boolean> => {
  const manager = await User.findById(userId);
  return manager !== null && manager.role === Role.EventManager;
};

const eventSchema = new Schema<EventAttributes>(
  {
    eventId: { type: String, required: true },
    eventFamilyType: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: EVENT_STATUS_VALUES },
    eventManager: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      validate: {
        validator: isValidEventManagerReference,
        message: 'event_manager must reference an existing User Account with the EventManager role.',
      },
    },
    // Zero or more at the schema level — STORY-012's create endpoint is
    // where "at least one" gets enforced, so this schema stays reusable by
    // anything that needs an Event shape without that create-time rule.
    clientContacts: { type: [clientContactSchema], default: [] },
    accommodation: { type: accommodationSchema },
    // Always instantiated, even if never supplied at creation — the
    // default factory runs Mongoose's own nested-schema defaults, so a
    // brand-new Event gets payment.totalEstimatedAmount/advanceRequired/
    // advancePaid all at 0 without STORY-012's create endpoint needing to
    // set anything (this story's own AC: "fields default to 0/unset").
    payment: { type: paymentSchema, required: true, default: () => ({}) },
    // Always instantiated, same reasoning as payment above — a brand-new
    // Event reads every checklist item as false, never null/error.
    documentsChecklist: { type: documentsChecklistSchema, required: true, default: () => ({}) },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

eventSchema.index({ eventId: 1 }, { unique: true });

// event_id is always server-generated, never client-supplied — overwritten
// unconditionally on creation, before validation runs (so `required` above
// can never actually fail). Only on creation: an update-path story later
// must not have every `.save()` mint a fresh id and reserve another
// sequence number out from under an existing Event.
eventSchema.pre('validate', async function assignEventId() {
  if (this.isNew) {
    this.eventId = await generateEventId();
  }
});

export type EventDocument = HydratedDocument<EventAttributes>;

export const Event = model<EventAttributes>('Event', eventSchema);
