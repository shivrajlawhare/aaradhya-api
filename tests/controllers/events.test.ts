import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { ChangeLogEntry } from '../../src/models/change-log-entry.js';
import { ClientContactRole, Event, EventStatus } from '../../src/models/event.js';
import { Role, User } from '../../src/models/user.js';
import { renderPdfFromUrl } from '../../src/services/browser-pdf.js';
import { signSessionToken } from '../../src/services/token.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';

// GET /events/:id/quotation.pdf drives a real headless browser against
// aaradhya-web's own running app (services/browser-pdf.ts) — mocked here
// so this suite verifies the controller's own contract (which URL/session
// it asks browser-pdf.ts to render, how it maps a render result/failure to
// a response) without needing a live frontend server or a real browser in
// this test process. The render function's own correctness (does Playwright
// actually work) is covered by tests/services/browser-pdf.test.ts instead.
vi.mock('../../src/services/browser-pdf.js', () => ({
  renderPdfFromUrl: vi.fn(),
}));

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

const listEventsAs = (token: string) => request(app).get('/events').set('Authorization', `Bearer ${token}`);

const searchEventsAs = (token: string, query: Record<string, string>) =>
  request(app).get('/events/search').query(query).set('Authorization', `Bearer ${token}`);

const getEventAs = (token: string, id: string) =>
  request(app).get(`/events/${id}`).set('Authorization', `Bearer ${token}`);

const patchEventAs = (token: string, id: string, body: object) =>
  request(app).patch(`/events/${id}`).set('Authorization', `Bearer ${token}`).send(body);

const deleteEventAs = (token: string, id: string) =>
  request(app).delete(`/events/${id}`).set('Authorization', `Bearer ${token}`);

const patchAccommodationAs = (token: string, id: string, body: object) =>
  request(app).patch(`/events/${id}/accommodation`).set('Authorization', `Bearer ${token}`).send(body);

const patchPaymentAs = (token: string, id: string, body: object) =>
  request(app).patch(`/events/${id}/payment`).set('Authorization', `Bearer ${token}`).send(body);

const patchDocumentsChecklistAs = (token: string, id: string, body: object) =>
  request(app).patch(`/events/${id}/documents`).set('Authorization', `Bearer ${token}`).send(body);

const patchExtrasAs = (token: string, id: string, body: object) =>
  request(app).patch(`/events/${id}/extras`).set('Authorization', `Bearer ${token}`).send(body);

const getQuotationSummaryAs = (token: string, id: string) =>
  request(app).get(`/events/${id}/quotation-summary`).set('Authorization', `Bearer ${token}`);

// .buffer(true)/.parse(...) — supertest's default parsers cover JSON/text
// only; without this, a binary application/pdf response comes back with an
// empty `response.body`, not the actual bytes.
const getQuotationPdfAs = (token: string, id: string) =>
  request(app)
    .get(`/events/${id}/quotation.pdf`)
    .set('Authorization', `Bearer ${token}`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });

const postSessionAs = (token: string, id: string, body: object) =>
  request(app).post(`/events/${id}/sessions`).set('Authorization', `Bearer ${token}`).send(body);

const patchSessionAs = (token: string, id: string, sid: string, body: object) =>
  request(app).patch(`/events/${id}/sessions/${sid}`).set('Authorization', `Bearer ${token}`).send(body);

const deleteSessionAs = (token: string, id: string, sid: string) =>
  request(app).delete(`/events/${id}/sessions/${sid}`).set('Authorization', `Bearer ${token}`);

const validSessionPayload = (overrides: Record<string, unknown> = {}) => ({
  sessionType: 'Wedding',
  venue: 'Lawn',
  venueCost: 50000,
  startDate: '2026-06-15',
  endDate: '2026-06-15',
  pax: 200,
  ...overrides,
});

const postItemAs = (token: string, id: string, sid: string, body: object) =>
  request(app).post(`/events/${id}/sessions/${sid}/items`).set('Authorization', `Bearer ${token}`).send(body);

const patchItemAs = (token: string, id: string, sid: string, iid: string, body: object) =>
  request(app).patch(`/events/${id}/sessions/${sid}/items/${iid}`).set('Authorization', `Bearer ${token}`).send(body);

const deleteItemAs = (token: string, id: string, sid: string, iid: string) =>
  request(app).delete(`/events/${id}/sessions/${sid}/items/${iid}`).set('Authorization', `Bearer ${token}`);

const listMenuItemsAs = (token: string, search: string) =>
  request(app).get('/menu-items').query({ search }).set('Authorization', `Bearer ${token}`);

const getCalendarAs = (token: string, month: number, year: number) =>
  request(app).get('/calendar').query({ month, year }).set('Authorization', `Bearer ${token}`);

const validMealItemPayload = (overrides: Record<string, unknown> = {}) => ({
  type: 'Meal',
  mealName: 'Lunch',
  pax: 100,
  costPerPlate: 500,
  ...overrides,
});

const validEventItemPayload = (overrides: Record<string, unknown> = {}) => ({
  type: 'Event',
  eventName: 'Muhurta',
  venue: 'Lawn',
  ...overrides,
});

beforeAll(connectTestDb);
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('POST /events', () => {
  it('returns 401 with no token', async () => {
    const manager = await seedEventManager();

    const response = await request(app).post('/events').send(validPayload(manager.id));

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const { token } = await seedCaller(role);
    const manager = await seedEventManager();

    const response = await createEventAs(token, validPayload(manager.id));

    expect(response.status).toBe(403);
  });

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

    const response = await createEventAs(token, validPayload(manager.id, { status: EventStatus.Confirmed }));

    expect(response.status).toBe(201);
    expect(response.body.status).toBe(EventStatus.Confirmed);
  });

  // STORY-072 — defaults to 5 (services/quotation.ts's own
  // FOOD_GST_RATE_PERCENT) via the Mongoose schema's own default when the
  // caller doesn't supply one, and honors a caller-supplied override —
  // same "defaults, but overridable" pattern the status test above covers.
  it('defaults foodGstRatePercent to 5, honoring a caller-supplied override', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const defaulted = await createEventAs(token, validPayload(manager.id));
    expect(defaulted.body.foodGstRatePercent).toBe(5);

    const overridden = await createEventAs(token, validPayload(manager.id, { foodGstRatePercent: 12 }));
    expect(overridden.body.foodGstRatePercent).toBe(12);
  });

  it('sets created_by from the authenticated caller, ignoring any value in the body', async () => {
    const { caller, token } = await seedCaller();
    const manager = await seedEventManager();
    const someoneElse = await seedEventManager();

    const response = await createEventAs(token, validPayload(manager.id, { createdBy: someoneElse.id }));

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
      expect.arrayContaining([expect.objectContaining({ field: 'clientContacts' })])
    );
  });

  it('returns 400 when a client_contacts row has an empty name', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(
      token,
      validPayload(manager.id, {
        clientContacts: [{ name: '', contactNumber: '9876543210', role: ClientContactRole.Bride }],
      })
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
      })
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
    }
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
      expect.arrayContaining([expect.objectContaining({ field: 'eventManager' })])
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
      expect.arrayContaining([expect.objectContaining({ field: 'eventManager' })])
    );
  });

  it('allows assigning event_manager to a User account that is currently deactivated', async () => {
    const { token } = await seedCaller();
    const inactiveManager = await seedEventManager({ active: false });

    const response = await createEventAs(token, validPayload(inactiveManager.id));

    expect(response.status).toBe(201);
    expect(response.body.eventManager).toBe(inactiveManager.id);
  });

  it('creates nested Sessions with their own Items and Accommodation in the same call (FR-EVT-8)', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(
      token,
      validPayload(manager.id, {
        sessions: [
          validSessionPayload({
            sessionType: 'Wedding',
            venue: 'Lawn',
            items: [validMealItemPayload({ mealName: 'Lunch', pax: 10, costPerPlate: 200 }), validEventItemPayload()],
          }),
        ],
        accommodation: {
          checkIn: '2026-06-14',
          checkOut: '2026-06-16',
          roomLines: [{ roomType: 'Deluxe', occupancy: 2, tariff: 2500, noOfRooms: 3 }],
        },
      })
    );

    expect(response.status).toBe(201);
    expect(response.body.sessions).toHaveLength(1);
    expect(response.body.sessions[0]).toMatchObject({ sessionType: 'Wedding', venue: 'Lawn' });
    expect(response.body.sessions[0].items).toHaveLength(2);
    expect(response.body.sessions[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'Meal', mealName: 'Lunch', totalCost: 2000 }),
        expect.objectContaining({ type: 'Event', eventName: 'Muhurta' }),
      ])
    );
    expect(response.body.accommodation.roomLines).toHaveLength(1);
    expect(response.body.accommodation.totalDays).toBe(2);

    const stored = await Event.findById(response.body.id);
    expect(stored?.sessions).toHaveLength(1);
    expect(stored?.sessions[0]?.items).toHaveLength(2);
  });

  it('resolves a nested Meal Item menuItems reference by name, persisting it for future reuse', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(
      token,
      validPayload(manager.id, {
        sessions: [validSessionPayload({ items: [validMealItemPayload({ menuItems: [{ name: 'Paneer Tikka' }] })] })],
      })
    );

    expect(response.status).toBe(201);
    expect(response.body.sessions[0].items[0].menuItems).toHaveLength(1);

    const search = await request(app)
      .get('/menu-items')
      .query({ search: 'Paneer' })
      .set('Authorization', `Bearer ${token}`);
    expect(search.body).toHaveLength(1);
    expect(search.body[0]?.id).toBe(response.body.sessions[0].items[0].menuItems[0]);
  });

  it('returns 400, not a silent no-op, when a nested Item menuItems id does not exist', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(
      token,
      validPayload(manager.id, {
        sessions: [
          validSessionPayload({ items: [validMealItemPayload({ menuItems: [{ id: '507f1f77bcf86cd799439011' }] })] }),
        ],
      })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const events = await Event.find({});
    expect(events).toHaveLength(0);
  });

  it('returns 400 for a nested Session whose end_date is before its start_date', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(
      token,
      validPayload(manager.id, {
        sessions: [validSessionPayload({ startDate: '2026-06-15', endDate: '2026-06-10' })],
      })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates extraLineItems (open-ended manual line items, FR-QUO-9a) alongside the fixed extras fields', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(
      token,
      validPayload(manager.id, {
        extras: { decoration: 15000 },
        extraLineItems: [
          { name: 'Photographer', note: 'wedding', amount: 25000 },
          { name: 'Mehendi Artist', amount: 8000 },
        ],
      })
    );

    expect(response.status).toBe(201);
    expect(response.body.extras.decoration).toBe(15000);
    expect(response.body.extraLineItems).toEqual([
      { name: 'Photographer', note: 'wedding', amount: 25000 },
      { name: 'Mehendi Artist', note: null, amount: 8000 },
    ]);
  });

  it('defaults sessions/accommodation/extraLineItems to empty when omitted, matching the pre-STORY-068 create shape', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    const response = await createEventAs(token, validPayload(manager.id));

    expect(response.status).toBe(201);
    expect(response.body.sessions).toEqual([]);
    expect(response.body.extraLineItems).toEqual([]);
    expect(response.body.accommodation.checkIn).toBeNull();
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
    }
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
    expect(response.body.map((event: { eventFamilyType: string }) => event.eventFamilyType).sort()).toEqual([
      'Corporate Offsite',
      'Wedding',
    ]);
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

