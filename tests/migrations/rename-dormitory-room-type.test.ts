import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FAMILY_ROOM_NAME, renameDormitoryToFamilyRoom } from '../../src/migrations/rename-dormitory-room-type.js';
import { Event } from '../../src/models/event.js';
import { RoomType } from '../../src/models/room-type.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';

beforeAll(async () => {
  await connectTestDb();
  await RoomType.init();
});

afterEach(clearCollections);

afterAll(disconnectTestDb);

// Raw inserts, so the fixtures look like documents saved before DEV-07
// (no occupancy on the Room Type) and skip unrelated Event validation.
const insertEventWithRoomTypes = (roomTypes: string[]) =>
  Event.collection.insertOne({
    eventId: `ARD-EVT-2026-${Math.random().toString(36).slice(2, 6)}`,
    accommodation: {
      roomLines: roomTypes.map((roomType) => ({ roomType, occupancy: 6, tariff: 5000, noOfRooms: 2 })),
    },
  });

const storedRoomLineTypes = async (id: Types.ObjectId) => {
  const event = await Event.collection.findOne({ _id: id });
  return (event?.accommodation?.roomLines ?? []).map((line: { roomType: string }) => line.roomType);
};

describe('renameDormitoryToFamilyRoom (DEV-07)', () => {
  it('renames the master "Dormitory" to "Family Room", giving it occupancy 6 when it had none', async () => {
    await RoomType.collection.insertOne({ name: 'Dormitory', defaultTariff: 5000, active: true });

    const result = await renameDormitoryToFamilyRoom();

    const roomTypes = await RoomType.find();
    expect(result.roomTypesRenamed).toBe(1);
    expect(roomTypes).toHaveLength(1);
    expect(roomTypes[0]).toMatchObject({ name: FAMILY_ROOM_NAME, occupancy: 6, defaultTariff: 5000, active: true });
  });

  it('renames matching Event room lines (case-insensitively) and leaves every other line alone', async () => {
    const first = await insertEventWithRoomTypes(['Deluxe', 'Dormitory', 'Extra Beds']);
    const second = await insertEventWithRoomTypes(['dormitory ']);
    const untouched = await insertEventWithRoomTypes(['Executive']);

    const result = await renameDormitoryToFamilyRoom();

    expect(result.eventsUpdated).toBe(2);
    expect(await storedRoomLineTypes(first.insertedId)).toEqual(['Deluxe', 'Family Room', 'Extra Beds']);
    expect(await storedRoomLineTypes(second.insertedId)).toEqual(['Family Room']);
    expect(await storedRoomLineTypes(untouched.insertedId)).toEqual(['Executive']);
  });

  it('is idempotent — a second run changes nothing', async () => {
    await RoomType.collection.insertOne({ name: 'Dormitory', defaultTariff: 5000, active: true });
    await insertEventWithRoomTypes(['Dormitory']);
    await renameDormitoryToFamilyRoom();

    const second = await renameDormitoryToFamilyRoom();

    expect(second).toEqual({ roomTypesRenamed: 0, eventsUpdated: 0 });
  });

  it('keeps an occupancy that was already set on the renamed Room Type', async () => {
    await RoomType.create({ name: 'Dormitory', occupancy: 8, defaultTariff: 5000 });

    await renameDormitoryToFamilyRoom();

    expect(await RoomType.findOne({ name: FAMILY_ROOM_NAME })).toMatchObject({ occupancy: 8 });
  });

  it('deactivates an active "Dormitory" instead of renaming it when an active "Family Room" already exists', async () => {
    await RoomType.create({ name: 'Family Room', occupancy: 6, defaultTariff: 6000 });
    await RoomType.create({ name: 'Dormitory', occupancy: 6, defaultTariff: 5000 });

    await renameDormitoryToFamilyRoom();

    const active = await RoomType.find({ active: true });
    expect(active.map((roomType) => roomType.name)).toEqual(['Family Room']);
    expect(await RoomType.findOne({ name: 'Dormitory' })).toMatchObject({ active: false });
  });
});
