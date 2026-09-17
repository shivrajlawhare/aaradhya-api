import { z } from 'zod';
import { objectIdSchema } from './common.js';

// defaultVenueCost is required, unlike MenuItem's optional
// defaultCostPerPlate — this story's own AC: POST /venues requires its
// default-cost field.
export const createVenueBodySchema = z.object({
  name: z.string().trim().min(1),
  defaultVenueCost: z.number().min(0),
});

// All fields independently optional — a caller may send just `active`
// (deactivate), just a rename/re-cost, or any combination (same "toggle
// active and/or edit fields in one request" shape as updateUserBodySchema).
export const updateVenueBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  defaultVenueCost: z.number().min(0).optional(),
  active: z.boolean().optional(),
});

export const venueResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  defaultVenueCost: z.number(),
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const venueIdParamsSchema = z.object({
  id: objectIdSchema('Invalid venue id.'),
});