describe('GET /events/search', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).get('/events/search');

    expect(response.status).toBe(401);
  });

  it.each([Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 200 for any authenticated role (%s) — no role restriction, same as GET /events',
    async (role) => {
      const { token } = await seedCaller(role);

      const response = await searchEventsAs(token, {});

      expect(response.status).toBe(200);
    }
  );

  it('is not swallowed by GET /events/:id — the literal path wins, not treated as an event id', async () => {
    const { token } = await seedCaller();

    const response = await searchEventsAs(token, {});

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('returns 200 with an empty array when no Event matches', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    await createEventAs(token, validPayload(manager.id));

    const response = await searchEventsAs(token, { eventFamilyType: 'Corporate Offsite' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('returns a session whose range only partially overlaps the query range — overlap, not containment (this story own AC)', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    // The session starts before the query's `from` and ends before the
    // query's `to` — not contained by the query range, but it does overlap it.
    await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ startDate: '2026-09-10', endDate: '2026-09-14' })
    );

    const response = await searchEventsAs(token, { from: '2026-09-12', to: '2026-09-20' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]?.id).toBe(created.body.id);
  });

  it('excludes an Event whose only Session falls entirely outside the queried date range', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ startDate: '2026-08-01', endDate: '2026-08-05' })
    );

    const response = await searchEventsAs(token, { from: '2026-09-12', to: '2026-09-20' });

    expect(response.body).toEqual([]);
  });

  it('omitting the date range entirely returns all Events matching the other filters', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ startDate: '2020-01-01', endDate: '2020-01-01' })
    );

    const response = await searchEventsAs(token, { eventFamilyType: 'Wedding' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it('narrows by status', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const tentative = await createEventAs(token, validPayload(manager.id));
    const confirmed = await createEventAs(token, validPayload(manager.id));
    await patchEventAs(token, confirmed.body.id, { status: 'Confirmed' });

    const response = await searchEventsAs(token, { status: 'Confirmed' });

    expect(response.body).toHaveLength(1);
    expect(response.body[0]?.id).toBe(confirmed.body.id);
    expect(response.body.map((event: { id: string }) => event.id)).not.toContain(tentative.body.id);
  });

  it('narrows by venue — an Event whose Session venue does not match is excluded', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const lawnEvent = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(token, lawnEvent.body.id, validSessionPayload({ venue: 'Lawn' }));
    const poolsideEvent = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(token, poolsideEvent.body.id, validSessionPayload({ venue: 'Poolside' }));

    const response = await searchEventsAs(token, { venue: 'Lawn' });

    expect(response.body).toHaveLength(1);
    expect(response.body[0]?.id).toBe(lawnEvent.body.id);
  });

  it('narrows by eventManager', async () => {
    const { token } = await seedCaller();
    const managerA = await seedEventManager();
    const managerB = await seedEventManager();
    const eventA = await createEventAs(token, validPayload(managerA.id));
    await createEventAs(token, validPayload(managerB.id));

    const response = await searchEventsAs(token, { eventManager: managerA.id });

    expect(response.body).toHaveLength(1);
    expect(response.body[0]?.id).toBe(eventA.body.id);
  });

  it('narrows by eventFamilyType, including a custom (non-enum) value entered at creation time', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    await createEventAs(token, validPayload(manager.id, { eventFamilyType: 'Wedding' }));
    const custom = await createEventAs(
      token,
      validPayload(manager.id, { eventFamilyType: 'Corporate Retreat (Custom)' })
    );

    const response = await searchEventsAs(token, { eventFamilyType: 'Corporate Retreat (Custom)' });

    expect(response.body).toHaveLength(1);
    expect(response.body[0]?.id).toBe(custom.body.id);
  });

  it('combines multiple filters with AND semantics', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const matching = await createEventAs(token, validPayload(manager.id, { eventFamilyType: 'Wedding' }));
    await postSessionAs(token, matching.body.id, validSessionPayload({ venue: 'Lawn' }));
    const wrongVenue = await createEventAs(token, validPayload(manager.id, { eventFamilyType: 'Wedding' }));
    await postSessionAs(token, wrongVenue.body.id, validSessionPayload({ venue: 'Poolside' }));
    const wrongType = await createEventAs(token, validPayload(manager.id, { eventFamilyType: 'Corporate Offsite' }));
    await postSessionAs(token, wrongType.body.id, validSessionPayload({ venue: 'Lawn' }));

    const response = await searchEventsAs(token, { eventFamilyType: 'Wedding', venue: 'Lawn' });

    expect(response.body).toHaveLength(1);
    expect(response.body[0]?.id).toBe(matching.body.id);
  });

  it('excludes a Cancelled Session from a venue search, same overlap logic as the calendar', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(token, created.body.id, validSessionPayload({ venue: 'Lawn' }));
    await patchSessionAs(token, created.body.id, session.body.id, { sessionStatus: 'Cancelled' });

    const response = await searchEventsAs(token, { venue: 'Lawn' });

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
    'returns 200 for any authenticated role (%s) — role-based field filtering, not a 403 (STORY-046)',
    async (role) => {
      const manager = await seedEventManager();
      const creatorToken = await signSessionToken({ id: manager.id, role: manager.role });
      const created = await createEventAs(creatorToken, validPayload(manager.id));
      const { token } = await seedCaller(role);

      const response = await getEventAs(token, created.body.id);

      expect(response.status).toBe(200);
    }
  );

  it('returns the Event matching the given id', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await getEventAs(token, created.body.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(created.body);
  });

  it('includes accommodation, defaulting to an empty/null state for a freshly created Event', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await getEventAs(token, created.body.id);

    expect(response.body.accommodation).toEqual({
      checkIn: null,
      checkOut: null,
      totalDays: null,
      roomLines: [],
      totalOccupancy: 0,
      totalCharges: 0,
    });
  });

  it('reflects a prior PATCH /events/:id/accommodation edit', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchAccommodationAs(token, created.body.id, {
      roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 1 }],
    });

    const response = await getEventAs(token, created.body.id);

    // No check_in/check_out set — total_days falls back to 1 (STORY-068's
    // own decision). 5000 × 1 room × 1 day × 1.05 = 5250.
    expect(response.body.accommodation.roomLines).toEqual([
      { roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 1, totalInclGst: 5250 },
    ]);
    expect(response.body.accommodation.totalCharges).toBe(5250);
  });

  it('includes payment, defaulting to 0/null for a freshly created Event', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await getEventAs(token, created.body.id);

    expect(response.body.payment).toEqual({
      totalEstimatedAmount: 0,
      advanceRequired: 0,
      advancePaid: 0,
      advancePaidDate: null,
      paymentMode: null,
      balance: 0,
    });
  });

  it('reflects a prior PATCH /events/:id/payment edit', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchPaymentAs(token, created.body.id, { totalEstimatedAmount: 50000, advancePaid: 20000 });

    const response = await getEventAs(token, created.body.id);

    expect(response.body.payment).toMatchObject({
      totalEstimatedAmount: 50000,
      advancePaid: 20000,
      balance: 30000,
    });
  });

  it('includes documentsChecklist, defaulting to all-false for a freshly created Event', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await getEventAs(token, created.body.id);

    expect(response.body.documentsChecklist).toEqual({
      aadharCard: false,
      panCard: false,
      leavingBirthCertificate: false,
      rationCard: false,
      passportPhotos: false,
      weddingCard: false,
    });
  });

  it('reflects a prior PATCH /events/:id/documents edit', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchDocumentsChecklistAs(token, created.body.id, { aadharCard: true, panCard: true });

    const response = await getEventAs(token, created.body.id);

    expect(response.body.documentsChecklist).toEqual({
      aadharCard: true,
      panCard: true,
      leavingBirthCertificate: false,
      rationCard: false,
      passportPhotos: false,
      weddingCard: false,
    });
  });

  it('includes extras, defaulting to 0 for a freshly created Event', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await getEventAs(token, created.body.id);

    expect(response.body.extras).toEqual({ decoration: 0, photographer: 0, bhatji: 0 });
  });

  it('reflects a prior PATCH /events/:id/extras edit', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchExtrasAs(token, created.body.id, { decoration: 15000 });

    const response = await getEventAs(token, created.body.id);

    expect(response.body.extras).toEqual({ decoration: 15000, photographer: 0, bhatji: 0 });
  });

  it('includes sessions, defaulting to an empty array for a freshly created Event', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await getEventAs(token, created.body.id);

    expect(response.body.sessions).toEqual([]);
  });

  it('reflects a prior POST /events/:id/sessions, including derived fields', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(token, created.body.id, validSessionPayload());

    const response = await getEventAs(token, created.body.id);

    expect(response.body.sessions).toHaveLength(1);
    expect(response.body.sessions[0]).toMatchObject({
      sessionType: 'Wedding',
      venue: 'Lawn',
      durationDays: 1,
      isMultiDay: false,
    });
  });

  it("includes each session's items, defaulting to an empty array", async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(token, created.body.id, validSessionPayload());

    const response = await getEventAs(token, created.body.id);

    expect(response.body.sessions[0]?.items).toEqual([]);
    expect(session.body.id).toBe(response.body.sessions[0]?.id);
  });

  it('reflects a prior POST .../sessions/:sid/items, including derived total_cost', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(token, created.body.id, validSessionPayload());
    await postItemAs(token, created.body.id, session.body.id, validMealItemPayload());

    const response = await getEventAs(token, created.body.id);

    expect(response.body.sessions[0]?.items).toHaveLength(1);
    expect(response.body.sessions[0]?.items[0]).toMatchObject({
      type: 'Meal',
      mealName: 'Lunch',
      totalCost: 50000,
    });
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

describe('GET /events/:id — role-based field filtering (STORY-046)', () => {
  const buildFixtureEvent = async () => {
    const { token: managerToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(
      managerToken,
      validPayload(manager.id, {
        clientContacts: [{ name: 'Priya Nair', contactNumber: '9876543210', role: 'Bride' }],
      })
    );
    const eventId = created.body.id;
    const session = await postSessionAs(
      managerToken,
      eventId,
      validSessionPayload({ venue: 'Lawn', setup: { seating: 'Theatre', tableCount: 5 } })
    );
    await postItemAs(managerToken, eventId, session.body.id, validMealItemPayload({ pax: 10, costPerPlate: 200 }));
    await postItemAs(managerToken, eventId, session.body.id, validEventItemPayload());
    await patchAccommodationAs(managerToken, eventId, {
      roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 1 }],
    });
    await patchPaymentAs(managerToken, eventId, { totalEstimatedAmount: 50000 });
    await patchExtrasAs(managerToken, eventId, { decoration: 1000 });
    return { eventId, managerToken };
  };

  // Reuses managerToken for the EventManager row instead of seeding a
  // second EventManager caller — seedCaller's username is derived from the
  // role, so two independent EventManager callers in one test would
  // collide on the same username (same fix STORY-041's own tests use).
  const tokenForRole = async (role: Role, managerToken: string): Promise<string> =>
    role === Role.EventManager ? managerToken : (await seedCaller(role)).token;

  it('EventManager gets every field — no regression from STORY-013', async () => {
    const { eventId, managerToken } = await buildFixtureEvent();

    const response = await getEventAs(managerToken, eventId);

    expect(response.status).toBe(200);
    expect(response.body.clientContacts).toHaveLength(1);
    expect(response.body.payment.totalEstimatedAmount).toBe(50000);
    expect(response.body.extras.decoration).toBe(1000);
    // No check_in/check_out set — total_days falls back to 1. 5000 × 1
    // room × 1 day × 1.05 = 5250.
    expect(response.body.accommodation.totalCharges).toBe(5250);
    expect(response.body.sessions[0].venueCost).toBeDefined();
    expect(response.body.sessions[0].setup).toBeDefined();
    expect(response.body.sessions[0].items).toHaveLength(2);
  });

  it('FnBHead sees event name/date(s)/POC/venue/pax/menu — payment/extras/non-food setup genuinely absent from the raw JSON', async () => {
    const { eventId } = await buildFixtureEvent();
    const { token } = await seedCaller(Role.FnBHead);

    const response = await getEventAs(token, eventId);

    expect(response.status).toBe(200);
    // Sees: event name/date(s)/POC/venue/pax/menu (meal timing/food instructions).
    expect(response.body.eventFamilyType).toBe('Wedding');
    expect(response.body.clientContacts).toEqual([{ name: 'Priya Nair', contactNumber: '9876543210', role: 'Bride' }]);
    expect(response.body.sessions[0].startDate).toBeDefined();
    expect(response.body.sessions[0].venue).toBe('Lawn');
    expect(response.body.sessions[0].pax).toBe(200);
    expect(response.body.sessions[0].items).toHaveLength(1);
    expect(response.body.sessions[0].items[0]).toMatchObject({ type: 'Meal', mealName: 'Lunch' });
    // Does not see: payment, or non-food setup details — genuinely absent
    // keys, not null/hidden client-side.
    expect(response.body).not.toHaveProperty('payment');
    expect(response.body).not.toHaveProperty('extras');
    expect(response.body).not.toHaveProperty('accommodation');
    expect(response.body.sessions[0]).not.toHaveProperty('setup');
    expect(response.body.sessions[0]).not.toHaveProperty('venueCost');
    expect(response.body.sessions[0].items[0]).not.toHaveProperty('costPerPlate');
    expect(response.body.sessions[0].items[0]).not.toHaveProperty('totalCost');
  });

  it('Housekeeping omits payment/menu/item fields, includes setup/rooms — genuinely absent from the raw JSON', async () => {
    const { eventId } = await buildFixtureEvent();
    const { token } = await seedCaller(Role.Housekeeping);

    const response = await getEventAs(token, eventId);

    expect(response.status).toBe(200);
    expect(response.body.sessions[0].venue).toBe('Lawn');
    expect(response.body.sessions[0].pax).toBe(200);
    expect(response.body.sessions[0].setup).toMatchObject({ seating: 'Theatre', tableCount: 5 });
    expect(response.body.accommodation.roomLines[0]).toMatchObject({ roomType: 'Double', noOfRooms: 1 });
    expect(response.body).not.toHaveProperty('payment');
    expect(response.body).not.toHaveProperty('extras');
    expect(response.body).not.toHaveProperty('clientContacts');
    expect(response.body.sessions[0]).not.toHaveProperty('items');
    expect(response.body.sessions[0]).not.toHaveProperty('venueCost');
    expect(response.body.accommodation).not.toHaveProperty('totalCharges');
    expect(response.body.accommodation.roomLines[0]).not.toHaveProperty('tariff');
    expect(response.body.accommodation.roomLines[0]).not.toHaveProperty('totalInclGst');
  });

  it('Reception omits payment/menu fields, includes client names/rooms/check-in-out — genuinely absent from the raw JSON', async () => {
    const { eventId } = await buildFixtureEvent();
    const { token } = await seedCaller(Role.Reception);

    const response = await getEventAs(token, eventId);

    expect(response.status).toBe(200);
    expect(response.body.clientContacts).toEqual([{ name: 'Priya Nair', contactNumber: '9876543210', role: 'Bride' }]);
    expect(response.body.sessions[0].pax).toBe(200);
    expect(response.body.accommodation.roomLines[0]).toMatchObject({ roomType: 'Double', noOfRooms: 1 });
    expect(response.body.accommodation).toHaveProperty('checkIn');
    expect(response.body.accommodation).toHaveProperty('checkOut');
    expect(response.body).not.toHaveProperty('payment');
    expect(response.body).not.toHaveProperty('extras');
    expect(response.body.sessions[0]).not.toHaveProperty('items');
    expect(response.body.sessions[0]).not.toHaveProperty('setup');
    expect(response.body.sessions[0]).not.toHaveProperty('venueCost');
    expect(response.body.accommodation).not.toHaveProperty('totalCharges');
    expect(response.body.accommodation.roomLines[0]).not.toHaveProperty('tariff');
  });

  it("venue is genuinely visible to all four roles — this story's own edge case", async () => {
    const { eventId, managerToken } = await buildFixtureEvent();

    for (const role of [Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception]) {
      const token = await tokenForRole(role, managerToken);
      const response = await getEventAs(token, eventId);
      expect(response.body.sessions[0].venue).toBe('Lawn');
    }
  });

  it('produces four independently distinct response shapes for the same fixture Event in the same test run', async () => {
    const { eventId, managerToken } = await buildFixtureEvent();

    const shapes = await Promise.all(
      [Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception].map(async (role) => {
        const token = await tokenForRole(role, managerToken);
        const response = await getEventAs(token, eventId);
        return JSON.stringify(response.body);
      })
    );

    expect(new Set(shapes).size).toBe(4);
  });
});

