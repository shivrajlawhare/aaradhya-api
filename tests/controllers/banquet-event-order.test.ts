import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  ClientContactRole,
  Event,
  EventStatus,
  ItemType,
  SeatingArrangement,
  SessionStatus,
} from '../../src/models/event.js';
import { MenuItem } from '../../src/models/menu-item.js';
import { Role, User } from '../../src/models/user.js';
import { renderPdfFromUrl } from '../../src/services/browser-pdf.js';
import { signSessionToken } from '../../src/services/token.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';

// The real headless render is covered by tests/services/browser-pdf.test.ts.
vi.mock('../../src/services/browser-pdf.js', () => ({
  renderPdfFromUrl: vi.fn(),
}));

const app = createApp();

// notes_for_department.pdf (docs/example_quatations): Dr. Chubhe's
// birthday dinner.
const DINNER_MENU = [
  'Veg Manchow Soup',
  'Mutton Chops',
  'Prawns Tikka',
  'Chicken Kebab',
  'Paneer Tikka',
  'Mutton Dum Biryani',
  'Veg Dum Biryani',
  'Tambda Rassa',
  'Pandhra Rassa',
  'Veg Raita',
  'Ice Cream',
];
const VENUE_COST = 15000;
const COST_PER_PLATE = 1250;

const seedCaller = async (role: Role = Role.EventManager) => {
  const caller = await User.create({
    name: 'Caller',
    username: `caller-${role.toLowerCase()}`,
    passwordHash: 'not-used-in-these-tests',
    role,
  });
  return { caller, token: await signSessionToken({ id: caller.id, role: caller.role }) };
};

const seedSampleEvent = async () => {
  const manager = await User.create({
    name: 'Assigned Manager',
    username: 'manager-beo',
    passwordHash: 'not-used-in-these-tests',
    role: Role.EventManager,
  });
  const menuItems = await MenuItem.insertMany(DINNER_MENU.map((name) => ({ name, defaultCostPerPlate: 300 })));
  return Event.create({
    eventFamilyType: 'Birthday',
    status: EventStatus.Confirmed,
    eventManager: manager._id,
    createdBy: manager._id,
    clientContacts: [{ name: 'Dr. Chubhe', contactNumber: '9822000000', role: ClientContactRole.POC }],
    extraLineItems: [{ name: 'Cake', amount: 4000 }],
    sessions: [
      {
        sessionType: 'Birthday Party/ Cocktail party',
        venue: 'Mini Party Hall',
        venueCost: VENUE_COST,
        startDate: new Date('2026-08-26T00:00:00.000Z'),
        endDate: new Date('2026-08-26T00:00:00.000Z'),
        startTime: '20:00',
        endTime: '23:00',
        pax: 20,
        setup: { seating: SeatingArrangement.SquareTables },
        departmentNotes: {
          vegPax: 4,
          nonVegPax: 16,
          maintenance: ['Sound System'],
          restaurantNote: 'Billing will be as per a la carte.',
        },
        items: [
          {
            type: ItemType.Meal,
            mealName: 'Dinner',
            startTime: '20:00',
            endTime: '23:00',
            pax: 20,
            costPerPlate: COST_PER_PLATE,
            menuItems: menuItems.map((menuItem) => menuItem._id),
          },
          { type: ItemType.Event, eventName: 'Cake cutting', startTime: '21:00', endTime: '21:15' },
        ],
      },
      {
        sessionType: 'Cancelled lunch',
        venue: 'Lawn',
        venueCost: 9999,
        startDate: new Date('2026-08-25T00:00:00.000Z'),
        endDate: new Date('2026-08-25T00:00:00.000Z'),
        pax: 10,
        sessionStatus: SessionStatus.Cancelled,
      },
    ],
  });
};

const getBeoAs = (token: string, id: string) =>
  request(app).get(`/events/${id}/banquet-event-order`).set('Authorization', `Bearer ${token}`);

const getBeoPdfAs = (token: string, id: string) =>
  request(app)
    .get(`/events/${id}/banquet-event-order.pdf`)
    .set('Authorization', `Bearer ${token}`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });

