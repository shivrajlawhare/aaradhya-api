import { z } from 'zod';
import { ClientContactRole, EventStatus } from '../../models/event.js';
import { objectIdSchema } from './common.js';

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

// The public Event shape — everything STORY-011's schema persists, plus the
// Accommodation Block (STORY-018/019). GET /events/:id (STORY-013) never
// exposed accommodation at all until now — STORY-020 (the Rooms tab UI)
// needs a way to read the *current* accommodation state on first render,
// and no story had added a GET for it (STORY-019 only added the PATCH).
// This is the minimal, additive fix: one more field on an already-public
// response, reusing STORY-019's own toPublicAccommodation — not a new
// concept, not a breaking change to the existing shape.
export const eventResultSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventFamilyType: z.string(),
  status: z.nativeEnum(EventStatus),
  eventManager: z.string(),
  clientContacts: z.array(clientContactResultSchema),
  accommodation: accommodationResultSchema,
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
