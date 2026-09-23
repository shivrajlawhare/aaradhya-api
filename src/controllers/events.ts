import type { ServerInferRequest, ServerInferResponses } from '@ts-rest/core';
import type { AppRouteMutationImplementation, AppRouteQueryImplementation } from '@ts-rest/express';
import { Error as MongooseError, type QueryFilter, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { contract } from '../contract/index.js';
import { ChangeLogEntry } from '../models/change-log-entry.js';
import {
  type AccommodationAttributes,
  type ClientContactAttributes,
  DOCUMENT_CHECKLIST_ITEM_KEYS,
  type DocumentsChecklistAttributes,
  Event,
  type EventAttributes,
  type EventDocument,
  EventStatus,
  type ExtrasAttributes,
  ItemType,
  type ManualLineItemAttributes,
  type PaymentAttributes,
  type RoomLineAttributes,
  type SessionAttributes,
  type SessionSetupAttributes,
  SessionStatus,
} from '../models/event.js';
import { MenuItem, type MenuItemDocument } from '../models/menu-item.js';
import { User } from '../models/user.js';
import {
  computeRoomLineTotalInclGst,
  computeTotalCharges,
  computeTotalDays,
  computeTotalOccupancy,
} from '../services/accommodation.js';
import { renderPdfFromUrl } from '../services/browser-pdf.js';
import { logChange } from '../services/change-log.js';
import { filterEventForRole } from '../services/event-visibility.js';
import { computeTotalCost } from '../services/item.js';
import { computeBalance } from '../services/payment.js';
import { computeTotalCostSummary } from '../services/quotation.js';
import {
  computeDurationDays,
  computeIsMultiDay,
  computeMonthRange,
  sessionOverlapsMonth,
} from '../services/session.js';
import { signSessionToken } from '../services/token.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';
import { escapeRegExp } from '../utils/regex.js';

type CreateEventResponse = ServerInferResponses<typeof contract.createEvent>;
type GetEventResponse = ServerInferResponses<typeof contract.getEvent>;
type UpdateEventResponse = ServerInferResponses<typeof contract.updateEvent>;
type UpdateEventBody = ServerInferRequest<typeof contract.updateEvent>['body'];
type UpdateEventAccommodationBody = ServerInferRequest<typeof contract.updateEventAccommodation>['body'];
type UpdateEventPaymentBody = ServerInferRequest<typeof contract.updateEventPayment>['body'];
type UpdateDocumentsChecklistBody = ServerInferRequest<typeof contract.updateDocumentsChecklist>['body'];
type UpdateEventExtrasBody = ServerInferRequest<typeof contract.updateEventExtras>['body'];
type CreateSessionResponse = ServerInferResponses<typeof contract.createSession>;
type UpdateSessionResponse = ServerInferResponses<typeof contract.updateSession>;
type UpdateSessionBody = ServerInferRequest<typeof contract.updateSession>['body'];
type DeleteSessionResponse = ServerInferResponses<typeof contract.deleteSession>;
type CreateItemResponse = ServerInferResponses<typeof contract.createItem>;
type UpdateItemResponse = ServerInferResponses<typeof contract.updateItem>;
type UpdateItemBody = ServerInferRequest<typeof contract.updateItem>['body'];

// Narrow (single-member), not the whole per-route union, so the same
// constant can be returned from any handler whose response union happens to
// share this exact 400/404 shape (they all reuse apiErrorSchema) — avoids
// three near-identical object literals across createEvent/getEvent/updateEvent.
const eventNotFound: Extract<GetEventResponse, { status: 404 }> = {
  status: 404,
  body: { error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' } },
};

// Distinct from eventNotFound — the Event itself exists, but no Session on
// it matches :sid (a stale link, a session already deleted, or a sid from a
// different Event entirely).
const sessionNotFound: Extract<UpdateSessionResponse, { status: 404 }> = {
  status: 404,
  body: { error: { code: 'SESSION_NOT_FOUND', message: 'No Session with that id on this Event.' } },
};

// Distinct from sessionNotFound the same way that's distinct from
// eventNotFound — the Event and Session both exist, but no Item on the
// Session matches :iid.
const itemNotFound: Extract<UpdateItemResponse, { status: 404 }> = {
  status: 404,
  body: { error: { code: 'ITEM_NOT_FOUND', message: 'No Item with that id on this Session.' } },
};

// This story's own edge case: referencing a menuItems id that doesn't
// resolve to a real Menu Item is a 400, not a silent no-op (and not a
// 404 — the Item/Session/Event path is well-formed, only the referenced
// id inside the body is bad, matching how invalidEventManager/
// invalidSessionDateRange are both 400s for the same "well-formed
// request, bad reference/value" reason).
const invalidMenuItemReference: Extract<CreateItemResponse, { status: 400 }> = {
  status: 400,
  body: {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body.',
      details: [{ field: 'menuItems', message: 'menuItems must reference existing Menu Items.' }],
    },
  },
};

const invalidEventManager: Extract<CreateEventResponse, { status: 400 }> = {
  status: 400,
  body: {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body.',
      details: [
        {
          field: 'eventManager',
          message: 'event_manager must reference an existing User Account with the EventManager role.',
        },
      ],
    },
  },
};

// STORY-068 — same body/reasoning as invalidMenuItemReference above, typed
// against CreateEventResponse instead of CreateItemResponse since a bad
// menuItems reference nested inside createEvent's own sessions[].items[]
// is caught by this route now too, not only the standalone
// POST .../items endpoint.
const invalidMenuItemReferenceOnCreateEvent: Extract<CreateEventResponse, { status: 400 }> = {
  status: 400,
  body: {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body.',
      details: [{ field: 'sessions', message: 'menuItems must reference existing Menu Items.' }],
    },
  },
};

// checkIn/checkOut/totalDays are nullable, not just absent — an Event can
// genuinely have no accommodation entered yet (accommodation itself is
// optional on the Event, STORY-018). totalOccupancy/totalCharges default to
// 0 for an empty roomLines array — "no rooms" is a valid, common case
// (STORY-019's own edge case), not an error state.
const toPublicAccommodation = (accommodation: AccommodationAttributes | undefined) => {
  const checkIn = accommodation?.checkIn ?? null;
  const checkOut = accommodation?.checkOut ?? null;
  const roomLines = accommodation?.roomLines ?? [];
  const totalDays = checkIn && checkOut ? computeTotalDays(checkIn, checkOut) : null;
  // A room line entered before check-in/check-out are both set still needs
  // some total to display — falls back to 1 (STORY-068's own decision,
  // see accommodation.ts's own computeRoomLineTotalInclGst comment) rather
  // than always reading 0 for every line until dates are chosen.
  const totalDaysForMath = totalDays ?? 1;

  return {
    checkIn,
    checkOut,
    totalDays,
    roomLines: roomLines.map((line) => ({
      roomType: line.roomType,
      occupancy: line.occupancy,
      tariff: line.tariff,
      noOfRooms: line.noOfRooms,
      totalInclGst: computeRoomLineTotalInclGst(line, totalDaysForMath),
    })),
    totalOccupancy: computeTotalOccupancy(roomLines),
    totalCharges: computeTotalCharges(roomLines, totalDaysForMath),
  };
};

// advancePaidDate/paymentMode are nullable, not just absent — matching
// accommodation's checkIn/checkOut convention. balance is always freshly
// computed from whatever totalEstimatedAmount/advancePaid are currently
// stored, never itself stored (STORY-021).
const toPublicPayment = (payment: PaymentAttributes) => ({
  totalEstimatedAmount: payment.totalEstimatedAmount,
  advanceRequired: payment.advanceRequired,
  advancePaid: payment.advancePaid,
  advancePaidDate: payment.advancePaidDate ?? null,
  paymentMode: payment.paymentMode ?? null,
  balance: computeBalance(payment.totalEstimatedAmount, payment.advancePaid),
});

