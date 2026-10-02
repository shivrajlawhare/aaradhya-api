/**
 * Local/dev convenience — pre-populates the Venue and Room Type master
 * lists (STORY-061's own AC) so the Session wizard and Settings screen have
 * real data on first run instead of an empty state, before anyone has used
 * Settings (STORY-062) to add entries by hand.
 *
 * Usage:
 *   npm run seed:config
 *
 * Safe to re-run: an existing (case-insensitive, active) name has its
 * default cost reset rather than failing on the uniqueness constraint.
 */
import { connectToDatabase } from '../src/db.js';
import { renameDormitoryToFamilyRoom } from '../src/migrations/rename-dormitory-room-type.js';
import { RoomType } from '../src/models/room-type.js';
import { Venue } from '../src/models/venue.js';
import { getOrSeedOneDayEventTemplate } from '../src/services/one-day-event-template.js';

// Poolside/Half Banquet/Full Banquet costs are this story's own AC values,
// taken from the reference quotations. "Lawn" isn't named in those
// quotations but is the venue used throughout the rest of this codebase's
// own fixtures/tests — seeded here too so it isn't the one dropdown entry
// missing on first run.
const VENUES = [
  { name: 'Poolside', defaultVenueCost: 60000 },
  { name: 'Half Banquet', defaultVenueCost: 60000 },
  { name: 'Full Banquet', defaultVenueCost: 120000 },
  { name: 'Lawn', defaultVenueCost: 50000 },
];

// DEV-07 (D2, example_quatation_3.pdf): names, occupancy (guests per room)
// and tariffs. "Deluxe" is now "Delux" and "Dormitory" is "Family Room".
const ROOM_TYPES = [
  { name: 'Delux', occupancy: 2, defaultTariff: 2800 },
  { name: 'Executive', occupancy: 3, defaultTariff: 3800 },
  { name: 'Family Room', occupancy: 6, defaultTariff: 6000 },
  { name: 'Extra Beds', occupancy: 0, defaultTariff: 700 },
];

// Earlier seeds' names, renamed in place so a re-seed doesn't leave the old
// name active beside the new one. Dormitory → Family Room also renames
// Event room lines (the DEV-07 migration); Deluxe → Delux is the master only.
const renameLegacyRoomTypes = async (): Promise<void> => {
  await renameDormitoryToFamilyRoom();
  const hasDelux = (await RoomType.exists({ name: 'Delux', active: true })) !== null;
  if (!hasDelux) {
    await RoomType.updateOne({ name: 'Deluxe', active: true }, { name: 'Delux' });
  }
};

const seedConfig = async (): Promise<void> => {
  await connectToDatabase();

  for (const venue of VENUES) {
    await Venue.findOneAndUpdate(
      { name: venue.name, active: true },
      { ...venue, active: true },
      { returnDocument: 'after', upsert: true, runValidators: true, collation: { locale: 'en', strength: 2 } }
    );
  }

  await renameLegacyRoomTypes();
  for (const roomType of ROOM_TYPES) {
    await RoomType.findOneAndUpdate(
      { name: roomType.name, active: true },
      { ...roomType, active: true },
      { returnDocument: 'after', upsert: true, runValidators: true, collation: { locale: 'en', strength: 2 } }
    );
  }

  // DEV-11 (D1): the One Day Event template, with example 4's values and
  // any of its Menu Items the master is missing. An existing (possibly
  // edited) template is left as it is.
  await getOrSeedOneDayEventTemplate();

  console.log(`[seed] ready — ${VENUES.length} venues, ${ROOM_TYPES.length} room types, One Day Event template`);
  process.exit(0);
};

seedConfig().catch((error) => {
  console.error('[seed] failed', error);
  process.exit(1);
});
