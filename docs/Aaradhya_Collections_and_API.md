# Aaradhya — MongoDB Collections & REST API Reference

Traces every field to SRS §4 (`Aaradhya_SRS_v1.1.md`) or the finalized multi-day amendment, and every endpoint to the story that specified it in `Aaradhya_Story_Backlog.md`. Nothing below adds a field or endpoint the spec doesn't call for — where the spec is genuinely silent or contradictory, it's called out in §3 (Flags) rather than guessed.

**Collection naming convention:** snake_case, matching the field vocabulary the SRS itself already uses (`event_id`, `client_contacts`, `session_type`, …) rather than introducing a different casing here.

---

## 1. Top-level collections

Four real MongoDB collections. Everything else below them is an embedded subdocument, called out separately for readability but not a separate collection — noted explicitly on each.

### 1.1 `events`

The aggregate root — SRS §4.1. One document per Event; Client Contacts, Accommodation, Payment, Documents Checklist, and Sessions are all embedded (§1.1.1–1.1.7 below), **not** separate collections.

| Field | Type | Required | Description |
|---|---|---|---|
| `_id` | ObjectId | Yes | Mongo primary key. |
| `event_id` | String | Yes, unique | Human-readable id, server-generated (`ARD-EVT-2026-001` format) — SRS §4.1; client-supplied values are ignored (STORY-011). |
| `event_family_type` | String (enum: `Wedding`\|`Corporate`\|`Birthday`\|`Other` + free text) | Yes | SRS §4.1 — dropdown + custom value. |
| `status` | String (enum: `Tentative`\|`Confirmed`\|`Completed`\|`Cancelled`) | Yes, default `Tentative` | SRS §4.1 / Glossary "Status (Event)". |
| `event_manager` | ObjectId, ref `users` | Yes | Must reference a `users` document with `role: EventManager` — SRS §4.1, STORY-011. |
| `created_by` | ObjectId, ref `users` | Yes | Set from the authenticated caller, never from the request body — SRS §4.1, STORY-012. |
| `created_at` | Date | Yes | SRS §4.1. |
| `client_contacts` | [ClientContact] (§1.1.1) | Yes (array itself required; at least one non-empty-name row enforced by `POST /events`, not the schema) | SRS §4.1 / §4.2 (Glossary). |
| `accommodation` | AccommodationBlock (§1.1.2) | No | SRS §4.3 — an Event may have zero rooms (STORY-019 edge case). |
| `payment` | PaymentRecord (§1.1.4) | No, defaults to zero/unset | SRS §4.4, Event Manager visibility only. |
| `documents_checklist` | [DocumentChecklistItem] (§1.1.6) | Yes, fixed 6-item set | SRS §4.8. |
| `sessions` | [Session] (§1.1.5) | Yes (array itself required; may be empty — a Session-less Event is a valid draft state per STORY-028) | SRS §4.2, finalized by the multi-day amendment. |

**Not a field here:** `change_log[]`. SRS §4.1 describes change history as conceptually part of the Event; the story backlog (STORY-008) implements it as its own top-level collection (§1.4) keyed by `entity_type`/`entity_id` so Event-level *and* Session-level edits can be logged uniformly. Documented under §1.4, not embedded here.

#### 1.1.1 Client Contact — embedded in `events.client_contacts[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `_id` | ObjectId | Yes | Needed to address a specific row for edit/remove (FR-EVT-2). |
| `name` | String | Yes (non-empty enforced at create/edit) | SRS §4.1, Glossary "Client Contact". |
| `role` | String (enum: `Bride`\|`Groom`\|`POC`\|`Custom`) | Yes | Glossary: "Bride, Groom, Point of Contact, or a custom-added row" — the field that distinguishes which default/custom row this is. |
| `contact_number` | String | **Flagged — see §3** | SRS §2 lists "Contact Number" as a column; whether it's mandatory per row was left open in STORY-012. |

#### 1.1.2 Accommodation Block — embedded in `events.accommodation`

| Field | Type | Required | Description |
|---|---|---|---|
| `check_in` | Date | Yes (if accommodation exists at all) | SRS §4.3. |
| `check_out` | Date | Yes | SRS §4.3. |
| `total_days` | Number | Yes — **server-computed on every write, never client-editable** | SRS §4.3 "auto-calc"; STORY-018. |
| `room_lines` | [RoomLine] (§1.1.3) | Yes, may be empty array | SRS §4.3. |
| `total_occupancy` | Number | Yes — server-computed | SRS §4.3 "auto-sum"; STORY-018. |
| `total_charges` | Number | Yes — server-computed | SRS §4.3 "auto-sum"; STORY-018. |

#### 1.1.3 Room Line — embedded in `events.accommodation.room_lines[]`