describe('PATCH /events/:id', () => {
  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));

    const response = await request(app).patch(`/events/${created.body.id}`).send({ status: EventStatus.Confirmed });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));
    const { token } = await seedCaller(role);

    const response = await patchEventAs(token, created.body.id, { status: EventStatus.Confirmed });

    expect(response.status).toBe(403);
  });

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

  // STORY-072 — SRS §4.9's "editable... if it varies" for the Food Cost
  // GST rate, reusing this existing top-level PATCH rather than a
  // dedicated route.
  it('updates foodGstRatePercent, reflected on the next GET', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    expect(created.body.foodGstRatePercent).toBe(5);

    const patchResponse = await patchEventAs(token, created.body.id, { foodGstRatePercent: 8 });
    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.foodGstRatePercent).toBe(8);

    const getResponse = await getEventAs(token, created.body.id);
    expect(getResponse.body.foodGstRatePercent).toBe(8);
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
      expect.arrayContaining([expect.objectContaining({ field: 'eventManager' })])
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
      expect.arrayContaining([expect.objectContaining({ field: 'eventManager' })])
    );
  });
});

describe('DELETE /events/:id', () => {
  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));

    const response = await request(app).delete(`/events/${created.body.id}`);

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));
    const { token } = await seedCaller(role);

    const response = await deleteEventAs(token, created.body.id);

    expect(response.status).toBe(403);
  });

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const { token } = await seedCaller();

    const response = await deleteEventAs(token, '507f1f77bcf86cd799439011');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' },
    });
  });

  it('returns 400 for a malformed id', async () => {
    const { token } = await seedCaller();

    const response = await deleteEventAs(token, 'not-an-id');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('deletes the Event and every Change Log Entry recorded against it', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    // Real edits via the normal PATCH flow — each one writes a real Change
    // Log Entry, so there's actually something in the DB for the cascade
    // delete to prove it removes, not just an already-empty collection.
    await patchEventAs(token, created.body.id, { status: EventStatus.Confirmed });
    await patchEventAs(token, created.body.id, { foodGstRatePercent: 8 });
    const entriesBeforeDelete = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entriesBeforeDelete.length).toBeGreaterThan(0);

    const response = await deleteEventAs(token, created.body.id);

    expect(response.status).toBe(204);
    expect(await Event.findById(created.body.id)).toBeNull();
    expect(await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id })).toHaveLength(0);
  });

  it('does not touch a different Event or its own Change Log Entries', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const other = await createEventAs(token, validPayload(manager.id));
    await patchEventAs(token, other.body.id, { status: EventStatus.Confirmed });

    await deleteEventAs(token, created.body.id);

    expect(await Event.findById(other.body.id)).not.toBeNull();
    const otherEntries = await ChangeLogEntry.find({ entityType: 'Event', entityId: other.body.id });
    expect(otherEntries.length).toBeGreaterThan(0);
  });

  // This story's own edge case — a freshly created Event has no Change Log
  // Entries yet (creation itself isn't logged, only edits are); the
  // deleteMany call still runs and simply matches nothing.
  it('succeeds for an Event with zero Change Log Entries', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await deleteEventAs(token, created.body.id);

    expect(response.status).toBe(204);
    expect(await Event.findById(created.body.id)).toBeNull();
  });
});