const toPublicExtras = (extras: ExtrasAttributes) => ({
  decoration: extras.decoration,
  photographer: extras.photographer,
  bhatji: extras.bhatji,
});

const toPublicExtraLineItems = (items: ManualLineItemAttributes[]) =>
  items.map((item) => ({ name: item.name, note: item.note ?? null, amount: item.amount }));

const toPublicDocumentsChecklist = (checklist: DocumentsChecklistAttributes) => ({
  aadharCard: checklist.aadharCard,
  panCard: checklist.panCard,
  leavingBirthCertificate: checklist.leavingBirthCertificate,
  rationCard: checklist.rationCard,
  passportPhotos: checklist.passportPhotos,
  weddingCard: checklist.weddingCard,
});

// The hydrated element type of EventDocument['sessions'] — a real Mongoose
// subdocument (Document methods like `.set()`/`.deleteOne()` included), not
// the plain SessionAttributes interface. Indexed off EventDocument itself
// rather than hand-reconstructed, so it always matches whatever Mongoose
// actually infers for a Types.DocumentArray element.
type SessionSubdocument = EventDocument['sessions'][number];

// The hydrated element type of a Session subdocument's own `items` —
// same reasoning SessionSubdocument documents above for `sessions`.
type ItemSubdocument = SessionSubdocument['items'][number];

const toPublicSessionSetup = (setup: SessionSetupAttributes) => ({
  seating: setup.seating ?? null,
  tableCount: setup.tableCount,
  chairCount: setup.chairCount,
  stage: setup.stage,
  buffet: setup.buffet,
  registrationDesk: setup.registrationDesk,
  vipSeating: setup.vipSeating,
  brideGroomSeating: setup.brideGroomSeating,
  notes: setup.notes ?? null,
});

// mealName/pax/costPerPlate are Meal-only; eventName/venue are Event-only —
// nullable, not just absent, same convention setup's own seating/notes
// already use. total_cost is always freshly computed from whatever
// pax/costPerPlate are currently stored (STORY-031's computeTotalCost) —
// never itself stored, so a submitted total_cost is silently ignored
// (STORY-032's own AC), and it's null for an Event Item, where the
// concept doesn't apply.
const toPublicItem = (item: ItemSubdocument) => ({
  id: item._id.toString(),
  type: item.type,
  mealName: item.mealName ?? null,
  pax: item.pax ?? null,
  costPerPlate: item.costPerPlate ?? null,
  limitedSeating: item.limitedSeating ?? null,
  menuItems: item.menuItems.map((ref) => ref.toString()),
  eventName: item.eventName ?? null,
  venue: item.venue ?? null,
  startTime: item.startTime ?? null,
  endTime: item.endTime ?? null,
  totalCost:
    item.pax !== undefined && item.costPerPlate !== undefined
      ? computeTotalCost({ pax: item.pax, costPerPlate: item.costPerPlate, limitedSeating: item.limitedSeating })
      : null,
});

// durationDays/isMultiDay reuse STORY-026's own computeDurationDays/
// computeIsMultiDay — never stored, always freshly computed from whatever
// startDate/endDate are currently on the Session, same "derived, never
// trusted from the client" convention totalDays (accommodation) and
// balance (payment) already established. Reads `_id` (not `.id`) — a
// Types.DocumentArray's own subdocument type only declares `_id` typed
// (Types.ObjectId), unlike a top-level HydratedDocument which also gets a
// typed `.id` string virtual. items reuses STORY-032's own toPublicItem —
// GET /events/:id exposed it only once the Session form (STORY-033)
// actually needed to read/edit current Item data.
const toPublicSession = (session: SessionSubdocument) => ({
  id: session._id.toString(),
  sessionType: session.sessionType,
  venue: session.venue,
  venueCost: session.venueCost,
  startDate: session.startDate,
  endDate: session.endDate,
  startTime: session.startTime ?? null,
  endTime: session.endTime ?? null,
  pax: session.pax,
  sessionStatus: session.sessionStatus,
  durationDays: computeDurationDays(session),
  isMultiDay: computeIsMultiDay(session),
  setup: toPublicSessionSetup(session.setup),
  items: session.items.map(toPublicItem),
});

// accommodation/payment/documentsChecklist/sessions each reuse their own
// toPublicX helper — GET /events/:id exposed none of them until a UI story
// actually needed to read current state on first render (STORY-020 for
// accommodation, STORY-023 for payment, STORY-025 for the checklist, now
// STORY-029 for sessions). Additive only: every existing consumer of this
// shape just gets more fields.
// Exported — STORY-047's dashboard controller reuses this directly (the
// same live Event data, no separate dashboard-specific projection) rather
// than duplicating the whole toPublicX chain in a second file.
export const toPublicEvent = (event: EventDocument) => ({
  id: event.id,
  eventId: event.eventId,
  eventFamilyType: event.eventFamilyType,
  status: event.status,
  eventManager: event.eventManager.toString(),
  clientContacts: event.clientContacts.map((contact) => ({
    name: contact.name,
    contactNumber: contact.contactNumber,
    role: contact.role,
  })),
  accommodation: toPublicAccommodation(event.accommodation),
  payment: toPublicPayment(event.payment),
  documentsChecklist: toPublicDocumentsChecklist(event.documentsChecklist),
  extras: toPublicExtras(event.extras),
  extraLineItems: toPublicExtraLineItems(event.extraLineItems),
  foodGstRatePercent: event.foodGstRatePercent,
  sessions: event.sessions.map(toPublicSession),
  createdBy: event.createdBy.toString(),
  createdAt: event.createdAt,
  updatedAt: event.updatedAt,
});

// Drops the subdocument's own `_id` so a stored row compares equal to a
// plain submitted row shaped the same as clientContactInputSchema.
const toPlainContact = ({ name, contactNumber, role }: ClientContactAttributes) => ({
  name,
  contactNumber,
  role,
});

const areClientContactsEqual = (stored: ClientContactAttributes[], submitted: ClientContactAttributes[]): boolean =>
  JSON.stringify(stored.map(toPlainContact)) === JSON.stringify(submitted.map(toPlainContact));

// Drops the subdocument's own `_id` so a stored room line compares equal to
// a plain submitted line shaped the same as roomLineInputSchema.
const toPlainRoomLine = ({ roomType, occupancy, tariff, noOfRooms }: RoomLineAttributes) => ({
  roomType,
  occupancy,
  tariff,
  noOfRooms,
});

const areRoomLinesEqual = (stored: RoomLineAttributes[], submitted: RoomLineAttributes[]): boolean =>
  JSON.stringify(stored.map(toPlainRoomLine)) === JSON.stringify(submitted.map(toPlainRoomLine));

// STORY-011's schema already rejects an event_manager that doesn't resolve
// to an existing EventManager-role User Account via a custom validator on
// that path — this just recognises that specific failure so it can be
// reshaped into the same VALIDATION_ERROR envelope every other bad-body
// case returns, instead of an unhandled 500.
const isInvalidEventManagerError = (error: unknown): boolean =>
  error instanceof MongooseError.ValidationError && 'eventManager' in error.errors;

