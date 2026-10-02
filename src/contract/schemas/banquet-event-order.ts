import { z } from 'zod';
import { sessionDepartmentNotesResultSchema, sessionSetupResultSchema } from './event.js';

// CR-1 D4/D5 (DEV-12) — what a Banquet Event Order page prints, and nothing
// else: no venue cost, cost per plate, totals or any other money, so every
// role may read it.
const banquetEventOrderMealSchema = z.object({
  mealName: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  // Menu Item names (not ids), in the meal's own order.
  menuItems: z.array(z.string()),
});

const banquetEventOrderSessionSchema = z.object({
  id: z.string(),
  sessionType: z.string(),
  venue: z.string(),
  startDate: z.date(),
  endDate: z.date(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  pax: z.number(),
  meals: z.array(banquetEventOrderMealSchema),
  // The session's ceremony (Event Item) names, e.g. "Muhurta".
  ceremonies: z.array(z.string()),
  setup: sessionSetupResultSchema,
  departmentNotes: sessionDepartmentNotesResultSchema,
});

export const banquetEventOrderResultSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  // D7: the POC's name, else the first client contact's, else the event type.
  clientName: z.string(),
  // Active sessions only, in date/time order — one BEO page each (D5).
  sessions: z.array(banquetEventOrderSessionSchema),
});
