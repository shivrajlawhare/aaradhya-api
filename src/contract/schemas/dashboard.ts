import { z } from 'zod';
import { EventStatus } from '../../models/event.js';
import { clientContactResultSchema } from './event.js';

// One row per qualifying Event (its soonest upcoming Session), per SRS
// FR-ROLE-2's own named columns: "date, event, client, venue, pax,
// status." clientContacts is `.optional()`, same "genuinely absent, not
// null" convention STORY-046's filteredEventResultSchema already
// established — this list reuses that same filtering (STORY-046's own
// filterEventForRole), so a role that can't see client names never gets
// this key at all.
export const dashboardUpcomingEventResultSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventFamilyType: z.string(),
  status: z.nativeEnum(EventStatus),
  date: z.date(),
  venue: z.string(),
  pax: z.number(),
  clientContacts: z.array(clientContactResultSchema).optional(),
});

// Counts are identical across roles (this story's own AC) — nothing about
// a count number itself is sensitive, only the per-event field detail in
// upcomingEvents is.
export const dashboardResultSchema = z.object({
  counts: z.object({
    todaysEvents: z.number(),
    upcoming: z.number(),
    tentative: z.number(),
    confirmed: z.number(),
  }),
  upcomingEvents: z.array(dashboardUpcomingEventResultSchema),
});