// event_id (server-generated), status's Tentative default, and createdBy
// are never taken as-is from the body: event_id is always minted by
// STORY-011's schema; status falls back to Tentative only when the caller
// omits it (FR-EVT-1 treats "initial status" as a real creation input, not
// something always fixed); createdBy always comes from the authenticated
// caller, never the request body, even if one is present.
//
// STORY-068 — sessions (each with their own items) and accommodation are
// now optional nested input here too (FR-EVT-8: "exactly one data-entry
// flow"), not only settable afterward via the separate per-Session/
// per-Item/PATCH-accommodation routes. Building the nested `sessions`
// array up front (resolving each Meal Item's own menuItems refs first,
// the same find-or-create resolveMenuItemRefs already used by the
// standalone createItem) lets the whole tree persist in the single
// Event.create() call below — every field on it is embedded, not
// referenced, so there's no multi-document transaction to reason about.
const buildSessionsInput = async (
  sessions: ServerInferRequest<typeof contract.createEvent>['body']['sessions']
): Promise<Record<string, unknown>[] | 'invalid-menu-item-reference'> => {
  const resolvedSessions: Record<string, unknown>[] = [];
  for (const session of sessions ?? []) {
    const resolvedItems: Record<string, unknown>[] = [];
    for (const item of session.items ?? []) {
      if (item.type === ItemType.Meal) {
        let menuItemIds: Types.ObjectId[] = [];
        if (item.menuItems) {
          const resolved = await resolveMenuItemRefs(item.menuItems);
          if (!resolved) {
            return 'invalid-menu-item-reference';
          }
          menuItemIds = resolved;
        }
        resolvedItems.push({
          type: ItemType.Meal,
          mealName: item.mealName,
          pax: item.pax,
          costPerPlate: item.costPerPlate,
          limitedSeating: item.limitedSeating ?? false,
          menuItems: menuItemIds,
          startTime: item.startTime,
          endTime: item.endTime,
        });
      } else {
        resolvedItems.push({
          type: ItemType.Event,
          eventName: item.eventName,
          venue: item.venue,
          startTime: item.startTime,
          endTime: item.endTime,
        });
      }
    }
    resolvedSessions.push({
      sessionType: session.sessionType,
      venue: session.venue,
      venueCost: session.venueCost,
      startDate: session.startDate,
      endDate: session.endDate,
      startTime: session.startTime,
      endTime: session.endTime,
      pax: session.pax,
      setup: session.setup,
      items: resolvedItems,
    });
  }
  return resolvedSessions;
};

export const createEvent: AppRouteMutationImplementation<typeof contract.createEvent> = async ({ body, req }) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('createEvent handler ran without an authenticated user.');
  }

  const sessionsInput = await buildSessionsInput(body.sessions);
  if (sessionsInput === 'invalid-menu-item-reference') {
    return invalidMenuItemReferenceOnCreateEvent;
  }

  try {
    const event = await Event.create({
      eventFamilyType: body.eventFamilyType,
      status: body.status ?? EventStatus.Tentative,
      eventManager: body.eventManager,
      clientContacts: body.clientContacts,
      sessions: sessionsInput,
      accommodation: body.accommodation,
      extras: body.extras,
      extraLineItems: body.extraLineItems ?? [],
      foodGstRatePercent: body.foodGstRatePercent,
      createdBy: req.user.id,
    });
    return { status: 201, body: toPublicEvent(event) };
  } catch (error) {
    if (isInvalidEventManagerError(error)) {
      return invalidEventManager;
    }
    if (isInvalidSessionDateRangeError(error)) {
      return invalidSessionDateRange;
    }
    throw error;
  }
};

// No role restriction — that's a later story's job (per STORY-013's Flow:
// "role-based field filtering is a separate later story"). Every field
// STORY-011's schema persists is returned as-is to any authenticated caller.
export const listEvents: AppRouteQueryImplementation<typeof contract.listEvents> = async () => {
  const events = await Event.find().sort({ createdAt: 1 });
  return { status: 200, body: events.map(toPublicEvent) };
};

// status/eventManager/eventFamilyType are plain top-level Event fields —
// Mongo ANDs sibling query keys automatically, no $elemMatch needed to
// combine them with each other or with the sessions-level condition below.
// venue/from/to are all Session-level, so they're combined into ONE
// $elemMatch — this story's own AC ("same interval-overlap logic as
// STORY-034") plus FR-SES-8 ("uses the same interval-overlap logic as the
// calendar, per §4.2") read as: the full §4.2 rule, not just its date-math
// half, so a Cancelled session (or one missing a date) is excluded from a
// venue/date search exactly as it is from the calendar, not just from a
// date-range search specifically. Returning whole Events (not flattened
// sessions, unlike STORY-034) means $elemMatch alone is sufficient — no
// further in-memory re-filter is needed, since "this Event has at least
// one qualifying Session" is exactly what should make it match.
export const searchEvents: AppRouteQueryImplementation<typeof contract.searchEvents> = async ({ query }) => {
  const filter: QueryFilter<EventAttributes> = {};

  if (query.status) {
    filter.status = query.status;
  }
  if (query.eventManager) {
    filter.eventManager = query.eventManager;
  }
  if (query.eventFamilyType) {
    filter.eventFamilyType = query.eventFamilyType;
  }
  if (query.venue || query.from || query.to) {
    filter.sessions = {
      $elemMatch: {
        sessionStatus: SessionStatus.Active,
        ...(query.venue ? { venue: query.venue } : {}),
        ...(query.to ? { startDate: { $lte: query.to } } : {}),
        ...(query.from ? { endDate: { $gte: query.from } } : {}),
      },
    };
  }

  const events = await Event.find(filter).sort({ createdAt: 1 });
  return { status: 200, body: events.map(toPublicEvent) };
};

// STORY-046 — the response is filtered per req.user.role; see
// src/services/event-visibility.ts for the actual field-visibility rules
// and their reasoning. EventManager gets toPublicEvent's own output
// unchanged (filterEventForRole's own early return).
export const getEvent: AppRouteQueryImplementation<typeof contract.getEvent> = async ({ params, req }) => {
  if (!req.user) {
    // Unreachable — authenticatedOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('getEvent handler ran without an authenticated user.');
  }
  const event = await Event.findById(params.id);
  if (!event) {
    return eventNotFound;
  }
  return { status: 200, body: filterEventForRole(toPublicEvent(event), req.user.role) };
};

interface PendingChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

// Only a field the caller actually sent, and whose value genuinely differs
// from what's stored, becomes both a $set entry and a queued Change Log
// Entry — a PATCH that resends identical values writes no log entry at all.
// This is a deliberate reading of STORY-008's "the caller decides whether a
// change is real before invoking the helper" line: the helper itself still
// always writes when called (STORY-008's own behavior, unchanged), but this
// controller is exactly the caller that line is talking about.
const buildEventUpdate = (
  existing: EventDocument,
  body: UpdateEventBody
): { update: Record<string, unknown>; changes: PendingChange[] } => {
  const update: Record<string, unknown> = {};
  const changes: PendingChange[] = [];

  if (body.eventFamilyType !== undefined && body.eventFamilyType !== existing.eventFamilyType) {
    update.eventFamilyType = body.eventFamilyType;
    changes.push({ field: 'eventFamilyType', oldValue: existing.eventFamilyType, newValue: body.eventFamilyType });
  }
  if (body.status !== undefined && body.status !== existing.status) {
    update.status = body.status;
    changes.push({ field: 'status', oldValue: existing.status, newValue: body.status });
  }
  if (body.eventManager !== undefined && body.eventManager !== existing.eventManager.toString()) {
    update.eventManager = body.eventManager;
    changes.push({
      field: 'eventManager',
      oldValue: existing.eventManager.toString(),
      newValue: body.eventManager,
    });
  }
  if (body.clientContacts !== undefined && !areClientContactsEqual(existing.clientContacts, body.clientContacts)) {
    update.clientContacts = body.clientContacts;
    changes.push({
      field: 'clientContacts',
      oldValue: existing.clientContacts.map(toPlainContact),
      newValue: body.clientContacts,
    });
  }
  if (body.foodGstRatePercent !== undefined && body.foodGstRatePercent !== existing.foodGstRatePercent) {
    update.foodGstRatePercent = body.foodGstRatePercent;
    changes.push({
      field: 'foodGstRatePercent',
      oldValue: existing.foodGstRatePercent,
      newValue: body.foodGstRatePercent,
    });
  }

  return { update, changes };
};

