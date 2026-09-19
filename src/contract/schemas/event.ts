import { z } from 'zod';
import { ClientContactRole, EventStatus, ItemType, SeatingArrangement, SessionStatus } from '../../models/event.js';
import { objectIdSchema } from './common.js';

// One boolean field per fixed key, hand-written (not built from
// DOCUMENT_CHECKLIST_ITEM_KEYS) — matches how every other schema field in
// this file is declared explicitly. `.strict()` is what actually implements
// this story's "rejects any key not in that fixed list": Zod's default
// object behavior silently strips unknown keys, which would look like
// success to a caller who mistyped one; `.strict()` turns that into a 400
// instead.
const documentsChecklistFieldsSchema = z.object({
  aadharCard: z.boolean().optional(),
  panCard: z.boolean().optional(),
  leavingBirthCertificate: z.boolean().optional(),
  rationCard: z.boolean().optional(),
  passportPhotos: z.boolean().optional(),
  weddingCard: z.boolean().optional(),
});

export const updateDocumentsChecklistBodySchema = documentsChecklistFieldsSchema.strict();

// .required() strips the .optional() every input field carries, rather
// than retyping the same six keys a third time.
export const documentsChecklistResultSchema = documentsChecklistFieldsSchema.required();

// contactNumber is required, not optional — STORY-011's schema already
// requires it per row. Leaving it optional here would just push the same
// failure down into a raw Mongoose ValidationError instead of a clean 400
// (documented as a v1 decision in the story backlog under STORY-012).
const clientContactInputSchema = z.object({
  name: z.string().trim().min(1),
  contactNumber: z.string().trim().min(1),
  role: z.nativeEnum(ClientContactRole),
});

export const eventIdParamsSchema = z.object({
  id: objectIdSchema('Invalid event id.'),
});

// Every field optional (PATCH semantics — a caller sends only what changed),
// but a supplied `clientContacts` still needs at least one row: this is the
// same "at least one Client Contact" rule STORY-012 enforces at create time,
// restated here since removing the last remaining row is exactly the case
// this story's AC calls out to reject.
export const updateEventBodySchema = z.object({
  eventFamilyType: z.string().trim().min(1).optional(),
  status: z.nativeEnum(EventStatus).optional(),
  eventManager: objectIdSchema('Invalid event_manager id.').optional(),
  clientContacts: z.array(clientContactInputSchema).min(1).optional(),
  // STORY-072 — lets a caller correct the Food Cost GST rate after
  // creation (SRS §4.9's "editable... if it varies"), reusing this
  // existing top-level PATCH rather than a dedicated route for one field.
  foodGstRatePercent: z.number().min(0).optional(),
});

export const clientContactResultSchema = z.object({
  name: z.string(),
  contactNumber: z.string(),
  role: z.nativeEnum(ClientContactRole),
});

const roomLineInputSchema = z.object({
  roomType: z.string().trim().min(1),
  occupancy: z.number().min(0),
  tariff: z.number().min(0),
  // A no_of_rooms of 0 is a valid placeholder row — STORY-018's own
  // decision, matching the Mongoose schema's `min: 0` (not `min: 1`).
  noOfRooms: z.number().min(0),
});

// Every field optional (PATCH semantics) — a caller sends only what
// changed. z.coerce.date() accepts the ISO string a JSON body actually
// carries; an unparseable value still fails as an invalid date.
export const updateAccommodationBodySchema = z.object({
  checkIn: z.coerce.date().optional(),
  checkOut: z.coerce.date().optional(),
  roomLines: z.array(roomLineInputSchema).optional(),
});

const roomLineResultSchema = roomLineInputSchema.extend({
  // Derived (STORY-018's computeRoomLineTotalInclGst) — never accepted as
  // input, always present on output.
  totalInclGst: z.number(),
});

// The public Accommodation Block shape — checkIn/checkOut/totalDays are
// nullable, not just optional, since a caller can genuinely have no
// accommodation entered yet (STORY-018: accommodation itself is optional on
// the Event). roomLines/totalOccupancy/totalCharges default to an empty/zero
// state instead, since "no rooms" is itself a valid, common case.
export const accommodationResultSchema = z.object({
  checkIn: z.date().nullable(),
  checkOut: z.date().nullable(),
  totalDays: z.number().nullable(),
  roomLines: z.array(roomLineResultSchema),
  totalOccupancy: z.number(),
  totalCharges: z.number(),
});

