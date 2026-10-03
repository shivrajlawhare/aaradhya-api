import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { convertLegacyExtrasToLineItems } from '../../src/migrations/convert-legacy-extras.js';
import { Event } from '../../src/models/event.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';

beforeAll(connectTestDb);

afterEach(clearCollections);

afterAll(disconnectTestDb);

// Raw inserts, so the fixtures look like documents saved before v2.2.0 and
// skip unrelated Event validation.
const insertEvent = (extras: Record<string, number>, extraLineItems: object[] = []) =>
  Event.collection.insertOne({
    eventId: `ARD-EVT-2026-${Math.random().toString(36).slice(2, 6)}`,
    extras,
    extraLineItems,
  });

const storedEvent = async (id: Types.ObjectId) => Event.collection.findOne({ _id: id });

describe('convertLegacyExtrasToLineItems (v2.2.0, V1)', () => {
  it('turns every non-zero extra into a line item of that name, after the existing ones, and zeroes the extras', async () => {
    const { insertedId } = await insertEvent({ decoration: 115000, photographer: 0, bhatji: 7000 }, [
      { name: 'DJ + Sound System', note: 'Sangeet night', amount: 30000 },
    ]);

    const result = await convertLegacyExtrasToLineItems();

    expect(result).toEqual({ eventsUpdated: 1, lineItemsAdded: 2 });
    const event = await storedEvent(insertedId);
    expect(event?.extraLineItems).toEqual([
      { name: 'DJ + Sound System', note: 'Sangeet night', amount: 30000 },
      expect.objectContaining({ name: 'Decoration', amount: 115000 }),
      expect.objectContaining({ name: 'Bhatji', amount: 7000 }),
    ]);
    expect(event?.extraLineItems[1]).not.toHaveProperty('note');
    expect(event?.extras).toEqual({ decoration: 0, photographer: 0, bhatji: 0 });
  });

  it('converts all three in Decoration, Photographer, Bhatji order', async () => {
    const { insertedId } = await insertEvent({ decoration: 1000, photographer: 2000, bhatji: 3000 });

    await convertLegacyExtrasToLineItems();

    const event = await storedEvent(insertedId);
    expect(event?.extraLineItems.map((item: { name: string }) => item.name)).toEqual([
      'Decoration',
      'Photographer',
      'Bhatji',
    ]);
  });

  it('leaves an Event with all-zero extras untouched', async () => {
    const { insertedId } = await insertEvent({ decoration: 0, photographer: 0, bhatji: 0 }, [
      { name: 'Decoration', amount: 50000 },
    ]);

    const result = await convertLegacyExtrasToLineItems();

    expect(result).toEqual({ eventsUpdated: 0, lineItemsAdded: 0 });
    expect((await storedEvent(insertedId))?.extraLineItems).toEqual([{ name: 'Decoration', amount: 50000 }]);
  });

  it('is idempotent — a second run adds nothing', async () => {
    const { insertedId } = await insertEvent({ decoration: 15000, photographer: 0, bhatji: 0 });
    await convertLegacyExtrasToLineItems();

    const second = await convertLegacyExtrasToLineItems();

    expect(second).toEqual({ eventsUpdated: 0, lineItemsAdded: 0 });
    expect((await storedEvent(insertedId))?.extraLineItems).toHaveLength(1);
  });
});