// Concurrent edits to the same Event by two Event Managers are not
// reconciled — last write to actually reach the database wins, same as a
// plain findByIdAndUpdate always behaves. Acceptable for v1 (deliberate
// non-requirement, not a bug) — nothing in this story asks for optimistic
// locking or a conflict response.
export const updateEvent: AppRouteMutationImplementation<typeof contract.updateEvent> = async ({
  params,
  body,
  req,
}) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('updateEvent handler ran without an authenticated user.');
  }
  const changedByUserId = req.user.id;

  const existing = await Event.findById(params.id);
  if (!existing) {
    return eventNotFound;
  }

  const { update, changes } = buildEventUpdate(existing, body);

  if (changes.length === 0) {
    return { status: 200, body: toPublicEvent(existing) };
  }

  let updated: EventDocument | null;
  try {
    updated = await Event.findByIdAndUpdate(params.id, update, {
      returnDocument: 'after',
      runValidators: true,
    });
  } catch (error) {
    if (isInvalidEventManagerError(error)) {
      return invalidEventManager;
    }
    throw error;
  }
  if (!updated) {
    return eventNotFound;
  }
  const eventId = updated.id;

  // STORY-081 — one groupId per handler invocation (not per field), so the
  // Activity tab can render every field this single PATCH touched as one
  // grouped edit action instead of N unrelated rows.
  const groupId = randomUUID();
  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
        groupId,
      })
    )
  );

  return { status: 200, body: toPublicEvent(updated) };
};

// STORY-084 — hard delete: removes the Event document itself plus every
// ChangeLogEntry row logged against it. Sessions/Items/Accommodation/
// Payment/Documents Checklist/Extras are embedded sub-documents on the
// Event schema itself, so they're removed automatically with it — no
// separate cleanup needed. User/MenuItem/Venue/EventType/RoomType are
// master lists an Event only ever references outward, never owns, so none
// of them are touched here.
//
// Sequential, not transactional — Event.findByIdAndDelete, then (only once
// that's confirmed a real Event existed) ChangeLogEntry.deleteMany, not
// wrapped in mongoose.startSession(). This codebase has no transactional
// precedent anywhere (grepped: zero uses of startSession), and a plain
// standalone dev MongoDB instance can't run transactions without a replica
// set — introducing that infrastructure for a single low-traffic admin
// action isn't worth it. Deliberate trade-off, documented rather than
// silently accepted: if the process crashes between the two deletes, an
// orphaned ChangeLogEntry set could remain (never a duplicated/corrupted
// Event, since this only returns success once the Event delete has already
// completed).
//
// Typed as AppRouteQueryImplementation, not AppRouteMutationImplementation
// — same reasoning deleteSession/deleteItem already document: a DELETE with
// no request body is ts-rest's no-body variant.
export const deleteEvent: AppRouteQueryImplementation<typeof contract.deleteEvent> = async ({ params }) => {
  const deleted = await Event.findByIdAndDelete(params.id);
  if (!deleted) {
    return eventNotFound;
  }

  await ChangeLogEntry.deleteMany({ entityType: 'Event', entityId: params.id });

  return { status: 204, body: undefined };
};

const areDatesEqual = (a: Date | undefined, b: Date | undefined): boolean =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

// checkIn/checkOut/roomLines are the three "fields" tracked here — one
// Change Log Entry per changed field, same granularity STORY-014 already
// uses for the rest of the Event (a whole-array change to roomLines is one
// entry with the full before/after array, not one entry per room line,
// exactly mirroring how clientContacts is logged). The logged roomLines
// value is the raw stored shape only — never totalInclGst, since that's
// never stored (STORY-018) and logging a transient, always-recomputed value
// would misrepresent what's actually persisted.
const buildAccommodationUpdate = (
  existing: EventDocument,
  body: UpdateEventAccommodationBody
): { update: Record<string, unknown>; changes: PendingChange[] } => {
  const currentAccommodation = existing.accommodation;
  const update: Record<string, unknown> = {};
  const changes: PendingChange[] = [];

  if (body.checkIn !== undefined && !areDatesEqual(body.checkIn, currentAccommodation?.checkIn)) {
    update['accommodation.checkIn'] = body.checkIn;
    changes.push({ field: 'checkIn', oldValue: currentAccommodation?.checkIn ?? null, newValue: body.checkIn });
  }
  if (body.checkOut !== undefined && !areDatesEqual(body.checkOut, currentAccommodation?.checkOut)) {
    update['accommodation.checkOut'] = body.checkOut;
    changes.push({
      field: 'checkOut',
      oldValue: currentAccommodation?.checkOut ?? null,
      newValue: body.checkOut,
    });
  }
  if (body.roomLines !== undefined && !areRoomLinesEqual(currentAccommodation?.roomLines ?? [], body.roomLines)) {
    update['accommodation.roomLines'] = body.roomLines;
    changes.push({
      field: 'roomLines',
      oldValue: (currentAccommodation?.roomLines ?? []).map(toPlainRoomLine),
      newValue: body.roomLines,
    });
  }

  return { update, changes };
};

// Same last-write-wins, no-locking stance STORY-014 already documented for
// the rest of the Event — nothing here adds optimistic concurrency either.
export const updateEventAccommodation: AppRouteMutationImplementation<
  typeof contract.updateEventAccommodation
> = async ({ params, body, req }) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('updateEventAccommodation handler ran without an authenticated user.');
  }
  const changedByUserId = req.user.id;

  const existing = await Event.findById(params.id);
  if (!existing) {
    return eventNotFound;
  }

  const { update, changes } = buildAccommodationUpdate(existing, body);

  if (changes.length === 0) {
    return { status: 200, body: toPublicAccommodation(existing.accommodation) };
  }

  const updated = await Event.findByIdAndUpdate(params.id, update, {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!updated) {
    return eventNotFound;
  }
  const eventId = updated.id;

  // STORY-081 — one groupId per handler invocation (not per field), so the
  // Activity tab can render every field this single PATCH touched as one
  // grouped edit action instead of N unrelated rows.
  const groupId = randomUUID();
  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
        groupId,
      })
    )
  );

  return { status: 200, body: toPublicAccommodation(updated.accommodation) };
};

// Five tracked fields, one Change Log Entry per changed field — same
// granularity every other PATCH on Event uses. No cross-field validation
// between advancePaidDate and advancePaid: this story's own edge case is
// resolved as "allowed" (see the story backlog Decisions), so setting one
// without the other already being real is never rejected here.
const buildPaymentUpdate = (
  existing: EventDocument,
  body: UpdateEventPaymentBody
): { update: Record<string, unknown>; changes: PendingChange[] } => {
  const current = existing.payment;
  const update: Record<string, unknown> = {};
  const changes: PendingChange[] = [];

  if (body.totalEstimatedAmount !== undefined && body.totalEstimatedAmount !== current.totalEstimatedAmount) {
    update['payment.totalEstimatedAmount'] = body.totalEstimatedAmount;
    changes.push({
      field: 'totalEstimatedAmount',
      oldValue: current.totalEstimatedAmount,
      newValue: body.totalEstimatedAmount,
    });
  }
  if (body.advanceRequired !== undefined && body.advanceRequired !== current.advanceRequired) {
    update['payment.advanceRequired'] = body.advanceRequired;
    changes.push({ field: 'advanceRequired', oldValue: current.advanceRequired, newValue: body.advanceRequired });
  }
  if (body.advancePaid !== undefined && body.advancePaid !== current.advancePaid) {
    update['payment.advancePaid'] = body.advancePaid;
    changes.push({ field: 'advancePaid', oldValue: current.advancePaid, newValue: body.advancePaid });
  }
  if (body.advancePaidDate !== undefined && !areDatesEqual(body.advancePaidDate, current.advancePaidDate)) {
    update['payment.advancePaidDate'] = body.advancePaidDate;
    changes.push({
      field: 'advancePaidDate',
      oldValue: current.advancePaidDate ?? null,
      newValue: body.advancePaidDate,
    });
  }
  if (body.paymentMode !== undefined && body.paymentMode !== current.paymentMode) {
    update['payment.paymentMode'] = body.paymentMode;
    changes.push({ field: 'paymentMode', oldValue: current.paymentMode ?? null, newValue: body.paymentMode });
  }

  return { update, changes };
};

