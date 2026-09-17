import type { AppRouteMutationImplementation, AppRouteQueryImplementation } from '@ts-rest/express';
import type { ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../contract/index.js';
import { EventType, type EventTypeDocument } from '../models/event-type.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';

type CreateEventTypeResponse = ServerInferResponses<typeof contract.createEventType>;
type UpdateEventTypeResponse = ServerInferResponses<typeof contract.updateEventType>;

const toPublicEventType = (eventType: EventTypeDocument) => ({
  id: eventType.id,
  name: eventType.name,
  active: eventType.active,
  createdAt: eventType.createdAt,
  updatedAt: eventType.updatedAt,
});

export const listEventTypes: AppRouteQueryImplementation<typeof contract.listEventTypes> = async () => {
  const eventTypes = await EventType.find().sort({ name: 1 });
  return { status: 200, body: eventTypes.map(toPublicEventType) };
};

const nameAlreadyExists: Extract<CreateEventTypeResponse, { status: 409 }> = {
  status: 409,
  body: {
    error: {
      code: 'EVENT_TYPE_NAME_TAKEN',
      message: 'An Event Type with that name already exists.',
    },
  },
};

export const createEventType: AppRouteMutationImplementation<typeof contract.createEventType> = async ({ body }) => {
  try {
    const eventType = await EventType.create({ name: body.name });
    return { status: 201, body: toPublicEventType(eventType) };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return nameAlreadyExists;
    }
    throw error;
  }
};

const eventTypeNotFound: Extract<UpdateEventTypeResponse, { status: 404 }> = {
  status: 404,
  body: { error: { code: 'EVENT_TYPE_NOT_FOUND', message: 'No event type with that id.' } },
};

export const updateEventType: AppRouteMutationImplementation<typeof contract.updateEventType> = async ({
  params,
  body,
}) => {
  const update: { name?: string; active?: boolean } = {};
  if (body.name !== undefined) {
    update.name = body.name;
  }
  if (body.active !== undefined) {
    update.active = body.active;
  }

  try {
    const eventType = await EventType.findByIdAndUpdate(params.id, update, {
      returnDocument: 'after',
      runValidators: true,
    });

    if (!eventType) {
      return eventTypeNotFound;
    }

    return { status: 200, body: toPublicEventType(eventType) };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return nameAlreadyExists;
    }
    throw error;
  }
};
