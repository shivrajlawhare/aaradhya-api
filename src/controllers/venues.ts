import type { AppRouteMutationImplementation, AppRouteQueryImplementation } from '@ts-rest/express';
import type { ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../contract/index.js';
import { Venue, type VenueDocument } from '../models/venue.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';

type CreateVenueResponse = ServerInferResponses<typeof contract.createVenue>;
type UpdateVenueResponse = ServerInferResponses<typeof contract.updateVenue>;

const toPublicVenue = (venue: VenueDocument) => ({
  id: venue.id,
  name: venue.name,
  defaultVenueCost: venue.defaultVenueCost,
  active: venue.active,
  createdAt: venue.createdAt,
  updatedAt: venue.updatedAt,
});

// Both active and inactive entries — the caller decides whether to filter
// (this story's own AC): a Session's Venue dropdown shows only active ones
// while the Settings screen (STORY-062) shows all.
export const listVenues: AppRouteQueryImplementation<typeof contract.listVenues> = async () => {
  const venues = await Venue.find().sort({ name: 1 });
  return { status: 200, body: venues.map(toPublicVenue) };
};

const nameAlreadyExists: Extract<CreateVenueResponse, { status: 409 }> = {
  status: 409,
  body: {
    error: {
      code: 'VENUE_NAME_TAKEN',
      message: 'A Venue with that name already exists.',
    },
  },
};

export const createVenue: AppRouteMutationImplementation<typeof contract.createVenue> = async ({ body }) => {
  try {
    const venue = await Venue.create({ name: body.name, defaultVenueCost: body.defaultVenueCost });
    return { status: 201, body: toPublicVenue(venue) };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return nameAlreadyExists;
    }
    throw error;
  }
};

const venueNotFound: Extract<UpdateVenueResponse, { status: 404 }> = {
  status: 404,
  body: { error: { code: 'VENUE_NOT_FOUND', message: 'No venue with that id.' } },
};

export const updateVenue: AppRouteMutationImplementation<typeof contract.updateVenue> = async ({ params, body }) => {
  const update: { name?: string; defaultVenueCost?: number; active?: boolean } = {};
  if (body.name !== undefined) {
    update.name = body.name;
  }
  if (body.defaultVenueCost !== undefined) {
    update.defaultVenueCost = body.defaultVenueCost;
  }
  if (body.active !== undefined) {
    update.active = body.active;
  }

  try {
    const venue = await Venue.findByIdAndUpdate(params.id, update, {
      returnDocument: 'after',
      runValidators: true,
    });

    if (!venue) {
      return venueNotFound;
    }

    return { status: 200, body: toPublicVenue(venue) };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return nameAlreadyExists;
    }
    throw error;
  }
};