// Every field optional (PATCH semantics). No cross-field validation between
// advancePaidDate and advancePaid — STORY-022's own decision: a caller may
// set an expected/planned advance_paid_date before advance_paid actually
// reflects a real payment.
export const updateEventPaymentBodySchema = z.object({
  totalEstimatedAmount: z.number().min(0).optional(),
  advanceRequired: z.number().min(0).optional(),
  advancePaid: z.number().min(0).optional(),
  advancePaidDate: z.coerce.date().optional(),
  paymentMode: z.string().trim().min(1).optional(),
});

// balance is derived (STORY-021's computeBalance) — never accepted as
// input, always present on output. advancePaidDate/paymentMode are
// nullable, not just optional, matching accommodation's checkIn/checkOut
// convention for "genuinely unset yet".
export const paymentResultSchema = z.object({
  totalEstimatedAmount: z.number(),
  advanceRequired: z.number(),
  advancePaid: z.number(),
  advancePaidDate: z.date().nullable(),
  paymentMode: z.string().nullable(),
  balance: z.number(),
});

// One numeric field per fixed key, hand-written — same "fixed, closed set
// of named keys" shape documentsChecklistFieldsSchema above already
// established for STORY-024, reused here since extras (Decoration/
// Photographer/Bhatji, SRS §5.4 FR-QUO-2) is the same kind of small,
// non-extensible field set. `.strict()` reuses that same "unknown key ->
// 400" outcome, for the same reason: a caller mistyping a key should get a
// rejection, not a silently-stripped no-op. min(0) rejects a negative
// amount (this story's own edge case — "these are costs, not adjustments").
const extrasFieldsSchema = z.object({
  decoration: z.number().min(0).optional(),
  photographer: z.number().min(0).optional(),
  bhatji: z.number().min(0).optional(),
});

export const updateEventExtrasBodySchema = extrasFieldsSchema.strict();

// .required() strips the .optional() every input field carries — every
// Event always has all three amounts (defaulted to 0), same "always
// instantiated" convention payment/documentsChecklist already use.
export const extrasResultSchema = extrasFieldsSchema.required();

// SRS FR-QUO-9a / Assumption A13 — an open-ended manual line item for the
// Total Cost Summary (name + optional short note + amount), additive
// alongside decoration/photographer/bhatji above, not a replacement (both
// feed the same extrasTotal — see aaradhya-api's services/quotation.ts).
// No `id` on the result shape — same "whole-array-replace, no per-row edit
// endpoint" precedent roomLineResultSchema already established; this story
// never edits or deletes one individually, only ever submits the full list
// once at Event creation.
const manualLineItemFieldsSchema = z.object({
  name: z.string().trim().min(1),
  note: z.string().trim().min(1).optional(),
  amount: z.number().min(0),
});

export const manualLineItemResultSchema = z.object({
  name: z.string(),
  note: z.string().nullable(),
  amount: z.number(),
});

// The exact 6 fields src/services/quotation.ts' computeTotalCostSummary
// produces (STORY-039) — this schema doesn't redeclare that shape, it just
// mirrors it field-for-field so GET /events/:id/quotation-summary (STORY-041)
// has a typed response.
export const quotationSummaryResultSchema = z.object({
  venueTotal: z.number(),
  foodSubtotal: z.number(),
  foodTotalInclGst: z.number(),
  accommodationTotal: z.number(),
  extrasTotal: z.number(),
  grandTotal: z.number(),
});

// setup is optional as a whole (STORY-027: an Event Manager may add a
// Session without touching setup at all yet) and every field within it is
// optional too — a caller sends only what it's chosen so far, the rest fall
// back to sessionSetupSchema's own field-level defaults (STORY-026).
const sessionSetupInputSchema = z.object({
  seating: z.nativeEnum(SeatingArrangement).optional(),
  tableCount: z.number().min(0).optional(),
  chairCount: z.number().min(0).optional(),
  stage: z.boolean().optional(),
  buffet: z.boolean().optional(),
  registrationDesk: z.boolean().optional(),
  vipSeating: z.boolean().optional(),
  brideGroomSeating: z.boolean().optional(),
  notes: z.string().trim().min(1).optional(),
});