describe('PATCH /events/:id/accommodation', () => {
  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));

    const response = await request(app).patch(`/events/${created.body.id}/accommodation`).send({ roomLines: [] });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));
    const { token } = await seedCaller(role);

    const response = await patchAccommodationAs(token, created.body.id, { roomLines: [] });

    expect(response.status).toBe(403);
  });

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
    // check_in/check_out are 1 calendar day apart — 1 night stayed
    // (STORY-070's own fix; not the "+1" inclusive-day count Session's own
    // duration uses).
    expect(response.body.totalDays).toBe(1);
    expect(response.body.totalOccupancy).toBe(8); // (2*2) + (4*1)
    // Double: 5000*2 rooms*1 day*1.05=10500; Suite: 12000*1 room*1 day*1.05=12600; sum=23100.
    expect(response.body.totalCharges).toBe(23100);
    expect(response.body.roomLines).toEqual([
      { roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 2, totalInclGst: 10500 },
      { roomType: 'Suite', occupancy: 4, tariff: 12000, noOfRooms: 1, totalInclGst: 12600 },
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
    // No check_in/check_out set — total_days falls back to 1.
    expect(response.body.totalCharges).toBe(5250); // 5000*1*1*1.05, not 999999
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
    // No check_in/check_out set — total_days falls back to 1.
    expect(response.body.totalCharges).toBe(15750); // 5000*3*1*1.05, not the earlier 5250
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

describe('PATCH /events/:id/payment', () => {
  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));

    const response = await request(app)
      .patch(`/events/${created.body.id}/payment`)
      .send({ totalEstimatedAmount: 50000 });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 403 for a caller with role %s — enforced by role, not just "logged in"',
    async (role) => {
      const { token: creatorToken } = await seedCaller();
      const manager = await seedEventManager();
      const created = await createEventAs(creatorToken, validPayload(manager.id));
      const { token } = await seedCaller(role);

      const response = await patchPaymentAs(token, created.body.id, { totalEstimatedAmount: 50000 });

      expect(response.status).toBe(403);
    }
  );

  it('returns 200 for an Event Manager', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchPaymentAs(token, created.body.id, { totalEstimatedAmount: 50000 });

    expect(response.status).toBe(200);
  });

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const { token } = await seedCaller();

    const response = await patchPaymentAs(token, '507f1f77bcf86cd799439011', { totalEstimatedAmount: 50000 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' },
    });
  });

  it('returns 400 for a malformed id', async () => {
    const { token } = await seedCaller();

    const response = await patchPaymentAs(token, 'not-an-id', { totalEstimatedAmount: 50000 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('sets payment fields, returning a freshly computed balance', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchPaymentAs(token, created.body.id, {
      totalEstimatedAmount: 50000,
      advanceRequired: 20000,
      advancePaid: 20000,
      paymentMode: 'UPI',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      totalEstimatedAmount: 50000,
      advanceRequired: 20000,
      advancePaid: 20000,
      paymentMode: 'UPI',
      balance: 30000,
    });
  });

  it('returns a negative balance, not clamped or errored, when advance_paid exceeds the estimate', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchPaymentAs(token, created.body.id, {
      totalEstimatedAmount: 50000,
      advancePaid: 60000,
    });

    expect(response.status).toBe(200);
    expect(response.body.balance).toBe(-10000);
  });

  it('ignores a submitted balance — response always reflects the server-computed value', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchPaymentAs(token, created.body.id, {
      totalEstimatedAmount: 50000,
      advancePaid: 20000,
      balance: 999999,
    });

    expect(response.status).toBe(200);
    expect(response.body.balance).toBe(30000);
  });

  it('allows setting advance_paid_date before advance_paid is ever set — no cross-field validation', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchPaymentAs(token, created.body.id, {
      advancePaidDate: '2026-05-01T00:00:00.000Z',
    });

    expect(response.status).toBe(200);
    expect(response.body.advancePaid).toBe(0);
    expect(new Date(response.body.advancePaidDate).toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('rejects a negative advance_paid as 400 — money in cannot be negative', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchPaymentAs(token, created.body.id, { advancePaid: -1 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('writes one Change Log Entry per changed field', async () => {
    const { caller, token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchPaymentAs(token, created.body.id, {
      totalEstimatedAmount: 50000,
      advancePaid: 20000,
      paymentMode: 'UPI',
    });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries.map((entry) => entry.field).sort()).toEqual(['advancePaid', 'paymentMode', 'totalEstimatedAmount']);
    for (const entry of entries) {
      expect(entry.changedBy).toBe(caller.id);
    }
  });

  it('writes no Change Log Entry for a PATCH that resubmits identical values', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchPaymentAs(token, created.body.id, { totalEstimatedAmount: 50000 });

    const response = await patchPaymentAs(token, created.body.id, { totalEstimatedAmount: 50000 });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries).toHaveLength(1); // only the first PATCH's entry, not a second
  });

  it('leaves other payment fields untouched when only one field is submitted', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchPaymentAs(token, created.body.id, { totalEstimatedAmount: 50000, advanceRequired: 20000 });

    const response = await patchPaymentAs(token, created.body.id, { advancePaid: 20000 });

    expect(response.status).toBe(200);
    expect(response.body.totalEstimatedAmount).toBe(50000);
    expect(response.body.advanceRequired).toBe(20000);
    expect(response.body.advancePaid).toBe(20000);
  });
});

describe('PATCH /events/:id/documents', () => {
  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));

    const response = await request(app).patch(`/events/${created.body.id}/documents`).send({ aadharCard: true });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));
    const { token } = await seedCaller(role);

    const response = await patchDocumentsChecklistAs(token, created.body.id, { aadharCard: true });

    expect(response.status).toBe(403);
  });

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const { token } = await seedCaller();

    const response = await patchDocumentsChecklistAs(token, '507f1f77bcf86cd799439011', {
      aadharCard: true,
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' },
    });
  });

  it('returns 400 for a malformed id', async () => {
    const { token } = await seedCaller();

    const response = await patchDocumentsChecklistAs(token, 'not-an-id', { aadharCard: true });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reads every item as false for a brand-new Event with no checklist state yet', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    // An empty-body PATCH takes the changes.length === 0 path, returning
    // the current (untouched) state — this is exactly what a caller would
    // see before ever toggling anything.
    const response = await patchDocumentsChecklistAs(token, created.body.id, {});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      aadharCard: false,
      panCard: false,
      leavingBirthCertificate: false,
      rationCard: false,
      passportPhotos: false,
      weddingCard: false,
    });
  });

  it('persists a toggled item as a boolean', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchDocumentsChecklistAs(token, created.body.id, { aadharCard: true });

    expect(response.status).toBe(200);
    expect(response.body.aadharCard).toBe(true);
    expect(response.body.panCard).toBe(false);
  });

  it('persists toggling an item back from true to false', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchDocumentsChecklistAs(token, created.body.id, { aadharCard: true });

    const response = await patchDocumentsChecklistAs(token, created.body.id, { aadharCard: false });

    expect(response.status).toBe(200);
    expect(response.body.aadharCard).toBe(false);
  });

  it('rejects a key outside the fixed checklist item list as 400', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchDocumentsChecklistAs(token, created.body.id, { passportCopy: true });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('writes one Change Log Entry per toggled item', async () => {
    const { caller, token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchDocumentsChecklistAs(token, created.body.id, {
      aadharCard: true,
      weddingCard: true,
    });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries.map((entry) => entry.field).sort()).toEqual(['aadharCard', 'weddingCard']);
    for (const entry of entries) {
      expect(entry.changedBy).toBe(caller.id);
      expect(entry.oldValue).toBe(false);
      expect(entry.newValue).toBe(true);
    }
  });

  it('writes no Change Log Entry for a PATCH that resubmits the same value', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchDocumentsChecklistAs(token, created.body.id, { aadharCard: true });

    const response = await patchDocumentsChecklistAs(token, created.body.id, { aadharCard: true });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries).toHaveLength(1); // only the first PATCH's entry, not a second
  });

  it('leaves other checklist items untouched when only one item is submitted', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchDocumentsChecklistAs(token, created.body.id, { aadharCard: true, panCard: true });

    const response = await patchDocumentsChecklistAs(token, created.body.id, { weddingCard: true });

    expect(response.status).toBe(200);
    expect(response.body.aadharCard).toBe(true);
    expect(response.body.panCard).toBe(true);
    expect(response.body.weddingCard).toBe(true);
  });
});

