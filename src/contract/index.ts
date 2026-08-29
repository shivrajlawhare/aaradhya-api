import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { apiErrorSchema } from './schemas/common.js';
import { loginBodySchema, loginResultSchema } from './schemas/auth.js';
import { changeLogEntryResultSchema, listChangeLogQuerySchema } from './schemas/change-log.js';
import {
  accommodationResultSchema,
  createEventBodySchema,
  createItemBodySchema,
  createSessionBodySchema,
  documentsChecklistResultSchema,
  eventIdParamsSchema,
  eventResultSchema,
  eventSessionItemParamsSchema,
  eventSessionParamsSchema,
  itemResultSchema,
  paymentResultSchema,
  sessionResultSchema,
  updateAccommodationBodySchema,
  updateDocumentsChecklistBodySchema,
  updateEventBodySchema,
  updateEventPaymentBodySchema,
  updateItemBodySchema,
  updateSessionBodySchema,
} from './schemas/event.js';
import {
  createMenuItemBodySchema,
  listMenuItemsQuerySchema,
  menuItemResultSchema,
} from './schemas/menu-item.js';
import {
  createUserBodySchema,
  updateUserBodySchema,
  userIdParamsSchema,
  userResultSchema,
} from './schemas/user.js';

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
  getEvent: {
    method: 'GET',
    path: '/events/:id',
    pathParams: eventIdParamsSchema,
    responses: {
      200: eventResultSchema,
      404: apiErrorSchema,
    },
    summary: 'Get one Event by id (any authenticated caller)',
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
});
