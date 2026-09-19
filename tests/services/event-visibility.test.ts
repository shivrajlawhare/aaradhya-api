import { describe, expect, it } from 'vitest';
import { ClientContactRole, EventStatus, ItemType, SeatingArrangement, SessionStatus } from '../../src/models/event.js';
import { Role } from '../../src/models/user.js';
import { filterEventForRole, type VisibilityEvent } from '../../src/services/event-visibility.js';

const fixtureEvent: VisibilityEvent = {
  id: 'event-1',
  eventId: 'ARD-EVT-2026-001',
  eventFamilyType: 'Wedding',
  status: EventStatus.Tentative,
  eventManager: 'manager-1',
  clientContacts: [{ name: 'Priya Nair', contactNumber: '9876543210', role: ClientContactRole.Bride }],
  accommodation: {
    checkIn: new Date('2026-06-14T00:00:00.000Z'),
    checkOut: new Date('2026-06-16T00:00:00.000Z'),
    totalDays: 3,
    roomLines: [{ roomType: 'Double', occupancy: 2, tariff: 5000, noOfRooms: 1, totalInclGst: 5900 }],
    totalOccupancy: 2,
    totalCharges: 5900,
  },
  payment: {
    totalEstimatedAmount: 50000,
    advanceRequired: 20000,
    advancePaid: 20000,
    advancePaidDate: null,
    paymentMode: null,
    balance: 30000,
  },
  documentsChecklist: {
    aadharCard: true,
    panCard: false,
    leavingBirthCertificate: false,
    rationCard: false,
    passportPhotos: false,
    weddingCard: false,
  },
  extras: { decoration: 1000, photographer: 0, bhatji: 0 },
  extraLineItems: [{ name: 'Photographer', note: 'wedding', amount: 25000 }],
  foodGstRatePercent: 5,
  sessions: [
    {
      id: 'session-1',
      sessionType: 'Wedding',
      venue: 'Lawn',
      venueCost: 5000,
      startDate: new Date('2026-06-15T00:00:00.000Z'),
      endDate: new Date('2026-06-15T00:00:00.000Z'),
      startTime: null,
      endTime: null,
      pax: 200,
      sessionStatus: SessionStatus.Active,
      durationDays: 1,
      isMultiDay: false,
      setup: {
        seating: SeatingArrangement.Theatre,
        tableCount: 10,
        chairCount: 100,
        stage: false,
        buffet: true,
        registrationDesk: false,
        vipSeating: false,
        brideGroomSeating: false,
        notes: null,
      },
      items: [
        {
          id: 'item-1',
          type: ItemType.Meal,
          mealName: 'Lunch',
          pax: 100,
          costPerPlate: 500,
          limitedSeating: false,
          menuItems: ['menu-item-1'],
          eventName: null,
          venue: null,
          startTime: null,
          endTime: null,
          totalCost: 50000,
        },
        {
          id: 'item-2',
          type: ItemType.Event,
          mealName: null,
          pax: null,
          costPerPlate: null,
          limitedSeating: null,
          menuItems: [],
          eventName: 'Muhurta',
          venue: 'Lawn',
          startTime: '10:00',
          endTime: null,
          totalCost: null,
        },
      ],
    },
  ],
  createdBy: 'manager-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('filterEventForRole', () => {
  it('returns every field unchanged for EventManager (no regression from the unfiltered behavior)', () => {
    const result = filterEventForRole(fixtureEvent, Role.EventManager);

    expect(result).toEqual(fixtureEvent);
  });

  it('venue is genuinely visible to all four roles (this story\'s own edge case)', () => {
    for (const role of [Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception]) {
      const result = filterEventForRole(fixtureEvent, role);
      expect(result.sessions[0]?.venue).toBe('Lawn');
    }
  });

  describe('FnBHead', () => {
    const result = filterEventForRole(fixtureEvent, Role.FnBHead);

    it('includes client contacts (POC name/contact)', () => {
      expect(result.clientContacts).toEqual(fixtureEvent.clientContacts);
    });

    it('includes date(s), venue, and pax on the session', () => {
      expect(result.sessions[0]).toMatchObject({
        startDate: fixtureEvent.sessions[0]!.startDate,
        endDate: fixtureEvent.sessions[0]!.endDate,
        venue: 'Lawn',
        pax: 200,
      });
    });

    it('includes only the Meal Item (menu/meal timing), excluding the Event Item', () => {
      expect(result.sessions[0]!.items).toHaveLength(1);
      expect(result.sessions[0]!.items![0]).toMatchObject({ type: ItemType.Meal, mealName: 'Lunch' });
    });

    it('genuinely omits payment, extras, extraLineItems, foodGstRatePercent, venueCost, and Item money fields', () => {
      expect(result.payment).toBeUndefined();
      expect(result.extras).toBeUndefined();
      expect(result.extraLineItems).toBeUndefined();
      expect(result.foodGstRatePercent).toBeUndefined();
      expect(result.sessions[0]!.venueCost).toBeUndefined();
      expect(result.sessions[0]!.items![0]!.costPerPlate).toBeUndefined();
      expect(result.sessions[0]!.items![0]!.totalCost).toBeUndefined();
      expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('payment');
      expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('extras');
      expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('extraLineItems');
      expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('foodGstRatePercent');
    });

    it('genuinely omits non-food setup details and accommodation', () => {
      expect(result.sessions[0]!.setup).toBeUndefined();
      expect(result.accommodation).toBeUndefined();
      expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('accommodation');
    });
  });

  describe('Housekeeping', () => {
    const result = filterEventForRole(fixtureEvent, Role.Housekeeping);

    it('includes setup and accommodation (rooms booked)', () => {
      expect(result.sessions[0]!.setup).toEqual(fixtureEvent.sessions[0]!.setup);
      expect(result.accommodation).toBeDefined();
      expect(result.accommodation!.roomLines[0]).toMatchObject({ roomType: 'Double', occupancy: 2, noOfRooms: 1 });
    });

    it('genuinely omits payment, extras, and every money figure including room tariffs', () => {
      expect(result.payment).toBeUndefined();
      expect(result.extras).toBeUndefined();
      expect(result.sessions[0]!.venueCost).toBeUndefined();
      expect(result.accommodation!.totalCharges).toBeUndefined();
      expect(result.accommodation!.roomLines[0]!.tariff).toBeUndefined();
      expect(result.accommodation!.roomLines[0]!.totalInclGst).toBeUndefined();
      const raw = JSON.parse(JSON.stringify(result));
      expect(raw).not.toHaveProperty('payment');
      expect(raw).not.toHaveProperty('extras');
      expect(raw.accommodation.roomLines[0]).not.toHaveProperty('tariff');
    });

    it('genuinely omits menu/item fields and client contacts', () => {
      expect(result.sessions[0]!.items).toBeUndefined();
      expect(result.clientContacts).toBeUndefined();
      expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('clientContacts');
    });
  });

  describe('Reception', () => {
    const result = filterEventForRole(fixtureEvent, Role.Reception);

    it('includes client names, rooms, and check-in/out', () => {
      expect(result.clientContacts).toEqual(fixtureEvent.clientContacts);
      expect(result.accommodation).toBeDefined();
      expect(result.accommodation!.checkIn).toEqual(fixtureEvent.accommodation!.checkIn);
      expect(result.accommodation!.checkOut).toEqual(fixtureEvent.accommodation!.checkOut);
    });

    it('genuinely omits payment, extras, and every money figure including room tariffs', () => {
      expect(result.payment).toBeUndefined();
      expect(result.extras).toBeUndefined();
      expect(result.sessions[0]!.venueCost).toBeUndefined();
      expect(result.accommodation!.totalCharges).toBeUndefined();
      expect(result.accommodation!.roomLines[0]!.tariff).toBeUndefined();
    });

    it('genuinely omits menu/item fields and setup', () => {
      expect(result.sessions[0]!.items).toBeUndefined();
      expect(result.sessions[0]!.setup).toBeUndefined();
    });
  });

  it('produces four independently distinct response shapes for the same fixture Event (this story\'s own AC)', () => {
    const shapes = [Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception].map((role) =>
      JSON.stringify(filterEventForRole(fixtureEvent, role)),
    );

    expect(new Set(shapes).size).toBe(4);
  });
});
