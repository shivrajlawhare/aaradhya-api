import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Venue } from '../../src/models/venue.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';
import { expectValidationError } from '../support/validation.js';

beforeAll(async () => {
  await connectTestDb();
  await Venue.init();
});

afterEach(clearCollections);

afterAll(disconnectTestDb);

describe('Venue model', () => {
  it('creates a Venue with a name and defaultVenueCost, active true by default', async () => {
    const venue = await Venue.create({ name: 'Poolside', defaultVenueCost: 60000 });

    expect(venue.name).toBe('Poolside');
    expect(venue.defaultVenueCost).toBe(60000);
    expect(venue.active).toBe(true);
  });

  it('rejects a document missing name', async () => {
    const error = await expectValidationError(Venue, { defaultVenueCost: 100 });

    expect(error.errors).toHaveProperty('name');
  });

  it('rejects a document missing defaultVenueCost', async () => {
    const error = await expectValidationError(Venue, { name: 'Poolside' });

    expect(error.errors).toHaveProperty('defaultVenueCost');
  });

  it('rejects a negative defaultVenueCost', async () => {
    const error = await expectValidationError(Venue, { name: 'Poolside', defaultVenueCost: -1 });

    expect(error.errors).toHaveProperty('defaultVenueCost');
  });

  it('rejects a duplicate active name at the database level', async () => {
    await Venue.create({ name: 'Poolside', defaultVenueCost: 60000 });

    await expect(Venue.create({ name: 'Poolside', defaultVenueCost: 60000 })).rejects.toThrow();
  });

  it('rejects a duplicate active name that only differs by case', async () => {
    await Venue.create({ name: 'Poolside', defaultVenueCost: 60000 });

    await expect(Venue.create({ name: 'poolside', defaultVenueCost: 60000 })).rejects.toThrow();
  });

  it('allows reintroducing a name that belongs to a deactivated entry', async () => {
    const original = await Venue.create({ name: 'Poolside', defaultVenueCost: 60000 });
    original.active = false;
    await original.save();

    const reintroduced = await Venue.create({ name: 'Poolside', defaultVenueCost: 65000 });

    expect(reintroduced.name).toBe('Poolside');
    expect(reintroduced.active).toBe(true);
  });
});