// Same last-write-wins, no-locking stance every other Event PATCH already
// documents — nothing here adds optimistic concurrency either.
export const updateEventPayment: AppRouteMutationImplementation<typeof contract.updateEventPayment> = async ({
  params,
  body,
  req,
}) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('updateEventPayment handler ran without an authenticated user.');
  }
  const changedByUserId = req.user.id;

  const existing = await Event.findById(params.id);
  if (!existing) {
    return eventNotFound;
  }

  const { update, changes } = buildPaymentUpdate(existing, body);

  if (changes.length === 0) {
    return { status: 200, body: toPublicPayment(existing.payment) };
  }

  const updated = await Event.findByIdAndUpdate(params.id, update, {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!updated) {
    return eventNotFound;
  }
  const eventId = updated.id;

  // STORY-081 — one groupId per handler invocation (not per field), so the
  // Activity tab can render every field this single PATCH touched as one
  // grouped edit action instead of N unrelated rows.
  const groupId = randomUUID();
  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
        groupId,
      })
    )
  );

  return { status: 200, body: toPublicPayment(updated.payment) };
};

// Unlike buildEventUpdate/buildAccommodationUpdate/buildPaymentUpdate, this
// loops over DOCUMENT_CHECKLIST_ITEM_KEYS instead of repeating one `if`
// block per field — every item here is a plain boolean with the same `!==`
// comparison, so there's no per-field custom logic (date/array/ObjectId
// compares) forcing those other three into their more repetitive shape.
const buildDocumentsChecklistUpdate = (
  existing: EventDocument,
  body: UpdateDocumentsChecklistBody
): { update: Record<string, unknown>; changes: PendingChange[] } => {
  const current = existing.documentsChecklist;
  const update: Record<string, unknown> = {};
  const changes: PendingChange[] = [];

  for (const key of DOCUMENT_CHECKLIST_ITEM_KEYS) {
    const newValue = body[key];
    if (newValue !== undefined && newValue !== current[key]) {
      update[`documentsChecklist.${key}`] = newValue;
      changes.push({ field: key, oldValue: current[key], newValue });
    }
  }

  return { update, changes };
};

// Same last-write-wins, no-locking stance every other Event PATCH already
// documents — nothing here adds optimistic concurrency either.
export const updateDocumentsChecklist: AppRouteMutationImplementation<
  typeof contract.updateDocumentsChecklist
> = async ({ params, body, req }) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('updateDocumentsChecklist handler ran without an authenticated user.');
  }
  const changedByUserId = req.user.id;

  const existing = await Event.findById(params.id);
  if (!existing) {
    return eventNotFound;
  }

  const { update, changes } = buildDocumentsChecklistUpdate(existing, body);

  if (changes.length === 0) {
    return { status: 200, body: toPublicDocumentsChecklist(existing.documentsChecklist) };
  }

  const updated = await Event.findByIdAndUpdate(params.id, update, {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!updated) {
    return eventNotFound;
  }
  const eventId = updated.id;

  // STORY-081 — one groupId per handler invocation (not per field), so the
  // Activity tab can render every field this single PATCH touched as one
  // grouped edit action instead of N unrelated rows.
  const groupId = randomUUID();
  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
        groupId,
      })
    )
  );

  return { status: 200, body: toPublicDocumentsChecklist(updated.documentsChecklist) };
};

// Three tracked fields, one Change Log Entry per changed field — same
// granularity every other Event PATCH uses. Plain !== compares, the same
// shape buildPaymentUpdate already uses for its own three money fields —
// not a loop over a shared keys array (unlike buildDocumentsChecklistUpdate)
// since three explicit ifs isn't more repetitive than building and
// threading one would be.
const buildExtrasUpdate = (
  existing: EventDocument,
  body: UpdateEventExtrasBody
): { update: Record<string, unknown>; changes: PendingChange[] } => {
  const current = existing.extras;
  const update: Record<string, unknown> = {};
  const changes: PendingChange[] = [];

  if (body.decoration !== undefined && body.decoration !== current.decoration) {
    update['extras.decoration'] = body.decoration;
    changes.push({ field: 'decoration', oldValue: current.decoration, newValue: body.decoration });
  }
  if (body.photographer !== undefined && body.photographer !== current.photographer) {
    update['extras.photographer'] = body.photographer;
    changes.push({ field: 'photographer', oldValue: current.photographer, newValue: body.photographer });
  }
  if (body.bhatji !== undefined && body.bhatji !== current.bhatji) {
    update['extras.bhatji'] = body.bhatji;
    changes.push({ field: 'bhatji', oldValue: current.bhatji, newValue: body.bhatji });
  }

  return { update, changes };
};

// Same last-write-wins, no-locking stance every other Event PATCH already
// documents — nothing here adds optimistic concurrency either.
export const updateEventExtras: AppRouteMutationImplementation<typeof contract.updateEventExtras> = async ({
  params,
  body,
  req,
}) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('updateEventExtras handler ran without an authenticated user.');
  }
  const changedByUserId = req.user.id;

  const existing = await Event.findById(params.id);
  if (!existing) {
    return eventNotFound;
  }

  const { update, changes } = buildExtrasUpdate(existing, body);

  if (changes.length === 0) {
    return { status: 200, body: toPublicExtras(existing.extras) };
  }

  const updated = await Event.findByIdAndUpdate(params.id, update, {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!updated) {
    return eventNotFound;
  }
  const eventId = updated.id;

  // STORY-081 — one groupId per handler invocation (not per field), so the
  // Activity tab can render every field this single PATCH touched as one
  // grouped edit action instead of N unrelated rows.
  const groupId = randomUUID();
  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
        groupId,
      })
    )
  );

  return { status: 200, body: toPublicExtras(updated.extras) };
};

// Recomputed from the Event's current live document on every call — no
// separate stored "quotation" object exists (this story's own AC, per
// Assumption A2), so there is nothing that could ever go stale between a
// PATCH on sessions/accommodation/extras and the next call here.
//
// A Cancelled Session's venue cost and items are excluded from the rollup:
// the SRS itself is silent on this (FR-QUO-2 says "per-Session"/"across
// Sessions" with no status qualifier, and the one existing Cancelled-
// exclusion precedent, sessionOverlapsRange, is explicitly scoped to
// calendar/search visibility, not cost accounting — see this story's own
// Decisions). This is this story's own judgment call: a cancelled Session
// isn't actually happening, so its cost shouldn't be charged to the
// client, consistent with §4.2's framing of Cancelled as "not part of
// what's scheduled" everywhere else the concept already appears.
// Shared by getQuotationSummary and getQuotationPdf below — extracted once
// a second real caller needed the exact same construction (directory-
// structure.md: "only extract to utils/ once a pattern genuinely repeats";
// same reasoning applies one level up, to a same-file helper).
const computeEventQuotationSummary = (event: EventDocument) =>
  computeTotalCostSummary({
    sessions: event.sessions
      .filter((session) => session.sessionStatus === SessionStatus.Active)
      .map((session) => ({
        venueCost: session.venueCost,
        items: session.items.map((item) => ({
          type: item.type,
          pax: item.pax,
          costPerPlate: item.costPerPlate,
          limitedSeating: item.limitedSeating,
        })),
      })),
    accommodationTotalCharges: computeTotalCharges(
      event.accommodation?.roomLines ?? [],
      // Same "fall back to 1 before dates are both set" reasoning
      // toPublicAccommodation's own totalDaysForMath documents.
      event.accommodation?.checkIn && event.accommodation.checkOut
        ? computeTotalDays(event.accommodation.checkIn, event.accommodation.checkOut)
        : 1
    ),
    extras: {
      decoration: event.extras.decoration,
      photographer: event.extras.photographer,
      bhatji: event.extras.bhatji,
      extraLineItems: event.extraLineItems,
    },
    // STORY-072 — the rate actually stored on THIS Event, not always the
    // FOOD_GST_RATE_PERCENT default, so this rollup and the Quotation's own
    // Total Cost Summary compute the identical Food Cost with GST.
    gstRatePercent: event.foodGstRatePercent,
  });

