import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { ClientContactRole } from '../../src/models/event.js';
import { Role, User } from '../../src/models/user.js';
import { signSessionToken } from '../../src/services/token.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';

const app = createApp();

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const today = startOfUtcDay(new Date());
const yesterday = new Date(today.getTime() - MS_PER_DAY);
const tomorrow = new Date(today.getTime() + MS_PER_DAY);
const dayAfterTomorrow = new Date(today.getTime() + 2 * MS_PER_DAY);

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

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

const patchEventAs = (token: string, id: string, body: object) =>
  request(app).patch(`/events/${id}`).set('Authorization', `Bearer ${token}`).send(body);

const validSessionPayload = (overrides: Record<string, unknown> = {}) => ({
  sessionType: 'Wedding',
  venue: 'Lawn',
  venueCost: 50000,
  startDate: isoDate(today),
  endDate: isoDate(today),
  pax: 200,
  ...overrides,
});

const postSessionAs = (token: string, id: string, body: object) =>
  request(app).post(`/events/${id}/sessions`).set('Authorization', `Bearer ${token}`).send(body);

const patchSessionAs = (token: string, id: string, sid: string, body: object) =>
  request(app).patch(`/events/${id}/sessions/${sid}`).set('Authorization', `Bearer ${token}`).send(body);

const postItemAs = (token: string, id: string, sid: string, body: object) =>
  request(app).post(`/events/${id}/sessions/${sid}/items`).set('Authorization', `Bearer ${token}`).send(body);

const validMealItemPayload = (overrides: Record<string, unknown> = {}) => ({
  type: 'Meal',
  mealName: 'Lunch',
  pax: 100,
  costPerPlate: 500,
  ...overrides,
});

const getDashboardAs = (token: string) => request(app).get('/dashboard').set('Authorization', `Bearer ${token}`);

