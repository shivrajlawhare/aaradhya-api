import { Error as MongooseError } from 'mongoose';
import type { AppRouteMutationImplementation, AppRouteQueryImplementation } from '@ts-rest/express';
import type { ServerInferRequest, ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../contract/index.js';
import {
  DOCUMENT_CHECKLIST_ITEM_KEYS,
  Event,
  EventStatus,
  type AccommodationAttributes,
  type ClientContactAttributes,
  type DocumentsChecklistAttributes,
  type EventDocument,
  type PaymentAttributes,
  type RoomLineAttributes,
  type SessionAttributes,
  type SessionSetupAttributes,
} from '../models/event.js';
import {
  computeRoomLineTotalInclGst,
  computeTotalCharges,
  computeTotalDays,
  computeTotalOccupancy,
} from '../services/accommodation.js';
import { logChange } from '../services/change-log.js';
import { computeBalance } from '../services/payment.js';
import { computeDurationDays, computeIsMultiDay } from '../services/session.js';

type CreateEventResponse = ServerInferResponses<typeof contract.createEvent>;
type GetEventResponse = ServerInferResponses<typeof contract.getEvent>;
type UpdateEventResponse = ServerInferResponses<typeof contract.updateEvent>;
type UpdateEventBody = ServerInferRequest<typeof contract.updateEvent>['body'];
type UpdateEventAccommodationBody = ServerInferRequest<typeof contract.updateEventAccommodation>['body'];
type UpdateEventPaymentBody = ServerInferRequest<typeof contract.updateEventPayment>['body'];
type UpdateDocumentsChecklistBody = ServerInferRequest<typeof contract.updateDocumentsChecklist>['body'];
type CreateSessionResponse = ServerInferResponses<typeof contract.createSession>;
type UpdateSessionResponse = ServerInferResponses<typeof contract.updateSession>;
type UpdateSessionBody = ServerInferRequest<typeof contract.updateSession>['body'];
type DeleteSessionResponse = ServerInferResponses<typeof contract.deleteSession>;

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

// checkIn/checkOut/totalDays are nullable, not just absent — an Event can
// genuinely have no accommodation entered yet (accommodation itself is
// optional on the Event, STORY-018). totalOccupancy/totalCharges default to
// 0 for an empty roomLines array — "no rooms" is a valid, common case
// (STORY-019's own edge case), not an error state.
const toPublicAccommodation = (accommodation: AccommodationAttributes | undefined) => {
  const checkIn = accommodation?.checkIn ?? null;
  const checkOut = accommodation?.checkOut ?? null;
  const roomLines = accommodation?.roomLines ?? [];

  return {
    checkIn,
    checkOut,
    totalDays: checkIn && checkOut ? computeTotalDays(checkIn, checkOut) : null,
    roomLines: roomLines.map((line) => ({
      roomType: line.roomType,
      occupancy: line.occupancy,
      tariff: line.tariff,
      noOfRooms: line.noOfRooms,
      totalInclGst: computeRoomLineTotalInclGst(line),
    })),
    totalOccupancy: computeTotalOccupancy(roomLines),
    totalCharges: computeTotalCharges(roomLines),
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

const toPublicDocumentsChecklist = (checklist: DocumentsChecklistAttributes) => ({
  aadharCard: checklist.aadharCard,
  panCard: checklist.panCard,
  leavingBirthCertificate: checklist.leavingBirthCertificate,
  rationCard: checklist.rationCard,
  passportPhotos: checklist.passportPhotos,
  weddingCard: checklist.weddingCard,
});

// accommodation/payment/documentsChecklist reuse toPublicAccommodation
// (STORY-019)/toPublicPayment (STORY-022)/toPublicDocumentsChecklist
// (STORY-024) — GET /events/:id exposed none of them until a UI story
// actually needed to read current state on first render (STORY-020 for
// accommodation, STORY-023 for payment, now STORY-025 for the checklist).
// Additive only: every existing consumer of this shape just gets more
// fields.
const toPublicEvent = (event: EventDocument) => ({
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

const areClientContactsEqual = (
  stored: ClientContactAttributes[],
  submitted: ClientContactAttributes[],
): boolean => JSON.stringify(stored.map(toPlainContact)) === JSON.stringify(submitted.map(toPlainContact));

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
export const createEvent: AppRouteMutationImplementation<typeof contract.createEvent> = async ({
  body,
  req,
}) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('createEvent handler ran without an authenticated user.');
  }

  try {
    const event = await Event.create({
      eventFamilyType: body.eventFamilyType,
      status: body.status ?? EventStatus.Tentative,
      eventManager: body.eventManager,
      clientContacts: body.clientContacts,
      createdBy: req.user.id,
    });
    return { status: 201, body: toPublicEvent(event) };
  } catch (error) {
    if (isInvalidEventManagerError(error)) {
      return invalidEventManager;
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

export const getEvent: AppRouteQueryImplementation<typeof contract.getEvent> = async ({ params }) => {
  const event = await Event.findById(params.id);
  if (!event) {
    return eventNotFound;
  }
  return { status: 200, body: toPublicEvent(event) };
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
  body: UpdateEventBody,
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
  if (
    body.clientContacts !== undefined &&
    !areClientContactsEqual(existing.clientContacts, body.clientContacts)
  ) {
    update.clientContacts = body.clientContacts;
    changes.push({
      field: 'clientContacts',
      oldValue: existing.clientContacts.map(toPlainContact),
      newValue: body.clientContacts,
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

  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
      }),
    ),
  );

  return { status: 200, body: toPublicEvent(updated) };
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
  body: UpdateEventAccommodationBody,
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
  if (
    body.roomLines !== undefined &&
    !areRoomLinesEqual(currentAccommodation?.roomLines ?? [], body.roomLines)
  ) {
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

  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
      }),
    ),
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
  body: UpdateEventPaymentBody,
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

  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
      }),
    ),
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
  body: UpdateDocumentsChecklistBody,
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

  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
      }),
    ),
  );

  return { status: 200, body: toPublicDocumentsChecklist(updated.documentsChecklist) };
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
  error instanceof MongooseError.ValidationError &&
  Object.keys(error.errors).some((path) => path.endsWith('.endDate'));

// The hydrated element type of EventDocument['sessions'] — a real Mongoose
// subdocument (Document methods like `.set()`/`.deleteOne()` included), not
// the plain SessionAttributes interface. Indexed off EventDocument itself
// rather than hand-reconstructed, so it always matches whatever Mongoose
// actually infers for a Types.DocumentArray element.
type SessionSubdocument = EventDocument['sessions'][number];

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

// durationDays/isMultiDay reuse STORY-026's own computeDurationDays/
// computeIsMultiDay — never stored, always freshly computed from whatever
// startDate/endDate are currently on the Session, same "derived, never
// trusted from the client" convention totalDays (accommodation) and
// balance (payment) already established. Reads `_id` (not `.id`) — a
// Types.DocumentArray's own subdocument type only declares `_id` typed
// (Types.ObjectId), unlike a top-level HydratedDocument which also gets a
// typed `.id` string virtual.
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
});

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
  await Promise.all(
    changes.map((change) =>
      logChange({
        entityType: 'Event',
        entityId: eventId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByUserId,
      }),
    ),
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
export const deleteSession: AppRouteQueryImplementation<typeof contract.deleteSession> = async ({
  params,
}) => {
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
