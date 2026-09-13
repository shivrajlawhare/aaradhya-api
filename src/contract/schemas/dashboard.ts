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
//
// meals: STORY-049's own "menu/meal-timing information... decide and
// document" — scoped to the soonest upcoming Session's Meal Items
// (mealName + start/end time), not each Meal's resolved menuItems dish
// names. Resolving those would mean joining against the separate
// MenuItem collection (see event-detail's own menuItemsById lookup) just
// for a dashboard summary row — out of scope for what this AC actually
// asks for ("meal-timing information visible", not a full menu). Present
// only for F&B Head (filterEventForRole's own canSeeMenu gate), same
// optional/genuinely-absent convention as clientContacts; `[]` (not
// absent) when F&B Head can see it but the session has no Meal Items yet.
export const dashboardUpcomingMealResultSchema = z.object({
  mealName: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
});

export const dashboardUpcomingEventResultSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventFamilyType: z.string(),
  status: z.nativeEnum(EventStatus),
  date: z.date(),
  venue: z.string(),
  pax: z.number(),
  clientContacts: z.array(clientContactResultSchema).optional(),
  meals: z.array(dashboardUpcomingMealResultSchema).optional(),
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
