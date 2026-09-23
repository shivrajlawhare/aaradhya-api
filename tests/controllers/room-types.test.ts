import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { RoomType } from '../../src/models/room-type.js';
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

const listRoomTypesAs = (token: string) => request(app).get('/room-types').set('Authorization', `Bearer ${token}`);

const createRoomTypeAs = (token: string, body: object) =>
  request(app).post('/room-types').set('Authorization', `Bearer ${token}`).send(body);

const patchRoomTypeAs = (token: string, id: string, body: object) =>
  request(app).patch(`/room-types/${id}`).set('Authorization', `Bearer ${token}`).send(body);

beforeAll(async () => {
  await connectTestDb();
  await RoomType.init();
});
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('GET /room-types', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).get('/room-types');

    expect(response.status).toBe(401);
  });

  it.each([Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'allows a caller with role %s',
    async (role) => {
      const token = await seedCaller(role);

      const response = await listRoomTypesAs(token);

      expect(response.status).toBe(200);
    }
  );

  it('returns both active and inactive entries', async () => {
    const token = await seedCaller();
    await RoomType.create({ name: 'Deluxe', defaultTariff: 2500 });
    await RoomType.create({ name: 'Dormitory', defaultTariff: 5000, active: false });

    const response = await listRoomTypesAs(token);

    expect(response.body).toHaveLength(2);
  });
});

describe('POST /room-types', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).post('/room-types').send({ name: 'Deluxe', defaultTariff: 2500 });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const token = await seedCaller(role);

    const response = await createRoomTypeAs(token, { name: 'Deluxe', defaultTariff: 2500 });

    expect(response.status).toBe(403);
  });

  it('creates the Room Type and returns it', async () => {
    const token = await seedCaller();

    const response = await createRoomTypeAs(token, { name: 'Deluxe', defaultTariff: 2500 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: 'Deluxe', defaultTariff: 2500, active: true });
    expect(typeof response.body.id).toBe('string');
  });

  it('returns 400 when defaultTariff is missing', async () => {
    const token = await seedCaller();

    const response = await createRoomTypeAs(token, { name: 'Deluxe' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a negative defaultTariff', async () => {
    const token = await seedCaller();

    const response = await createRoomTypeAs(token, { name: 'Deluxe', defaultTariff: -1 });

    expect(response.status).toBe(400);
  });

  it('returns 409, not a duplicate row, when the active name already exists', async () => {
    const token = await seedCaller();
    await RoomType.create({ name: 'Deluxe', defaultTariff: 2500 });

    const response = await createRoomTypeAs(token, { name: 'Deluxe', defaultTariff: 2500 });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: { code: 'ROOM_TYPE_NAME_TAKEN', message: 'A Room Type with that name already exists.' },
    });
  });

  it('treats name uniqueness as case-insensitive', async () => {
    const token = await seedCaller();
    await RoomType.create({ name: 'Deluxe', defaultTariff: 2500 });

    const response = await createRoomTypeAs(token, { name: 'deluxe', defaultTariff: 2500 });

    expect(response.status).toBe(409);
  });

  it('allows creating a Room Type whose name belongs only to a deactivated entry', async () => {
    const token = await seedCaller();
    await RoomType.create({ name: 'Deluxe', defaultTariff: 2500, active: false });

    const response = await createRoomTypeAs(token, { name: 'Deluxe', defaultTariff: 2800 });

    expect(response.status).toBe(201);
  });
});

describe('PATCH /room-types/:id', () => {
  it('returns 401 with no token', async () => {
    const token = await seedCaller();
    const created = await createRoomTypeAs(token, { name: 'Deluxe', defaultTariff: 2500 });

    const response = await request(app).patch(`/room-types/${created.body.id}`).send({ active: false });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const managerToken = await seedCaller();
    const created = await createRoomTypeAs(managerToken, { name: 'Deluxe', defaultTariff: 2500 });
    const token = await seedCaller(role);

    const response = await patchRoomTypeAs(token, created.body.id, { active: false });

    expect(response.status).toBe(403);
  });

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const token = await seedCaller();

    const response = await patchRoomTypeAs(token, '507f1f77bcf86cd799439011', { active: false });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'ROOM_TYPE_NOT_FOUND', message: 'No room type with that id.' },
    });
  });

  it('returns 400 for a malformed id', async () => {
    const token = await seedCaller();

    const response = await patchRoomTypeAs(token, 'not-an-id', { active: false });

    expect(response.status).toBe(400);
  });

  it('deactivates the Room Type without deleting it', async () => {
    const token = await seedCaller();
    const created = await createRoomTypeAs(token, { name: 'Deluxe', defaultTariff: 2500 });

    const response = await patchRoomTypeAs(token, created.body.id, { active: false });

    expect(response.status).toBe(200);
    expect(response.body.active).toBe(false);
    const stored = await RoomType.findById(created.body.id);
    expect(stored).not.toBeNull();
  });

  it('edits name and defaultTariff independently of active', async () => {
    const token = await seedCaller();
    const created = await createRoomTypeAs(token, { name: 'Deluxe', defaultTariff: 2500 });

    const response = await patchRoomTypeAs(token, created.body.id, { name: 'Deluxe Suite', defaultTariff: 2800 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: 'Deluxe Suite', defaultTariff: 2800, active: true });
  });

  it('returns 409 when renaming to a name already active on another Room Type', async () => {
    const token = await seedCaller();
    await createRoomTypeAs(token, { name: 'Deluxe', defaultTariff: 2500 });
    const dormitory = await createRoomTypeAs(token, { name: 'Dormitory', defaultTariff: 5000 });

    const response = await patchRoomTypeAs(token, dormitory.body.id, { name: 'Deluxe' });

    expect(response.status).toBe(409);
  });
});
