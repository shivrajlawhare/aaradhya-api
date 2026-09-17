import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EventType } from '../../src/models/event-type.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';
import { expectValidationError } from '../support/validation.js';

beforeAll(async () => {
  await connectTestDb();
  await EventType.init();
});

afterEach(clearCollections);

afterAll(disconnectTestDb);

describe('EventType model', () => {
  it('creates an EventType with a name, active true by default', async () => {
    const eventType = await EventType.create({ name: 'Wedding' });

    expect(eventType.name).toBe('Wedding');
    expect(eventType.active).toBe(true);
  });

  it('rejects a document missing name', async () => {
    const error = await expectValidationError(EventType, {});

    expect(error.errors).toHaveProperty('name');
  });

  it('rejects a duplicate active name at the database level', async () => {
    await EventType.create({ name: 'Wedding' });

    await expect(EventType.create({ name: 'Wedding' })).rejects.toThrow();
  });

  it('rejects a duplicate active name that only differs by case', async () => {
    await EventType.create({ name: 'Wedding' });

    await expect(EventType.create({ name: 'wedding' })).rejects.toThrow();
  });

  it('allows reintroducing a name that belongs to a deactivated entry', async () => {
    const original = await EventType.create({ name: 'Wedding' });
    original.active = false;
    await original.save();

    const reintroduced = await EventType.create({ name: 'Wedding' });

    expect(reintroduced.name).toBe('Wedding');
    expect(reintroduced.active).toBe(true);
  });
});
