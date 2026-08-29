import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ClientContactRole,
  Event,
  EventStatus,
  ItemType,
  SeatingArrangement,
  SessionStatus,
  type ClientContactAttributes,
  type SessionAttributes,
} from '../../src/models/event.js';
import { Role, User } from '../../src/models/user.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';
import { expectValidationError } from '../support/validation.js';

const validContact = (): ClientContactAttributes => ({
  name: 'Priya Nair',
  contactNumber: '9876543210',
  role: ClientContactRole.Bride,
});

const validSession = (overrides: Partial<SessionAttributes> = {}): Partial<SessionAttributes> => ({
  sessionType: 'Wedding',
  venue: 'Lawn',
  venueCost: 50000,
  startDate: new Date('2026-06-15'),
  endDate: new Date('2026-06-15'),
  pax: 200,
  ...overrides,
});

const createEventManager = () =>
  User.create({
    name: 'Event Manager',
    username: `manager-${new Types.ObjectId().toHexString()}`,
    passwordHash: 'argon2-hash-placeholder',
    role: Role.EventManager,
  });

const createNonEventManager = () =>
  User.create({
    name: 'FnB Head',
    username: `fnb-${new Types.ObjectId().toHexString()}`,
    passwordHash: 'argon2-hash-placeholder',
    role: Role.FnBHead,
  });

beforeAll(async () => {
  await connectTestDb();
  await Event.init();
});

afterEach(clearCollections);

afterAll(disconnectTestDb);

