import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MenuItem } from '../../src/models/menu-item.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';
import { expectValidationError } from '../support/validation.js';

beforeAll(async () => {
  await connectTestDb();
  // Builds the collation-based unique index — needed for the
  // case-insensitive-duplicate tests below to actually exercise it.
  await MenuItem.init();
});

afterEach(clearCollections);

afterAll(disconnectTestDb);

describe('MenuItem model', () => {
  it('creates a Menu Item with a name and default_cost_per_plate', async () => {
    const item = await MenuItem.create({ name: 'Paneer Tikka', defaultCostPerPlate: 250 });

    expect(item.name).toBe('Paneer Tikka');
    expect(item.defaultCostPerPlate).toBe(250);
  });

  it('defaults default_cost_per_plate to 0 when not supplied', async () => {
    const item = await MenuItem.create({ name: 'Paneer Tikka' });

    expect(item.defaultCostPerPlate).toBe(0);
  });

  it('rejects a document missing name', async () => {
    const error = await expectValidationError(MenuItem, { defaultCostPerPlate: 100 });

    expect(error.errors).toHaveProperty('name');
  });

  it('rejects a negative default_cost_per_plate', async () => {
    const error = await expectValidationError(MenuItem, { name: 'Paneer Tikka', defaultCostPerPlate: -1 });

    expect(error.errors).toHaveProperty('defaultCostPerPlate');
  });

  it('rejects a duplicate name at the database level', async () => {
    await MenuItem.create({ name: 'Paneer Tikka' });

    await expect(MenuItem.create({ name: 'Paneer Tikka' })).rejects.toThrow();
  });

  it('rejects a duplicate name that only differs by case', async () => {
    await MenuItem.create({ name: 'Paneer Tikka' });

    await expect(MenuItem.create({ name: 'paneer tikka' })).rejects.toThrow();
  });
});
