import { z } from 'zod';
import { objectIdSchema } from './common.js';

// defaultTariff is required — this story's own AC: POST /room-types
// requires its default-cost field, same as POST /venues.
// occupancy (DEV-07): guests per room, snapshotted onto Event room lines.
export const createRoomTypeBodySchema = z.object({
  name: z.string().trim().min(1),
  occupancy: z.number().int().min(0),
  defaultTariff: z.number().min(0),
});

export const updateRoomTypeBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  occupancy: z.number().int().min(0).optional(),
  defaultTariff: z.number().min(0).optional(),
  active: z.boolean().optional(),
});

export const roomTypeResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  occupancy: z.number(),
  defaultTariff: z.number(),
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const roomTypeIdParamsSchema = z.object({
  id: objectIdSchema('Invalid room type id.'),
});
