import { Error as MongooseError } from 'mongoose';
import type { AppRouteMutationImplementation, AppRouteQueryImplementation } from '@ts-rest/express';
import type { ServerInferRequest, ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../contract/index.js';
import { Event, EventStatus, type ClientContactAttributes, type EventDocument } from '../models/event.js';
import { logChange } from '../services/change-log.js';

type CreateEventResponse = ServerInferResponses<typeof contract.createEvent>;
type GetEventResponse = ServerInferResponses<typeof contract.getEvent>;
type UpdateEventResponse = ServerInferResponses<typeof contract.updateEvent>;
type UpdateEventBody = ServerInferRequest<typeof contract.updateEvent>['body'];

// Narrow (single-member), not the whole per-route union, so the same
// constant can be returned from any handler whose response union happens to
// share this exact 400/404 shape (they all reuse apiErrorSchema) — avoids
// three near-identical object literals across createEvent/getEvent/updateEvent.
const eventNotFound: Extract<GetEventResponse, { status: 404 }> = {
  status: 404,
  body: { error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' } },
};

const invalidEventManager: Extract<CreateEventResponse, { status: 400 }> = {
  status: 400,
  body: {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body.',
      details: [
        {
          field: 'eventManager',
          message: 'event_manager must reference an existing User Account with the EventManager role.',
        },
      ],
    },
  },
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

// Drops the subdocument's own `_id` so a stored row compares equal to a
// plain submitted row shaped the same as clientContactInputSchema.
const toPlainContact = ({ name, contactNumber, role }: ClientContactAttributes) => ({
  name,
  contactNumber,
  role,
});

const areClientContactsEqual = (
  stored: ClientContactAttributes[],
  submitted: ClientContactAttributes[],
): boolean => JSON.stringify(stored.map(toPlainContact)) === JSON.stringify(submitted.map(toPlainContact));

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
      return invalidEventManager;
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

interface PendingChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

// Only a field the caller actually sent, and whose value genuinely differs
// from what's stored, becomes both a $set entry and a queued Change Log
// Entry — a PATCH that resends identical values writes no log entry at all.
// This is a deliberate reading of STORY-008's "the caller decides whether a
// change is real before invoking the helper" line: the helper itself still
// always writes when called (STORY-008's own behavior, unchanged), but this
// controller is exactly the caller that line is talking about.
const buildEventUpdate = (
  existing: EventDocument,
  body: UpdateEventBody,
): { update: Record<string, unknown>; changes: PendingChange[] } => {
  const update: Record<string, unknown> = {};
  const changes: PendingChange[] = [];

  if (body.eventFamilyType !== undefined && body.eventFamilyType !== existing.eventFamilyType) {
    update.eventFamilyType = body.eventFamilyType;
    changes.push({ field: 'eventFamilyType', oldValue: existing.eventFamilyType, newValue: body.eventFamilyType });
  }
  if (body.status !== undefined && body.status !== existing.status) {
    update.status = body.status;
    changes.push({ field: 'status', oldValue: existing.status, newValue: body.status });
  }
  if (body.eventManager !== undefined && body.eventManager !== existing.eventManager.toString()) {
    update.eventManager = body.eventManager;
    changes.push({
      field: 'eventManager',
      oldValue: existing.eventManager.toString(),
      newValue: body.eventManager,
    });
  }
  if (
    body.clientContacts !== undefined &&
    !areClientContactsEqual(existing.clientContacts, body.clientContacts)
  ) {
    update.clientContacts = body.clientContacts;
    changes.push({
      field: 'clientContacts',
      oldValue: existing.clientContacts.map(toPlainContact),
      newValue: body.clientContacts,
    });
  }

  return { update, changes };
};

// Concurrent edits to the same Event by two Event Managers are not
// reconciled — last write to actually reach the database wins, same as a
// plain findByIdAndUpdate always behaves. Acceptable for v1 (deliberate
// non-requirement, not a bug) — nothing in this story asks for optimistic
// locking or a conflict response.
export const updateEvent: AppRouteMutationImplementation<typeof contract.updateEvent> = async ({
  params,
  body,
  req,
}) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('updateEvent handler ran without an authenticated user.');
  }
  const changedByUserId = req.user.id;

  const existing = await Event.findById(params.id);
  if (!existing) {
    return eventNotFound;
  }

  const { update, changes } = buildEventUpdate(existing, body);

  if (changes.length === 0) {
    return { status: 200, body: toPublicEvent(existing) };
  }

  let updated: EventDocument | null;
  try {
    updated = await Event.findByIdAndUpdate(params.id, update, {
      returnDocument: 'after',
      runValidators: true,
    });
  } catch (error) {
    if (isInvalidEventManagerError(error)) {
      return invalidEventManager;
    }
    throw error;
  }
  if (!updated) {
    return eventNotFound;
  }
  const eventId = updated.id;

  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
      }),
    ),
  );

  return { status: 200, body: toPublicEvent(updated) };
};
