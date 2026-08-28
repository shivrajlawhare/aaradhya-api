# Aaradhya Event Management System — Software Requirements Specification

**Document status:** Draft for sign-off — supersedes `Aaradhya_Event_Management_Spec_v1.md` and folds in `Spec_Amendment_MultiDate_Sessions.md` as finalized.
**Version:** 1.1
**Stack:** TypeScript + React + MUI (frontend) · REST API + MongoDB (backend) · server-side PDF generation
**Scale target:** ~15 users/day, single organization, single property

This document is the single source of truth for development-story slicing. Every module in §5 is written to correspond to an independent set of stories; every entity in §4 uses the exact name it will keep throughout later prompts (see Glossary, §2).

---

## 1. Purpose & Scope

### 1.1 Purpose

Aaradhya currently manages weddings, corporate events, and other functions using Excel sheets and manually typed PDF quotations, entered separately from the operational tracking used by kitchen, housekeeping, and reception staff. This causes duplicate data entry, drift between the quoted numbers and the operational plan, and manual arithmetic errors (GST, totals, occupancy).

This system replaces that process with one application where a single **Event** record is the source of truth for: client details, the day-by-day/session plan, accommodation, cost totals, and the client-facing **Quotation** PDF. Every downstream view — the calendar, the F&B/Housekeeping/Reception dashboards, and the PDF — is a rendering of that one record, never a separate entry.

### 1.2 Scope (v1)

In scope:
- Single-property event management for one organization (no multi-property, no multi-tenant).
- Event and Session data entry, including multi-day sessions (§4.2).
- Accommodation, payment tracking, and a documents checklist per event.
- A shared, growable menu-item master list.
- Auto-computed cost totals (no manually typed totals or GST).
- On-demand Quotation PDF generation in the existing Aaradhya format.
- A monthly calendar view with date-range-aware event display.
- Four fixed user roles with role-filtered dashboards.
- A per-field change history/audit trail.
- Username/password authentication for a small, internally managed user base.

Out of scope items are consolidated in §7; do not infer additional scope from feature adjacency.

### 1.3 Relationship to other project documents

- Visual/UI design (layout, color, typography, component styling) is defined separately in the Figma design spec and is explicitly **not** part of this document.
- This document does not contain code, API contracts, or schema syntax; entities are described conceptually so that technical design and story-writing can follow from it.

---

## 2. Glossary

All later documents (story prompts, tickets, Figma frames) must reuse these exact names — do not introduce synonyms for the same concept.

| Term | Definition |
|---|---|
| **Event** | The top-level record for one client engagement (e.g. one wedding, one corporate booking). Contains client, accommodation, payment, documents, and one or more Sessions. Identified by `event_id`. |
| **Session** | One scheduled block of activity within an Event (e.g. Engagement, Haldi, Wedding day). Has its own venue, date range, setup, and Items. An Event with one Session is a single-day/single-function event; an Event with several Sessions is multi-day/multi-function. |
| **Item** | A single line within a Session: either a **Meal Item** (food/beverage, tied to Menu Items) or an **Event Item** (a non-food program moment, e.g. Muhurta, Cake Cutting). |
| **Menu Item** | An entry in the shared, organization-wide food/beverage master list (e.g. "Paneer Tikka"), reusable across Meal Items in any Session of any Event. |
| **Client Contact** | A named party on the Event (Bride, Groom, Point of Contact, or a custom-added row), with a name and phone number. |
| **Accommodation Block** | The single event-level record of the guest room stay (check-in, check-out) containing one or more **Room Lines**. |
| **Room Line** | One row within an Accommodation Block: room type, occupancy, tariff, number of rooms, computed total. |
| **Payment Record** | The Event's financial tracking fields: total estimated amount, advance, balance, payment mode, status. Visible only to the Event Manager role. |
| **Document Checklist Item** | One Yes/No tracked item from the fixed client-document list (Aadhar, PAN, etc.) — no file upload. |
| **Quotation** | The PDF export rendered on demand from an Event's current data. Not a separately entered record. |
| **Change Log Entry** | One audit record: field, old value, new value, changed-by user, timestamp. |
| **User Account** | A login belonging to one of the four Roles. |
| **Role** | One of: Event Manager, F&B Head, Housekeeping Head, Reception Desk (§3). |
| **Status (Event)** | Event-level lifecycle: Tentative → Confirmed → Completed, or Cancelled at any point. |
| **Session Status** | Session-level state, independent of Event Status: Active or Cancelled (§4.2). |

