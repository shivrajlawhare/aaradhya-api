import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { ChangeLogEntry } from '../../src/models/change-log-entry.js';
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

const listEventsAs = (token: string) =>
  request(app).get('/events').set('Authorization', `Bearer ${token}`);

const getEventAs = (token: string, id: string) =>
  request(app).get(`/events/${id}`).set('Authorization', `Bearer ${token}`);

const patchEventAs = (token: string, id: string, body: object) =>
  request(app).patch(`/events/${id}`).set('Authorization', `Bearer ${token}`).send(body);

const patchAccommodationAs = (token: string, id: string, body: object) =>
  request(app).patch(`/events/${id}/accommodation`).set('Authorization', `Bearer ${token}`).send(body);

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

describe('GET /events', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).get('/events');

    expect(response.status).toBe(401);
  });

  it.each([Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 200 for any authenticated role (%s) — no role restriction yet',
    async (role) => {
      const { token } = await seedCaller(role);

      const response = await listEventsAs(token);

      expect(response.status).toBe(200);
    },
  );

  it('returns every Event with its core fields', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    await createEventAs(token, validPayload(manager.id));
    await createEventAs(token, validPayload(manager.id, { eventFamilyType: 'Corporate Offsite' }));

    const response = await listEventsAs(token);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(2);
    expect(response.body.map((event: { eventFamilyType: string }) => event.eventFamilyType).sort()).toEqual(
      ['Corporate Offsite', 'Wedding'],
    );
    for (const event of response.body) {
      expect(event).toMatchObject({
        id: expect.any(String),
        eventId: expect.stringMatching(/^ARD-EVT-\d{4}-\d{3}$/),
        status: EventStatus.Tentative,
        eventManager: manager.id,
      });
    }
  });

  it('returns an empty array, not a 404, when no Events exist', async () => {
    const { token } = await seedCaller();

    const response = await listEventsAs(token);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe('GET /events/:id', () => {
  it('returns 401 with no token', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await request(app).get(`/events/${created.body.id}`);

    expect(response.status).toBe(401);
  });

  it.each([Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 200 for any authenticated role (%s) — no role restriction yet',
    async (role) => {
      const manager = await seedEventManager();
      const creatorToken = await signSessionToken({ id: manager.id, role: manager.role });
      const created = await createEventAs(creatorToken, validPayload(manager.id));
      const { token } = await seedCaller(role);

      const response = await getEventAs(token, created.body.id);

      expect(response.status).toBe(200);
    },
  );

  it('returns the Event matching the given id', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await getEventAs(token, created.body.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(created.body);
  });

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const { token } = await seedCaller();

    const response = await getEventAs(token, '507f1f77bcf86cd799439011');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' },
    });
  });

  it('returns 400, not 500, for a malformed id', async () => {
    const { token } = await seedCaller();

    const response = await getEventAs(token, 'not-an-id');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('PATCH /events/:id', () => {
  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));

    const response = await request(app)
      .patch(`/events/${created.body.id}`)
      .send({ status: EventStatus.Confirmed });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 403 for a caller with role %s',
    async (role) => {
      const { token: creatorToken } = await seedCaller();
      const manager = await seedEventManager();
      const created = await createEventAs(creatorToken, validPayload(manager.id));
      const { token } = await seedCaller(role);

      const response = await patchEventAs(token, created.body.id, { status: EventStatus.Confirmed });

      expect(response.status).toBe(403);
    },
  );

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const { token } = await seedCaller();

    const response = await patchEventAs(token, '507f1f77bcf86cd799439011', {
      status: EventStatus.Confirmed,
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' },
    });
  });

  it('returns 400 for a malformed id', async () => {
    const { token } = await seedCaller();

    const response = await patchEventAs(token, 'not-an-id', { status: EventStatus.Confirmed });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('changes status to Cancelled from any prior status, reflected on the next GET', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id, { status: EventStatus.Confirmed }));

    const patchResponse = await patchEventAs(token, created.body.id, { status: EventStatus.Cancelled });
    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.status).toBe(EventStatus.Cancelled);

    const getResponse = await getEventAs(token, created.body.id);
    expect(getResponse.body.status).toBe(EventStatus.Cancelled);
  });

  it('writes exactly one Change Log Entry with the correct field/oldValue/newValue for a single-field edit', async () => {
    const { caller, token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchEventAs(token, created.body.id, { eventFamilyType: 'Corporate Offsite' });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      field: 'eventFamilyType',
      oldValue: 'Wedding',
      newValue: 'Corporate Offsite',
      changedBy: caller.id,
    });
  });

  it('writes one Change Log Entry per changed field when several fields are edited at once', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const otherManager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchEventAs(token, created.body.id, {
      status: EventStatus.Confirmed,
      eventManager: otherManager.id,
    });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries.map((entry) => entry.field).sort()).toEqual(['eventManager', 'status']);
  });

  it('writes a Change Log Entry for the full before/after client_contacts array when a row is added', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const newContacts = [
      { name: 'Priya Nair', contactNumber: '9876543210', role: ClientContactRole.Bride },
      { name: 'Rohan Nair', contactNumber: '9123456780', role: ClientContactRole.Groom },
    ];
    const response = await patchEventAs(token, created.body.id, { clientContacts: newContacts });

    expect(response.status).toBe(200);
    expect(response.body.clientContacts).toEqual(newContacts);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    if (!entry) {
      throw new Error('expected exactly one Change Log Entry');
    }
    expect(entry.field).toBe('clientContacts');
    expect(entry.oldValue).toEqual([
      { name: 'Priya Nair', contactNumber: '9876543210', role: ClientContactRole.Bride },
    ]);
    expect(entry.newValue).toEqual(newContacts);
  });

  it('rejects removing the last remaining Client Contact row with 400', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchEventAs(token, created.body.id, { clientContacts: [] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries).toHaveLength(0);
  });

  it('writes no Change Log Entry for a PATCH that resubmits identical values', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchEventAs(token, created.body.id, {
      eventFamilyType: 'Wedding',
      eventManager: manager.id,
    });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries).toHaveLength(0);
  });

  it('returns 400 when event_manager is changed to reference a nonexistent User Account', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchEventAs(token, created.body.id, {
      eventManager: '507f1f77bcf86cd799439011',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'eventManager' })]),
    );
    const stored = await Event.findById(created.body.id);
    expect(stored?.eventManager.toString()).toBe(manager.id);
  });

  it('returns 400 when event_manager is changed to reference a User whose role is not EventManager', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const nonManager = await User.create({
      name: 'FnB Head',
      username: 'fnb-head',
      passwordHash: 'not-used-in-these-tests',
      role: Role.FnBHead,
    });

    const response = await patchEventAs(token, created.body.id, { eventManager: nonManager.id });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'eventManager' })]),
    );
  });
});

