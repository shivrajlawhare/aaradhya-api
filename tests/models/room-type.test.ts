import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RoomType } from '../../src/models/room-type.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';
import { expectValidationError } from '../support/validation.js';

beforeAll(async () => {
  await connectTestDb();
  await RoomType.init();
});

afterEach(clearCollections);

afterAll(disconnectTestDb);

describe('RoomType model', () => {
  it('creates a RoomType with a name and defaultTariff, active true by default', async () => {
    const roomType = await RoomType.create({ name: 'Deluxe', defaultTariff: 2500 });

    expect(roomType.name).toBe('Deluxe');
    expect(roomType.defaultTariff).toBe(2500);
    expect(roomType.active).toBe(true);
  });

  it('rejects a document missing name', async () => {
    const error = await expectValidationError(RoomType, { defaultTariff: 100 });

    expect(error.errors).toHaveProperty('name');
  });

  it('rejects a document missing defaultTariff', async () => {
    const error = await expectValidationError(RoomType, { name: 'Deluxe' });

    expect(error.errors).toHaveProperty('defaultTariff');
  });

  it('rejects a negative defaultTariff', async () => {
    const error = await expectValidationError(RoomType, { name: 'Deluxe', defaultTariff: -1 });

    expect(error.errors).toHaveProperty('defaultTariff');
  });

  it('rejects a duplicate active name at the database level', async () => {
    await RoomType.create({ name: 'Deluxe', defaultTariff: 2500 });

    await expect(RoomType.create({ name: 'Deluxe', defaultTariff: 2500 })).rejects.toThrow();
  });

  it('rejects a duplicate active name that only differs by case', async () => {
    await RoomType.create({ name: 'Deluxe', defaultTariff: 2500 });

    await expect(RoomType.create({ name: 'deluxe', defaultTariff: 2500 })).rejects.toThrow();
  });

  it('allows reintroducing a name that belongs to a deactivated entry', async () => {
    const original = await RoomType.create({ name: 'Deluxe', defaultTariff: 2500 });
    original.active = false;
    await original.save();

    const reintroduced = await RoomType.create({ name: 'Deluxe', defaultTariff: 2800 });

    expect(reintroduced.name).toBe('Deluxe');
    expect(reintroduced.active).toBe(true);
  });
});
