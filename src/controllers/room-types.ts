import type { ServerInferResponses } from '@ts-rest/core';
import type { AppRouteMutationImplementation, AppRouteQueryImplementation } from '@ts-rest/express';
import type { contract } from '../contract/index.js';
import { RoomType, type RoomTypeDocument } from '../models/room-type.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';

type CreateRoomTypeResponse = ServerInferResponses<typeof contract.createRoomType>;
type UpdateRoomTypeResponse = ServerInferResponses<typeof contract.updateRoomType>;

const toPublicRoomType = (roomType: RoomTypeDocument) => ({
  id: roomType.id,
  name: roomType.name,
  defaultTariff: roomType.defaultTariff,
  active: roomType.active,
  createdAt: roomType.createdAt,
  updatedAt: roomType.updatedAt,
});

export const listRoomTypes: AppRouteQueryImplementation<typeof contract.listRoomTypes> = async () => {
  const roomTypes = await RoomType.find().sort({ name: 1 });
  return { status: 200, body: roomTypes.map(toPublicRoomType) };
};

const nameAlreadyExists: Extract<CreateRoomTypeResponse, { status: 409 }> = {
  status: 409,
  body: {
    error: {
      code: 'ROOM_TYPE_NAME_TAKEN',
      message: 'A Room Type with that name already exists.',
    },
  },
};

export const createRoomType: AppRouteMutationImplementation<typeof contract.createRoomType> = async ({ body }) => {
  try {
    const roomType = await RoomType.create({ name: body.name, defaultTariff: body.defaultTariff });
    return { status: 201, body: toPublicRoomType(roomType) };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return nameAlreadyExists;
    }
    throw error;
  }
};

const roomTypeNotFound: Extract<UpdateRoomTypeResponse, { status: 404 }> = {
  status: 404,
  body: { error: { code: 'ROOM_TYPE_NOT_FOUND', message: 'No room type with that id.' } },
};

export const updateRoomType: AppRouteMutationImplementation<typeof contract.updateRoomType> = async ({
  params,
  body,
}) => {
  const update: { name?: string; defaultTariff?: number; active?: boolean } = {};
  if (body.name !== undefined) {
    update.name = body.name;
  }
  if (body.defaultTariff !== undefined) {
    update.defaultTariff = body.defaultTariff;
  }
  if (body.active !== undefined) {
    update.active = body.active;
  }

  try {
    const roomType = await RoomType.findByIdAndUpdate(params.id, update, {
      returnDocument: 'after',
      runValidators: true,
    });

    if (!roomType) {
      return roomTypeNotFound;
    }

    return { status: 200, body: toPublicRoomType(roomType) };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return nameAlreadyExists;
    }
    throw error;
  }
};