// sessionType/venue required (this story's own Flow: "choosing type,
// venue... "); venueCost/pax/startTime/endTime/setup are optional, falling
// back to sessionSchema's own field-level defaults (STORY-026) when
// omitted. No session_status here — this story's own Flow line never lists
// it among what an Event Manager chooses when adding a Session; it always
// starts Active (STORY-026's schema default), same "don't implement beyond
// the current story's AC" restraint applied elsewhere. z.coerce.date()
// accepts the ISO string a JSON body actually carries, same convention
// updateAccommodationBodySchema already uses.
export const createSessionBodySchema = z.object({
  sessionType: z.string().trim().min(1),
  venue: z.string().trim().min(1),
  venueCost: z.number().min(0).optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  startTime: z.string().trim().min(1).optional(),
  endTime: z.string().trim().min(1).optional(),
  pax: z.number().min(0).optional(),
  setup: sessionSetupInputSchema.optional(),
});

// Exported — STORY-050's dashboard row reuses this directly for
// Housekeeping's own "setup/seating requirements" column (SRS §3.3), same
// "reuse the exact filtered shape, don't reinvent it" precedent STORY-047's
// clientContactResultSchema reuse already set.
export const sessionSetupResultSchema = z.object({
  seating: z.nativeEnum(SeatingArrangement).nullable(),
  tableCount: z.number(),
  chairCount: z.number(),
  stage: z.boolean(),
  buffet: z.boolean(),
  registrationDesk: z.boolean(),
  vipSeating: z.boolean(),
  brideGroomSeating: z.boolean(),
  notes: z.string().nullable(),
});

export const eventSessionParamsSchema = z.object({
  id: objectIdSchema('Invalid event id.'),
  sid: objectIdSchema('Invalid session id.'),
});

// Every field optional (PATCH semantics), unlike createSessionBodySchema —
// a caller sends only what changed. Unlike creation, session_status IS
// accepted here (this story's own AC: "Setting session_status to Cancelled
// succeeds independently of the parent Event's status") — cancelling an
// existing Session is an edit, not something a brand-new Session starts as.
export const updateSessionBodySchema = z.object({
  sessionType: z.string().trim().min(1).optional(),
  venue: z.string().trim().min(1).optional(),
  venueCost: z.number().min(0).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  startTime: z.string().trim().min(1).optional(),
  endTime: z.string().trim().min(1).optional(),
  pax: z.number().min(0).optional(),
  sessionStatus: z.nativeEnum(SessionStatus).optional(),
  // Whole-object replace, same "treat a compound sub-value as one field"
  // convention updateAccommodationBodySchema's roomLines already
  // established — a caller resends the full setup it wants, not a sparse
  // patch of just the sub-fields that changed.
  setup: sessionSetupInputSchema.optional(),
});

// Each entry either references an existing Menu Item by id, or a name to
// find-or-create (reusing STORY-030's own uniqueness semantics) — the SRS's
// "search existing Menu Items or add new inline" flow (§4.5) folded into a
// single input shape, rather than requiring a caller to always call
// POST /menu-items first and pass only ids.
const menuItemRefInputSchema = z.union([
  z.object({ id: objectIdSchema('Invalid menu item id.') }),
  z.object({ name: z.string().trim().min(1) }),
]);

const mealItemBodySchema = z.object({
  type: z.literal(ItemType.Meal),
  mealName: z.string().trim().min(1),
  pax: z.number().min(0),
  costPerPlate: z.number().min(0),
  // Glossary's "Limited Seating (L.S.)" — defaults false (models/event.ts)
  // when omitted, same "not sent means not set" convention every other
  // optional boolean-ish field on this endpoint already uses.
  limitedSeating: z.boolean().optional(),
  menuItems: z.array(menuItemRefInputSchema).optional(),
  startTime: z.string().trim().min(1).optional(),
  endTime: z.string().trim().min(1).optional(),
});

// STORY-071 — eventName/venue relaxed from required (min(1)) to fully
// optional: both reference quotations (docs/example_quatations/) print
// Ceremony/Event Items with no venue at all ("Muhurta 11am – 12.30pm"), and
// example_quatation_2.pdf has one Ceremony Item with EVERY field left blank
// (a bare grey divider row in its own Event Details table) — a real,
// intentional state the Quotation renderer must reproduce, not an
// impossible one the schema should keep rejecting. No change to Meal's own
// mealItemBodySchema — a Meal Item's own mealName/pax/costPerPlate stay
// required, since neither reference quotation has a blank Food/Dining row.
const eventItemBodySchema = z.object({
  type: z.literal(ItemType.Event),
  eventName: z.string().trim().optional(),
  venue: z.string().trim().optional(),
  startTime: z.string().trim().min(1).optional(),
  endTime: z.string().trim().min(1).optional(),
});