beforeAll(connectTestDb);
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('GET /dashboard', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).get('/dashboard');

    expect(response.status).toBe(401);
  });

  it.each([Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 200 for any authenticated role (%s) — no role restriction',
    async (role) => {
      const { token } = await seedCaller(role);

      const response = await getDashboardAs(token);

      expect(response.status).toBe(200);
    },
  );

  it('returns all-zero counts and an empty upcoming-events list with no Events at all', async () => {
    const { token } = await seedCaller();

    const response = await getDashboardAs(token);

    expect(response.body).toEqual({
      counts: { todaysEvents: 0, upcoming: 0, tentative: 0, confirmed: 0 },
      upcomingEvents: [],
    });
  });

  it('counts today\'s events from real Session overlap data, not a naive status count alone', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();

    // Tentative with no Sessions at all — counts toward `tentative`, but
    // NOT `todaysEvents` (this is the "not a naive status count" AC).
    await createEventAs(token, validPayload(manager.id, { eventFamilyType: 'No sessions yet' }));

    // Tentative with an Active Session overlapping today.
    const withTodaySession = await createEventAs(token, validPayload(manager.id, { eventFamilyType: 'Today' }));
    await postSessionAs(token, withTodaySession.body.id, validSessionPayload());

    const response = await getDashboardAs(token);

    expect(response.body.counts.tentative).toBe(2);
    expect(response.body.counts.todaysEvents).toBe(1);
  });

  it('includes a multi-day Session ending exactly at today\'s UTC midnight — inclusive boundary, matching STORY-034', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ startDate: isoDate(yesterday), endDate: isoDate(today) }),
    );

    const response = await getDashboardAs(token);

    expect(response.body.counts.todaysEvents).toBe(1);
    // Already underway today, not "upcoming" — its startDate is in the past.
    expect(response.body.counts.upcoming).toBe(0);
  });

  it('excludes a Cancelled Session from today\'s count even though it overlaps today', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    const session = await postSessionAs(token, created.body.id, validSessionPayload());
    await patchSessionAs(token, created.body.id, session.body.id, { sessionStatus: 'Cancelled' });

    const response = await getDashboardAs(token);

    expect(response.body.counts.todaysEvents).toBe(0);
  });

  it('excludes a Cancelled Event from today\'s/upcoming even with a stale Active session', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(token, created.body.id, validSessionPayload());
    await patchEventAs(token, created.body.id, { status: 'Cancelled' });

    const response = await getDashboardAs(token);

    expect(response.body.counts.todaysEvents).toBe(0);
    expect(response.body.counts.upcoming).toBe(0);
    // Status counts only track Tentative/Confirmed — Cancelled counts
    // toward neither.
    expect(response.body.counts.tentative).toBe(0);
    expect(response.body.counts.confirmed).toBe(0);
  });

  it('counts a Session starting strictly after today as upcoming, not today', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id, { status: 'Confirmed' }));
    await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ startDate: isoDate(tomorrow), endDate: isoDate(tomorrow) }),
    );

    const response = await getDashboardAs(token);

    expect(response.body.counts.upcoming).toBe(1);
    expect(response.body.counts.todaysEvents).toBe(0);
    expect(response.body.counts.confirmed).toBe(1);
  });

  it('lists the upcoming Event with date/venue/pax/status from its soonest upcoming Session, soonest first', async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const soonEvent = await createEventAs(token, validPayload(manager.id, { eventFamilyType: 'Soon' }));
    await postSessionAs(
      token,
      soonEvent.body.id,
      validSessionPayload({ venue: 'Poolside', pax: 50, startDate: isoDate(tomorrow), endDate: isoDate(tomorrow) }),
    );
    const laterEvent = await createEventAs(token, validPayload(manager.id, { eventFamilyType: 'Later' }));
    await postSessionAs(
      token,
      laterEvent.body.id,
      validSessionPayload({
        venue: 'Lawn',
        pax: 100,
        startDate: isoDate(dayAfterTomorrow),
        endDate: isoDate(dayAfterTomorrow),
      }),
    );

    const response = await getDashboardAs(token);

    expect(response.body.upcomingEvents).toHaveLength(2);
    expect(response.body.upcomingEvents[0]).toMatchObject({
      eventFamilyType: 'Soon',
      venue: 'Poolside',
      pax: 50,
      status: 'Tentative',
    });
    expect(response.body.upcomingEvents[1]).toMatchObject({ eventFamilyType: 'Later', venue: 'Lawn', pax: 100 });
  });

  it("picks an Event's soonest upcoming Session when it has more than one", async () => {
    const { token } = await seedCaller();
    const manager = await seedEventManager();
    const created = await createEventAs(token, validPayload(manager.id));
    await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ venue: 'Later Venue', startDate: isoDate(dayAfterTomorrow), endDate: isoDate(dayAfterTomorrow) }),
    );
    await postSessionAs(
      token,
      created.body.id,
      validSessionPayload({ venue: 'Sooner Venue', startDate: isoDate(tomorrow), endDate: isoDate(tomorrow) }),
    );

    const response = await getDashboardAs(token);

    expect(response.body.upcomingEvents).toHaveLength(1);
    expect(response.body.upcomingEvents[0].venue).toBe('Sooner Venue');
  });

  describe('role-based field filtering of the upcoming-events list (reuses STORY-046)', () => {
    const buildUpcomingFixture = async () => {
      const { token: managerToken } = await seedCaller();
      const manager = await seedEventManager();
      const created = await createEventAs(
        managerToken,
        validPayload(manager.id, {
          clientContacts: [{ name: 'Priya Nair', contactNumber: '9876543210', role: 'Bride' }],
        }),
      );
      await postSessionAs(
        managerToken,
        created.body.id,
        validSessionPayload({ venue: 'Lawn', pax: 150, startDate: isoDate(tomorrow), endDate: isoDate(tomorrow) }),
      );
      return { managerToken };
    };

    const tokenForRole = async (role: Role, managerToken: string): Promise<string> =>
      role === Role.EventManager ? managerToken : (await seedCaller(role)).token;

    it('includes clientContacts for F&B and Reception, omits it for Housekeeping — genuinely absent from the raw JSON', async () => {
      const { managerToken } = await buildUpcomingFixture();

      for (const role of [Role.EventManager, Role.FnBHead, Role.Reception]) {
        const token = await tokenForRole(role, managerToken);
        const response = await getDashboardAs(token);
        expect(response.body.upcomingEvents[0].clientContacts).toEqual([
          { name: 'Priya Nair', contactNumber: '9876543210', role: 'Bride' },
        ]);
      }

      const housekeepingToken = await tokenForRole(Role.Housekeeping, managerToken);
      const housekeepingResponse = await getDashboardAs(housekeepingToken);
      expect(housekeepingResponse.body.upcomingEvents[0]).not.toHaveProperty('clientContacts');
    });

    it('venue/pax/date/status are visible to all four roles', async () => {
      const { managerToken } = await buildUpcomingFixture();

      for (const role of [Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception]) {
        const token = await tokenForRole(role, managerToken);
        const response = await getDashboardAs(token);
        expect(response.body.upcomingEvents[0]).toMatchObject({ venue: 'Lawn', pax: 150, status: 'Tentative' });
        expect(response.body.upcomingEvents[0].date).toBeDefined();
      }
    });

    it('counts are identical across all four roles for the same fixture data', async () => {
      const { managerToken } = await buildUpcomingFixture();

      const counts = await Promise.all(
        [Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception].map(async (role) => {
          const token = await tokenForRole(role, managerToken);
          const response = await getDashboardAs(token);
          return JSON.stringify(response.body.counts);
        }),
      );

      expect(new Set(counts).size).toBe(1);
    });
  });

  describe('F&B Head menu/meal-timing visibility (STORY-049)', () => {
    it('includes meals (mealName/startTime/endTime) for F&B Head, omits the key entirely for every other role', async () => {
      const { token: managerToken } = await seedCaller();
      const manager = await seedEventManager();
      const created = await createEventAs(managerToken, validPayload(manager.id));
      const session = await postSessionAs(
        managerToken,
        created.body.id,
        validSessionPayload({ startDate: isoDate(tomorrow), endDate: isoDate(tomorrow) }),
      );
      await postItemAs(
        managerToken,
        created.body.id,
        session.body.id,
        validMealItemPayload({ startTime: '12:00', endTime: '14:00' }),
      );

      const { token: fnbToken } = await seedCaller(Role.FnBHead);
      const fnbResponse = await getDashboardAs(fnbToken);
      expect(fnbResponse.body.upcomingEvents[0].meals).toEqual([
        { mealName: 'Lunch', startTime: '12:00', endTime: '14:00' },
      ]);

      for (const role of [Role.EventManager, Role.Housekeeping, Role.Reception]) {
        const token = role === Role.EventManager ? managerToken : (await seedCaller(role)).token;
        const response = await getDashboardAs(token);
        expect(response.body.upcomingEvents[0]).not.toHaveProperty('meals');
      }
    });

    it('gives F&B Head an empty meals array (not omitted) when the soonest Session has no Meal Items yet', async () => {
      const { token: managerToken } = await seedCaller();
      const manager = await seedEventManager();
      const created = await createEventAs(managerToken, validPayload(manager.id));
      await postSessionAs(
        managerToken,
        created.body.id,
        validSessionPayload({ startDate: isoDate(tomorrow), endDate: isoDate(tomorrow) }),
      );

      const { token: fnbToken } = await seedCaller(Role.FnBHead);
      const response = await getDashboardAs(fnbToken);

      expect(response.body.upcomingEvents[0]).toHaveProperty('meals', []);
    });

    it('excludes an Event whose only qualifying Session is Cancelled, for F&B Head same as every other role (STORY-034/047\'s Active-only rule)', async () => {
      const { token: managerToken } = await seedCaller();
      const manager = await seedEventManager();
      const created = await createEventAs(managerToken, validPayload(manager.id));
      const session = await postSessionAs(
        managerToken,
        created.body.id,
        validSessionPayload({ startDate: isoDate(tomorrow), endDate: isoDate(tomorrow) }),
      );
      await postItemAs(managerToken, created.body.id, session.body.id, validMealItemPayload());
      await patchSessionAs(managerToken, created.body.id, session.body.id, { sessionStatus: 'Cancelled' });

      const { token: fnbToken } = await seedCaller(Role.FnBHead);
      const response = await getDashboardAs(fnbToken);

      expect(response.body.counts.upcoming).toBe(0);
      expect(response.body.upcomingEvents).toHaveLength(0);
    });
  });
});
