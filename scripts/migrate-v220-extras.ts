/**
 * v2.2.0 one-off migration (DEV-20, UI Redesign V1): every Event's non-zero
 * fixed extras (Decoration / Photographer / Bhatji) become extra line items,
 * then the fixed extras are reset to 0.
 *
 * Usage:
 *   npm run migrate:v220
 *
 * Idempotent — safe to re-run. Run it once per environment when deploying
 * v2.2.0 (the API no longer reads the fixed extras).
 */
import { connectToDatabase } from '../src/db.js';
import { convertLegacyExtrasToLineItems } from '../src/migrations/convert-legacy-extras.js';

const migrate = async (): Promise<void> => {
  await connectToDatabase();
  const { eventsUpdated, lineItemsAdded } = await convertLegacyExtrasToLineItems();
  console.log(`[migrate:v220] done — ${eventsUpdated} events updated, ${lineItemsAdded} line items added`);
  process.exit(0);
};

migrate().catch((error) => {
  console.error('[migrate:v220] failed', error);
  process.exit(1);
});
