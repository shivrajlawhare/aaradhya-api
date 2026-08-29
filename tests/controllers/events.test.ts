import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { ClientContactRole, Event, EventStatus } from '../../src/models/event.js';
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
  return { caller, token: await signSessionToken({ id: caller.id, role: caller.role }) };
};

const seedEventManager = async (overrides: Record<string, unknown> = {}) =>
  User.create({
    name: 'Assigned Manager',
    username: `manager-${Math.random().toString(36).slice(2)}`,
    passwordHash: 'not-used-in-these-tests',
    role: Role.EventManager,
    ...overrides,
  });

const validPayload = (managerId: string, overrides: Record<string, unknown> = {}) => ({
  eventFamilyType: 'Wedding',
  eventManager: managerId,
  clientContacts: [{ name: 'Priya Nair', contactNumber: '9876543210', role: ClientContactRole.Bride }],
  ...overrides,
});

const createEventAs = (token: string, body: object) =>
  request(app).post('/events').set('Authorization', `Bearer ${token}`).send(body);

beforeAll(connectTestDb);
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('POST /events', () => {
  it('returns 401 with no token', async () => {
    const manager = await seedEventManager();

    const response = await request(app).post('/events').send(validPayload(manager.id));

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 403 for a caller with role %s',
    async (role) => {
      const { token } = await seedCaller(role);
      const manager = await seedEventManager();

      const response = await createEventAs(token, validPayload(manager.id));

      expect(response.status).toBe(403);
    },
  );

  it('creates the Event, defaulting status to Tentative and generating an event_id', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(token, validPayload(manager.id));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
    });
    expect(response.body.eventId).toMatch(/^ARD-EVT-\d{4}-\d{3}$/);
    expect(response.body.clientContacts).toEqual([
      { name: 'Priya Nair', contactNumber: '9876543210', role: ClientContactRole.Bride },
    ]);
  });

  it('honors a caller-supplied initial status instead of always defaulting', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(
      token,
      validPayload(manager.id, { status: EventStatus.Confirmed }),
    );

    expect(response.status).toBe(201);
    expect(response.body.status).toBe(EventStatus.Confirmed);
  });

  it('sets created_by from the authenticated caller, ignoring any value in the body', async () => {
    const { caller, token } = await seedCaller();
    const manager = await seedEventManager();
    const someoneElse = await seedEventManager();

    const response = await createEventAs(
      token,
      validPayload(manager.id, { createdBy: someoneElse.id }),
    );

    expect(response.status).toBe(201);
    expect(response.body.createdBy).toBe(caller.id);
    expect(response.body.createdBy).not.toBe(someoneElse.id);
  });

  it('persists the Event via STORY-011s schema', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(token, validPayload(manager.id));

    const stored = await Event.findById(response.body.id);
    expect(stored).not.toBeNull();
    expect(stored?.eventId).toBe(response.body.eventId);
  });

  it('returns 400 for zero client_contacts rows', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(token, validPayload(manager.id, { clientContacts: [] }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'clientContacts' })]),
    );
  });

  it('returns 400 when a client_contacts row has an empty name', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(
      token,
      validPayload(manager.id, {
        clientContacts: [{ name: '', contactNumber: '9876543210', role: ClientContactRole.Bride }],
      }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when a client_contacts row is missing contactNumber', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(
      token,
      validPayload(manager.id, {
        clientContacts: [{ name: 'Priya Nair', role: ClientContactRole.Bride }],
      }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['eventFamilyType', 'eventManager', 'clientContacts'])(
    'returns 400 listing %s when it is missing',
    async (field) => {
      const { token } = await seedCaller();
      const manager = await seedEventManager();
      const payload: Record<string, unknown> = { ...validPayload(manager.id) };
      delete payload[field];

      const response = await createEventAs(token, payload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('returns 400 for a malformed event_manager id', async () => {
    const { token } = await seedCaller();

    const response = await createEventAs(token, validPayload('not-an-id'));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when event_manager references a nonexistent User Account', async () => {
    const { token } = await seedCaller();

    const response = await createEventAs(token, validPayload('507f1f77bcf86cd799439011'));

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'eventManager' })]),
    );
  });

  it('returns 400 when event_manager references a User whose role is not EventManager', async () => {
    const { token } = await seedCaller();
    const nonManager = await User.create({
      name: 'FnB Head',
      username: 'fnb-head',
      passwordHash: 'not-used-in-these-tests',
      role: Role.FnBHead,
    });

    const response = await createEventAs(token, validPayload(nonManager.id));

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'eventManager' })]),
    );
  });

  it('allows assigning event_manager to a User account that is currently deactivated', async () => {
    const { token } = await seedCaller();
    const inactiveManager = await seedEventManager({ active: false });

    const response = await createEventAs(token, validPayload(inactiveManager.id));

    expect(response.status).toBe(201);
    expect(response.body.eventManager).toBe(inactiveManager.id);
  });
});
