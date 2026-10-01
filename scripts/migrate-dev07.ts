/**
 * DEV-07 one-off migration: "Dormitory" → "Family Room", in the Room Type
 * master and in every Event's accommodation room lines.
 *
 * Usage:
 *   npm run migrate:dev07
 *
 * Idempotent — safe to re-run. Run it once per environment before (or
 * alongside) `npm run seed:config`.
 */
import { connectToDatabase } from '../src/db.js';
import { renameDormitoryToFamilyRoom } from '../src/migrations/rename-dormitory-room-type.js';

const migrate = async (): Promise<void> => {
  await connectToDatabase();
  const { roomTypesRenamed, eventsUpdated } = await renameDormitoryToFamilyRoom();
  console.log(`[migrate:dev07] done — ${roomTypesRenamed} room types, ${eventsUpdated} events updated`);
  process.exit(0);
};

migrate().catch((error) => {
  console.error('[migrate:dev07] failed', error);
  process.exit(1);
});