---

## 3. User Roles & Personas

Four fixed roles, no multi-tenant org hierarchy, no self-service signup — accounts are created by an Event Manager (see Assumption A1 on administrative capability).

### 3.1 Event Manager
Full access to every Event: client details, all Sessions/Items, setup, accommodation, payments, documents checklist, change history, calendar, and status control. The only role that can create/edit Events, generate Quotations, record payments, and manage other Users. There are up to 3 concurrent Event Manager accounts.

### 3.2 F&B Head
Operational role covering both kitchen and restaurant/service concerns (merged per finalized decision). Sees: event name, date(s), POC name/contact, venue, pax, menu (Meal Items and their Menu Items), meal timing, special food instructions. Does not see payments or non-food setup details.

### 3.3 Housekeeping Head
Sees: event name, date(s), venue, pax, seating/setup requirements, hall setup, rooms booked (where applicable). Does not see menu or payment data.

### 3.4 Reception Desk
Sees: event name, date(s), POC, pax, venue, rooms booked, Bride/Groom names, check-in/out dates. Does not see menu or payment data.

Each non-Event-Manager role's dashboard and Event Page view is a filtered projection of the same Event record — there are no separate per-role data stores (FR-ROLE-1, §5.5).

---

## 4. Core Entities

Field lists below are conceptual (for shared understanding and story-slicing), not a schema definition.

### 4.1 Event

| Field | Notes |
|---|---|
| `event_id` | Auto-generated, human-readable (e.g. `ARD-EVT-2026-001`). |
| `event_family_type` | Wedding / Corporate / Birthday / Other — dropdown + custom value. |
| `status` | Tentative / Confirmed / Completed / Cancelled. |
| `event_manager` | Assigned Event Manager (one of the User Accounts with that Role). |
| `created_by`, `created_at` | Standard audit fields. |
| `client_contacts[]` | List of Client Contact rows; default rows Bride, Groom, POC; add/remove supported. |
| `accommodation` | One Accommodation Block (§4.3). |
| `payment` | One Payment Record (§4.4), Event Manager-only visibility. |
| `documents_checklist[]` | Fixed set of Document Checklist Items. |
| `sessions[]` | One or more Sessions (§4.2) — this is what makes an Event multi-day/multi-function. |
| `change_log[]` | Change Log Entries for every tracked field edit on the Event or its children. |

An Event has no independently stored "Quotation record" — the Quotation is generated from this data at request time (see §4.7 and Assumption A2 on whether generated PDFs are archived).

### 4.2 Session — finalized multi-day model

This section folds in and finalizes the multi-day/calendar-overlap amendment; it is not subject to further re-derivation in later documents.

| Field | Notes |
|---|---|
| `session_type` | Engagement / Haldi / Wedding / Custom — dropdown + custom. |
| `venue` | Prefilled list (Poolside, Half Banquet, Full Banquet, Lawn, Conference, …) + custom. |
| `venue_cost` | Auto-filled from venue selection, editable. |
| `start_date`, `end_date` | **Date range, both required, `end_date ≥ start_date`.** Replaces the earlier single `session_date`. A single-day session is simply the case `start_date == end_date`. |
| `start_time`, `end_time` | Time-of-day, applied to `start_date` and `end_date` respectively. |
| `duration_days` *(derived)* | `end_date − start_date + 1`. Not stored. |
| `is_multi_day` *(derived)* | `duration_days > 1`. Not stored. |
| `pax` | Numeric. |
| `session_status` | **Active / Cancelled.** Independent of the parent Event's `status` — one Session inside a multi-day Event can be cancelled without cancelling the Event. |
| `setup` | Seating arrangement (Theatre/Round tables/Classroom/U-shape/Cluster/Other), table/chair counts, stage/buffet/registration-desk/VIP/bride-groom-seating flags, and one free-text decoration/stage/AV/parking notes field. |
| `items[]` | One or more Items (§4.5). |

