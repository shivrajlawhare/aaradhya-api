import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { loginBodySchema, loginResultSchema } from './schemas/auth.js';
import { changeLogEntryResultSchema, listChangeLogQuerySchema } from './schemas/change-log.js';
import { apiErrorSchema } from './schemas/common.js';
import { dashboardResultSchema } from './schemas/dashboard.js';
import {
  createEventTypeBodySchema,
  eventTypeIdParamsSchema,
  eventTypeResultSchema,
  updateEventTypeBodySchema,
} from './schemas/event-type.js';
import {
  accommodationResultSchema,
  calendarSessionResultSchema,
  createEventBodySchema,
  createItemBodySchema,
  createSessionBodySchema,
  documentsChecklistResultSchema,
  eventIdParamsSchema,
  eventResultSchema,
  eventSessionItemParamsSchema,
  eventSessionParamsSchema,
  extrasResultSchema,
  filteredEventResultSchema,
  getCalendarQuerySchema,
  itemResultSchema,
  paymentResultSchema,
  quotationSummaryResultSchema,
  searchEventsQuerySchema,
  sessionResultSchema,
  updateAccommodationBodySchema,
  updateDocumentsChecklistBodySchema,
  updateEventBodySchema,
  updateEventExtrasBodySchema,
  updateEventPaymentBodySchema,
  updateItemBodySchema,
  updateSessionBodySchema,
} from './schemas/event.js';
import {
  createMenuItemBodySchema,
  listMenuItemsQuerySchema,
  menuItemIdParamsSchema,
  menuItemResultSchema,
  updateMenuItemBodySchema,
} from './schemas/menu-item.js';
import {
  createRoomTypeBodySchema,
  roomTypeIdParamsSchema,
  roomTypeResultSchema,
  updateRoomTypeBodySchema,
} from './schemas/room-type.js';
import {
  createUserBodySchema,
  eventManagerSummarySchema,
  updateUserBodySchema,
  userIdParamsSchema,
  userResultSchema,
} from './schemas/user.js';
import {
  createVenueBodySchema,
  updateVenueBodySchema,
  venueIdParamsSchema,
  venueResultSchema,
} from './schemas/venue.js';

const c = initContract();

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

/**
 * Local home for the ts-rest contract until the shared `@aaradhya/contracts`
 * package location is settled (see docs/directory-structure.md open item).
 * Routes and schemas move to that package once the decision is made — the
 * import sites stay the same shape.
 */