// A discriminated union, not a flat optional-everything shape — Zod
// enforces "requires the correct field set for whichever type is set"
// (this story's own AC) at the request-validation layer itself, ahead of
// and independent from itemSchema's own per-field `required` functions
// (STORY-031) doing the same at the persistence layer.
export const createItemBodySchema = z.discriminatedUnion('type', [mealItemBodySchema, eventItemBodySchema]);

// STORY-068 — a Session as it's nested inside createEventBodySchema below,
// identical to createSessionBodySchema except it also accepts its own
// `items` up front (a plain createSessionBodySchema never has — Items are
// otherwise always added afterward via POST .../sessions/:sid/items, see
// that route's own comment). This is what lets "Generate Quotation" submit
// Sessions and their Items in the exact same call as the Event itself
// (FR-EVT-8 — "exactly one data-entry flow").
const createEventSessionInputSchema = z.object({
  sessionType: z.string().trim().min(1),
  venue: z.string().trim().min(1),
  venueCost: z.number().min(0).optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  startTime: z.string().trim().min(1).optional(),
  endTime: z.string().trim().min(1).optional(),
  pax: z.number().min(0).optional(),
  setup: sessionSetupInputSchema.optional(),
  items: z.array(createItemBodySchema).optional(),
});

// STORY-068 — the wizard's own "Generate Quotation" submits the entire
// accumulated flow (Client Contacts, Sessions with their own Items,
// Accommodation, and the Total Cost Summary's manual line items) as this
// single call instead of the create-then-PATCH-then-POST-per-Session-
// then-POST-per-Item sequence every screen before the wizard used
// (FR-EVT-8: "exactly one data-entry flow," never a sequence of partial
// per-step writes). Every new field below is optional and defaults to the
// same empty/zero state createEvent already produced before this story —
// a caller that only ever sends the original four fields (as every
// pre-wizard caller still does, e.g. this contract's own tests) keeps
// working exactly as before.
export const createEventBodySchema = z.object({
  eventFamilyType: z.string().trim().min(1),
  // Optional — FR-EVT-1 names "initial status" as a creation input, so a
  // caller may supply any of the four values up front; absent falls back
  // to Tentative in the controller.
  status: z.nativeEnum(EventStatus).optional(),
  eventManager: objectIdSchema('Invalid event_manager id.'),
  // At least one row here, even though STORY-011's Mongoose schema itself
  // allows zero — this create endpoint is where FR-EVT-1's "at least one
  // Client Contact" rule is actually enforced, and every row must carry a
  // non-empty name (a blank-name placeholder row is rejected, not
  // silently dropped).
  clientContacts: z.array(clientContactInputSchema).min(1),
  sessions: z.array(createEventSessionInputSchema).optional(),
  // Reuses updateAccommodationBodySchema wholesale — identical shape,
  // same "every field optional, no time component" limitation.
  accommodation: updateAccommodationBodySchema.optional(),
  extras: extrasFieldsSchema.optional(),
  extraLineItems: z.array(manualLineItemFieldsSchema).optional(),
  // STORY-072 — defaults to 5 (services/quotation.ts's own
  // FOOD_GST_RATE_PERCENT) when omitted, via the Mongoose schema's own
  // default rather than repeating the literal here.
  foodGstRatePercent: z.number().min(0).optional(),
});

// Every field optional (PATCH semantics) — a caller sends only what
// changed. No `type` here: switching an Item between Meal/Event isn't
// something this story's AC asks for, so it isn't offered.
// eventName/venue no longer require min(1) (STORY-071, same reasoning as
// eventItemBodySchema above) — an explicit "" is a legitimate way to clear
// a previously-set value back to blank, not a rejected edit.
export const updateItemBodySchema = z.object({
  mealName: z.string().trim().min(1).optional(),
  pax: z.number().min(0).optional(),
  costPerPlate: z.number().min(0).optional(),
  limitedSeating: z.boolean().optional(),
  menuItems: z.array(menuItemRefInputSchema).optional(),
  eventName: z.string().trim().optional(),
  venue: z.string().trim().optional(),
  startTime: z.string().trim().min(1).optional(),
  endTime: z.string().trim().min(1).optional(),
});