**Calendar rendering rule (finalized).** A Session's chip appears on every calendar date `D` such that `start_date ≤ D ≤ end_date` and `session_status = Active` — not only on `start_date`. An Event's chip/band on a given day is the union of all its Active Sessions covering that day, deduplicated to one chip per Event per day even if multiple Sessions of that Event cover the same day.

**Date search/filter rule (finalized).** "Events on date X" and "events between X and Y" both use interval-overlap matching against `start_date`/`end_date`, not equality against a single date field.

**Edge cases (finalized, carried from the amendment, not to be re-litigated):**
- Month/year-boundary sessions need no special handling — real date arithmetic, not string month-matching.
- Two Active Sessions of the same Event overlapping the same day collapse into one calendar chip; the Event Page still lists both Sessions separately.
- Sessions of different Events overlapping the same day render as separate stacked chips (standard calendar overflow behavior).
- Dates are stored timezone-naive (single-property, single-timezone operation — Asia/Kolkata); `start_time`/`end_time` are local time-of-day values, not merged into timezone-aware datetimes, and are not part of the overlap query.
- A Cancelled Session (or one missing `start_date`/`end_date` because entry is incomplete) is excluded from calendar rendering and date search, but remains visible (struck through, for Cancelled) in the Event Page's Session list.

### 4.3 Accommodation Block

Event-level, one block per Event (not per Session) — confirmed decision, matches both existing quotation formats.

| Field | Notes |
|---|---|
| `check_in`, `check_out` | Dates. |
| `total_days` *(derived)* | From check-in/check-out. |
| `room_lines[]` | Room type (prefilled), occupancy, tariff (prefilled, editable), number of rooms, `total_incl_gst` *(derived)*. |
| `total_occupancy` *(derived)* | Sum across room lines. |
| `total_charges` *(derived)* | Sum across room lines. |

### 4.4 Payment Record

Event-level, Event Manager visibility only.

| Field | Notes |
|---|---|
| `total_estimated_amount` | |
| `advance_required`, `advance_paid`, `advance_paid_date` | |
| `payment_mode` | |
| `balance` *(derived)* | `total_estimated_amount − advance_paid`, recomputed as later payments are logged. |
| `payment_status` | Derived/selectable status reflecting balance state. |

### 4.5 Item (Meal Item / Event Item)

Belongs to exactly one Session.

| Field | Notes |
|---|---|
| `type` | `Meal` or `Event`. |
| **Meal Item fields** | `meal_name` (prefilled + custom), `start_time`/`end_time`, `pax`, `cost_per_plate` (auto-suggested from meal type, editable), `total_cost` *(derived: `pax × cost_per_plate`)*, `menu_items[]` (search existing Menu Items or add new inline). |
| **Event Item fields** | `event_name` (prefilled + custom), `start_time`/`end_time`, `venue` (prefilled). |

### 4.6 Menu Item (master list)

Organization-wide, shared across all Events/Sessions/Items.

| Field | Notes |
|---|---|
| `name` | Searchable. |
| `default_cost_per_plate` | Used to auto-suggest `cost_per_plate` on a Meal Item by meal type association. |
| `created_via` | Whether added ad hoc during Item entry (then persisted for future reuse) or pre-seeded. |

### 4.7 Quotation (PDF export)

Not a persisted entity distinct from the Event — a rendering. Triggered by "Generate Quotation PDF" on the Event Page. Content: Client Details → Event Details per Session → Accommodation → F&B per Session → Total Cost Summary (read-only rollup, §5.4) → static Terms & Conditions/Documents/Bank footer.

### 4.8 Document Checklist Item

Fixed list per Event: Aadhar Card, PAN Card, Leaving/Birth Certificate, Ration Card, 2 passport photos (per Client Contact), Wedding Card. Each is a Yes/No flag — no file storage.

### 4.9 User Account

| Field | Notes |
|---|---|
| `name`, `login credentials` | |
| `role` | One of the four Roles (§3). |
| `active` | Enable/disable without deleting history. |