export const getQuotationSummary: AppRouteQueryImplementation<typeof contract.getQuotationSummary> = async ({
  params,
}) => {
  const event = await Event.findById(params.id);
  if (!event) {
    return eventNotFound;
  }

  return { status: 200, body: computeEventQuotationSummary(event) };
};

// EventManager-only (this story's own judgment call — see the contract's
// own comment). A Cancelled Session is excluded from every per-session
// section here, same reasoning/precedent as computeEventQuotationSummary's
// own filter: its cost isn't counted in the Total Cost Summary, so showing
// it as a real scheduled item to the client in the same document would be
// inconsistent.
// Drives a real, headless browser against aaradhya-web's own already-
// running quotation-preview page (services/browser-pdf.ts) rather than a
// second, hand-duplicated PDF template — this is the ONLY way the
// generated PDF stays byte-for-byte the same as QuotationDocument (STORY-
// 069 through STORY-073's fixed reproduction of the reference quotations)
// without two templates silently drifting apart. Supersedes the previous
// pdfkit-based plain-text renderer (services/quotation-pdf.ts, now
// deleted), which never reproduced any of that fidelity work and was the
// actual cause of a shared/downloaded Quotation losing all its layout.
// `?print=1` on that route (quotation-preview-page.tsx) skips the
// editable-looking extras panel and the "Share PDF" button itself, so
// neither ends up baked into the downloaded document.
export const getQuotationPdf: AppRouteQueryImplementation<typeof contract.getQuotationPdf> = async ({
  params,
  req,
  res,
}) => {
  const event = await Event.findById(params.id);
  if (!event) {
    return eventNotFound;
  }
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('getQuotationPdf handler ran without an authenticated user.');
  }

  // The headless browser has no real login session of its own — this
  // mints one for the SAME already-authenticated caller and injects it
  // into the target page's own localStorage (browser-pdf.ts), the exact
  // mechanism aaradhya-web's own api/client.ts reads a session from.
  const caller = await User.findById(req.user.id);
  const token = await signSessionToken({ id: req.user.id, role: req.user.role });
  const pdf = await renderPdfFromUrl(config.webAppUrl, `/events/${event.id}/quotation-preview?print=1`, {
    token,
    user: { id: req.user.id, name: caller?.name ?? 'Aaradhya', role: req.user.role },
  });

  // No caching of a stale render (this story's own AC) — every call is a
  // fresh render of the Event's current live data, never persisted (SRS
  // Assumption A2), so nothing here should ever be served from a cache.
  res.setHeader('Cache-Control', 'no-store');

  return { status: 200, body: pdf };
};

const invalidSessionDateRange: Extract<CreateSessionResponse, { status: 400 }> = {
  status: 400,
  body: {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body.',
      details: [{ field: 'endDate', message: 'end_date must be on or after start_date.' }],
    },
  },
};

// sessionSchema's own field-level validator (src/models/event.ts) is what
// actually rejects end_date < start_date — this just recognises that
// specific failure (by its path within the sessions array) so it can be
// reshaped into the same VALIDATION_ERROR envelope every other bad-body
// case returns, matching isInvalidEventManagerError's own convention above.
const isInvalidSessionDateRangeError = (error: unknown): boolean =>
  error instanceof MongooseError.ValidationError && Object.keys(error.errors).some((path) => path.endsWith('.endDate'));

// No session_status accepted at creation — a newly added Session always
// starts Active (sessionSchema's own default), matching this story's Flow
// line (type/venue/date range/times/pax/setup, not status).
// venue_cost is taken as-is from the body when supplied (this story's own
// AC: this endpoint doesn't own the venue→cost lookup, the client does) —
// falls back to sessionSchema's own default (0) when omitted, exactly like
// pax/startTime/endTime/setup.
// Adding a Session to an Event whose own status is Cancelled is allowed,
// not blocked — no other write endpoint on Event (updateEvent,
// updateEventAccommodation, updateEventPayment, updateDocumentsChecklist)
// checks the Event's current status before writing, and FR-EVT-6 already
// establishes Cancelled as not a locked/terminal state (an Event Manager
// can move status away from it again). Consistent with that existing
// behavior, not a new exception.
// No Change Log Entry is written here — adding a Session is a creation,
// not a field-level edit, the same "creation isn't logged, only edits are"
// precedent createEvent already established (it never calls logChange
// either).
export const createSession: AppRouteMutationImplementation<typeof contract.createSession> = async ({
  params,
  body,
  req,
}) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('createSession handler ran without an authenticated user.');
  }

  const existing = await Event.findById(params.id);
  if (!existing) {
    return eventNotFound;
  }

  const session = existing.sessions.create({
    sessionType: body.sessionType,
    venue: body.venue,
    venueCost: body.venueCost,
    startDate: body.startDate,
    endDate: body.endDate,
    startTime: body.startTime,
    endTime: body.endTime,
    pax: body.pax,
    setup: body.setup,
  });
  existing.sessions.push(session);

  try {
    await existing.save();
  } catch (error) {
    if (isInvalidSessionDateRangeError(error)) {
      return invalidSessionDateRange;
    }
    throw error;
  }

  return { status: 201, body: toPublicSession(session) };
};

// A partial submitted setup, default-filled the same way sessionSetupSchema
// (STORY-026) would fill it on assignment — used only to compare against
// the existing, already-normalized setup (toPublicSessionSetup) so a PATCH
// resending an identical setup writes no Change Log Entry, the same
// "genuinely differs, not just present" rule every other field here uses.
const normalizeSubmittedSetup = (setup: Partial<SessionSetupAttributes> | undefined) => ({
  seating: setup?.seating ?? null,
  tableCount: setup?.tableCount ?? 0,
  chairCount: setup?.chairCount ?? 0,
  stage: setup?.stage ?? false,
  buffet: setup?.buffet ?? false,
  registrationDesk: setup?.registrationDesk ?? false,
  vipSeating: setup?.vipSeating ?? false,
  brideGroomSeating: setup?.brideGroomSeating ?? false,
  notes: setup?.notes ?? null,
});

