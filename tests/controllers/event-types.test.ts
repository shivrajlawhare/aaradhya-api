import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { EventType } from '../../src/models/event-type.js';
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

const listEventTypesAs = (token: string) => request(app).get('/event-types').set('Authorization', `Bearer ${token}`);

const createEventTypeAs = (token: string, body: object) =>
  request(app).post('/event-types').set('Authorization', `Bearer ${token}`).send(body);

const patchEventTypeAs = (token: string, id: string, body: object) =>
  request(app).patch(`/event-types/${id}`).set('Authorization', `Bearer ${token}`).send(body);

beforeAll(async () => {
  await connectTestDb();
  await EventType.init();
});
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('GET /event-types', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).get('/event-types');

    expect(response.status).toBe(401);
  });

  it.each([Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'allows a caller with role %s',
    async (role) => {
      const token = await seedCaller(role);

      const response = await listEventTypesAs(token);

      expect(response.status).toBe(200);
    },
  );

  it('returns both active and inactive entries', async () => {
    const token = await seedCaller();
    await EventType.create({ name: 'Wedding' });
    await EventType.create({ name: 'Corporate Offsite', active: false });

    const response = await listEventTypesAs(token);

    expect(response.body).toHaveLength(2);
  });
});

describe('POST /event-types', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).post('/event-types').send({ name: 'Wedding' });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const token = await seedCaller(role);

    const response = await createEventTypeAs(token, { name: 'Wedding' });

    expect(response.status).toBe(403);
  });

  it('creates the Event Type and returns it', async () => {
    const token = await seedCaller();

    const response = await createEventTypeAs(token, { name: 'Wedding' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: 'Wedding', active: true });
    expect(typeof response.body.id).toBe('string');
  });

  it('returns 400 when name is missing', async () => {
    const token = await seedCaller();

    const response = await createEventTypeAs(token, {});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409, not a duplicate row, when the active name already exists', async () => {
    const token = await seedCaller();
    await EventType.create({ name: 'Wedding' });

    const response = await createEventTypeAs(token, { name: 'Wedding' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: { code: 'EVENT_TYPE_NAME_TAKEN', message: 'An Event Type with that name already exists.' },
    });
  });

  it('treats name uniqueness as case-insensitive', async () => {
    const token = await seedCaller();
    await EventType.create({ name: 'Wedding' });

    const response = await createEventTypeAs(token, { name: 'wedding' });

    expect(response.status).toBe(409);
  });

  it('allows creating an Event Type whose name belongs only to a deactivated entry', async () => {
    const token = await seedCaller();
    await EventType.create({ name: 'Wedding', active: false });

    const response = await createEventTypeAs(token, { name: 'Wedding' });

    expect(response.status).toBe(201);
  });
});

describe('PATCH /event-types/:id', () => {
  it('returns 401 with no token', async () => {
    const token = await seedCaller();
    const created = await createEventTypeAs(token, { name: 'Wedding' });

    const response = await request(app).patch(`/event-types/${created.body.id}`).send({ active: false });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const managerToken = await seedCaller();
    const created = await createEventTypeAs(managerToken, { name: 'Wedding' });
    const token = await seedCaller(role);

    const response = await patchEventTypeAs(token, created.body.id, { active: false });

    expect(response.status).toBe(403);
  });

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const token = await seedCaller();

    const response = await patchEventTypeAs(token, '507f1f77bcf86cd799439011', { active: false });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'EVENT_TYPE_NOT_FOUND', message: 'No event type with that id.' },
    });
  });

  it('returns 400 for a malformed id', async () => {
    const token = await seedCaller();

    const response = await patchEventTypeAs(token, 'not-an-id', { active: false });

    expect(response.status).toBe(400);
  });

  it('deactivates the Event Type without deleting it', async () => {
    const token = await seedCaller();
    const created = await createEventTypeAs(token, { name: 'Wedding' });

    const response = await patchEventTypeAs(token, created.body.id, { active: false });

    expect(response.status).toBe(200);
    expect(response.body.active).toBe(false);
    const stored = await EventType.findById(created.body.id);
    expect(stored).not.toBeNull();
  });

  it('edits name independently of active', async () => {
    const token = await seedCaller();
    const created = await createEventTypeAs(token, { name: 'Wedding' });

    const response = await patchEventTypeAs(token, created.body.id, { name: 'Hindu Wedding' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: 'Hindu Wedding', active: true });
  });

  it('returns 409 when renaming to a name already active on another Event Type', async () => {
    const token = await seedCaller();
    await createEventTypeAs(token, { name: 'Wedding' });
    const corporate = await createEventTypeAs(token, { name: 'Corporate Offsite' });

    const response = await patchEventTypeAs(token, corporate.body.id, { name: 'Wedding' });

    expect(response.status).toBe(409);
  });
});
