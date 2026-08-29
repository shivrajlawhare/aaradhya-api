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

// SRS §4.2 — Session Status, independent of the parent Event's own `status`;
// one Session inside a multi-day Event can be cancelled without cancelling
// the Event. Defaults to Active (this story's own AC).
export enum SessionStatus {
  Active = 'Active',
  Cancelled = 'Cancelled',
}

export const SESSION_STATUS_VALUES: SessionStatus[] = Object.values(SessionStatus);

// SRS §4.2's `setup` field lists a fixed set of seating arrangements
// ("Theatre/Round tables/Classroom/U-shape/Cluster/Other") as a closed list
// with an `Other` catch-all member — the same closed-enum-with-a-terminal-
// option shape as EventStatus/ClientContactRole, not the free-text "dropdown
// + custom value" shape used for event_family_type/session_type/venue below
// (those explicitly say "+ custom value/custom", this field doesn't).
export enum SeatingArrangement {
  Theatre = 'Theatre',
  RoundTables = 'RoundTables',
  Classroom = 'Classroom',
  UShape = 'UShape',
  Cluster = 'Cluster',
  Other = 'Other',
}

export const SEATING_ARRANGEMENT_VALUES: SeatingArrangement[] = Object.values(SeatingArrangement);

// SRS §4.2 — a Session's setup sub-object: seating arrangement, table/chair
// counts, a handful of yes/no facility flags, and one free-text notes field
// for anything not otherwise structured (decoration/stage/AV/parking).
// Always instantiated with defaulted fields (see `default: () => ({})`
// below), the same "every Session genuinely has one from day one" shape
// STORY-021/STORY-024 already used for payment/documentsChecklist — not
// accommodation's "may be entirely absent" shape.
export interface SessionSetupAttributes {
  seating?: SeatingArrangement;
  tableCount: number;
  chairCount: number;
  stage: boolean;
  buffet: boolean;
  registrationDesk: boolean;
  vipSeating: boolean;
  brideGroomSeating: boolean;
  notes?: string;
}

// SRS §4.5 — a single line within a Session: either a Meal Item (food/
// beverage, tied to Menu Items) or an Event Item (a non-food program
// moment, e.g. Muhurta, Cake Cutting).
export enum ItemType {
  Meal = 'Meal',
  Event = 'Event',
}

export const ITEM_TYPE_VALUES: ItemType[] = Object.values(ItemType);

// mealName/pax/costPerPlate are Meal-only; eventName/venue are Event-only —
// enforced at the schema level (each field's own conditional `required`,
// see itemSchema below) per this story's own AC, not by a discriminated
// TS union: this repo doesn't use Mongoose's schema-discriminator feature
// anywhere yet, so a flat shape with per-field conditional `required`
// functions matches every other cross-field rule already in this file
// (e.g. sessionSchema's own endDate validator) rather than introducing a
// new pattern for just this one case. totalCost is deliberately absent —
// derived (src/services/item.ts), never stored, same "never trust a
// stored derived value" convention totalDays/totalInclGst/balance/
// durationDays already established.
export interface ItemAttributes {
  type: ItemType;
  // Free text, not an enum — SRS phrases this like session_type/venue
  // ("prefilled + custom"), the same reasoning that kept those free text.
  mealName?: string;
  pax?: number;
  costPerPlate?: number;
  // References into the shared Menu Item master list (STORY-030) — no
  // existence validation yet, same "shape now, enforce later if a story
  // actually needs it" precedent eventManager's own validator was the
  // exception to, not the rule.
  menuItems: Types.ObjectId[];
  eventName?: string;
  // Free text, not an enum — same "prefilled" phrasing as Session's venue.
  venue?: string;
  // Local time-of-day values, shared by either type — same convention
  // Session's own startTime/endTime already use.
  startTime?: string;
  endTime?: string;
}

// SRS §4.2 — one scheduled block of activity within an Event.
export interface SessionAttributes {
  // Free text, not an enum — SRS phrases this exactly like
  // event_family_type ("dropdown + custom"), so the schema stays open the
  // same way.
  sessionType: string;
  // Free text, not an enum — same "dropdown + custom" phrasing as venue.
  venue: string;
  venueCost: number;
  startDate: Date;
  endDate: Date;
  // Local time-of-day values ("18:30"), not merged into a timezone-aware
  // datetime and not part of any overlap query (Spec_Amendment_MultiDate_
  // Sessions.md edge cases) — plain optional strings, not Dates.
  startTime?: string;
  endTime?: string;
  pax: number;
  sessionStatus: SessionStatus;
  setup: SessionSetupAttributes;
  items: ItemAttributes[];
}

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
  // Typed as a DocumentArray (not plain SessionAttributes[], unlike
  // clientContacts/roomLines above) — STORY-027 is the first place a
  // Session's own generated sub-id needs to come back out, which needs
  // `.create()`/`.id()`'s typed subdocument behavior, not just push/read.
  sessions: Types.DocumentArray<SessionAttributes>;
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