| Field | Type | Required | Description |
|---|---|---|---|
| `_id` | ObjectId | Yes | Addresses a specific room line for edit/remove. |
| `room_type` | String (prefilled list + custom) | Yes | SRS §4.3. |
| `occupancy` | Number | Yes | SRS §4.3. |
| `tariff` | Number | Yes (prefilled, editable) | SRS §4.3. |
| `no_of_rooms` | Number | Yes | SRS §4.3. |
| `total_incl_gst` | Number | Yes — server-computed | SRS §4.3 "auto-calc"; STORY-018. |

#### 1.1.4 Payment Record — embedded in `events.payment`

Event Manager visibility only (SRS §4.4, §6.2).

| Field | Type | Required | Description |
|---|---|---|---|
| `total_estimated_amount` | Number | No, defaults to 0 | SRS §4.4. |
| `advance_required` | Number | No | SRS §4.4. |
| `advance_paid` | Number | No, defaults to 0; must be ≥ 0 | SRS §4.4; STORY-021 rejects negative input. |
| `advance_paid_date` | Date | **Flagged — see §3** | SRS §4.4; STORY-022 leaves "date without an amount yet" undecided. |
| `payment_mode` | String | No | SRS §4.4. |
| `balance` | Number | Yes — server-computed (`total_estimated_amount − advance_paid`) | SRS §4.4 "auto-calc"; STORY-021. Can be negative — not clamped. |
| `payment_status` | String | **Flagged — see §3** | SRS §4.4 describes this as "Derived/selectable" — the spec itself doesn't settle whether it's system-computed or Event-Manager-selected. |

#### 1.1.5 Session — embedded in `events.sessions[]`

**Finalized multi-day model** — `start_date`/`end_date` replace the earlier single `session_date` per the amendment. This is the field set to build against; it is not open for re-derivation.

| Field | Type | Required | Description |
|---|---|---|---|
| `_id` | ObjectId | Yes | Addresses a specific session for edit/remove (STORY-028). |
| `session_type` | String (enum: `Engagement`\|`Haldi`\|`Wedding`\|`Custom` + free text) | Yes | SRS §4.2. |
| `venue` | String (prefilled list + custom) | Yes | SRS §4.2. |
| `venue_cost` | Number | Yes (auto-filled from venue, editable) | SRS §4.2. |
| `start_date` | Date | Yes | Amendment §1 — replaces `session_date`. |
| `end_date` | Date | Yes, must be ≥ `start_date` | Amendment §1. |
| `start_time` | String (time-of-day) | Yes | SRS §4.2, applies to `start_date` per amendment. |
| `end_time` | String (time-of-day) | Yes | SRS §4.2, applies to `end_date` per amendment. |
| `pax` | Number | Yes | SRS §4.2. |
| `session_status` | String (enum: `Active`\|`Cancelled`) | Yes, default `Active` | Amendment §1 — independent of the parent Event's `status`. |
| `setup` | Setup (§1.1.5.1) | Yes | SRS §4.2. |
| `items` | [Item] (§1.1.5.2) | Yes, may be empty array | SRS §4.2. |

**Not fields here:** `duration_days`, `is_multi_day`. The amendment states these explicitly as derived, not stored — computed on read, never persisted (Amendment §1, STORY-026).

##### 1.1.5.1 Setup — embedded in `events.sessions[].setup`

| Field | Type | Required | Description |
|---|---|---|---|
| `seating_arrangement` | String (enum: `Theatre`\|`Round tables`\|`Classroom`\|`U-shape`\|`Cluster`\|`Other`) | Yes | SRS §4.2. |
| `table_count` | Number | No | SRS §4.2. |
| `chair_count` | Number | No | SRS §4.2. |
| `stage_required` | Boolean | Yes, default `false` | SRS §4.2. |
| `buffet_setup` | Boolean | Yes, default `false` | SRS §4.2. |
| `registration_desk` | Boolean | Yes, default `false` | SRS §4.2. |
| `vip_seating` | Boolean | Yes, default `false` | SRS §4.2. |
| `bride_groom_seating` | Boolean | Yes, default `false` | SRS §4.2. |
| `notes` | String | No | SRS §4.2 — exactly one free-text field, deliberately not a primary input (STORY-029 explicitly caps this at one). |

##### 1.1.5.2 Item — embedded in `events.sessions[].items[]`