// Every key anywhere in the payload, to prove no money field exists.
const collectKeys = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(collectKeys);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...collectKeys(nested)]);
  }
  return [];
};

beforeAll(connectTestDb);
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('GET /events/:id/banquet-event-order', () => {
  it('returns 401 with no token', async () => {
    const event = await seedSampleEvent();

    const response = await request(app).get(`/events/${event.id}/banquet-event-order`);

    expect(response.status).toBe(401);
  });

  it.each([Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'allows a caller with role %s',
    async (role) => {
      const event = await seedSampleEvent();
      const { token } = await seedCaller(role);

      const response = await getBeoAs(token, event.id);

      expect(response.status).toBe(200);
    }
  );

  it('returns 404 for an unknown event', async () => {
    const { token } = await seedCaller();

    const response = await getBeoAs(token, '0123456789abcdef01234567');

    expect(response.status).toBe(404);
  });

  it('reproduces the notes_for_department.pdf sample, active sessions only', async () => {
    const event = await seedSampleEvent();
    const { token } = await seedCaller(Role.Housekeeping);

    const response = await getBeoAs(token, event.id);

    expect(response.body).toMatchObject({ eventId: event.eventId, clientName: 'Dr. Chubhe' });
    expect(response.body.sessions).toHaveLength(1);
    expect(response.body.sessions[0]).toMatchObject({
      sessionType: 'Birthday Party/ Cocktail party',
      venue: 'Mini Party Hall',
      startDate: '2026-08-26T00:00:00.000Z',
      startTime: '20:00',
      endTime: '23:00',
      pax: 20,
      meals: [{ mealName: 'Dinner', startTime: '20:00', endTime: '23:00', menuItems: DINNER_MENU }],
      ceremonies: ['Cake cutting'],
      setup: { seating: SeatingArrangement.SquareTables, tableCount: 0, chairCount: 0, stage: false },
      departmentNotes: {
        vegPax: 4,
        nonVegPax: 16,
        maintenance: ['Sound System'],
        restaurantNote: 'Billing will be as per a la carte.',
      },
    });
  });

  it('carries no prices — no cost, amount or total field, and none of the event’s money values', async () => {
    const event = await seedSampleEvent();
    const { token } = await seedCaller();

    const response = await getBeoAs(token, event.id);

    const keys = collectKeys(response.body);
    expect(keys.filter((key) => /cost|amount|total|price|tariff|gst|balance|payment/i.test(key))).toEqual([]);
    const json = JSON.stringify(response.body);
    expect(json).not.toContain(String(VENUE_COST));
    expect(json).not.toContain(String(COST_PER_PLATE));
    expect(json).not.toContain('4000');
    expect(json).not.toMatch(/₹|Rs\./);
  });
});

describe('GET /events/:id/banquet-event-order.pdf', () => {
  const pdfBuffer = Buffer.from('%PDF-1.7 beo');

  beforeEach(() => {
    vi.mocked(renderPdfFromUrl).mockReset();
    vi.mocked(renderPdfFromUrl).mockResolvedValue(pdfBuffer);
  });

  it.each([Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'renders the web BEO page in print mode for role %s, named <eventId>-notes-for-department.pdf',
    async (role) => {
      const event = await seedSampleEvent();
      const { caller, token } = await seedCaller(role);

      const response = await getBeoPdfAs(token, event.id);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="${event.eventId}-notes-for-department.pdf"`
      );
      expect(Buffer.compare(response.body, pdfBuffer)).toBe(0);
      expect(renderPdfFromUrl).toHaveBeenCalledWith(
        expect.any(String),
        `/events/${event.id}/notes-for-department?print=1`,
        expect.objectContaining({ user: expect.objectContaining({ id: caller.id, role }) })
      );
    }
  );

  it('returns 404 for an unknown event without rendering', async () => {
    const { token } = await seedCaller();

    const response = await getBeoPdfAs(token, '0123456789abcdef01234567');

    expect(response.status).toBe(404);
    expect(renderPdfFromUrl).not.toHaveBeenCalled();
  });
});
