import { Error as MongooseError } from 'mongoose';
import type { AppRouteMutationImplementation, AppRouteQueryImplementation } from '@ts-rest/express';
import type { ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../contract/index.js';
import { Event, EventStatus, type EventDocument } from '../models/event.js';

type GetEventResponse = ServerInferResponses<typeof contract.getEvent>;

const eventNotFound: GetEventResponse = {
  status: 404,
  body: { error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' } },
};

const toPublicEvent = (event: EventDocument) => ({
  id: event.id,
  eventId: event.eventId,
  eventFamilyType: event.eventFamilyType,
  status: event.status,
  eventManager: event.eventManager.toString(),
  clientContacts: event.clientContacts.map((contact) => ({
    name: contact.name,
    contactNumber: contact.contactNumber,
    role: contact.role,
  })),
  createdBy: event.createdBy.toString(),
  createdAt: event.createdAt,
  updatedAt: event.updatedAt,
});

// STORY-011's schema already rejects an event_manager that doesn't resolve
// to an existing EventManager-role User Account via a custom validator on
// that path — this just recognises that specific failure so it can be
// reshaped into the same VALIDATION_ERROR envelope every other bad-body
// case returns, instead of an unhandled 500.
const isInvalidEventManagerError = (error: unknown): boolean =>
  error instanceof MongooseError.ValidationError && 'eventManager' in error.errors;

// event_id (server-generated), status's Tentative default, and createdBy
// are never taken as-is from the body: event_id is always minted by
// STORY-011's schema; status falls back to Tentative only when the caller
// omits it (FR-EVT-1 treats "initial status" as a real creation input, not
// something always fixed); createdBy always comes from the authenticated
// caller, never the request body, even if one is present.
export const createEvent: AppRouteMutationImplementation<typeof contract.createEvent> = async ({
  body,
  req,
}) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('createEvent handler ran without an authenticated user.');
  }

  try {
    const event = await Event.create({
      eventFamilyType: body.eventFamilyType,
      status: body.status ?? EventStatus.Tentative,
      eventManager: body.eventManager,
      clientContacts: body.clientContacts,
      createdBy: req.user.id,
    });
    return { status: 201, body: toPublicEvent(event) };
  } catch (error) {
    if (isInvalidEventManagerError(error)) {
      return {
        status: 400,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body.',
            details: [
              {
                field: 'eventManager',
                message:
                  'event_manager must reference an existing User Account with the EventManager role.',
              },
            ],
          },
        },
      };
    }
    throw error;
  }
};

// No role restriction — that's a later story's job (per STORY-013's Flow:
// "role-based field filtering is a separate later story"). Every field
// STORY-011's schema persists is returned as-is to any authenticated caller.
export const listEvents: AppRouteQueryImplementation<typeof contract.listEvents> = async () => {
  const events = await Event.find().sort({ createdAt: 1 });
  return { status: 200, body: events.map(toPublicEvent) };
};

export const getEvent: AppRouteQueryImplementation<typeof contract.getEvent> = async ({ params }) => {
  const event = await Event.findById(params.id);
  if (!event) {
    return eventNotFound;
  }
  return { status: 200, body: toPublicEvent(event) };
};
