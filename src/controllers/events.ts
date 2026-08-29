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
} from '../models/event.js';
import {
  computeRoomLineTotalInclGst,
  computeTotalCharges,
  computeTotalDays,
  computeTotalOccupancy,
} from '../services/accommodation.js';
import { logChange } from '../services/change-log.js';
import { computeBalance } from '../services/payment.js';

type CreateEventResponse = ServerInferResponses<typeof contract.createEvent>;
type GetEventResponse = ServerInferResponses<typeof contract.getEvent>;
type UpdateEventResponse = ServerInferResponses<typeof contract.updateEvent>;
type UpdateEventBody = ServerInferRequest<typeof contract.updateEvent>['body'];
type UpdateEventAccommodationBody = ServerInferRequest<typeof contract.updateEventAccommodation>['body'];
type UpdateEventPaymentBody = ServerInferRequest<typeof contract.updateEventPayment>['body'];
type UpdateDocumentsChecklistBody = ServerInferRequest<typeof contract.updateDocumentsChecklist>['body'];

// Narrow (single-member), not the whole per-route union, so the same
// constant can be returned from any handler whose response union happens to
// share this exact 400/404 shape (they all reuse apiErrorSchema) — avoids
// three near-identical object literals across createEvent/getEvent/updateEvent.
const eventNotFound: Extract<GetEventResponse, { status: 404 }> = {
  status: 404,
  body: { error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' } },
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

// accommodation/payment reuse toPublicAccommodation (STORY-019)/
// toPublicPayment (STORY-022) — GET /events/:id exposed neither until a UI
// story actually needed to read current state on first render (STORY-020
// for accommodation, STORY-023 for payment). Additive only: every existing
// consumer of this shape just gets more fields.
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

const toPublicDocumentsChecklist = (checklist: DocumentsChecklistAttributes) => ({
  aadharCard: checklist.aadharCard,
  panCard: checklist.panCard,
  leavingBirthCertificate: checklist.leavingBirthCertificate,
  rationCard: checklist.rationCard,
  passportPhotos: checklist.passportPhotos,
  weddingCard: checklist.weddingCard,
});

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
