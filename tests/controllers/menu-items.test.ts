import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MenuItem } from '../../src/models/menu-item.js';
import { Role, User } from '../../src/models/user.js';
import { signSessionToken } from '../../src/services/token.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';

const app = createApp();

const seedCaller = async (role: Role = Role.EventManager) => {
  const caller = await User.create({
    name: 'Caller',
    username: `caller-${role.toLowerCase()}`,
    passwordHash: 'not-used-in-these-tests',
    role,
  });
  return signSessionToken({ id: caller.id, role: caller.role });
};

const listMenuItemsAs = (token: string, search?: string) =>
  request(app)
    .get('/menu-items')
    .query(search === undefined ? {} : { search })
    .set('Authorization', `Bearer ${token}`);

const createMenuItemAs = (token: string, body: object) =>
  request(app).post('/menu-items').set('Authorization', `Bearer ${token}`).send(body);

beforeAll(async () => {
  await connectTestDb();
  await MenuItem.init();
});
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('GET /menu-items', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).get('/menu-items');

    expect(response.status).toBe(401);
  });

  it.each([Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'allows a caller with role %s — search is not gated by role',
    async (role) => {
      const token = await seedCaller(role);

      const response = await listMenuItemsAs(token);

      expect(response.status).toBe(200);
    },
  );

  it('returns the full list when search is omitted', async () => {
    const token = await seedCaller();
    await MenuItem.create({ name: 'Paneer Tikka' });
    await MenuItem.create({ name: 'Gulab Jamun' });

    const response = await listMenuItemsAs(token);

    expect(response.body).toHaveLength(2);
  });

  it('returns the full list when search is an empty string', async () => {
    const token = await seedCaller();
    await MenuItem.create({ name: 'Paneer Tikka' });
    await MenuItem.create({ name: 'Gulab Jamun' });

    const response = await listMenuItemsAs(token, '');

    expect(response.body).toHaveLength(2);
  });

  it('matches a case-insensitive substring', async () => {
    const token = await seedCaller();
    await MenuItem.create({ name: 'Paneer Tikka' });
    await MenuItem.create({ name: 'Gulab Jamun' });

    const response = await listMenuItemsAs(token, 'PANEER');

    expect(response.body).toHaveLength(1);
    expect(response.body[0]?.name).toBe('Paneer Tikka');
  });

  it('treats the search term as a literal substring, not a regex pattern', async () => {
    const token = await seedCaller();
    await MenuItem.create({ name: 'Gulab Jamun' });

    const response = await listMenuItemsAs(token, 'Gulab.Jamun');

    expect(response.body).toHaveLength(0);
  });

  it('returns no results for a search that matches nothing', async () => {
    const token = await seedCaller();
    await MenuItem.create({ name: 'Paneer Tikka' });

    const response = await listMenuItemsAs(token, 'biryani');

    expect(response.body).toEqual([]);
  });
});

describe('POST /menu-items', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).post('/menu-items').send({ name: 'Paneer Tikka' });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'allows a caller with role %s — adding is not gated to EventManager',
    async (role) => {
      const token = await seedCaller(role);

      const response = await createMenuItemAs(token, { name: `Item by ${role}` });

      expect(response.status).toBe(201);
    },
  );

  it('creates the Menu Item and returns it', async () => {
    const token = await seedCaller();

    const response = await createMenuItemAs(token, { name: 'Paneer Tikka', defaultCostPerPlate: 250 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: 'Paneer Tikka', defaultCostPerPlate: 250 });
    expect(typeof response.body.id).toBe('string');
  });

  it('defaults default_cost_per_plate to 0 when omitted', async () => {
    const token = await seedCaller();

    const response = await createMenuItemAs(token, { name: 'Paneer Tikka' });

    expect(response.status).toBe(201);
    expect(response.body.defaultCostPerPlate).toBe(0);
  });

  it('returns 409, not a duplicate row, when the name already exists', async () => {
    const token = await seedCaller();
    await MenuItem.create({ name: 'Paneer Tikka' });

    const response = await createMenuItemAs(token, { name: 'Paneer Tikka' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: { code: 'MENU_ITEM_NAME_TAKEN', message: 'A Menu Item with that name already exists.' },
    });
    const count = await MenuItem.countDocuments();
    expect(count).toBe(1);
  });

  it('treats name uniqueness as case-insensitive', async () => {
    const token = await seedCaller();
    await MenuItem.create({ name: 'Paneer Tikka' });

    const response = await createMenuItemAs(token, { name: 'paneer tikka' });

    expect(response.status).toBe(409);
  });

  it('returns 400 when name is missing', async () => {
    const token = await seedCaller();

    const response = await createMenuItemAs(token, { defaultCostPerPlate: 100 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a negative default_cost_per_plate', async () => {
    const token = await seedCaller();

    const response = await createMenuItemAs(token, { name: 'Paneer Tikka', defaultCostPerPlate: -1 });

    expect(response.status).toBe(400);
  });
});