describe('PATCH /events/:id/extras', () => {
  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));

    const response = await request(app).patch(`/events/${created.body.id}/extras`).send({ decoration: 5000 });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));
    const { token } = await seedCaller(role);

    const response = await patchExtrasAs(token, created.body.id, { decoration: 5000 });

    expect(response.status).toBe(403);
  });

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const { token } = await seedCaller();

    const response = await patchExtrasAs(token, '507f1f77bcf86cd799439011', { decoration: 5000 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' },
    });
  });

  it('returns 400 for a malformed id', async () => {
    const { token } = await seedCaller();

    const response = await patchExtrasAs(token, 'not-an-id', { decoration: 5000 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reads all three amounts as 0 for a brand-new Event with no extras entered yet', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    // An empty-body PATCH takes the changes.length === 0 path, returning
    // the current (untouched) state.
    const response = await patchExtrasAs(token, created.body.id, {});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ decoration: 0, photographer: 0, bhatji: 0 });
  });

  it('sets a plain numeric amount with no computation applied to it', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchExtrasAs(token, created.body.id, {
      decoration: 15000,
      photographer: 20000,
      bhatji: 5000,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ decoration: 15000, photographer: 20000, bhatji: 5000 });
  });

  it('rejects a key outside the fixed decoration/photographer/bhatji list as 400', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchExtrasAs(token, created.body.id, { catering: 1000 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a negative amount as 400 — these are costs, not adjustments', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchExtrasAs(token, created.body.id, { decoration: -1 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('writes one Change Log Entry per changed field', async () => {
    const { caller, token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await patchExtrasAs(token, created.body.id, { decoration: 15000, bhatji: 5000 });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries.map((entry) => entry.field).sort()).toEqual(['bhatji', 'decoration']);
    for (const entry of entries) {
      expect(entry.changedBy).toBe(caller.id);
      expect(entry.oldValue).toBe(0);
    }
  });

  it('writes no Change Log Entry for a PATCH that resubmits the same value', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchExtrasAs(token, created.body.id, { decoration: 15000 });

    const response = await patchExtrasAs(token, created.body.id, { decoration: 15000 });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries).toHaveLength(1); // only the first PATCH's entry, not a second
  });

  it('leaves other extras fields untouched when only one field is submitted', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await patchExtrasAs(token, created.body.id, { decoration: 15000, photographer: 20000 });

    const response = await patchExtrasAs(token, created.body.id, { bhatji: 5000 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ decoration: 15000, photographer: 20000, bhatji: 5000 });
  });
});

describe('GET /events/:id/quotation-summary', () => {
  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));

    const response = await request(app).get(`/events/${created.body.id}/quotation-summary`);

    expect(response.status).toBe(401);
  });

  it.each([Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 200 for a caller with role %s — any authenticated caller, not EventManager-only',
    async (role) => {
      const { token: creatorToken } = await seedCaller();
      const manager = await seedEventManager();
      const created = await createEventAs(creatorToken, validPayload(manager.id));
      // Reuse creatorToken for the EventManager row instead of seeding a
      // second EventManager caller — seedCaller's username is derived from
      // the role, so two independent EventManager callers in one test would
      // collide on the same username.
      const token = role === Role.EventManager ? creatorToken : (await seedCaller(role)).token;

      const response = await getQuotationSummaryAs(token, created.body.id);

      expect(response.status).toBe(200);
    }
  );

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const { token } = await seedCaller();

    const response = await getQuotationSummaryAs(token, '507f1f77bcf86cd799439011');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' },
    });
  });

  it('returns 400 for a malformed id', async () => {
    const { token } = await seedCaller();

    const response = await getQuotationSummaryAs(token, 'not-an-id');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns an all-zero summary for a brand-new Event with no Sessions/Accommodation/extras yet', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await getQuotationSummaryAs(token, created.body.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      venueTotal: 0,
      foodSubtotal: 0,
      foodTotalInclGst: 0,
      accommodationTotal: 0,
      extrasTotal: 0,
      grandTotal: 0,
    });
  });

  it('combines live session/item/accommodation/extras data into the exact expected rollup', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const eventId = created.body.id;

    // Session 1: venueCost 5000, one Meal item (10 × 200 = 2000) plus one
    // Event item (Muhurta — no cost fields, contributes 0).
    const session1 = await postSessionAs(token, eventId, validSessionPayload({ venueCost: 5000 }));
    await postItemAs(token, eventId, session1.body.id, validMealItemPayload({ pax: 10, costPerPlate: 200 }));
    await postItemAs(token, eventId, session1.body.id, validEventItemPayload());

    // Session 2: venueCost 3000, two Meal items (5 × 300 = 1500, 2 × 100 = 200).
    const session2 = await postSessionAs(token, eventId, validSessionPayload({ venueCost: 3000 }));
    await postItemAs(token, eventId, session2.body.id, validMealItemPayload({ pax: 5, costPerPlate: 300 }));
    await postItemAs(token, eventId, session2.body.id, validMealItemPayload({ pax: 2, costPerPlate: 100 }));

    // Accommodation: no check_in/check_out set, so total_days falls back
    // to 1 — 5000 tariff × 2 rooms × 1 day × 5% GST = 10500.
    await patchAccommodationAs(token, eventId, {
      roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 2 }],
    });

    await patchExtrasAs(token, eventId, { decoration: 1000, photographer: 1500, bhatji: 500 });

    const response = await getQuotationSummaryAs(token, eventId);

    // venueTotal = 5000 + 3000 = 8000. foodSubtotal = 2000 + 1500 + 200 =
    // 3700. foodTotalInclGst = 3700 × 1.05 = 3885. accommodationTotal =
    // 10500. extrasTotal = 1000 + 1500 + 500 = 3000. grandTotal = 8000 +
    // 3885 + 10500 + 3000 = 25385 — confirms this endpoint wires live data
    // through computeTotalCostSummary (STORY-068's own 5%-default rates)
    // with no drift.
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      venueTotal: 8000,
      foodSubtotal: 3700,
      foodTotalInclGst: 3885,
      accommodationTotal: 10500,
      extrasTotal: 3000,
      grandTotal: 25385,
    });
  });

  // STORY-072 — a per-Event foodGstRatePercent (SRS §4.9's "editable...
  // if it varies") must be the rate this rollup actually applies, not
  // always the 5% default — same live-through-the-real-endpoint check as
  // the test above, just with a non-default rate set at creation.
  it('uses this Event’s own foodGstRatePercent, not the 5% default, for foodTotalInclGst/grandTotal', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id, { foodGstRatePercent: 10 }));
    const eventId = created.body.id;

    const session = await postSessionAs(token, eventId, validSessionPayload({ venueCost: 0 }));
    await postItemAs(token, eventId, session.body.id, validMealItemPayload({ pax: 10, costPerPlate: 200 }));

    const response = await getQuotationSummaryAs(token, eventId);

    // foodSubtotal = 2000; foodTotalInclGst = 2000 × 1.10 = 2200 (not the
    // 5%-default 2100) — grandTotal = 0 (venue) + 2200 + 0 (accommodation)
    // + 0 (extras) = 2200.
    expect(response.status).toBe(200);
    expect(response.body.foodTotalInclGst).toBe(2200);
    expect(response.body.grandTotal).toBe(2200);
  });

  it("reflects a Session's edited venue_cost immediately, with no separate stored quotation object", async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const eventId = created.body.id;
    const session = await postSessionAs(token, eventId, validSessionPayload({ venueCost: 5000 }));

    const before = await getQuotationSummaryAs(token, eventId);
    expect(before.body.venueTotal).toBe(5000);

    await patchSessionAs(token, eventId, session.body.id, { venueCost: 9000 });
    const after = await getQuotationSummaryAs(token, eventId);

    expect(after.body.venueTotal).toBe(9000);
  });

  it('excludes a Cancelled Session — its venue cost and item costs are not charged to the client', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const eventId = created.body.id;
    const session = await postSessionAs(token, eventId, validSessionPayload({ venueCost: 5000 }));
    await postItemAs(token, eventId, session.body.id, validMealItemPayload({ pax: 10, costPerPlate: 200 }));

    const beforeCancel = await getQuotationSummaryAs(token, eventId);
    expect(beforeCancel.body.venueTotal).toBe(5000);
    expect(beforeCancel.body.foodSubtotal).toBe(2000);

    await patchSessionAs(token, eventId, session.body.id, { sessionStatus: 'Cancelled' });
    const afterCancel = await getQuotationSummaryAs(token, eventId);

    expect(afterCancel.body.venueTotal).toBe(0);
    expect(afterCancel.body.foodSubtotal).toBe(0);
  });
});