### 4.10 Change Log Entry

| Field | Notes |
|---|---|
| `entity`, `field` | What changed (Event field, Session field, etc.). |
| `old_value`, `new_value` | |
| `changed_by`, `timestamp` | |

---

## 5. Functional Requirements by Module

Modules are scoped to map to independent story sets; cross-module dependencies are called out explicitly so story sequencing can account for them.

### 5.1 Event Management Module
*Primary entities: Event, Client Contact, Accommodation Block, Payment Record, Document Checklist Item.*

- FR-EVT-1: An Event Manager can create an Event with `event_family_type`, initial `status`, assigned `event_manager`, and at least one Client Contact.
- FR-EVT-2: An Event Manager can add/remove/edit Client Contact rows (default Bride/Groom/POC, custom rows supported).
- FR-EVT-3: An Event Manager can edit the Accommodation Block; `total_days`, `total_incl_gst` per Room Line, `total_occupancy`, and `total_charges` are always system-computed, never manually entered.
- FR-EVT-4: An Event Manager can record and update the Payment Record; `balance` is always system-computed.
- FR-EVT-5: An Event Manager can toggle each Document Checklist Item independently.
- FR-EVT-6: An Event Manager can change `status` at any time, including to Cancelled, from any prior status.
- FR-EVT-7: Every field edit anywhere on the Event or its child entities produces a Change Log Entry (see Module 5.7).
- FR-EVT-8: There is exactly one data-entry flow for an Event — no separate "quotation intake" flow exists anywhere in the product.

### 5.2 Session & Calendar Management Module
*Primary entities: Session, Item, Menu Item.*

- FR-SES-1: An Event Manager can add/remove Sessions on an Event, each with its own `session_type`, `venue`, `venue_cost`, `start_date`/`end_date`, `start_time`/`end_time`, `pax`, `setup`, and `session_status`.
- FR-SES-2: `start_date`/`end_date` support single-day (`start_date == end_date`) and multi-day ranges without a different entry mode.
- FR-SES-3: An Event Manager can add Items (Meal or Event type) to a Session; Meal Items support searching and inline-adding Menu Items, with new Menu Items persisted to the shared master list.
- FR-SES-4: `total_cost` on a Meal Item is always system-computed (`pax × cost_per_plate`); `cost_per_plate` auto-suggests from the selected meal type and is editable.
- FR-SES-5: The monthly calendar view renders one chip/band per Event per calendar day, computed via the finalized overlap rule in §4.2 — a Session appears on every date it spans, not only its start date.
- FR-SES-6: Calendar filters (All / Tentative / Confirmed / Venue / Event Manager / Event Type) apply on top of the overlap-based day rendering.
- FR-SES-7: Clicking a calendar chip opens the corresponding Event Page.
- FR-SES-8: Date-based search/filtering elsewhere in the app (e.g. "events this week") uses the same interval-overlap logic as the calendar, per §4.2.

### 5.3 Client Management Module
*Primary entities: Client Contact (embedded in Event; no standalone client directory in v1 — see Assumption A3).*

- FR-CLI-1: Client Contacts are managed as part of Event Management (FR-EVT-2); there is no separate client CRM/module in v1.
- FR-CLI-2: Reception Desk role sees Client Contact names (Bride/Groom) and POC contact details as part of its filtered Event view.

### 5.4 Quotation Generation Module
*Primary entities: Quotation (derived), Event and all its children.*

- FR-QUO-1: "Generate Quotation PDF" is available on the Event Page and produces a PDF in the existing Aaradhya template from the Event's current data, at any point in the Event's lifecycle.
- FR-QUO-2: The Total Cost Summary section is a 100% read-only rollup: per-Session venue costs + sum of Item `total_cost` across Sessions (+ GST%) + Accommodation `total_charges` + three optional simple line-item inputs (Decoration/Photographer/Bhatji, amount only) = Grand Total. No field in this summary accepts free numeric entry other than the three named optional line items and the GST% where it varies.
- FR-QUO-3: Regenerating the Quotation after data changes reflects the latest Event state; whether prior generated PDFs are retained is addressed in Assumption A2.
- FR-QUO-4: The PDF layout paginates automatically from Session/Item data — "page" is not a concept exposed in the data-entry UI.