export const contract = c.router({
  getHealth: {
    method: 'GET',
    path: '/health',
    responses: {
      200: healthResponseSchema,
    },
    summary: 'Liveness check',
  },
  login: {
    method: 'POST',
    path: '/auth/login',
    body: loginBodySchema,
    responses: {
      200: loginResultSchema,
      401: apiErrorSchema,
    },
    summary: 'Exchange username + password for a session token',
  },
  createUser: {
    method: 'POST',
    path: '/users',
    body: createUserBodySchema,
    responses: {
      201: userResultSchema,
      409: apiErrorSchema,
    },
    summary: 'Create a User Account (Event Manager only)',
  },
  listUsers: {
    method: 'GET',
    path: '/users',
    responses: {
      200: z.array(userResultSchema),
    },
    summary: 'List all User Accounts (Event Manager only)',
  },
  updateUser: {
    method: 'PATCH',
    path: '/users/:id',
    pathParams: userIdParamsSchema,
    body: updateUserBodySchema,
    responses: {
      200: userResultSchema,
      404: apiErrorSchema,
    },
    summary: 'Toggle active and/or change role on a User Account (Event Manager only)',
  },
  // Deliberately not GET /users?role=EventManager — that route is
  // EventManager-only (userResultSchema exposes username/active/timestamps
  // no other role should see); this is a narrower {id, name} shape any
  // authenticated caller can read, for STORY-037's calendar filter picker.
  listEventManagers: {
    method: 'GET',
    path: '/event-managers',
    responses: {
      200: z.array(eventManagerSummarySchema),
    },
    summary: 'List {id, name} for every Event Manager account (any authenticated caller)',
  },
  listChangeLog: {
    method: 'GET',
    path: '/change-log',
    query: listChangeLogQuerySchema,
    responses: {
      200: z.array(changeLogEntryResultSchema),
    },
    summary: 'List Change Log Entries for one entity (Event Manager only)',
  },
  createEvent: {
    method: 'POST',
    path: '/events',
    body: createEventBodySchema,
    responses: {
      201: eventResultSchema,
      400: apiErrorSchema,
    },
    summary: 'Create an Event (Event Manager only)',
  },
  listEvents: {
    method: 'GET',
    path: '/events',
    responses: {
      200: z.array(eventResultSchema),
    },
    summary: 'List all Events (any authenticated caller)',
  },
  // Registered before getEvent (path '/events/:id') so Express tries this
  // more specific literal path first — otherwise '/events/search' would
  // match '/events/:id' with id='search' and never reach this handler at
  // all, since createExpressEndpoints mounts routes in this object's own
  // key order.
  searchEvents: {
    method: 'GET',
    path: '/events/search',
    query: searchEventsQuerySchema,
    responses: {
      200: z.array(eventResultSchema),
    },
    summary:
      'Search Events by date-range overlap plus status/venue/eventManager/eventFamilyType filters (any authenticated caller)',
  },
  // 200 is filteredEventResultSchema, not eventResultSchema (STORY-046) —
  // the only route whose response shape genuinely depends on req.user.role;
  // every other route returning an Event stays EventManager-only, so
  // eventResultSchema itself stays fully required/unchanged for them.
  getEvent: {
    method: 'GET',
    path: '/events/:id',
    pathParams: eventIdParamsSchema,
    responses: {
      200: filteredEventResultSchema,
      404: apiErrorSchema,
    },
    summary: 'Get one Event by id, fields filtered per the caller role (any authenticated caller)',
  },
  updateEvent: {
    method: 'PATCH',
    path: '/events/:id',
    pathParams: eventIdParamsSchema,
    body: updateEventBodySchema,
    responses: {
      200: eventResultSchema,
      400: apiErrorSchema,
      404: apiErrorSchema,
    },
    summary: 'Edit core fields and/or Client Contacts on an Event (Event Manager only)',
  },
  deleteEvent: {
    method: 'DELETE',
    path: '/events/:id',
    pathParams: eventIdParamsSchema,
    responses: {
      204: c.noBody(),
      404: apiErrorSchema,
    },
    summary: 'Permanently delete an Event and its Change Log Entries (Event Manager only)',
  },
  updateEventAccommodation: {
    method: 'PATCH',
    path: '/events/:id/accommodation',
    pathParams: eventIdParamsSchema,
    body: updateAccommodationBodySchema,
    responses: {
      200: accommodationResultSchema,
      404: apiErrorSchema,
    },
    summary: "Edit an Event's Accommodation Block (Event Manager only)",
  },
  updateEventPayment: {
    method: 'PATCH',
    path: '/events/:id/payment',
    pathParams: eventIdParamsSchema,
    body: updateEventPaymentBodySchema,
    responses: {
      200: paymentResultSchema,
      404: apiErrorSchema,
    },
    summary: "Edit an Event's Payment Record (Event Manager only)",
  },
  updateDocumentsChecklist: {
    method: 'PATCH',
    path: '/events/:id/documents',
    pathParams: eventIdParamsSchema,
    body: updateDocumentsChecklistBodySchema,
    responses: {
      200: documentsChecklistResultSchema,
      404: apiErrorSchema,
    },
    summary: "Toggle items on an Event's Documents Checklist (Event Manager only)",
  },
  updateEventExtras: {
    method: 'PATCH',
    path: '/events/:id/extras',
    pathParams: eventIdParamsSchema,
    body: updateEventExtrasBodySchema,
    responses: {
      200: extrasResultSchema,
      404: apiErrorSchema,
    },
    summary: "Edit an Event's Quotation extras — Decoration/Photographer/Bhatji (Event Manager only)",
  },
  getQuotationSummary: {
    method: 'GET',
    path: '/events/:id/quotation-summary',
    pathParams: eventIdParamsSchema,
    responses: {
      200: quotationSummaryResultSchema,
      404: apiErrorSchema,
    },
    summary: "Get an Event's live Total Cost Summary rollup (any authenticated caller)",
  },
  // c.otherResponse — this route's body is a raw PDF byte stream, not JSON;
  // every other route in this contract returns z.object(...)/z.array(...)
  // (or c.noBody() for a 204). EventManager-only (unlike getQuotationSummary
  // above): the PDF surfaces the same Payment-Record-adjacent financial
  // detail (Grand Total, bank account number) the SRS restricts to Event
  // Manager visibility elsewhere (§4.4/§3.4) — this story's own judgment
  // call, since its own AC doesn't name a role restriction explicitly.
  getQuotationPdf: {
    method: 'GET',
    path: '/events/:id/quotation.pdf',
    pathParams: eventIdParamsSchema,
    responses: {
      200: c.otherResponse({ contentType: 'application/pdf', body: c.type<Buffer>() }),
      404: apiErrorSchema,
    },
    summary: 'Generate the client-facing Quotation PDF from live Event data (Event Manager only)',
  },
  createSession: {
    method: 'POST',
    path: '/events/:id/sessions',
    pathParams: eventIdParamsSchema,
    body: createSessionBodySchema,
    responses: {
      201: sessionResultSchema,
      400: apiErrorSchema,
      404: apiErrorSchema,
    },
    summary: 'Add a Session to an Event (Event Manager only)',
  },
  updateSession: {
    method: 'PATCH',
    path: '/events/:id/sessions/:sid',
    pathParams: eventSessionParamsSchema,
    body: updateSessionBodySchema,
    responses: {
      200: sessionResultSchema,
      400: apiErrorSchema,
      404: apiErrorSchema,
    },
    summary: "Edit one of an Event's Sessions (Event Manager only)",
  },
  deleteSession: {
    method: 'DELETE',
    path: '/events/:id/sessions/:sid',
    pathParams: eventSessionParamsSchema,
    responses: {
      204: c.noBody(),
      404: apiErrorSchema,
    },
    summary: "Remove one of an Event's Sessions (Event Manager only)",
  },
  listMenuItems: {
    method: 'GET',
    path: '/menu-items',
    query: listMenuItemsQuerySchema,
    responses: {
      200: z.array(menuItemResultSchema),
    },
    summary: 'Search the shared Menu Item master list (any authenticated caller)',
  },
  createMenuItem: {
    method: 'POST',
    path: '/menu-items',
    body: createMenuItemBodySchema,
    responses: {
      201: menuItemResultSchema,
      409: apiErrorSchema,
    },
    summary: 'Add a Menu Item to the shared master list (any authenticated caller)',
  },
  updateMenuItem: {
    method: 'PATCH',
    path: '/menu-items/:id',
    pathParams: menuItemIdParamsSchema,
    body: updateMenuItemBodySchema,
    responses: {
      200: menuItemResultSchema,
      404: apiErrorSchema,
      409: apiErrorSchema,
    },
    // Same authenticatedOnly reasoning as createMenuItem above (this
    // route's own sibling) — the master list "grows organically" from any
    // manager's entry, not gated by role; no `active` field exists on this
    // model to toggle here (settings-sections.ts's own comment).
    summary: 'Edit name/default cost on a Menu Item (any authenticated caller)',
  },
  createItem: {
    method: 'POST',
    path: '/events/:id/sessions/:sid/items',
    pathParams: eventSessionParamsSchema,
    body: createItemBodySchema,
    responses: {
      201: itemResultSchema,
      400: apiErrorSchema,
      404: apiErrorSchema,
    },
    summary: 'Add a Meal or Event Item to a Session (Event Manager only)',
  },
  updateItem: {
    method: 'PATCH',
    path: '/events/:id/sessions/:sid/items/:iid',
    pathParams: eventSessionItemParamsSchema,
    body: updateItemBodySchema,
    responses: {
      200: itemResultSchema,
      400: apiErrorSchema,
      404: apiErrorSchema,
    },
    summary: "Edit one of a Session's Items (Event Manager only)",
  },
  deleteItem: {
    method: 'DELETE',
    path: '/events/:id/sessions/:sid/items/:iid',
    pathParams: eventSessionItemParamsSchema,
    responses: {
      204: c.noBody(),
      404: apiErrorSchema,
    },
    summary: "Remove one of a Session's Items (Event Manager only)",
  },
  getCalendar: {
    method: 'GET',
    path: '/calendar',
    query: getCalendarQuerySchema,
    responses: {
      200: z.array(calendarSessionResultSchema),
    },
    summary: 'Active Sessions overlapping any date within a given month (any authenticated caller)',
  },
  getDashboard: {
    method: 'GET',
    path: '/dashboard',
    responses: {
      200: dashboardResultSchema,
    },
    summary:
      'Role-filtered dashboard aggregate: today/upcoming/tentative/confirmed counts + upcoming-events list (any authenticated caller)',
  },
  // The three Admin/Configuration master lists (STORY-061). Every GET is
  // authenticatedOnly — every role's dropdowns (Session/Room Line entry)
  // need to read these, even though only Event Manager can edit them
  // (SRS FR-CFG-6). Deactivating an entry (PATCH active:false) never
  // deletes it and never cascades to any Event/Session/Room Line already
  // referencing its name (they copied the name/cost at selection time —
  // see the Venue/RoomType model comments).
  listVenues: {
    method: 'GET',
    path: '/venues',
    responses: {
      200: z.array(venueResultSchema),
    },
    summary: 'List every Venue, active and inactive (any authenticated caller)',
  },
  createVenue: {
    method: 'POST',
    path: '/venues',
    body: createVenueBodySchema,
    responses: {
      201: venueResultSchema,
      409: apiErrorSchema,
    },
    summary: 'Add a Venue to the master list (Event Manager only)',
  },
  updateVenue: {
    method: 'PATCH',
    path: '/venues/:id',
    pathParams: venueIdParamsSchema,
    body: updateVenueBodySchema,
    responses: {
      200: venueResultSchema,
      404: apiErrorSchema,
      409: apiErrorSchema,
    },
    summary: 'Edit name/default cost and/or toggle active on a Venue (Event Manager only)',
  },
  listEventTypes: {
    method: 'GET',
    path: '/event-types',
    responses: {
      200: z.array(eventTypeResultSchema),
    },
    summary: 'List every Event Type, active and inactive (any authenticated caller)',
  },
  createEventType: {
    method: 'POST',
    path: '/event-types',
    body: createEventTypeBodySchema,
    responses: {
      201: eventTypeResultSchema,
      409: apiErrorSchema,
    },
    summary: 'Add an Event Type to the master list (Event Manager only)',
  },
  updateEventType: {
    method: 'PATCH',
    path: '/event-types/:id',
    pathParams: eventTypeIdParamsSchema,
    body: updateEventTypeBodySchema,
    responses: {
      200: eventTypeResultSchema,
      404: apiErrorSchema,
      409: apiErrorSchema,
    },
    summary: 'Edit name and/or toggle active on an Event Type (Event Manager only)',
  },
  listRoomTypes: {
    method: 'GET',
    path: '/room-types',
    responses: {
      200: z.array(roomTypeResultSchema),
    },
    summary: 'List every Room Type, active and inactive (any authenticated caller)',
  },
  createRoomType: {
    method: 'POST',
    path: '/room-types',
    body: createRoomTypeBodySchema,
    responses: {
      201: roomTypeResultSchema,
      409: apiErrorSchema,
    },
    summary: 'Add a Room Type to the master list (Event Manager only)',
  },
  updateRoomType: {
    method: 'PATCH',
    path: '/room-types/:id',
    pathParams: roomTypeIdParamsSchema,
    body: updateRoomTypeBodySchema,
    responses: {
      200: roomTypeResultSchema,
      404: apiErrorSchema,
      409: apiErrorSchema,
    },
    summary: 'Edit name/default tariff and/or toggle active on a Room Type (Event Manager only)',
  },
});