export const eventSessionItemParamsSchema = z.object({
  id: objectIdSchema('Invalid event id.'),
  sid: objectIdSchema('Invalid session id.'),
  iid: objectIdSchema('Invalid item id.'),
});

// mealName/pax/costPerPlate are Meal-only; eventName/venue are Event-only —
// nullable, not just absent, same "not applicable to the current variant
// reads as null" convention setup's own seating/notes already use.
// menuItems is always an array (ids only — no populate/expand convention
// exists anywhere yet). total_cost is derived (STORY-031's
// computeTotalCost) — null for an Event Item, since the concept doesn't
// apply; never accepted as input (this story's own AC: a client-submitted
// total_cost is ignored).
export const itemResultSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(ItemType),
  mealName: z.string().nullable(),
  pax: z.number().nullable(),
  costPerPlate: z.number().nullable(),
  limitedSeating: z.boolean().nullable(),
  menuItems: z.array(z.string()),
  eventName: z.string().nullable(),
  venue: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  totalCost: z.number().nullable(),
});

// durationDays/isMultiDay are derived (STORY-026's computeDurationDays/
// computeIsMultiDay) — never accepted as input, always present on output,
// same "derived fields ride along with every sub-resource response"
// convention totalDays/totalInclGst (accommodation) and balance (payment)
// already established. startTime/endTime are nullable, not just optional,
// matching accommodation's checkIn/checkOut convention for "genuinely
// unset yet". items added STORY-033 — GET /events/:id returned it only
// once the Session form actually needed to read/edit current Item data
// (same retroactive-addition pattern accommodation/payment/
// documentsChecklist/sessions itself already went through).
export const sessionResultSchema = z.object({
  id: z.string(),
  sessionType: z.string(),
  venue: z.string(),
  venueCost: z.number(),
  startDate: z.date(),
  endDate: z.date(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  pax: z.number(),
  sessionStatus: z.nativeEnum(SessionStatus),
  durationDays: z.number(),
  isMultiDay: z.boolean(),
  setup: sessionSetupResultSchema,
  items: z.array(itemResultSchema),
});

// The public Event shape — everything STORY-011's schema persists, plus the
// Accommodation Block (STORY-018/019), the Payment Record (STORY-021/022),
// the Documents Checklist (STORY-024), and now Sessions (STORY-026/027/028).
// GET /events/:id (STORY-013) exposed none of them at first — each was
// added the moment a UI story actually needed to read the current state on
// first render (STORY-020 for accommodation, STORY-023 for payment,
// STORY-025 for the checklist, now STORY-029 for sessions — the fourth
// occurrence of the recurrence flagged in STORY-028's own Decisions).
// Additive only: one more field on an already-public response, reusing
// STORY-027's own toPublicSession — not a new concept, not a breaking change.
export const eventResultSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventFamilyType: z.string(),
  status: z.nativeEnum(EventStatus),
  eventManager: z.string(),
  clientContacts: z.array(clientContactResultSchema),
  accommodation: accommodationResultSchema,
  payment: paymentResultSchema,
  documentsChecklist: documentsChecklistResultSchema,
  // Added STORY-042 — the Overview tab's Total Cost Summary panel needs
  // the current decoration/photographer/bhatji values to prefill its three
  // editable fields, the same "exposed the moment a UI story actually
  // needs to read current state on first render" recurrence
  // accommodation/payment/documentsChecklist/sessions each already went
  // through.
  extras: extrasResultSchema,
  // Added STORY-068 alongside extras, same reasoning.
  extraLineItems: z.array(manualLineItemResultSchema),
  // Added STORY-072 — the Quotation's own Total Cost Summary needs the
  // rate actually stored on this Event, not always the 5% default, to
  // recompute the Food Cost row identically on every reopen.
  foodGstRatePercent: z.number(),
  sessions: z.array(sessionResultSchema),
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// STORY-046 — a separate schema from eventResultSchema above, used only by
// GET /events/:id's own response: createEvent/updateEvent/etc. all stay
// EventManager-only (see router.ts), so eventResultSchema itself stays
// fully required/unchanged for them. This is the one route whose response
// shape genuinely varies by req.user.role (src/services/event-visibility.ts
// does the actual filtering) — every field a role might not see is
// `.optional()` (Zod accepts the key being entirely absent, not merely
// `null`), which is what "genuinely omits the field, verify the raw JSON"
// (this story's own AC) requires. `.extend()` only overrides the specific
// keys listed; every other field keeps eventResultSchema's own required
// definition, since the SRS never restricts them by role (id/eventId/
// eventFamilyType/status/eventManager/documentsChecklist/createdBy/
// createdAt/updatedAt).
const filteredRoomLineResultSchema = roomLineResultSchema.extend({
  tariff: z.number().optional(),
  totalInclGst: z.number().optional(),
});

// Exported — STORY-050/051's dashboard row reuses this directly for
// Housekeeping/Reception's own "rooms booked"/"check-in/out" column, same
// reasoning sessionSetupResultSchema's own export comment gives.
export const filteredAccommodationResultSchema = accommodationResultSchema.extend({
  roomLines: z.array(filteredRoomLineResultSchema),
  totalCharges: z.number().optional(),
});

const filteredItemResultSchema = itemResultSchema.extend({
  costPerPlate: z.number().nullable().optional(),
  totalCost: z.number().nullable().optional(),
});

const filteredSessionResultSchema = sessionResultSchema.extend({
  venueCost: z.number().optional(),
  setup: sessionSetupResultSchema.optional(),
  items: z.array(filteredItemResultSchema).optional(),
});

export const filteredEventResultSchema = eventResultSchema.extend({
  clientContacts: z.array(clientContactResultSchema).optional(),
  accommodation: filteredAccommodationResultSchema.optional(),
  payment: paymentResultSchema.optional(),
  extras: extrasResultSchema.optional(),
  extraLineItems: z.array(manualLineItemResultSchema).optional(),
  // Hidden for every non-EventManager role, same "money-adjacent figure"
  // class as extras/extraLineItems above (event-visibility.ts's own
  // filterEventForRole) — it only ever feeds the Quotation's own Total
  // Cost Summary, an EventManager-only screen.
  foodGstRatePercent: z.number().optional(),
  sessions: z.array(filteredSessionResultSchema),
});

// month is 1-indexed (?month=9 means September), matching the story's own
// query example — z.coerce.number() parses the string every query param
// arrives as; a non-numeric or out-of-range value fails validation and is
// reshaped into the documented 400 by app.ts's requestValidationErrorHandler,
// same as every other route's request-schema validation.
export const getCalendarQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(1970).max(2100),
});