// Mutates `session` in place for every field that actually changed and
// returns the matching PendingChanges — same "only a genuinely different,
// caller-sent value becomes a change" rule buildEventUpdate/
// buildAccommodationUpdate/buildPaymentUpdate already use, adapted to
// mutate a live subdocument directly (via existing.save()) rather than
// build a $set object, since re-running sessionSchema's own end_date >=
// start_date validator on save is what this story's AC needs re-confirmed
// on every update, not just at creation.
//
// Each change's `field` is prefixed with the session's identity —
// `sessions[<session_type>].<field>` — captured from sessionType BEFORE any
// of this request's edits are applied, even a sessionType change itself
// (this story's AC example: `sessions[Wedding].end_date`), so the Activity
// tab can tell which Session a given entry belongs to. camelCase per-field
// names (`endDate`, not `end_date`) match every other Change Log Entry
// already written by this controller — the AC's own snake_case is that
// story text's prose convention, not a wire-format instruction (the SRS
// writes every field name that way throughout).
// `setup` is diffed and logged as one whole field (not per-nested-key),
// the same "compound sub-value is one field" convention roomLines already
// established for Accommodation.
const applySessionUpdate = (session: SessionSubdocument, body: UpdateSessionBody): PendingChange[] => {
  const identity = session.sessionType;
  const changes: PendingChange[] = [];

  if (body.sessionType !== undefined && body.sessionType !== session.sessionType) {
    changes.push({
      field: `sessions[${identity}].sessionType`,
      oldValue: session.sessionType,
      newValue: body.sessionType,
    });
    session.sessionType = body.sessionType;
  }
  if (body.venue !== undefined && body.venue !== session.venue) {
    changes.push({ field: `sessions[${identity}].venue`, oldValue: session.venue, newValue: body.venue });
    session.venue = body.venue;
  }
  if (body.venueCost !== undefined && body.venueCost !== session.venueCost) {
    changes.push({
      field: `sessions[${identity}].venueCost`,
      oldValue: session.venueCost,
      newValue: body.venueCost,
    });
    session.venueCost = body.venueCost;
  }
  if (body.startDate !== undefined && !areDatesEqual(body.startDate, session.startDate)) {
    changes.push({
      field: `sessions[${identity}].startDate`,
      oldValue: session.startDate,
      newValue: body.startDate,
    });
    session.startDate = body.startDate;
  }
  if (body.endDate !== undefined && !areDatesEqual(body.endDate, session.endDate)) {
    changes.push({ field: `sessions[${identity}].endDate`, oldValue: session.endDate, newValue: body.endDate });
    session.endDate = body.endDate;
  }
  if (body.startTime !== undefined && body.startTime !== session.startTime) {
    changes.push({
      field: `sessions[${identity}].startTime`,
      oldValue: session.startTime ?? null,
      newValue: body.startTime,
    });
    session.startTime = body.startTime;
  }
  if (body.endTime !== undefined && body.endTime !== session.endTime) {
    changes.push({
      field: `sessions[${identity}].endTime`,
      oldValue: session.endTime ?? null,
      newValue: body.endTime,
    });
    session.endTime = body.endTime;
  }
  if (body.pax !== undefined && body.pax !== session.pax) {
    changes.push({ field: `sessions[${identity}].pax`, oldValue: session.pax, newValue: body.pax });
    session.pax = body.pax;
  }
  // Independent of the parent Event's own status (this story's own AC) —
  // nothing here, or anywhere else in this controller, ever inspects
  // existing.status before writing.
  if (body.sessionStatus !== undefined && body.sessionStatus !== session.sessionStatus) {
    changes.push({
      field: `sessions[${identity}].sessionStatus`,
      oldValue: session.sessionStatus,
      newValue: body.sessionStatus,
    });
    session.sessionStatus = body.sessionStatus;
  }
  if (body.setup !== undefined) {
    const oldValue = toPublicSessionSetup(session.setup);
    const newValue = normalizeSubmittedSetup(body.setup);
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({ field: `sessions[${identity}].setup`, oldValue, newValue });
      // A submitted setup is a partial shape (every field optional, same as
      // createSessionBodySchema) — SessionSetupAttributes' own fields are
      // required, so a direct `session.setup = body.setup` assignment
      // doesn't type-check. `.set()` is Mongoose's own loosely-typed escape
      // hatch for exactly this (same reasoning `.create()`'s `obj: any`
      // already applies for createSession) — the sub-schema's own
      // field-level defaults still fill every omitted key at the Mongoose
      // level, same as they would on creation.
      session.set('setup', body.setup);
    }
  }

  return changes;
};

// Same last-write-wins, no-locking stance every other Event PATCH already
// documents — nothing here adds optimistic concurrency either.
export const updateSession: AppRouteMutationImplementation<typeof contract.updateSession> = async ({
  params,
  body,
  req,
}) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('updateSession handler ran without an authenticated user.');
  }
  const changedByUserId = req.user.id;

  const existing = await Event.findById(params.id);
  if (!existing) {
    return eventNotFound;
  }

  const session = existing.sessions.id(params.sid);
  if (!session) {
    return sessionNotFound;
  }

  const changes = applySessionUpdate(session, body);

  if (changes.length === 0) {
    return { status: 200, body: toPublicSession(session) };
  }

  try {
    await existing.save();
  } catch (error) {
    if (isInvalidSessionDateRangeError(error)) {
      return invalidSessionDateRange;
    }
    throw error;
  }

  const eventId = existing.id;
  // STORY-081 — one groupId per handler invocation (not per field), so the
  // Activity tab can render every field this single PATCH touched as one
  // grouped edit action instead of N unrelated rows.
  const groupId = randomUUID();
  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
        groupId,
      })
    )
  );

  return { status: 200, body: toPublicSession(session) };
};

// No Change Log Entry — removing a whole Session is a deletion, not a
// field-level edit, the same "creation isn't logged, only edits are"
// precedent createSession (STORY-027) already established for adding one;
// applied symmetrically here.
// Deleting an Event's only remaining Session is allowed — an Event with
// zero Sessions is a valid, if incomplete, draft state (this story's own
// edge case); nothing here requires at least one to remain.
// Typed as AppRouteQueryImplementation, not AppRouteMutationImplementation
// — this route has no request body at all (a DELETE with no body is
// ts-rest's AppRouteDeleteNoBody variant), which @ts-rest/express handles
// with the same no-body handler signature GET routes use, despite the
// method being DELETE.
export const deleteSession: AppRouteQueryImplementation<typeof contract.deleteSession> = async ({ params }) => {
  const existing = await Event.findById(params.id);
  if (!existing) {
    return eventNotFound;
  }

  const session = existing.sessions.id(params.sid);
  if (!session) {
    return sessionNotFound;
  }

  session.deleteOne();
  await existing.save();

  return { status: 204, body: undefined };
};

// Attempts to create a new Menu Item by name; if that collides
// case-insensitively with an existing one (STORY-030's own collation
// index), re-queries for the existing match instead of failing — a
// "find-or-create" that leans on the database's own uniqueness
// constraint as the source of truth rather than a check-then-create
// sequence (which would race two concurrent callers adding the same new
// name at once).
const findOrCreateMenuItemByName = async (name: string): Promise<MenuItemDocument> => {
  try {
    return await MenuItem.create({ name });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await MenuItem.findOne({ name: { $regex: `^${escapeRegExp(name)}$`, $options: 'i' } });
      if (existing) {
        return existing;
      }
    }
    throw error;
  }
};

// Resolves every menuItems entry in a request body to a real Menu Item's
// id — an `{ id }` entry must already exist (returns null for the whole
// call if any doesn't, this story's own edge case: a bad reference is a
// 400, not a silent no-op or partial write); an `{ name }` entry is
// found-or-created (this story's own AC: adding a not-yet-existing Menu
// Item by name persists it to the shared master list as part of this
// same request).
const resolveMenuItemRefs = async (
  refs: readonly ({ id: string } | { name: string })[]
): Promise<Types.ObjectId[] | null> => {
  const ids: Types.ObjectId[] = [];
  for (const ref of refs) {
    if ('id' in ref) {
      const existing = await MenuItem.findById(ref.id);
      if (!existing) {
        return null;
      }
      ids.push(existing._id);
    } else {
      const item = await findOrCreateMenuItemByName(ref.name);
      ids.push(item._id);
    }
  }
  return ids;
};

