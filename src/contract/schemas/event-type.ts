import { z } from 'zod';
import { objectIdSchema } from './common.js';

// Only `name` — this story's own AC: POST /event-types requires only name
// (no default-cost field on this master list, unlike Venue/RoomType).
export const createEventTypeBodySchema = z.object({
  name: z.string().trim().min(1),
});

export const updateEventTypeBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
});

export const eventTypeResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const eventTypeIdParamsSchema = z.object({
  id: objectIdSchema('Invalid event type id.'),
});
