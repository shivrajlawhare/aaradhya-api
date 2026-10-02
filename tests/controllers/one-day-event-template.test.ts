import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { ChangeLogEntry } from '../../src/models/change-log-entry.js';
import { MenuItem } from '../../src/models/menu-item.js';
import { OneDayEventTemplate } from '../../src/models/one-day-event-template.js';
import { Role, User } from '../../src/models/user.js';
import { signSessionToken } from '../../src/services/token.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';

const app = createApp();
const PATH = '/settings/one-day-event-template';

const seedCaller = async (role: Role = Role.EventManager) => {
  const caller = await User.create({
    name: 'Caller',
    username: `caller-${role.toLowerCase()}`,
    passwordHash: 'not-used-in-these-tests',
    role,
  });
  return { id: caller.id, token: await signSessionToken({ id: caller.id, role: caller.role }) };
};

const getTemplateAs = (token: string) => request(app).get(PATH).set('Authorization', `Bearer ${token}`);

const putTemplateAs = (token: string, body: object) =>
  request(app).put(PATH).set('Authorization', `Bearer ${token}`).send(body);

// The current template as a PUT body (menu items back to ids).
const toBody = (template: {
  eventFamilyType: string;
  session: { sessionType: string; venue: string; startTime: string; endTime: string; pax: number };
  roomLines: object[];
  ceremonies: object[];
  meals: { mealName: string; menuItems: { id: string }[] }[];
  lineItems: { name: string; note: string | null; amount: number }[];
  gstPercent: number;
}) => ({
  eventFamilyType: template.eventFamilyType,
  session: {
    sessionType: template.session.sessionType,
    venue: template.session.venue,
    startTime: template.session.startTime,
    endTime: template.session.endTime,
    pax: template.session.pax,
  },
  roomLines: template.roomLines,
  ceremonies: template.ceremonies,
  meals: template.meals.map((meal) => ({ ...meal, menuItems: meal.menuItems.map((menuItem) => menuItem.id) })),
  lineItems: template.lineItems.map(({ name, note, amount }) => ({ name, note: note ?? undefined, amount })),
  gstPercent: template.gstPercent,
});

beforeAll(async () => {
  await connectTestDb();
  await Promise.all([MenuItem.init(), OneDayEventTemplate.init()]);
});
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('GET /settings/one-day-event-template', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).get(PATH);

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for role %s', async (role) => {
    const { token } = await seedCaller(role);

    const response = await getTemplateAs(token);

    expect(response.status).toBe(403);
  });

  it('seeds the example 4 template on first read', async () => {
    const { token } = await seedCaller();

    const response = await getTemplateAs(token);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      eventFamilyType: 'Wedding',
      session: {
        sessionType: 'Wedding',
        venue: 'Full Banquet',
        venueCost: null,
        startTime: '09:00',
        endTime: '15:00',
        pax: 500,
        setup: null,
      },
      roomLines: [
        { roomType: 'Delux', noOfRooms: 14 },
        { roomType: 'Executive', noOfRooms: 2 },
        { roomType: 'Family Room', noOfRooms: 2 },
        { roomType: 'Extra Beds', noOfRooms: 0 },
      ],
      ceremonies: [{ eventName: 'Muhurta', startTime: '11:00', endTime: '12:30' }],
      lineItems: [
        { name: 'Decoration', note: null, amount: 115000 },
        { name: 'Photographer', note: null, amount: 0 },
        { name: 'Bhatji', note: 'wedding + punyawachan', amount: 7000 },
      ],
      gstPercent: 5,
    });
    const meals = response.body.meals as {
      mealName: string;
      pax: number;
      costPerPlate: number;
      menuItems: { name: string }[];
    }[];
    expect(meals.map(({ mealName, pax, costPerPlate }) => [mealName, pax, costPerPlate])).toEqual([
      ['Breakfast', 50, 160],
      ['Welcome Drink', 500, 30],
      ['Lunch', 500, 450],
    ]);
    expect(meals[0]?.menuItems.map((menuItem) => menuItem.name)).toEqual(['Tea', 'Coffee', 'Pohe', 'Upma']);
    expect(meals[2]?.menuItems).toHaveLength(14);
  });

  it('creates the missing Menu Items once, reusing an existing one regardless of case', async () => {
    const { token } = await seedCaller();
    const existing = await MenuItem.create({ name: 'tea', defaultCostPerPlate: 20 });

    await getTemplateAs(token);
    const response = await getTemplateAs(token);

    expect(response.body.meals[0].menuItems[0]).toEqual({ id: existing.id, name: 'tea' });
    expect(await MenuItem.countDocuments()).toBe(19);
    expect(await OneDayEventTemplate.countDocuments()).toBe(1);
  });
});

describe('PUT /settings/one-day-event-template', () => {
  it('returns 403 for a non-Event-Manager', async () => {
    const { token } = await seedCaller(Role.FnBHead);

    const response = await putTemplateAs(token, {});

    expect(response.status).toBe(403);
  });

  it('replaces the template, so the next read returns the edit', async () => {
    const { token } = await seedCaller();
    const seeded = (await getTemplateAs(token)).body;
    const body = toBody(seeded);
    body.session.pax = 600;
    body.gstPercent = 18;
    body.ceremonies = [];

    const response = await putTemplateAs(token, { ...body, session: { ...body.session, venueCost: 100000 } });

    expect(response.status).toBe(200);
    const next = (await getTemplateAs(token)).body;
    expect(next.session).toMatchObject({ pax: 600, venueCost: 100000 });
    expect(next.gstPercent).toBe(18);
    expect(next.ceremonies).toEqual([]);
  });

  it('writes one grouped Change Log entry per changed section', async () => {
    const { id, token } = await seedCaller();
    const body = toBody((await getTemplateAs(token)).body);

    await putTemplateAs(token, { ...body, gstPercent: 18, eventFamilyType: 'Engagement' });

    const entries = await ChangeLogEntry.find({ entityType: 'OneDayEventTemplate' }).sort({ field: 1 });
    expect(entries.map((entry) => [entry.field, entry.oldValue, entry.newValue])).toEqual([
      ['eventFamilyType', 'Wedding', 'Engagement'],
      ['gstPercent', 5, 18],
    ]);
    expect(entries.every((entry) => entry.changedBy === id)).toBe(true);
    expect(new Set(entries.map((entry) => entry.groupId)).size).toBe(1);
  });

  it('rejects a meal that references an unknown Menu Item', async () => {
    const { token } = await seedCaller();
    const body = toBody((await getTemplateAs(token)).body);
    body.meals[0]!.menuItems = ['0123456789abcdef01234567'];

    const response = await putTemplateAs(token, body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MENU_ITEM_NOT_FOUND');
  });

  it('rejects a time that is not HH:mm', async () => {
    const { token } = await seedCaller();
    const body = toBody((await getTemplateAs(token)).body);
    body.session.startTime = '9am';

    const response = await putTemplateAs(token, body);

    expect(response.status).toBe(400);
  });
});
