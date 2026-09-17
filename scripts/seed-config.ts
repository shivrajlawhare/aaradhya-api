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
import { RoomType } from '../src/models/room-type.js';
import { Venue } from '../src/models/venue.js';

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

// Tariffs from example_quatation_1.pdf, as named in this story's own AC.
const ROOM_TYPES = [
  { name: 'Deluxe', defaultTariff: 2500 },
  { name: 'Executive', defaultTariff: 3500 },
  { name: 'Dormitory', defaultTariff: 5000 },
  { name: 'Extra Beds', defaultTariff: 700 },
];

const seedConfig = async (): Promise<void> => {
  await connectToDatabase();

  for (const venue of VENUES) {
    await Venue.findOneAndUpdate(
      { name: venue.name, active: true },
      { ...venue, active: true },
      { returnDocument: 'after', upsert: true, runValidators: true, collation: { locale: 'en', strength: 2 } },
    );
  }

  for (const roomType of ROOM_TYPES) {
    await RoomType.findOneAndUpdate(
      { name: roomType.name, active: true },
      { ...roomType, active: true },
      { returnDocument: 'after', upsert: true, runValidators: true, collation: { locale: 'en', strength: 2 } },
    );
  }

  console.log(`[seed] ready — ${VENUES.length} venues, ${ROOM_TYPES.length} room types`);
  process.exit(0);
};

seedConfig().catch((error) => {
  console.error('[seed] failed', error);
  process.exit(1);
});