// No session_status-equivalent concept here, and no Change Log Entry —
// adding an Item is a creation, not a field-level edit, the same
// "creation isn't logged, only edits are" precedent createSession
// (STORY-027) already established.
export const createItem: AppRouteMutationImplementation<typeof contract.createItem> = async ({ params, body, req }) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('createItem handler ran without an authenticated user.');
  }

  const existingEvent = await Event.findById(params.id);
  if (!existingEvent) {
    return eventNotFound;
  }

  const session = existingEvent.sessions.id(params.sid);
  if (!session) {
    return sessionNotFound;
  }

  let menuItemIds: Types.ObjectId[] = [];
  if (body.type === ItemType.Meal && body.menuItems) {
    const resolved = await resolveMenuItemRefs(body.menuItems);
    if (!resolved) {
      return invalidMenuItemReference;
    }
    menuItemIds = resolved;
  }

  const item = session.items.create(
    body.type === ItemType.Meal
      ? {
          type: ItemType.Meal,
          mealName: body.mealName,
          pax: body.pax,
          costPerPlate: body.costPerPlate,
          limitedSeating: body.limitedSeating ?? false,
          menuItems: menuItemIds,
          startTime: body.startTime,
          endTime: body.endTime,
        }
      : {
          type: ItemType.Event,
          eventName: body.eventName,
          venue: body.venue,
          startTime: body.startTime,
          endTime: body.endTime,
        }
  );
  session.items.push(item);

  await existingEvent.save();

  return { status: 201, body: toPublicItem(item) };
};

// Mutates `item` in place for every field that actually changed and
// returns the matching PendingChanges — same "only a genuinely different,
// caller-sent value becomes a change" rule applySessionUpdate already
// uses, extended one level deeper. `field` is prefixed with both the
// Session's identity and the Item's own (mealName, falling back to
// eventName) — `sessions[<session_type>].items[<item_identity>].<field>`
// — both captured before this request's own edits, same "old identity,
// not new" rule applySessionUpdate already established for sessionType.
// menuItems is resolved async (may need to look up or create Menu Items)
// and returns the sentinel 'invalid-menu-item-reference' instead of
// throwing when an `{ id }` entry doesn't resolve, so the handler can
// turn that into a clean 400 rather than an unhandled rejection.
const applyItemUpdate = async (
  session: SessionSubdocument,
  item: ItemSubdocument,
  body: UpdateItemBody
): Promise<PendingChange[] | 'invalid-menu-item-reference'> => {
  const prefix = `sessions[${session.sessionType}].items[${item.mealName ?? item.eventName ?? ''}]`;
  const changes: PendingChange[] = [];

  if (body.mealName !== undefined && body.mealName !== item.mealName) {
    changes.push({ field: `${prefix}.mealName`, oldValue: item.mealName ?? null, newValue: body.mealName });
    item.mealName = body.mealName;
  }
  if (body.pax !== undefined && body.pax !== item.pax) {
    changes.push({ field: `${prefix}.pax`, oldValue: item.pax ?? null, newValue: body.pax });
    item.pax = body.pax;
  }
  if (body.costPerPlate !== undefined && body.costPerPlate !== item.costPerPlate) {
    changes.push({
      field: `${prefix}.costPerPlate`,
      oldValue: item.costPerPlate ?? null,
      newValue: body.costPerPlate,
    });
    item.costPerPlate = body.costPerPlate;
  }
  if (body.limitedSeating !== undefined && body.limitedSeating !== item.limitedSeating) {
    changes.push({
      field: `${prefix}.limitedSeating`,
      oldValue: item.limitedSeating ?? false,
      newValue: body.limitedSeating,
    });
    item.limitedSeating = body.limitedSeating;
  }
  if (body.eventName !== undefined && body.eventName !== item.eventName) {
    changes.push({ field: `${prefix}.eventName`, oldValue: item.eventName ?? null, newValue: body.eventName });
    item.eventName = body.eventName;
  }
  if (body.venue !== undefined && body.venue !== item.venue) {
    changes.push({ field: `${prefix}.venue`, oldValue: item.venue ?? null, newValue: body.venue });
    item.venue = body.venue;
  }
  if (body.startTime !== undefined && body.startTime !== item.startTime) {
    changes.push({ field: `${prefix}.startTime`, oldValue: item.startTime ?? null, newValue: body.startTime });
    item.startTime = body.startTime;
  }
  if (body.endTime !== undefined && body.endTime !== item.endTime) {
    changes.push({ field: `${prefix}.endTime`, oldValue: item.endTime ?? null, newValue: body.endTime });
    item.endTime = body.endTime;
  }
  if (body.menuItems !== undefined) {
    const resolved = await resolveMenuItemRefs(body.menuItems);
    if (!resolved) {
      return 'invalid-menu-item-reference';
    }
    const oldIds = item.menuItems.map((ref) => ref.toString());
    const newIds = resolved.map((ref) => ref.toString());
    if (JSON.stringify(oldIds) !== JSON.stringify(newIds)) {
      changes.push({ field: `${prefix}.menuItems`, oldValue: oldIds, newValue: newIds });
      item.menuItems = resolved;
    }
  }

  return changes;
};

// Same last-write-wins, no-locking stance every other Event PATCH already
// documents — nothing here adds optimistic concurrency either.
export const updateItem: AppRouteMutationImplementation<typeof contract.updateItem> = async ({ params, body, req }) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('updateItem handler ran without an authenticated user.');
  }
  const changedByUserId = req.user.id;

  const existingEvent = await Event.findById(params.id);
  if (!existingEvent) {
    return eventNotFound;
  }

  const session = existingEvent.sessions.id(params.sid);
  if (!session) {
    return sessionNotFound;
  }

  const item = session.items.id(params.iid);
  if (!item) {
    return itemNotFound;
  }

  const changes = await applyItemUpdate(session, item, body);
  if (changes === 'invalid-menu-item-reference') {
    return invalidMenuItemReference;
  }

  if (changes.length === 0) {
    return { status: 200, body: toPublicItem(item) };
  }

  await existingEvent.save();

  const eventId = existingEvent.id;
  // STORY-081 — one groupId per handler invocation (not per field), so the
  // Activity tab can render every field this single PATCH touched as one
  // grouped edit action instead of N unrelated rows.
  const groupId = randomUUID();
  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
        groupId,
      })
    )
  );

  return { status: 200, body: toPublicItem(item) };
};

// No Change Log Entry — removing a whole Item is a deletion, not a
// field-level edit, the same "creation isn't logged, only edits are"
// precedent createItem/createSession/deleteSession already established,
// applied symmetrically here.
export const deleteItem: AppRouteQueryImplementation<typeof contract.deleteItem> = async ({ params }) => {
  const existingEvent = await Event.findById(params.id);
  if (!existingEvent) {
    return eventNotFound;
  }

  const session = existingEvent.sessions.id(params.sid);
  if (!session) {
    return sessionNotFound;
  }

  const item = session.items.id(params.iid);
  if (!item) {
    return itemNotFound;
  }

  item.deleteOne();
  await existingEvent.save();

  return { status: 204, body: undefined };
};

// $elemMatch narrows to Events that have AT LEAST ONE qualifying session —
// querying the three conditions without it would let MongoDB match each
// condition against a different array element instead of the same one
// (e.g. an Event with one Cancelled session in-range and one Active
// session out of range would wrongly match). The exact same test then runs
// again in-memory (sessionOverlapsMonth) to filter each matched Event down
// to only its own qualifying sessions — a matched Event can still have
// other, non-qualifying sessions that must not appear in the response.
export const getCalendar: AppRouteQueryImplementation<typeof contract.getCalendar> = async ({ query }) => {
  const range = computeMonthRange(query.month, query.year);

  const events = await Event.find({
    sessions: {
      $elemMatch: {
        sessionStatus: SessionStatus.Active,
        startDate: { $lte: range.monthEnd },
        endDate: { $gte: range.monthStart },
      },
    },
  });

  const sessions = events.flatMap((event) =>
    event.sessions
      .filter((session) => sessionOverlapsMonth(session, range))
      .map((session) => ({
        ...toPublicSession(session),
        event: {
          id: event.id,
          eventFamilyType: event.eventFamilyType,
          status: event.status,
          eventManager: event.eventManager.toString(),
        },
      }))
  );

  return { status: 200, body: sessions };
};