### 5.5 Role-Based Dashboards & Views Module
*Primary entities: User Account, Role; reads across Event and children.*

- FR-ROLE-1: Each Role's dashboard and Event Page view is a filtered projection of the same Event data per the visibility table in §3 — no per-role duplicate storage.
- FR-ROLE-2: The Event Manager dashboard shows aggregate counts (today's events, upcoming, tentative, confirmed) and an upcoming-events list with date, event, client, venue, pax, status.
- FR-ROLE-3: F&B Head, Housekeeping Head, and Reception Desk dashboards use the same structural layout as FR-ROLE-2, restricted to their permitted fields.
- FR-ROLE-4: On an individual Event Page, non-Event-Manager roles see only their relevant tab(s), pre-filtered; the Event Manager sees all tabs (Overview, Client, Sessions & Menu, Setup, Rooms, Payments, Documents).

### 5.6 Authentication & User Management Module
*Primary entities: User Account.*

- FR-AUTH-1: Users authenticate with username/password credentials issued internally (no self-service signup).
- FR-AUTH-2: Every authenticated action is attributable to a User Account for Change Log purposes.
- FR-AUTH-3: An authorized user (see Assumption A1) can create, deactivate, and reassign the Role of a User Account.
- FR-AUTH-4: Session/token expiry and password reset mechanics are standard and not further specified here (technical design decision, not a product requirement).

### 5.7 Change History Module
*Primary entities: Change Log Entry.*

- FR-LOG-1: Every field-level edit on an Event or any child entity (Session, Item, Accommodation, Payment, Documents Checklist) creates a Change Log Entry capturing field, old value, new value, changed-by, timestamp.
- FR-LOG-2: Change Log Entries are visible to Event Managers on the Event Page (e.g. an "Activity" sub-tab).
- FR-LOG-3: No approval/workflow gating is applied to edits — the log is a visible audit trail only, not a review gate.

---

## 6. Non-Functional Requirements

### 6.1 Performance
- Application is sized for ~15 concurrent daily users and a total dataset in the low thousands of Events over the system's working life — no requirement for horizontal scaling, sharding, or read-replica architecture.
- Calendar month view and dashboard aggregate queries should return within normal interactive web latency (sub-second) at this data scale using standard indexed MongoDB queries (see indexing note in the multi-day amendment).
- PDF generation should complete within a few seconds of the request.

### 6.2 Security
- Role-based access control enforced server-side on every API endpoint, not just hidden in the UI — a F&B Head, Housekeeping Head, or Reception Desk account must not be able to retrieve payment data via a direct API call.
- Payment Record and full Change Log are restricted to the Event Manager role.
- Passwords stored using a standard salted hash; no plaintext credential storage.
- No client-facing authentication surface in v1 (no client portal — see §7).

### 6.3 Multi-Tenancy
- Explicitly single-tenant, single-organization, single-property. No tenant-isolation, no per-organization configuration layer, no white-labeling. Any future multi-property need is a distinct future phase, not a v1 concern.

### 6.4 Accessibility
- Standard web accessibility practices (keyboard navigability, sufficient color contrast for status indicators, form labels/ARIA where applicable) apply to the extent typical for an internal operations tool; no formal WCAG conformance level is mandated by the business in v1 (flagged — see Assumption A4).

### 6.5 Reliability & Data Integrity
- Every cost/GST/total field defined as "auto-calc" in §4 must never be directly editable — this is a correctness requirement, not just a UX preference, since it is the primary fix for the current Excel-driven arithmetic errors.
- Because there is exactly one Event record per event (FR-EVT-8), there is no reconciliation/sync requirement between a "quotation" and an "event" — that entire class of bug is eliminated by the data model, not handled defensively.

### 6.6 Data Retention & Backup
- Standard operational backup of the MongoDB data store; no specific retention period or archival policy is mandated by the business in v1 (flagged — see Assumption A5).

### 6.7 Browser/Device Support
- Desktop-first web application (staff operate from front-desk/office computers); no native mobile app requirement. Responsive behavior for tablet use is reasonable but not a hard requirement (flagged — see Assumption A6).

---

## 7. Out of Scope (v1)

Confirmed exclusions — do not build, and do not treat as implied scope from an adjacent feature:

- WhatsApp/SMS notifications
- Client-facing portal or e-signatures
- File upload for the Documents Checklist (Yes/No tracking only)
- Exportable/scheduled reports (dashboard + calendar are considered sufficient)
- Structured decoration/stage/AV/parking fields (free-text notes field only)
- Staff scheduling
- Payment gateway integration
- Multi-property / multi-tenant support
- A standalone Client CRM/directory module (Client Contacts exist only as embedded rows on an Event)
- Archival/versioning of previously generated Quotation PDFs (see Assumption A2)

These may be revisited as a future phase once v1 is in real use, but are not to be sliced into v1 development stories.

---

## 8. Notes for Story Slicing

Each module in §5 is intended to become one or more independent story groups, roughly in this dependency order:

1. **Auth & User Management (5.6)** — foundational; other modules assume an authenticated, role-bearing User Account.
2. **Event Management (5.1)** — Event, Client Contact, Accommodation, Payment, Documents core CRUD.
3. **Session & Calendar Management (5.2)** — depends on Event existing; the multi-day/overlap logic (§4.2) is its own testable slice, independent of Item/Menu Item work.
4. **Quotation Generation (5.4)** — depends on 5.1 and 5.2 having stable data to render; the Total Cost Summary rollup logic can be built/tested independently of the PDF template rendering itself.
5. **Role-Based Dashboards & Views (5.5)** — a filtering/projection layer over 5.1–5.3; can be sliced per role.
6. **Change History (5.7)** — cross-cutting; can be built incrementally alongside each module above rather than as a single story.

---

## 9. Assumptions

Flagged for confirmation before development stories are written. Nothing below was explicitly stated in the source requirements conversation.

- **A1 — Administrative capability for User Accounts.** The source requirements name "Event Manager" as the full-access role but never formally define an Admin/Accounts role for creating and managing User Accounts. This document assumes Event Managers collectively have this capability (FR-AUTH-3). If a distinct Admin role or a single super-admin account is actually intended, §3 and §5.6 need a small revision.
- **A2 — Quotation PDF history.** Assumed that generated Quotation PDFs are **not** archived/versioned — each generation is a live render of current data, and there is no requirement to retrieve "exactly what was sent to the client on date X" later. If the business needs a record of what was actually quoted at a point in time, this needs a new stored `Quotation` entity (a snapshot), which is a real scope addition, not a rendering detail.
- **A3 — No standalone Client directory.** Assumed Client Contacts exist only as rows embedded in an Event (no cross-event client history, e.g. "has this couple booked with us before"). If repeat-client tracking matters to the business, that's a distinct module.
- **A4 — Accessibility level.** No WCAG conformance target was specified; assumed "reasonable internal-tool accessibility" rather than a certified standard, given the 15-user internal audience.
- **A5 — Backup/retention policy.** No specific backup frequency or retention period was stated; assumed standard periodic backup is sufficient with no formal SLA.
- **A6 — Device support.** Assumed primarily desktop use based on the front-desk/office operational context described; tablet/mobile responsiveness assumed "nice to have," not required, since it was never discussed.
- **A7 — Session Status as a new field.** `session_status` (Active/Cancelled) was introduced in the multi-day amendment to let one Session of a multi-day Event be cancelled independently of the Event's own `status`. The original v1 spec had no session-level status field at all — confirm this is desired before treating it as locked.
- **A8 — Menu Item master list governance.** Assumed any Event Manager (not a curated subset) can add new Menu Items inline, with no dedupe/moderation step — matching the "grows organically" description in the source conversation. If menu-list quality control matters, that's an added requirement.
- **A9 — GST%.** Assumed GST% is a single organization-wide rate applied to food costs, editable per-quotation "if it varies" (as stated), but not modeled as tax-per-Menu-Item or tax-per-Session in v1.