describe('GET /events/:id/quotation.pdf', () => {
  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));

    const response = await request(app).get(`/events/${created.body.id}/quotation.pdf`);

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 403 for a caller with role %s — Event Manager only',
    async (role) => {
      const { token: creatorToken } = await seedCaller();
      const manager = await seedEventManager();
      const created = await createEventAs(creatorToken, validPayload(manager.id));
      const { token } = await seedCaller(role);

      const response = await getQuotationPdfAs(token, created.body.id);

      expect(response.status).toBe(403);
    }
  );

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const { token } = await seedCaller();

    const response = await getQuotationPdfAs(token, '507f1f77bcf86cd799439011');

    expect(response.status).toBe(404);
  });

  it('returns 400 for a malformed id', async () => {
    const { token } = await seedCaller();

    const response = await getQuotationPdfAs(token, 'not-an-id');

    expect(response.status).toBe(400);
  });

  describe('when renderPdfFromUrl resolves (mocked — its own real behavior is covered by tests/services/browser-pdf.test.ts)', () => {
    const mockPdfBuffer = Buffer.from('%PDF-mock-quotation-pdf');

    beforeEach(() => {
      vi.mocked(renderPdfFromUrl).mockReset();
      vi.mocked(renderPdfFromUrl).mockResolvedValue(mockPdfBuffer);
    });

    it('returns the rendered PDF buffer with a no-store Cache-Control header', async () => {
      const { token } = await seedCaller();
      const manager = await seedEventManager();
      const created = await createEventAs(token, validPayload(manager.id));

      const response = await getQuotationPdfAs(token, created.body.id);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect(Buffer.compare(response.body, mockPdfBuffer)).toBe(0);
    });

    it("drives the headless browser to this exact Event's own print-mode quotation-preview URL", async () => {
      const { token } = await seedCaller();
      const manager = await seedEventManager();
      const created = await createEventAs(token, validPayload(manager.id));

      await getQuotationPdfAs(token, created.body.id);

      expect(renderPdfFromUrl).toHaveBeenCalledWith(
        config.webAppUrl,
        `/events/${created.body.id}/quotation-preview?print=1`,
        expect.objectContaining({ token: expect.any(String) })
      );
    });

    it("mints a session for the SAME authenticated caller, not the Event's own assigned manager", async () => {
      const { caller, token } = await seedCaller();
      const manager = await seedEventManager();
      const created = await createEventAs(token, validPayload(manager.id));

      await getQuotationPdfAs(token, created.body.id);

      const [, , session] = vi.mocked(renderPdfFromUrl).mock.calls[0]!;
      expect(session).toMatchObject({ user: { id: caller.id, name: caller.name, role: caller.role } });
    });
  });

  it('propagates a render failure as a 500 rather than silently returning an empty PDF', async () => {
    vi.mocked(renderPdfFromUrl).mockReset();
    vi.mocked(renderPdfFromUrl).mockRejectedValueOnce(new Error('browser crashed'));
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await getQuotationPdfAs(token, created.body.id);

    expect(response.status).toBe(500);
  });
});

describe('POST /events/:id/sessions', () => {
  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));

    const response = await request(app).post(`/events/${created.body.id}/sessions`).send(validSessionPayload());

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const { token: creatorToken } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(creatorToken, validPayload(manager.id));
    const { token } = await seedCaller(role);

    const response = await postSessionAs(token, created.body.id, validSessionPayload());

    expect(response.status).toBe(403);
  });

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const { token } = await seedCaller();

    const response = await postSessionAs(token, '507f1f77bcf86cd799439011', validSessionPayload());

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' },
    });
  });

  it('returns 400 for a malformed id', async () => {
    const { token } = await seedCaller();

    const response = await postSessionAs(token, 'not-an-id', validSessionPayload());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates a Session via the STORY-026 schema, returned with its generated sub-id', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await postSessionAs(token, created.body.id, validSessionPayload());

    expect(response.status).toBe(201);
    expect(typeof response.body.id).toBe('string');
    expect(response.body.id).not.toBe('');
    expect(response.body).toMatchObject({
      sessionType: 'Wedding',
      venue: 'Lawn',
      venueCost: 50000,
      pax: 200,
      sessionStatus: 'Active',
      durationDays: 1,
      isMultiDay: false,
    });
  });

  it('persists the Session on the Event, readable via a subsequent GET', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(token, created.body.id, validSessionPayload());

    const event = await Event.findById(created.body.id);

    expect(event?.sessions).toHaveLength(1);
    expect(event?.sessions[0]?.sessionType).toBe('Wedding');
  });

  it('returns 400 with a clear message when end_date is before start_date', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ startDate: '2026-06-15', endDate: '2026-06-14' })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([
      { field: 'endDate', message: 'end_date must be on or after start_date.' },
    ]);
  });

  it('accepts a single-day session where start_date === end_date', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ startDate: '2026-06-15', endDate: '2026-06-15' })
    );

    expect(response.status).toBe(201);
    expect(response.body.durationDays).toBe(1);
    expect(response.body.isMultiDay).toBe(false);
  });

  it('accepts venue_cost submitted by the client as-is, without recomputing it', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ venue: 'Poolside', venueCost: 75000 })
    );

    expect(response.status).toBe(201);
    expect(response.body.venueCost).toBe(75000);
  });

  it('rejects a session missing a required field as 400', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const payload: Record<string, unknown> = validSessionPayload();
    delete payload.venue;

    const response = await postSessionAs(token, created.body.id, payload);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('writes no Change Log Entry — adding a Session is a creation, not a field edit', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    await postSessionAs(token, created.body.id, validSessionPayload());

    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: created.body.id });
    expect(entries).toHaveLength(0);
  });

  it("allows adding a Session to an Event whose own status is Cancelled (this story's own edge case: allowed, not blocked)", async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id, { status: EventStatus.Cancelled }));

    const response = await postSessionAs(token, created.body.id, validSessionPayload());

    expect(response.status).toBe(201);
  });
});

