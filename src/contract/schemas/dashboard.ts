import { z } from 'zod';
import { EventStatus } from '../../models/event.js';
import { clientContactResultSchema, filteredAccommodationResultSchema, sessionSetupResultSchema } from './event.js';

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

// STORY-050's own "setup/rooms detail visible" (Housekeeping) — SRS §3.3's
// exact wording is "seating/setup requirements, hall setup, rooms booked
// (where applicable)", mapped onto the two shapes that already exist for
// this: setup reuses sessionSetupResultSchema verbatim for the row's
// soonest upcoming Session (Housekeeping only, filterEventForRole's own
// canSeeSetup gate); accommodation reuses filteredAccommodationResultSchema
// verbatim, the Event-level rooms-booked detail (Housekeeping AND
// Reception, canSeeAccommodation) — also directly serves STORY-051's own
// "rooms, check-in/out visible" bullet, no further backend change needed
// for that story. Both `.optional()`, same genuinely-absent convention as
// clientContacts/meals — undefined for every role that can't see them,
// including Event Manager (this is Housekeeping/Reception's own new
// column, same "extra column vs. the Event Manager view" framing STORY-049
// already established for meals).
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
  setup: sessionSetupResultSchema.optional(),
  accommodation: filteredAccommodationResultSchema.optional(),
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