// Every field defaults to its "nothing entered yet" value — counts/flags
// default to 0/false, same convention documentsChecklistSchema already uses
// for its own booleans; seating/notes stay optional with no default, since
// there's no sensible "not entered yet" enum member or placeholder text.
const sessionSetupSchema = new Schema<SessionSetupAttributes>(
  {
    seating: { type: String, enum: SEATING_ARRANGEMENT_VALUES },
    tableCount: { type: Number, required: true, default: 0, min: 0 },
    chairCount: { type: Number, required: true, default: 0, min: 0 },
    stage: { type: Boolean, required: true, default: false },
    buffet: { type: Boolean, required: true, default: false },
    registrationDesk: { type: Boolean, required: true, default: false },
    vipSeating: { type: Boolean, required: true, default: false },
    brideGroomSeating: { type: Boolean, required: true, default: false },
    notes: { type: String, trim: true },
  },
  { _id: false },
);

// Returns a Mongoose `required` function for "only required when this
// Item's own type matches" — a regular function (not an arrow function),
// same reason sessionSchema's own endDate validator below is, so `this`
// binds to the subdocument being validated rather than lexically
// capturing the outer scope. Shared by every conditionally-required field
// below rather than five near-identical inline closures — this is the
// schema-level enforcement of this story's own AC: "requires the correct
// field set for whichever type is set."
const requiredForItemType = (type: ItemType) =>
  function (this: ItemAttributes): boolean {
    return this.type === type;
  };

const itemSchema = new Schema<ItemAttributes>({
  type: { type: String, required: true, enum: ITEM_TYPE_VALUES },
  mealName: { type: String, trim: true, required: requiredForItemType(ItemType.Meal) },
  // A pax of 0 is a valid placeholder row (this story's own edge case,
  // decided as "allowed") — min: 0, not min: 1; total_cost simply computes
  // to 0, not an error.
  pax: { type: Number, min: 0, required: requiredForItemType(ItemType.Meal) },
  costPerPlate: { type: Number, min: 0, required: requiredForItemType(ItemType.Meal) },
  menuItems: { type: [{ type: Schema.Types.ObjectId, ref: 'MenuItem' }], default: [] },
  eventName: { type: String, trim: true, required: requiredForItemType(ItemType.Event) },
  venue: { type: String, trim: true, required: requiredForItemType(ItemType.Event) },
  startTime: { type: String, trim: true },
  endTime: { type: String, trim: true },
});

// end_date's validator is a regular function (not an arrow function) so
// `this` binds to the subdocument being validated, per Mongoose's own
// validator-context convention — this is the schema-level enforcement of
// this story's own AC ("Schema rejects end_date < start_date").
const sessionSchema = new Schema<SessionAttributes>({
  sessionType: { type: String, required: true, trim: true },
  venue: { type: String, required: true, trim: true },
  venueCost: { type: Number, required: true, default: 0, min: 0 },
  startDate: { type: Date, required: true },
  endDate: {
    type: Date,
    required: true,
    validate: {
      // Mongoose types `this` as a union of the hydrated subdocument and
      // Query (the latter only applies when an update explicitly opts in
      // via `{ context: 'query' }`, which nothing here does) — narrowed
      // with a plain `in` check rather than an `as` cast (typescript-rules
      // rule 1).
      validator: function (value: Date): boolean {
        return 'startDate' in this ? value.getTime() >= this.startDate.getTime() : true;
      },
      message: 'end_date must be on or after start_date.',
    },
  },
  startTime: { type: String, trim: true },
  endTime: { type: String, trim: true },
  pax: { type: Number, required: true, default: 0, min: 0 },
  sessionStatus: {
    type: String,
    required: true,
    enum: SESSION_STATUS_VALUES,
    default: SessionStatus.Active,
  },
  // Always instantiated, same "default: () => ({})" reasoning as payment/
  // documentsChecklist above — every Session genuinely has a setup record
  // from the moment it's added, even if every field is still at its default.
  setup: { type: sessionSetupSchema, required: true, default: () => ({}) },
  // Zero or more at the schema level, same reasoning as sessions on Event —
  // this story only defines the shape; any create/edit endpoint (and
  // whatever "at least one Item" rule, if any) is a later story's job.
  items: { type: [itemSchema], default: [] },
});

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
    // Zero or more at the schema level, same reasoning as clientContacts —
    // this story only defines the shape; an "at least one Session" rule (if
    // any) belongs to whichever later story adds the add/remove endpoint.
    sessions: { type: [sessionSchema], default: [] },
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