| Field | Type | Required | Applies to | Description |
|---|---|---|---|---|
| `_id` | ObjectId | Yes | Both | Addresses a specific item for edit/remove (STORY-032). |
| `type` | String (enum: `Meal`\|`Event`) | Yes | Both | SRS §4.5. |
| `meal_name` | String (prefilled + custom) | Yes if `type=Meal` | Meal | SRS §4.5. |
| `event_name` | String (prefilled + custom) | Yes if `type=Event` | Event | SRS §4.5. |
| `start_time` | String (time-of-day) | Yes | Both | SRS §4.5. |
| `end_time` | String (time-of-day) | Yes | Both | SRS §4.5. |
| `pax` | Number | Yes if `type=Meal` | Meal | SRS §4.5. |
| `cost_per_plate` | Number | Yes if `type=Meal` (auto-suggested, editable) | Meal | SRS §4.5. |
| `total_cost` | Number | Yes if `type=Meal` — **server-computed** (`pax × cost_per_plate`), never client-editable | Meal | SRS §4.5 "auto-calc"; STORY-031/032. |
| `menu_items` | [ObjectId, ref `menu_items`] | No, may be empty | Meal | SRS §4.5. |
| `venue` | String (prefilled) | Yes if `type=Event` | Event | SRS §4.5. |

#### 1.1.6 Document Checklist Item — embedded in `events.documents_checklist[]`

Fixed 6-item set, server-defined — no item can be added or removed via the API (SRS §4.8, STORY-024).

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | String (enum: `aadhar_card`\|`pan_card`\|`leaving_birth_certificate`\|`ration_card`\|`passport_photos`\|`wedding_card`) | Yes | SRS §4.8's fixed list. |
| `received` | Boolean | Yes, default `false` | SRS §4.8 — Yes/No flag, no file upload. |

---

### 1.2 `users`

SRS §4.9. One document per User Account.

| Field | Type | Required | Description |
|---|---|---|---|
| `_id` | ObjectId | Yes | Mongo primary key. |
| `name` | String | Yes | SRS §4.9. |
| `username` | String | Yes, unique | SRS §4.9 "login credentials"; STORY-001. |
| `password_hash` | String | Yes | SRS §4.9; never returned in any API response (STORY-002/005/006). |
| `role` | String (enum: `EventManager`\|`FnBHead`\|`Housekeeping`\|`Reception`) | Yes | SRS §3, §4.9. |
| `active` | Boolean | Yes, default `true` | SRS §4.9. |

### 1.3 `menu_items`

SRS §4.6. Organization-wide, shared across every Event/Session/Item.

| Field | Type | Required | Description |
|---|---|---|---|
| `_id` | ObjectId | Yes | Referenced by `events.sessions[].items[].menu_items[]`. |
| `name` | String | Yes, unique (case-insensitive) | SRS §4.6; STORY-030. |
| `default_cost_per_plate` | Number | Yes | SRS §4.6 — used to auto-suggest `cost_per_plate` on a Meal Item. |
| `created_via` | String (e.g. `adhoc`\|`preseeded`) | Yes | SRS §4.6 — "whether added ad hoc during Item entry... or pre-seeded." |

### 1.4 `change_log_entries`

SRS §4.10, implemented as its own collection per STORY-008 (see the note under §1.1).

