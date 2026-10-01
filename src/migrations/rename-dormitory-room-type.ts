import { Event } from '../models/event.js';
import { RoomType } from '../models/room-type.js';

// DEV-07 (UI Redesign decision D2 / example_quatation_3.pdf): the room type
// sold as "Dormitory" is now "Family Room" (6 guests per room).
export const DORMITORY_NAME = 'Dormitory';
export const FAMILY_ROOM_NAME = 'Family Room';
export const FAMILY_ROOM_OCCUPANCY = 6;

const DORMITORY_PATTERN = /^\s*dormitory\s*$/i;

export interface RenameDormitoryResult {
  roomTypesRenamed: number;
  eventsUpdated: number;
}

/**
 * One-off data migration (run by scripts/migrate-dev07.ts): renames every
 * stored "Dormitory" Room Type to "Family Room", and every Event room line
 * whose roomType is "Dormitory" likewise, so historical Events and the
 * master agree. Case-insensitive; idempotent (a second run finds nothing).
 *
 * A renamed Room Type still at occupancy 0 (saved before occupancy
 * existed) gets Family Room's 6. If an active "Family Room" already exists,
 * an active "Dormitory" is deactivated instead of renamed, so the active-
 * name uniqueness index never trips. Event room lines keep the occupancy
 * they were saved with.
 */
export const renameDormitoryToFamilyRoom = async (): Promise<RenameDormitoryResult> => {
  const dormitories = await RoomType.find({ name: DORMITORY_PATTERN });
  const hasActiveFamilyRoom =
    (await RoomType.exists({ name: FAMILY_ROOM_NAME, active: true }).collation({ locale: 'en', strength: 2 })) !== null;

  let roomTypesRenamed = 0;
  for (const dormitory of dormitories) {
    if (dormitory.active && hasActiveFamilyRoom) {
      dormitory.active = false;
    } else {
      dormitory.name = FAMILY_ROOM_NAME;
      if (dormitory.occupancy === 0) {
        dormitory.occupancy = FAMILY_ROOM_OCCUPANCY;
      }
    }
    await dormitory.save();
    roomTypesRenamed += 1;
  }

  const eventsResult = await Event.updateMany(
    { 'accommodation.roomLines.roomType': DORMITORY_PATTERN },
    { $set: { 'accommodation.roomLines.$[line].roomType': FAMILY_ROOM_NAME } },
    { arrayFilters: [{ 'line.roomType': DORMITORY_PATTERN }] }
  );

  return { roomTypesRenamed, eventsUpdated: eventsResult.modifiedCount };
};
