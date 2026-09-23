import { ClientContactRole, EventStatus, ItemType, SeatingArrangement, SessionStatus } from '../models/event.js';
import { Role } from '../models/user.js';

export interface VisibilitySessionSetup {
  seating: SeatingArrangement | null;
  tableCount: number;
  chairCount: number;
  stage: boolean;
  buffet: boolean;
  registrationDesk: boolean;
  vipSeating: boolean;
  brideGroomSeating: boolean;
  notes: string | null;
}

export interface VisibilityItem {
  id: string;
  type: ItemType;
  mealName: string | null;
  pax: number | null;
  costPerPlate?: number | null;
  limitedSeating: boolean | null;
  menuItems: string[];
  eventName: string | null;
  venue: string | null;
  startTime: string | null;
  endTime: string | null;
  totalCost?: number | null;
}

export interface VisibilitySession {
  id: string;
  sessionType: string;
  venue: string;
  venueCost?: number;
  startDate: Date;
  endDate: Date;
  startTime: string | null;
  endTime: string | null;
  pax: number;
  sessionStatus: SessionStatus;
  durationDays: number;
  isMultiDay: boolean;
  setup?: VisibilitySessionSetup;
  items?: VisibilityItem[];
}

export interface VisibilityRoomLine {
  roomType: string;
  occupancy: number;
  tariff?: number;
  noOfRooms: number;
  totalInclGst?: number;
}

export interface VisibilityAccommodation {
  checkIn: Date | null;
  checkOut: Date | null;
  totalDays: number | null;
  roomLines: VisibilityRoomLine[];
  totalOccupancy: number;
  totalCharges?: number;
}

export interface VisibilityDocumentsChecklist {
  aadharCard: boolean;
  panCard: boolean;
  leavingBirthCertificate: boolean;
  rationCard: boolean;
  passportPhotos: boolean;
  weddingCard: boolean;
}

export interface VisibilityPayment {
  totalEstimatedAmount: number;
  advanceRequired: number;
  advancePaid: number;
  advancePaidDate: Date | null;
  paymentMode: string | null;
  balance: number;
}

export interface VisibilityExtras {
  decoration: number;
  photographer: number;
  bhatji: number;
}

export interface VisibilityManualLineItem {
  name: string;
  note: string | null;
  amount: number;
}

export interface VisibilityEvent {
  id: string;
  eventId: string;
  eventFamilyType: string;
  status: EventStatus;
  eventManager: string;
  clientContacts?: { name: string; contactNumber: string; role: ClientContactRole }[];
  accommodation?: VisibilityAccommodation;
  payment?: VisibilityPayment;
  documentsChecklist: VisibilityDocumentsChecklist;
  extras?: VisibilityExtras;
  extraLineItems?: VisibilityManualLineItem[];
  // STORY-072 — same money-adjacent class as extras/extraLineItems above;
  // it only ever feeds the Quotation's own Total Cost Summary, an
  // EventManager-only screen.
  foodGstRatePercent?: number;
  sessions: VisibilitySession[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Pure role-based projection of an already-built public Event object (SRS
 * §3, §5.5 FR-ROLE-1) — DB-free, taking/returning plain data so it's
 * unit-testable with no HTTP layer, and reusable by whatever else needs
 * the same per-role rule (STORY-047's dashboard "via STORY-046"). Every
 * omitted field is set to `undefined`, not deleted or nulled — Express's
 * `res.json` (via `JSON.stringify`) drops an `undefined`-valued key from
 * the wire response entirely, which is what "genuinely omits the field,
 * verify the raw JSON" (this story's own AC) requires; a Zod `.optional()`
 * field on the contract's own response schema accepts `undefined` the
 * same way.
 *
 * Field-visibility decisions (SRS §3.1-3.4 + this story's own AC text) —
 * documented here since neither source gives an exhaustive field list:
 * - EventManager: everything, unchanged (this story's own regression AC).
 * - Money is hidden end-to-end for every other role: `payment`, `extras`,
 *   `extraLineItems` (STORY-068's open-ended manual line items — the same
 *   class of figure as extras, hidden for the same reason),
 *   each Session's `venueCost`, each Item's `costPerPlate`/`totalCost`,
 *   and each Accommodation room line's `tariff`/`totalInclGst` plus the
 *   block's own `totalCharges` — the SRS only names the `payment` object
 *   explicitly, but `extras`/`venueCost`/room tariffs are money figures
 *   in the same class, and the story's own Decisions record this as a
 *   deliberate policy call, not an SRS-mandated one.
 * - `clientContacts`: F&B ("POC name/contact") and Reception ("Bride/Groom
 *   names") per SRS §3.2/§3.4; not Housekeeping (§3.3 never mentions it).
 * - `accommodation`: Housekeeping and Reception ("rooms booked") per
 *   §3.3/§3.4; not F&B (§3.2 never mentions rooms).
 * - `setup`: Housekeeping only ("seating/setup requirements, hall setup"
 *   per §3.3) — F&B's own "non-food setup details" exclusion is read as
 *   the whole `setup` object, since none of `SessionSetupAttributes`'
 *   fields are food-specific; Reception's §3.4 never mentions setup.
 * - `items`: F&B sees Meal Items only (§3.2's "menu... meal timing...
 *   food instructions" — Event Items like Muhurta/Cake Cutting aren't
 *   menu content), with the money fields above still stripped from them.
 *   Housekeeping and Reception get no items at all ("omits... menu/item
 *   fields" — this story's own AC, for both).
 * - `documentsChecklist`: every role — the SRS never restricts it, and
 *   STORY-024's own Decisions already settled this ("No role-filtering
 *   concern here unlike payment").
 */
export const filterEventForRole = (event: VisibilityEvent, role: Role): VisibilityEvent => {
  if (role === Role.EventManager) {
    return event;
  }

  const canSeeClientContacts = role === Role.FnBHead || role === Role.Reception;
  const canSeeAccommodation = role === Role.Housekeeping || role === Role.Reception;
  const canSeeSetup = role === Role.Housekeeping;
  const canSeeMenu = role === Role.FnBHead;

  return {
    ...event,
    clientContacts: canSeeClientContacts ? event.clientContacts : undefined,
    accommodation: canSeeAccommodation && event.accommodation ? filterAccommodation(event.accommodation) : undefined,
    payment: undefined,
    extras: undefined,
    extraLineItems: undefined,
    foodGstRatePercent: undefined,
    sessions: event.sessions.map((session) => filterSession(session, { canSeeSetup, canSeeMenu })),
  };
};

const filterAccommodation = (accommodation: VisibilityAccommodation): VisibilityAccommodation => ({
  ...accommodation,
  roomLines: accommodation.roomLines.map((line) => ({ ...line, tariff: undefined, totalInclGst: undefined })),
  totalCharges: undefined,
});

const filterSession = (
  session: VisibilitySession,
  { canSeeSetup, canSeeMenu }: { canSeeSetup: boolean; canSeeMenu: boolean }
): VisibilitySession => ({
  ...session,
  venueCost: undefined,
  setup: canSeeSetup ? session.setup : undefined,
  items: canSeeMenu
    ? (session.items ?? []).filter((item) => item.type === ItemType.Meal).map(filterItemMoney)
    : undefined,
});

const filterItemMoney = (item: VisibilityItem): VisibilityItem => ({
  ...item,
  costPerPlate: undefined,
  totalCost: undefined,
});