// Deliberately not the full eventResultSchema — payment/accommodation/
// documentsChecklist/clientContacts have no bearing on rendering a calendar
// chip, and this story's own AC only asks for "enough of its parent Event's
// data... to render a chip without a second round-trip per session."
// eventManager added STORY-037 — the calendar's own Event Manager filter
// chip filters the already-fetched month's data client-side (venue/status/
// eventFamilyType were already present via sessionResultSchema/this
// summary; eventManager was the one field missing), the same retroactive-
// addition pattern this codebase has gone through repeatedly rather than
// a second network round-trip per filter interaction.
export const calendarEventSummarySchema = z.object({
  id: z.string(),
  eventFamilyType: z.string(),
  status: z.nativeEnum(EventStatus),
  eventManager: z.string(),
});

// Reuses sessionResultSchema wholesale (including items/setup) rather than
// hand-carving a leaner calendar-only shape — the same "avoid a second
// round-trip" AC argues for handing back the richer shape the client
// already knows how to read from GET /events, not a third, narrower Session
// representation to keep in sync.
export const calendarSessionResultSchema = sessionResultSchema.extend({
  event: calendarEventSummarySchema,
});

// Every field optional — "omitting the date range entirely returns all
// Events matching the other filters" (this story's own AC), and each of
// the four sibling filters (status/venue/eventManager/eventFamilyType) is
// independently optional too, combined with AND semantics only when
// actually supplied. `from`/`to` are independently optional as well (not
// an all-or-nothing pair) — an omitted side of the range simply means "no
// bound on that side," matching the plain-language reading of the range
// test itself (`start_date <= to AND end_date >= from`). `eventFamilyType`
// is this story's own "event_type" filter — named after the actual
// persisted field (docs/stories/Aaradhya_Story_Backlog.md's own field
// table calls it eventFamilyType throughout) rather than introducing a
// second name for the same concept.
export const searchEventsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.nativeEnum(EventStatus).optional(),
  venue: z.string().trim().min(1).optional(),
  eventManager: objectIdSchema('Invalid event manager id.').optional(),
  eventFamilyType: z.string().trim().min(1).optional(),
});