describe('PATCH /events/:id/accommodation', () => {
  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));

    const response = await request(app)
      .patch(`/events/${created.body.id}/accommodation`)
      .send({ roomLines: [] });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 403 for a caller with role %s',
    async (role) => {
      const { token: creatorToken } = await seedCaller();
      const manager = await seedEventManager();
      const created = await createEventAs(creatorToken, validPayload(manager.id));
      const { token } = await seedCaller(role);

      const response = await patchAccommodationAs(token, created.body.id, { roomLines: [] });

      expect(response.status).toBe(403);
    },
  );

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const { token } = await seedCaller();

    const response = await patchAccommodationAs(token, '507f1f77bcf86cd799439011', { roomLines: [] });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' },
    });
  });

  it('returns 400 for a malformed id', async () => {
    const { token } = await seedCaller();

    const response = await patchAccommodationAs(token, 'not-an-id', { roomLines: [] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('sets check_in/check_out and room_lines, returning freshly computed derived fields', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchAccommodationAs(token, created.body.id, {
      checkIn: '2026-06-15T00:00:00.000Z',
      checkOut: '2026-06-16T00:00:00.000Z',
      roomLines: [
        { roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 2 },
        { roomType: 'Suite', occupancy: 4, tariff: 12000, noOfRooms: 1 },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.totalDays).toBe(2);
    expect(response.body.totalOccupancy).toBe(8); // (2*2) + (4*1)
    // Double: 5000*2*1.18=11800; Suite: 12000*1*1.18=14160; sum=25960.
    expect(response.body.totalCharges).toBe(25960);
    expect(response.body.roomLines).toEqual([
      { roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 2, totalInclGst: 11800 },
      { roomType: 'Suite', occupancy: 4, tariff: 12000, noOfRooms: 1, totalInclGst: 14160 },
    ]);
  });

  it('allows room_lines as an empty array — totals compute to zero, not an error', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchAccommodationAs(token, created.body.id, { roomLines: [] });

    expect(response.status).toBe(200);
    expect(response.body.roomLines).toEqual([]);
    expect(response.body.totalOccupancy).toBe(0);
    expect(response.body.totalCharges).toBe(0);
  });

  it('ignores a submitted total_charges (or any other derived field) — response always reflects the server-computed value', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchAccommodationAs(token, created.body.id, {
      roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 1 }],
      totalCharges: 999999,
      totalOccupancy: 999999,
      totalDays: 999999,
    });

    expect(response.status).toBe(200);
    expect(response.body.totalCharges).toBe(5900); // 5000*1*1.18, not 999999
    expect(response.body.totalOccupancy).toBe(2);
  });

  it('returns freshly computed totals reflecting the edit, not stale pre-edit values', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchAccommodationAs(token, created.body.id, {
      roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 1 }],
    });

    const response = await patchAccommodationAs(token, created.body.id, {
      roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 3 }],
    });

    expect(response.status).toBe(200);
    expect(response.body.totalCharges).toBe(17700); // 5000*3*1.18, not the earlier 5900
  });

  it('leaves check_in/check_out untouched when only room_lines is submitted', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchAccommodationAs(token, created.body.id, {
      checkIn: '2026-06-15T00:00:00.000Z',
      checkOut: '2026-06-16T00:00:00.000Z',
      roomLines: [],
    });

    const response = await patchAccommodationAs(token, created.body.id, {
      roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 1 }],
    });

    expect(response.status).toBe(200);
    expect(new Date(response.body.checkIn).toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(new Date(response.body.checkOut).toISOString()).toBe('2026-06-16T00:00:00.000Z');
  });

  it('writes one Change Log Entry per changed field (check_in, check_out, room_lines)', async () => {
    const { caller, token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchAccommodationAs(token, created.body.id, {
      checkIn: '2026-06-15T00:00:00.000Z',
      checkOut: '2026-06-16T00:00:00.000Z',
      roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 1 }],
    });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries.map((entry) => entry.field).sort()).toEqual(['checkIn', 'checkOut', 'roomLines']);
    for (const entry of entries) {
      expect(entry.changedBy).toBe(caller.id);
    }
  });

  it("logs room_lines' raw stored shape only, never the derived total_incl_gst", async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    await patchAccommodationAs(token, created.body.id, {
      roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 1 }],
    });

    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id, field: 'roomLines' });
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    if (!entry) {
      throw new Error('expected exactly one roomLines Change Log Entry');
    }
    expect(entry.oldValue).toEqual([]);
    expect(entry.newValue).toEqual([{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 1 }]);
  });

  it('writes no Change Log Entry for a PATCH that resubmits identical room_lines', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const roomLines = [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 1 }];
    await patchAccommodationAs(token, created.body.id, { roomLines });

    const response = await patchAccommodationAs(token, created.body.id, { roomLines });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id, field: 'roomLines' });
    expect(entries).toHaveLength(1); // only the first PATCH's entry, not a second
  });

  it('rejects a room line with a negative no_of_rooms as 400', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchAccommodationAs(token, created.body.id, {
      roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: -1 }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