describe('Event model', () => {
  it('generates a server-side event_id in the ARD-EVT-<year>-<seq> format', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      clientContacts: [validContact()],
      createdBy: manager.id,
    });

    expect(event.eventId).toMatch(/^ARD-EVT-\d{4}-\d{3}$/);
  });

  it('ignores a client-supplied event_id and generates its own', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventId: 'CLIENT-SUPPLIED-ID',
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      clientContacts: [validContact()],
      createdBy: manager.id,
    });

    expect(event.eventId).not.toBe('CLIENT-SUPPLIED-ID');
    expect(event.eventId).toMatch(/^ARD-EVT-\d{4}-\d{3}$/);
  });

  it('assigns distinct event_ids across repeated creation', async () => {
    const manager = await createEventManager();
    const baseData = {
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
    };

    const first = await Event.create(baseData);
    const second = await Event.create(baseData);

    expect(first.eventId).not.toBe(second.eventId);
  });

  it('assigns distinct event_ids under concurrent (parallel) creation', async () => {
    const manager = await createEventManager();
    const baseData = {
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
    };

    const events = await Promise.all(Array.from({ length: 10 }, () => Event.create(baseData)));

    expect(new Set(events.map((event) => event.eventId)).size).toBe(10);
  });

  it('rejects a duplicate event_id at the database level', async () => {
    const manager = await createEventManager();
    const baseData = {
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
    };
    const [existing] = await Event.create([baseData]);
    if (!existing) {
      throw new Error('expected Event.create([baseData]) to return one document');
    }

    const error = await Event.collection
      .insertOne({ ...existing.toObject(), _id: new Types.ObjectId() })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 11000 });
  });

  it.each(Object.values(EventStatus))('accepts %s as a status', async (status) => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status,
      eventManager: manager.id,
      createdBy: manager.id,
    });

    expect(event.status).toBe(status);
  });

  it('rejects a status outside the four allowed values', async () => {
    const manager = await createEventManager();

    const error = await expectValidationError(Event, {
      eventFamilyType: 'Wedding',
      status: 'Postponed',
      eventManager: manager.id,
      createdBy: manager.id,
    });

    expect(error.errors).toHaveProperty('status');
  });

  it('accepts a free-text event_family_type value alongside the known ones', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Corporate Offsite',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
    });

    expect(event.eventFamilyType).toBe('Corporate Offsite');
  });

  it('rejects an event_manager id that does not reference any User Account', async () => {
    const manager = await createEventManager();

    const error = await expectValidationError(Event, {
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: new Types.ObjectId(),
      createdBy: manager.id,
    });

    expect(error.errors).toHaveProperty('eventManager');
  });

  it('rejects an event_manager id that references a User whose role is not EventManager', async () => {
    const manager = await createEventManager();
    const nonManager = await createNonEventManager();

    const error = await expectValidationError(Event, {
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: nonManager.id,
      createdBy: manager.id,
    });

    expect(error.errors).toHaveProperty('eventManager');
  });

  it('accepts zero client_contacts rows at the schema level', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
    });

    expect(event.clientContacts).toEqual([]);
  });

  it('accepts multiple client_contacts rows, including a Custom role', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      clientContacts: [
        validContact(),
        { name: 'Rohan Nair', contactNumber: '9123456780', role: ClientContactRole.Groom },
        { name: 'Wedding Planner', contactNumber: '9988776655', role: ClientContactRole.Custom },
      ],
    });

    expect(event.clientContacts).toHaveLength(3);
    expect(event.clientContacts.map((contact) => contact.role)).toEqual([
      ClientContactRole.Bride,
      ClientContactRole.Groom,
      ClientContactRole.Custom,
    ]);
  });

  it('rejects a client_contacts row with a role outside the four allowed values', async () => {
    const manager = await createEventManager();

    const error = await expectValidationError(Event, {
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      clientContacts: [{ name: 'Someone', contactNumber: '9000000000', role: 'BestMan' }],
    });

    expect(error.errors).toHaveProperty('clientContacts.0.role');
  });

  it('accepts an Event with no accommodation at all', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
    });

    expect(event.accommodation).toBeUndefined();
  });

  it('accepts an accommodation block with zero room_lines', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      accommodation: {
        checkIn: new Date('2026-06-15'),
        checkOut: new Date('2026-06-16'),
        roomLines: [],
      },
    });

    expect(event.accommodation?.roomLines).toEqual([]);
  });

  it('accepts an accommodation block with multiple room lines', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      accommodation: {
        checkIn: new Date('2026-06-15'),
        checkOut: new Date('2026-06-16'),
        roomLines: [
          { roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 3 },
          { roomType: 'Suite', occupancy: 4, tariff: 12000, noOfRooms: 1 },
        ],
      },
    });

    expect(event.accommodation?.roomLines).toHaveLength(2);
    expect(event.accommodation?.roomLines.map((line) => line.roomType)).toEqual(['Double', 'Suite']);
  });

  it('accepts a room line with no_of_rooms: 0 as a placeholder row', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      accommodation: {
        roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 0 }],
      },
    });

    expect(event.accommodation?.roomLines[0]?.noOfRooms).toBe(0);
  });

  it('rejects a room line with a negative no_of_rooms', async () => {
    const manager = await createEventManager();

    const error = await expectValidationError(Event, {
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      accommodation: {
        roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: -1 }],
      },
    });

    expect(error.errors).toHaveProperty('accommodation.roomLines.0.noOfRooms');
  });

  it.each(['roomType', 'occupancy', 'tariff', 'noOfRooms'])(
    'rejects a room line missing %s',
    async (field) => {
      const manager = await createEventManager();
      const roomLine: Record<string, unknown> = {
        roomType: 'Double',
        occupancy: 2,
        tariff: 5000,
        noOfRooms: 1,
      };
      delete roomLine[field];

      const error = await expectValidationError(Event, {
        eventFamilyType: 'Wedding',
        status: EventStatus.Tentative,
        eventManager: manager.id,
        createdBy: manager.id,
        accommodation: { roomLines: [roomLine] },
      });

      expect(error.errors).toHaveProperty(`accommodation.roomLines.0.${field}`);
    },
  );

  it('defaults payment to 0/unset for a brand-new Event with no payment activity', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
    });

    expect(event.payment).toMatchObject({
      totalEstimatedAmount: 0,
      advanceRequired: 0,
      advancePaid: 0,
    });
    expect(event.payment.advancePaidDate).toBeUndefined();
    expect(event.payment.paymentMode).toBeUndefined();
  });

  it('accepts a fully populated Payment Record', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      payment: {
        totalEstimatedAmount: 50000,
        advanceRequired: 20000,
        advancePaid: 20000,
        advancePaidDate: new Date('2026-05-01'),
        paymentMode: 'UPI',
      },
    });

    expect(event.payment).toMatchObject({
      totalEstimatedAmount: 50000,
      advanceRequired: 20000,
      advancePaid: 20000,
      paymentMode: 'UPI',
    });
    expect(event.payment.advancePaidDate).toEqual(new Date('2026-05-01'));
  });

  it.each(['totalEstimatedAmount', 'advanceRequired', 'advancePaid'])(
    'rejects a negative %s — money in cannot be negative',
    async (field) => {
      const manager = await createEventManager();

      const error = await expectValidationError(Event, {
        eventFamilyType: 'Wedding',
        status: EventStatus.Tentative,
        eventManager: manager.id,
        createdBy: manager.id,
        payment: { [field]: -1 },
      });

      expect(error.errors).toHaveProperty(`payment.${field}`);
    },
  );

  it('defaults every documentsChecklist item to false for a brand-new Event', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
    });

    expect(event.documentsChecklist).toMatchObject({
      aadharCard: false,
      panCard: false,
      leavingBirthCertificate: false,
      rationCard: false,
      passportPhotos: false,
      weddingCard: false,
    });
  });

  it('accepts a documentsChecklist with some items toggled true', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      documentsChecklist: { aadharCard: true, weddingCard: true },
    });

    expect(event.documentsChecklist).toMatchObject({
      aadharCard: true,
      panCard: false,
      weddingCard: true,
    });
  });

  it('accepts an Event with no sessions at all', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
    });

    expect(event.sessions).toEqual([]);
  });

  it('accepts a single-day session where start_date === end_date', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [validSession({ startDate: new Date('2026-06-15'), endDate: new Date('2026-06-15') })],
    });

    expect(event.sessions[0]?.startDate).toEqual(event.sessions[0]?.endDate);
  });

  it('accepts a multi-day session where end_date > start_date, the same code path as single-day', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [validSession({ startDate: new Date('2026-06-15'), endDate: new Date('2026-06-17') })],
    });

    expect(event.sessions).toHaveLength(1);
  });

  it('rejects a session with end_date before start_date', async () => {
    const manager = await createEventManager();

    const error = await expectValidationError(Event, {
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [validSession({ startDate: new Date('2026-06-15'), endDate: new Date('2026-06-14') })],
    });

    expect(error.errors).toHaveProperty('sessions.0.endDate');
  });

  it('defaults session_status to Active when not supplied', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [validSession()],
    });

    expect(event.sessions[0]?.sessionStatus).toBe(SessionStatus.Active);
  });

  it('accepts an explicit Cancelled session_status', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [validSession({ sessionStatus: SessionStatus.Cancelled })],
    });

    expect(event.sessions[0]?.sessionStatus).toBe(SessionStatus.Cancelled);
  });

  it('rejects a session_status outside Active/Cancelled', async () => {
    const manager = await createEventManager();

    const error = await expectValidationError(Event, {
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [{ ...validSession(), sessionStatus: 'Postponed' }],
    });

    expect(error.errors).toHaveProperty('sessions.0.sessionStatus');
  });

  it('defaults setup to its zero/false state for a session with no setup supplied', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [validSession()],
    });

    expect(event.sessions[0]?.setup).toMatchObject({
      tableCount: 0,
      chairCount: 0,
      stage: false,
      buffet: false,
      registrationDesk: false,
      vipSeating: false,
      brideGroomSeating: false,
    });
  });

  it('accepts a fully populated setup sub-object', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [
        validSession({
          setup: {
            seating: SeatingArrangement.RoundTables,
            tableCount: 20,
            chairCount: 200,
            stage: true,
            buffet: true,
            registrationDesk: true,
            vipSeating: true,
            brideGroomSeating: true,
            notes: 'Stage faces the lawn entrance.',
          },
        }),
      ],
    });

    expect(event.sessions[0]?.setup).toMatchObject({
      seating: SeatingArrangement.RoundTables,
      tableCount: 20,
      chairCount: 200,
      stage: true,
      notes: 'Stage faces the lawn entrance.',
    });
  });

  it('rejects a seating value outside the fixed arrangement list', async () => {
    const manager = await createEventManager();

    const error = await expectValidationError(Event, {
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [{ ...validSession(), setup: { seating: 'Igloo' } }],
    });

    expect(error.errors).toHaveProperty('sessions.0.setup.seating');
  });

  it.each(['sessionType', 'venue', 'startDate', 'endDate'])(
    'rejects a session missing %s',
    async (field) => {
      const manager = await createEventManager();
      const session: Record<string, unknown> = { ...validSession() };
      delete session[field];

      const error = await expectValidationError(Event, {
        eventFamilyType: 'Wedding',
        status: EventStatus.Tentative,
        eventManager: manager.id,
        createdBy: manager.id,
        sessions: [session],
      });

      expect(error.errors).toHaveProperty(`sessions.0.${field}`);
    },
  );

  it('accepts a valid Meal Item, with no event_name/venue required', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [
        validSession({
          items: [{ type: ItemType.Meal, mealName: 'Lunch', pax: 100, costPerPlate: 500, menuItems: [] }],
        }),
      ],
    });

    expect(event.sessions[0]?.items[0]).toMatchObject({
      type: ItemType.Meal,
      mealName: 'Lunch',
      pax: 100,
      costPerPlate: 500,
    });
  });

  it('accepts a valid Event Item, with no pax/cost_per_plate required', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [
        validSession({
          items: [{ type: ItemType.Event, eventName: 'Muhurta', venue: 'Lawn', menuItems: [] }],
        }),
      ],
    });

    expect(event.sessions[0]?.items[0]).toMatchObject({
      type: ItemType.Event,
      eventName: 'Muhurta',
      venue: 'Lawn',
    });
  });

  it('accepts a Meal Item with pax: 0 as a placeholder row', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [
        validSession({
          items: [{ type: ItemType.Meal, mealName: 'Lunch', pax: 0, costPerPlate: 500, menuItems: [] }],
        }),
      ],
    });

    expect(event.sessions[0]?.items[0]?.pax).toBe(0);
  });

  it('rejects an item with a type outside Meal/Event', async () => {
    const manager = await createEventManager();

    const error = await expectValidationError(Event, {
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [{ ...validSession(), items: [{ type: 'Snack', mealName: 'Lunch', pax: 1, costPerPlate: 1 }] }],
    });

    expect(error.errors).toHaveProperty('sessions.0.items.0.type');
  });

  it.each(['mealName', 'pax', 'costPerPlate'])(
    'rejects a Meal Item missing %s',
    async (field) => {
      const manager = await createEventManager();
      const item: Record<string, unknown> = { type: ItemType.Meal, mealName: 'Lunch', pax: 100, costPerPlate: 500 };
      delete item[field];

      const error = await expectValidationError(Event, {
        eventFamilyType: 'Wedding',
        status: EventStatus.Tentative,
        eventManager: manager.id,
        createdBy: manager.id,
        sessions: [{ ...validSession(), items: [item] }],
      });

      expect(error.errors).toHaveProperty(`sessions.0.items.0.${field}`);
    },
  );

  it.each(['eventName', 'venue'])('rejects an Event Item missing %s', async (field) => {
    const manager = await createEventManager();
    const item: Record<string, unknown> = { type: ItemType.Event, eventName: 'Muhurta', venue: 'Lawn' };
    delete item[field];

    const error = await expectValidationError(Event, {
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [{ ...validSession(), items: [item] }],
    });

    expect(error.errors).toHaveProperty(`sessions.0.items.0.${field}`);
  });

  it('does not require mealName/pax/costPerPlate on an Event Item', async () => {
    const manager = await createEventManager();

    const event = await Event.create({
      eventFamilyType: 'Wedding',
      status: EventStatus.Tentative,
      eventManager: manager.id,
      createdBy: manager.id,
      sessions: [
        validSession({ items: [{ type: ItemType.Event, eventName: 'Muhurta', venue: 'Lawn', menuItems: [] }] }),
      ],
    });

    expect(event.sessions[0]?.items[0]?.mealName).toBeUndefined();
    expect(event.sessions[0]?.items[0]?.pax).toBeUndefined();
    expect(event.sessions[0]?.items[0]?.costPerPlate).toBeUndefined();
  });

  it.each(['eventFamilyType', 'status', 'eventManager', 'createdBy'])(
    'rejects a document missing %s',
    async (field) => {
      const manager = await createEventManager();
      const data: Record<string, unknown> = {
        eventFamilyType: 'Wedding',
        status: EventStatus.Tentative,
        eventManager: manager.id,
        createdBy: manager.id,
      };
      delete data[field];

      const error = await expectValidationError(Event, data);

      expect(error.errors).toHaveProperty(field);
    },
  );
});