describe('PATCH /events/:id/sessions/:sid', () => {
  const seedEventWithSession = async (token: string, overrides: Record<string, unknown> = {}) => {
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(token, created.body.id, validSessionPayload(overrides));
    return { eventId: created.body.id, sessionId: session.body.id };
  };

  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(creatorToken);

    const response = await request(app).patch(`/events/${eventId}/sessions/${sessionId}`).send({ pax: 250 });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const { token: creatorToken } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(creatorToken);
    const { token } = await seedCaller(role);

    const response = await patchSessionAs(token, eventId, sessionId, { pax: 250 });

    expect(response.status).toBe(403);
  });

  it('returns 404 for a well-formed but nonexistent event id', async () => {
    const { token } = await seedCaller();

    const response = await patchSessionAs(token, '507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012', {
      pax: 250,
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' },
    });
  });

  it('returns 404 for a well-formed but nonexistent session id on an existing Event', async () => {
    const { token } = await seedCaller();
    const { eventId } = await seedEventWithSession(token);

    const response = await patchSessionAs(token, eventId, '507f1f77bcf86cd799439012', { pax: 250 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'SESSION_NOT_FOUND', message: 'No Session with that id on this Event.' },
    });
  });

  it('returns 400 for a malformed event id', async () => {
    const { token } = await seedCaller();

    const response = await patchSessionAs(token, 'not-an-id', '507f1f77bcf86cd799439012', { pax: 250 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a malformed session id', async () => {
    const { token } = await seedCaller();
    const { eventId } = await seedEventWithSession(token);

    const response = await patchSessionAs(token, eventId, 'not-an-id', { pax: 250 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('persists an edited field, reflected in the response', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);

    const response = await patchSessionAs(token, eventId, sessionId, { pax: 250 });

    expect(response.status).toBe(200);
    expect(response.body.pax).toBe(250);
  });

  it('re-validates end_date >= start_date on every update, not just at creation', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token, {
      startDate: '2026-06-15',
      endDate: '2026-06-15',
    });

    const response = await patchSessionAs(token, eventId, sessionId, { endDate: '2026-06-14' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([
      { field: 'endDate', message: 'end_date must be on or after start_date.' },
    ]);
  });

  it('accepts widening the date range so end_date remains on/after the new start_date', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token, {
      startDate: '2026-06-15',
      endDate: '2026-06-15',
    });

    const response = await patchSessionAs(token, eventId, sessionId, { endDate: '2026-06-17' });

    expect(response.status).toBe(200);
    expect(response.body.durationDays).toBe(3);
    expect(response.body.isMultiDay).toBe(true);
  });

  it('writes one Change Log Entry per changed field, scoped with the session identity', async () => {
    const { caller, token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token, { sessionType: 'Wedding' });

    const response = await patchSessionAs(token, eventId, sessionId, { pax: 250, venue: 'Poolside' });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: eventId });
    expect(entries.map((entry) => entry.field).sort()).toEqual(['sessions[Wedding].pax', 'sessions[Wedding].venue']);
    for (const entry of entries) {
      expect(entry.changedBy).toBe(caller.id);
    }
  });

  it('writes no Change Log Entry for a PATCH that resubmits the same value', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token, { pax: 200 });

    const response = await patchSessionAs(token, eventId, sessionId, { pax: 200 });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: eventId });
    expect(entries).toHaveLength(0);
  });

  it('sets session_status to Cancelled independently of the parent Event status', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id, { status: EventStatus.Confirmed }));
    const session = await postSessionAs(token, created.body.id, validSessionPayload());

    const response = await patchSessionAs(token, created.body.id, session.body.id, {
      sessionStatus: 'Cancelled',
    });

    expect(response.status).toBe(200);
    expect(response.body.sessionStatus).toBe('Cancelled');
    const eventCheck = await getEventAs(token, created.body.id);
    expect(eventCheck.body.status).toBe('Confirmed');
  });
});

describe('DELETE /events/:id/sessions/:sid', () => {
  const seedEventWithSession = async (token: string) => {
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(token, created.body.id, validSessionPayload());
    return { eventId: created.body.id, sessionId: session.body.id };
  };

  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(creatorToken);

    const response = await request(app).delete(`/events/${eventId}/sessions/${sessionId}`);

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const { token: creatorToken } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(creatorToken);
    const { token } = await seedCaller(role);

    const response = await deleteSessionAs(token, eventId, sessionId);

    expect(response.status).toBe(403);
  });

  it('returns 404 for a well-formed but nonexistent event id', async () => {
    const { token } = await seedCaller();

    const response = await deleteSessionAs(token, '507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012');

    expect(response.status).toBe(404);
  });

  it('returns 404 for a well-formed but nonexistent session id', async () => {
    const { token } = await seedCaller();
    const { eventId } = await seedEventWithSession(token);

    const response = await deleteSessionAs(token, eventId, '507f1f77bcf86cd799439012');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'SESSION_NOT_FOUND', message: 'No Session with that id on this Event.' },
    });
  });

  it('returns 400 for a malformed session id', async () => {
    const { token } = await seedCaller();
    const { eventId } = await seedEventWithSession(token);

    const response = await deleteSessionAs(token, eventId, 'not-an-id');

    expect(response.status).toBe(400);
  });

  it('removes the session from the array — a subsequent GET no longer includes it', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);

    const response = await deleteSessionAs(token, eventId, sessionId);

    expect(response.status).toBe(204);
    const event = await Event.findById(eventId);
    expect(event?.sessions).toHaveLength(0);
  });

  it("allows deleting an Event's only Session — a zero-Session Event is a valid draft state", async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);

    const response = await deleteSessionAs(token, eventId, sessionId);

    expect(response.status).toBe(204);
    const event = await Event.findById(eventId);
    expect(event?.sessions).toEqual([]);
  });

  it('writes no Change Log Entry — deleting a Session is not a field edit', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);

    await deleteSessionAs(token, eventId, sessionId);

    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: eventId });
    expect(entries).toHaveLength(0);
  });
});

describe('POST /events/:id/sessions/:sid/items', () => {
  const seedEventWithSession = async (token: string) => {
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(token, created.body.id, validSessionPayload());
    return { eventId: created.body.id, sessionId: session.body.id };
  };

  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(creatorToken);

    const response = await request(app)
      .post(`/events/${eventId}/sessions/${sessionId}/items`)
      .send(validMealItemPayload());

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const { token: creatorToken } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(creatorToken);
    const { token } = await seedCaller(role);

    const response = await postItemAs(token, eventId, sessionId, validMealItemPayload());

    expect(response.status).toBe(403);
  });

  it('returns 404 for a well-formed but nonexistent event id', async () => {
    const { token } = await seedCaller();

    const response = await postItemAs(
      token,
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439012',
      validMealItemPayload()
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' },
    });
  });

  it('returns 404 for a well-formed but nonexistent session id', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await postItemAs(token, created.body.id, '507f1f77bcf86cd799439012', validMealItemPayload());

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'SESSION_NOT_FOUND', message: 'No Session with that id on this Event.' },
    });
  });

  it('returns 400 for a malformed session id', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));

    const response = await postItemAs(token, created.body.id, 'not-an-id', validMealItemPayload());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates a Meal Item, ignoring a client-submitted total_cost', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);

    const response = await postItemAs(token, eventId, sessionId, validMealItemPayload({ totalCost: 999999 }));

    expect(response.status).toBe(201);
    expect(typeof response.body.id).toBe('string');
    expect(response.body).toMatchObject({
      type: 'Meal',
      mealName: 'Lunch',
      pax: 100,
      costPerPlate: 500,
      totalCost: 50000,
    });
  });

  it('defaults limited_seating to false when omitted, using the literal pax for total_cost', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);

    const response = await postItemAs(token, eventId, sessionId, validMealItemPayload());

    expect(response.body.limitedSeating).toBe(false);
    expect(response.body.totalCost).toBe(50000);
  });

  it('a limited_seating Meal Item computes total_cost as cost_per_plate alone, ignoring pax', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);

    const response = await postItemAs(
      token,
      eventId,
      sessionId,
      validMealItemPayload({ pax: 200, costPerPlate: 500, limitedSeating: true })
    );

    expect(response.status).toBe(201);
    expect(response.body.limitedSeating).toBe(true);
    expect(response.body.totalCost).toBe(500);
  });

  it('creates an Event Item, with pax/cost_per_plate/total_cost reading null', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);

    const response = await postItemAs(token, eventId, sessionId, validEventItemPayload());

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      type: 'Event',
      eventName: 'Muhurta',
      venue: 'Lawn',
      pax: null,
      costPerPlate: null,
      limitedSeating: null,
      totalCost: null,
    });
  });

  // STORY-071 — venue (and eventName) are no longer required on an Event
  // Item: both reference quotations (docs/example_quatations/) print
  // Ceremony Items with no venue, and one has a Ceremony Item with every
  // field blank. Supersedes this test's own previous 400 expectation.
  it('creates an Event Item with venue omitted, reading null', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);
    const payload: Record<string, unknown> = validEventItemPayload();
    delete payload.venue;

    const response = await postItemAs(token, eventId, sessionId, payload);

    expect(response.status).toBe(201);
    expect(response.body.venue).toBeNull();
  });

  it('creates an Event Item with every optional field omitted', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);

    const response = await postItemAs(token, eventId, sessionId, { type: 'Event' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      type: 'Event',
      eventName: null,
      venue: null,
      startTime: null,
      endTime: null,
    });
  });

  it('adding a not-yet-existing Menu Item by name creates it, findable via GET /menu-items?search=', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);

    const response = await postItemAs(
      token,
      eventId,
      sessionId,
      validMealItemPayload({ menuItems: [{ name: 'Paneer Tikka' }] })
    );

    expect(response.status).toBe(201);
    expect(response.body.menuItems).toHaveLength(1);

    const search = await listMenuItemsAs(token, 'Paneer');
    expect(search.body).toHaveLength(1);
    expect(search.body[0]?.name).toBe('Paneer Tikka');
    expect(search.body[0]?.id).toBe(response.body.menuItems[0]);
  });

  it('adding an already-existing Menu Item by name reuses it, not a duplicate', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);
    const existing = await request(app)
      .post('/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Paneer Tikka' });

    const response = await postItemAs(
      token,
      eventId,
      sessionId,
      validMealItemPayload({ menuItems: [{ name: 'paneer tikka' }] })
    );

    expect(response.status).toBe(201);
    expect(response.body.menuItems).toEqual([existing.body.id]);
    const search = await listMenuItemsAs(token, 'paneer');
    expect(search.body).toHaveLength(1);
  });

  it('adding a Menu Item by an existing id references it directly', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);
    const existing = await request(app)
      .post('/menu-items')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Gulab Jamun' });

    const response = await postItemAs(
      token,
      eventId,
      sessionId,
      validMealItemPayload({ menuItems: [{ id: existing.body.id }] })
    );

    expect(response.status).toBe(201);
    expect(response.body.menuItems).toEqual([existing.body.id]);
  });

  it('returns 400, not a silent no-op, when a menuItems id does not exist', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);

    const response = await postItemAs(
      token,
      eventId,
      sessionId,
      validMealItemPayload({ menuItems: [{ id: '507f1f77bcf86cd799439011' }] })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const event = await Event.findById(eventId);
    expect(event?.sessions[0]?.items).toHaveLength(0);
  });

  it('writes no Change Log Entry — adding an Item is a creation, not a field edit', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId } = await seedEventWithSession(token);

    await postItemAs(token, eventId, sessionId, validMealItemPayload());

    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: eventId });
    expect(entries).toHaveLength(0);
  });
});

