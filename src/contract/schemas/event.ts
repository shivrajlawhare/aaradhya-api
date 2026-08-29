import { z } from 'zod';
import { ClientContactRole, EventStatus } from '../../models/event.js';
import { objectIdSchema } from './common.js';

// One boolean field per fixed key, hand-written (not built from
// DOCUMENT_CHECKLIST_ITEM_KEYS) — matches how every other schema field in
// this file is declared explicitly. `.strict()` is what actually implements
// this story's "rejects any key not in that fixed list": Zod's default
// object behavior silently strips unknown keys, which would look like
// success to a caller who mistyped one; `.strict()` turns that into a 400
// instead.
const documentsChecklistFieldsSchema = z.object({
  aadharCard: z.boolean().optional(),
  panCard: z.boolean().optional(),
  leavingBirthCertificate: z.boolean().optional(),
  rationCard: z.boolean().optional(),
  passportPhotos: z.boolean().optional(),
  weddingCard: z.boolean().optional(),
});

export const updateDocumentsChecklistBodySchema = documentsChecklistFieldsSchema.strict();

// .required() strips the .optional() every input field carries, rather
// than retyping the same six keys a third time.
export const documentsChecklistResultSchema = documentsChecklistFieldsSchema.required();

// contactNumber is required, not optional — STORY-011's schema already
// requires it per row. Leaving it optional here would just push the same
// failure down into a raw Mongoose ValidationError instead of a clean 400
// (documented as a v1 decision in the story backlog under STORY-012).
const clientContactInputSchema = z.object({
  name: z.string().trim().min(1),
  contactNumber: z.string().trim().min(1),
  role: z.nativeEnum(ClientContactRole),
});

export const eventIdParamsSchema = z.object({
  id: objectIdSchema('Invalid event id.'),
});

export const createEventBodySchema = z.object({
  eventFamilyType: z.string().trim().min(1),
  // Optional — FR-EVT-1 names "initial status" as a creation input, so a
  // caller may supply any of the four values up front; absent falls back
  // to Tentative in the controller.
  status: z.nativeEnum(EventStatus).optional(),
  eventManager: objectIdSchema('Invalid event_manager id.'),
  // At least one row here, even though STORY-011's Mongoose schema itself
  // allows zero — this create endpoint is where FR-EVT-1's "at least one
  // Client Contact" rule is actually enforced, and every row must carry a
  // non-empty name (a blank-name placeholder row is rejected, not
  // silently dropped).
  clientContacts: z.array(clientContactInputSchema).min(1),
});

// Every field optional (PATCH semantics — a caller sends only what changed),
// but a supplied `clientContacts` still needs at least one row: this is the
// same "at least one Client Contact" rule STORY-012 enforces at create time,
// restated here since removing the last remaining row is exactly the case
// this story's AC calls out to reject.
export const updateEventBodySchema = z.object({
  eventFamilyType: z.string().trim().min(1).optional(),
  status: z.nativeEnum(EventStatus).optional(),
  eventManager: objectIdSchema('Invalid event_manager id.').optional(),
  clientContacts: z.array(clientContactInputSchema).min(1).optional(),
});

const clientContactResultSchema = z.object({
  name: z.string(),
  contactNumber: z.string(),
  role: z.nativeEnum(ClientContactRole),
});

const roomLineInputSchema = z.object({
  roomType: z.string().trim().min(1),
  occupancy: z.number().min(0),
  tariff: z.number().min(0),
  // A no_of_rooms of 0 is a valid placeholder row — STORY-018's own
  // decision, matching the Mongoose schema's `min: 0` (not `min: 1`).
  noOfRooms: z.number().min(0),
});

// Every field optional (PATCH semantics) — a caller sends only what
// changed. z.coerce.date() accepts the ISO string a JSON body actually
// carries; an unparseable value still fails as an invalid date.
export const updateAccommodationBodySchema = z.object({
  checkIn: z.coerce.date().optional(),
  checkOut: z.coerce.date().optional(),
  roomLines: z.array(roomLineInputSchema).optional(),
});

const roomLineResultSchema = roomLineInputSchema.extend({
  // Derived (STORY-018's computeRoomLineTotalInclGst) — never accepted as
  // input, always present on output.
  totalInclGst: z.number(),
});

// The public Accommodation Block shape — checkIn/checkOut/totalDays are
// nullable, not just optional, since a caller can genuinely have no
// accommodation entered yet (STORY-018: accommodation itself is optional on
// the Event). roomLines/totalOccupancy/totalCharges default to an empty/zero
// state instead, since "no rooms" is itself a valid, common case.
export const accommodationResultSchema = z.object({
  checkIn: z.date().nullable(),
  checkOut: z.date().nullable(),
  totalDays: z.number().nullable(),
  roomLines: z.array(roomLineResultSchema),
  totalOccupancy: z.number(),
  totalCharges: z.number(),
});

// Every field optional (PATCH semantics). No cross-field validation between
// advancePaidDate and advancePaid — STORY-022's own decision: a caller may
// set an expected/planned advance_paid_date before advance_paid actually
// reflects a real payment.
export const updateEventPaymentBodySchema = z.object({
  totalEstimatedAmount: z.number().min(0).optional(),
  advanceRequired: z.number().min(0).optional(),
  advancePaid: z.number().min(0).optional(),
  advancePaidDate: z.coerce.date().optional(),
  paymentMode: z.string().trim().min(1).optional(),
});

// balance is derived (STORY-021's computeBalance) — never accepted as
// input, always present on output. advancePaidDate/paymentMode are
// nullable, not just optional, matching accommodation's checkIn/checkOut
// convention for "genuinely unset yet".
export const paymentResultSchema = z.object({
  totalEstimatedAmount: z.number(),
  advanceRequired: z.number(),
  advancePaid: z.number(),
  advancePaidDate: z.date().nullable(),
  paymentMode: z.string().nullable(),
  balance: z.number(),
});

// The public Event shape — everything STORY-011's schema persists, plus the
// Accommodation Block (STORY-018/019), the Payment Record (STORY-021/022),
// and the Documents Checklist (STORY-024). GET /events/:id (STORY-013)
// exposed none of them at first — each was added the moment a UI story
// actually needed to read the current state on first render (STORY-020 for
// accommodation, STORY-023 for payment, now STORY-025 for the checklist —
// exactly the recurrence flagged in STORY-024's own Decisions). Additive
// only: one more field on an already-public response, reusing STORY-024's
// own toPublicDocumentsChecklist — not a new concept, not a breaking change.
export const eventResultSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventFamilyType: z.string(),
  status: z.nativeEnum(EventStatus),
  eventManager: z.string(),
  clientContacts: z.array(clientContactResultSchema),
  accommodation: accommodationResultSchema,
  payment: paymentResultSchema,
  documentsChecklist: documentsChecklistResultSchema,
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