| Field | Type | Required | Description |
|---|---|---|---|
| `_id` | ObjectId | Yes | Mongo primary key. |
| `entity_type` | String (e.g. `Event`\|`Session`) | Yes | SRS §4.10 "field"; STORY-008. |
| `entity_id` | ObjectId | Yes | The `events._id` the entry belongs to (Session-level edits are still logged against the parent Event — STORY-028's `field` naming convention, e.g. `sessions[Wedding].end_date`, distinguishes which nested part changed). |
| `field` | String | Yes | SRS §4.10. |
| `old_value` | Mixed | Yes | SRS §4.10 — stored even when equal to `new_value` (STORY-008 leaves this deliberate). |
| `new_value` | Mixed | Yes | SRS §4.10. |
| `changed_by` | ObjectId, ref `users` | Yes | SRS §4.10. |
| `timestamp` | Date | Yes, server-set | SRS §4.10. |

---

## 2. REST API endpoints

| Method | Path | Purpose | Story |
|---|---|---|---|
| POST | `/auth/login` | Authenticate with username/password, issue a session token | STORY-002 |
| POST | `/users` | Create a User Account (EventManager-only) | STORY-005 |
| GET | `/users` | List all User Accounts (EventManager-only) | STORY-006 |
| PATCH | `/users/:id` | Deactivate a User Account or change its role (EventManager-only) | STORY-006 |
| GET | `/change-log` | List Change Log Entries for one entity (`?entityType=&entityId=`), EventManager-only | STORY-009 |
| POST | `/events` | Create an Event (family type, manager, ≥1 Client Contact) | STORY-012 |
| GET | `/events` | List Events | STORY-013 |
| GET | `/events/:id` | Get one Event; response fields filtered by caller's role | STORY-013, STORY-046 |
| PATCH | `/events/:id` | Edit core Event fields (family type, status, manager, Client Contacts) | STORY-014 |
| PATCH | `/events/:id/accommodation` | Edit the Accommodation Block and its Room Lines; derived totals server-computed | STORY-019 |
| PATCH | `/events/:id/payment` | Edit the Payment Record (EventManager-only); `balance` server-computed | STORY-022 |
| PATCH | `/events/:id/documents` | Toggle a Documents Checklist item | STORY-024 |
| POST | `/events/:id/sessions` | Add a Session to an Event | STORY-027 |
| PATCH | `/events/:id/sessions/:sid` | Edit a Session (including its date range) | STORY-028 |
| DELETE | `/events/:id/sessions/:sid` | Remove a Session | STORY-028 |
| GET | `/menu-items` | Search the shared Menu Item list (`?search=`) | STORY-030 |
| POST | `/menu-items` | Add a new Menu Item to the shared list | STORY-030 |
| POST | `/events/:id/sessions/:sid/items` | Add a Meal or Event Item to a Session | STORY-032 |
| PATCH | `/events/:id/sessions/:sid/items/:itemId` | Edit an Item; `total_cost` server-recomputed | STORY-032 |
| DELETE | `/events/:id/sessions/:sid/items/:itemId` | Remove an Item | STORY-032 |
| GET | `/calendar` | Sessions active on any date in a given month (`?month=&year=`), overlap-rule query | STORY-034 |
| GET | `/events/search` | Date-range + status/venue/manager/type filtered Event search, overlap-rule query | STORY-036 |
| PATCH | `/events/:id/extras` | Set the three optional extras (Decoration/Photographer/Bhatji amounts) | STORY-040 |
| GET | `/events/:id/quotation-summary` | Live Total Cost Summary rollup — not a stored entity | STORY-041 |
| GET | `/events/:id/quotation.pdf` | Generate and return the client-facing Quotation PDF | STORY-043 |
| GET | `/dashboard` | Aggregate counts + upcoming-events list, role-filtered | STORY-047 |

**Not an endpoint here:** a "get current user" route (e.g. `GET /auth/me`). STORY-003 uses a throwaway test route to verify the auth middleware, not a real production endpoint, and no story has the frontend needing to re-fetch "who am I" outside the login response itself. Flagged in §3 rather than added speculatively.

---

## 3. Flags — decisions the spec doesn't settle

These block or under-specify the row/endpoint next to them above; resolve before that piece is built, not during it.

1. **`client_contacts[].contact_number` — required or optional?** SRS §2 lists it as a column but never states whether a row is valid without one. STORY-012 flagged this as an open call. Affects `POST /events` and `PATCH /events/:id` validation.
2. **`payment.payment_status` — system-derived or Event-Manager-selected?** SRS §4.4 literally says "Derived/selectable," which reads as two different designs at once. If derived, it's computed the same way `balance` is (never client-writable); if selectable, `PATCH /events/:id/payment` needs to accept it as input and STORY-021's schema needs an enum of valid values that doesn't currently exist anywhere in the spec.
3. **`payment.advance_paid_date` without `advance_paid`.** STORY-022 leaves open whether a date can be set before an amount is recorded against it.
4. **Session-adding on a Cancelled Event.** STORY-027 leaves open whether `POST /events/:id/sessions` should be blocked when the parent Event's `status` is already `Cancelled`, or allowed (since `session_status` is already independent of Event `status` per the amendment).
5. **No "current user" endpoint.** Noted above — flag if the frontend ever needs to restore a session on page reload without a fresh login (e.g. token stored client-side, page refreshed) rather than getting user identity from the login response alone.
6. **No distinct-values endpoint for calendar filters.** STORY-037's Venue/Event Manager/Event Type filter chips need a source of real existing values to populate their options from. No endpoint here provides that (e.g. `GET /events/distinct/venue`) — STORY-037 itself already flags this as an unresolved dependency; needs a decision (dedicated endpoint vs. deriving client-side from an already-fetched Event list) before that story is built.
7. **No Menu Item removal/curation path.** `POST /menu-items` and `GET /menu-items` are the only operations the spec defines (SRS §4.6, STORY-030). The SRS's own Assumption A8 already flags that list governance is unaddressed — if duplicate or bad entries accumulate over time, there's currently no documented way to fix that via the API.
8. **`events.accommodation` as `null` vs. an empty-but-present object.** SRS treats "no accommodation" as a valid state (STORY-019 edge case: zero room lines), but doesn't say whether an Event with no accommodation entered yet stores `accommodation: null` or an accommodation object with an empty `room_lines[]` and zero totals. Affects how `GET /events/:id` and the Quotation Summary (STORY-041) should render that state.