describe('PATCH /events/:id/sessions/:sid/items/:iid', () => {
  const seedEventWithItem = async (token: string, itemOverrides: Record<string, unknown> = {}) => {
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(token, created.body.id, validSessionPayload());
    const item = await postItemAs(token, created.body.id, session.body.id, validMealItemPayload(itemOverrides));
    return { eventId: created.body.id, sessionId: session.body.id, itemId: item.body.id };
  };

  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const { eventId, sessionId, itemId } = await seedEventWithItem(creatorToken);

    const response = await request(app)
      .patch(`/events/${eventId}/sessions/${sessionId}/items/${itemId}`)
      .send({ pax: 150 });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const { token: creatorToken } = await seedCaller();
    const { eventId, sessionId, itemId } = await seedEventWithItem(creatorToken);
    const { token } = await seedCaller(role);

    const response = await patchItemAs(token, eventId, sessionId, itemId, { pax: 150 });

    expect(response.status).toBe(403);
  });

  it('returns 404 for a well-formed but nonexistent item id', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(token, created.body.id, validSessionPayload());

    const response = await patchItemAs(token, created.body.id, session.body.id, '507f1f77bcf86cd799439012', {
      pax: 150,
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'ITEM_NOT_FOUND', message: 'No Item with that id on this Session.' },
    });
  });

  // STORY-071 — venue/eventName are no longer required on an Event Item
  // (contract/schemas/event.ts's own updateItemBodySchema comment): an
  // explicit "" is a legitimate way to clear a previously-set value back to
  // blank, not a rejected edit. Exercises the controller's own `!==
  // undefined` guard (applyItemUpdate) end-to-end, not just by inspection.
  it('clears venue/eventName back to blank with an explicit ""', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(token, created.body.id, validSessionPayload());
    const item = await postItemAs(token, created.body.id, session.body.id, validEventItemPayload());

    const response = await patchItemAs(token, created.body.id, session.body.id, item.body.id, {
      eventName: '',
      venue: '',
    });

    expect(response.status).toBe(200);
    // '' is a real, stored value here, not coalesced to null — the only
    // coalescing toPublicItem's own `item.eventName ?? null` does is for a
    // field that was never set at all (undefined), a genuinely different
    // state from "explicitly cleared to empty".
    expect(response.body.eventName).toBe('');
    expect(response.body.venue).toBe('');
  });

  it('recomputes total_cost when pax or cost_per_plate change', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId, itemId } = await seedEventWithItem(token, { pax: 100, costPerPlate: 500 });

    const response = await patchItemAs(token, eventId, sessionId, itemId, { pax: 120, costPerPlate: 550 });

    expect(response.status).toBe(200);
    expect(response.body.pax).toBe(120);
    expect(response.body.costPerPlate).toBe(550);
    expect(response.body.totalCost).toBe(66000);
  });

  it('writes one Change Log Entry per changed field, scoped with the session and item identity', async () => {
    const { caller, token } = await seedCaller();
    const { eventId, sessionId, itemId } = await seedEventWithItem(token, { mealName: 'Lunch' });

    const response = await patchItemAs(token, eventId, sessionId, itemId, { pax: 150, costPerPlate: 600 });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: eventId });
    expect(entries.map((entry) => entry.field).sort()).toEqual([
      'sessions[Wedding].items[Lunch].costPerPlate',
      'sessions[Wedding].items[Lunch].pax',
    ]);
    for (const entry of entries) {
      expect(entry.changedBy).toBe(caller.id);
    }
  });

  it('writes no Change Log Entry for a PATCH that resubmits the same values', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId, itemId } = await seedEventWithItem(token, { pax: 100, costPerPlate: 500 });

    const response = await patchItemAs(token, eventId, sessionId, itemId, { pax: 100, costPerPlate: 500 });

    expect(response.status).toBe(200);
    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: eventId });
    expect(entries).toHaveLength(0);
  });

  it('returns 400, not a silent no-op, when patching menuItems with an id that does not exist', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId, itemId } = await seedEventWithItem(token);

    const response = await patchItemAs(token, eventId, sessionId, itemId, {
      menuItems: [{ id: '507f1f77bcf86cd799439011' }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /events/:id/sessions/:sid/items/:iid', () => {
  const seedEventWithItem = async (token: string) => {
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(token, created.body.id, validSessionPayload());
    const item = await postItemAs(token, created.body.id, session.body.id, validMealItemPayload());
    return { eventId: created.body.id, sessionId: session.body.id, itemId: item.body.id };
  };

  it('returns 401 with no token', async () => {
    const { token: creatorToken } = await seedCaller();
    const { eventId, sessionId, itemId } = await seedEventWithItem(creatorToken);

    const response = await request(app).delete(`/events/${eventId}/sessions/${sessionId}/items/${itemId}`);

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const { token: creatorToken } = await seedCaller();
    const { eventId, sessionId, itemId } = await seedEventWithItem(creatorToken);
    const { token } = await seedCaller(role);

    const response = await deleteItemAs(token, eventId, sessionId, itemId);

    expect(response.status).toBe(403);
  });

  it('returns 404 for a well-formed but nonexistent item id', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(token, created.body.id, validSessionPayload());

    const response = await deleteItemAs(token, created.body.id, session.body.id, '507f1f77bcf86cd799439012');

    expect(response.status).toBe(404);
  });

  it("removes the item from the Session's item list — a subsequent read no longer includes it", async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId, itemId } = await seedEventWithItem(token);

    const response = await deleteItemAs(token, eventId, sessionId, itemId);

    expect(response.status).toBe(204);
    const event = await Event.findById(eventId);
    expect(event?.sessions[0]?.items).toHaveLength(0);
  });

  it('writes no Change Log Entry — deleting an Item is not a field edit', async () => {
    const { token } = await seedCaller();
    const { eventId, sessionId, itemId } = await seedEventWithItem(token);

    await deleteItemAs(token, eventId, sessionId, itemId);

    const entries = await ChangeLogEntry.find({ entityType: 'Event', entityId: eventId });
    expect(entries).toHaveLength(0);
  });
});

describe('GET /calendar', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).get('/calendar').query({ month: 9, year: 2026 });

    expect(response.status).toBe(401);
  });

  it.each([Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 200 for any authenticated role (%s) — no role restriction, same as GET /events',
    async (role) => {
      const { token } = await seedCaller(role);

      const response = await getCalendarAs(token, 9, 2026);

      expect(response.status).toBe(200);
    }
  );

  it('returns 400 for an out-of-range month', async () => {
    const { token } = await seedCaller();

    const response = await getCalendarAs(token, 13, 2026);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with an empty array for a month with zero matching sessions', async () => {
    const { token } = await seedCaller();

    const response = await getCalendarAs(token, 9, 2026);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('returns a fixture 3-day session for a query naming a date in the middle of its range, even though the query never names that date specifically', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ startDate: '2026-09-12', endDate: '2026-09-14' })
    );

    const response = await getCalendarAs(token, 9, 2026);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      startDate: expect.any(String),
      endDate: expect.any(String),
      sessionStatus: 'Active',
      event: {
        id: created.body.id,
        eventFamilyType: 'Wedding',
        status: EventStatus.Tentative,
        eventManager: manager.id,
      },
    });
  });

  it('returns a session spanning a month boundary from both the September and the October query', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ startDate: '2026-09-29', endDate: '2026-10-01' })
    );

    const septemberResponse = await getCalendarAs(token, 9, 2026);
    const octoberResponse = await getCalendarAs(token, 10, 2026);

    expect(septemberResponse.body).toHaveLength(1);
    expect(octoberResponse.body).toHaveLength(1);
  });

  it('excludes a Cancelled session even though its dates fall in range', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ startDate: '2026-09-12', endDate: '2026-09-12' })
    );
    await patchSessionAs(token, created.body.id, session.body.id, { sessionStatus: 'Cancelled' });

    const response = await getCalendarAs(token, 9, 2026);

    expect(response.body).toEqual([]);
  });

  it('excludes a session whose range does not overlap the queried month at all', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ startDate: '2026-08-01', endDate: '2026-08-05' })
    );

    const response = await getCalendarAs(token, 9, 2026);

    expect(response.body).toEqual([]);
  });

  it("returns both of the same Event's Active sessions overlapping the same day, raw — dedup is a client-side rendering concern (STORY-035), not this endpoint's job", async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ sessionType: 'Haldi', venue: 'Lawn', startDate: '2026-09-12', endDate: '2026-09-12' })
    );
    await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({
        sessionType: 'Vendor Setup',
        venue: 'Banquet Hall',
        startDate: '2026-09-12',
        endDate: '2026-09-12',
      })
    );

    const response = await getCalendarAs(token, 9, 2026);

    expect(response.body).toHaveLength(2);
  });
});
