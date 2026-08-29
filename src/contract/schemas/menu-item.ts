import { z } from 'zod';

// Optional — an empty/omitted search returns the full list (this story's
// own edge case, decided as: no query means no filter, not a 400 — matches
// how an empty search box reads to someone browsing the whole master list).
export const listMenuItemsQuerySchema = z.object({
  search: z.string().trim().optional(),
});

// defaultCostPerPlate optional, falling back to the schema's own default
// (0) — a Menu Item added ad hoc mid-entry (SRS §4.6/FR-SES-3) may not have
// an agreed cost yet, same "money field defaults to 0" convention
// venueCost/pax already use elsewhere.
export const createMenuItemBodySchema = z.object({
  name: z.string().trim().min(1),
  defaultCostPerPlate: z.number().min(0).optional(),
});

export const menuItemResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  defaultCostPerPlate: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
