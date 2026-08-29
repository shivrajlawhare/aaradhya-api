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

const clientContactResultSchema = z.object({
  name: z.string(),
  contactNumber: z.string(),
  role: z.nativeEnum(ClientContactRole),
});

// The public Event shape — everything STORY-011's schema persists.
export const eventResultSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventFamilyType: z.string(),
  status: z.nativeEnum(EventStatus),
  eventManager: z.string(),
  clientContacts: z.array(clientContactResultSchema),
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
