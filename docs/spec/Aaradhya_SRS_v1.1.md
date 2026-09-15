# Aaradhya Event Management System — Software Requirements Specification

**Document status:** Draft for sign-off — supersedes `Aaradhya_Event_Management_Spec_v1.md`, folds in `Spec_Amendment_MultiDate_Sessions.md` as finalized, and folds in `Aaradhya_Quotation_PDF_Strategy.md` plus the Quotation-flow/UI amendment below as finalized (§4.7, §5.4, §5.8, §6.7–6.9).
**Version:** 1.2
**Stack:** TypeScript + React + MUI (frontend) · REST API + MongoDB (backend) · server-side PDF generation
**Scale target:** ~15 users/day, single organization, single property

**v1.2 changelog (summary):** Quotation generation now produces a persisted Quotation Snapshot, not a pure live render (supersedes Assumption A2 — see `Aaradhya_Quotation_PDF_Strategy.md`); the Quotation's structure and its data-entry sequence are specified in full detail (§4.7, §5.4); a new Admin/Configuration Settings module manages Venue, Event Type, and Room Type master lists (§4.6, §5.8); the application is now mobile-first, superseding the earlier desktop-first assumption (§6.7); primary navigation is a side drawer, not a fixed top bar (§6.8); date/time entry standardizes on MUI pickers app-wide (§6.9); the calendar's primary layout becomes a full-width week view with additional filters (§5.2).

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
- A full-width, week-view calendar with date-range-aware event display and dropdown filters (§5.2).
- Four fixed user roles with role-filtered dashboards.
- A per-field change history/audit trail.
- Username/password authentication for a small, internally managed user base.
- Admin-configurable master lists — Venue, Event Type, Room Type — each with an editable default cost, alongside the existing Menu Item master list (§4.6, §5.8).
- Persisted Quotation Snapshots with a retrievable history per Event, superseding the earlier "pure live render, nothing archived" assumption (§4.7, §5.4).
- A mobile-first responsive UI: every screen specified for both a mobile and a desktop/laptop layout (§6.7).

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
| **Venue Master** | An entry in the organization-wide list of selectable venues (e.g. Poolside, Full Banquet), each with an editable default cost. Selecting one on a Session prefills `venue_cost` (§4.2, §5.8). |
| **Event Type Master** | An entry in the organization-wide list of selectable Session types (e.g. Engagement, Wedding, Haldi) offered on the `session_type` dropdown (§4.2, §5.8). |
| **Room Type Master** | An entry in the organization-wide list of selectable room types (e.g. Deluxe, Executive, Dormitory), each with an editable default tariff. Selecting one on a Room Line prefills `tariff` (§4.3, §5.8). |
| **Limited Seating (L.S.)** | A per-Meal-Item flag. When set, the Meal Item is priced as a single flat amount for the whole gathering rather than per head: the Quotation displays its Pax as `L.S. (Npax)` instead of a bare number, and the Total Cost Summary treats its Pax as `1` (see Assumption A11 on the exact intended meaning of the abbreviation). |
| **Ceremony Event** | The per-date Quotation table's display grouping for Event Items (a non-food program moment — see **Item** below) — rendered as an empty, grey, time-only row with no Pax/Cost/Menu (working label, see Assumption A14). |
| **Food/Dining Event** | The per-date Quotation table's display grouping for Meal Items — rendered with Pax, Cost, and Menu (working label, see Assumption A14). |
| **Quotation Snapshot** | The persisted record of one "Generate Quotation PDF" action: `event_id`, `generated_at`, `generated_by`, `storage_key`, and the `grand_total` at generation time. Supersedes the earlier "Quotation is a pure render, nothing is stored" definition (§4.7). |
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
| `room_lines[]` | Room type (prefilled), occupancy, tariff (prefilled, editable), number of rooms, `total_incl_gst` *(derived)*. An **"Extra Beds" room line is always present as a fixed fourth line** on the Quotation's Accommodation table, even when its occupancy/rooms/total are all zero (both reference quotations print a zero-valued Extra Beds row rather than omitting it) — it is not conditionally hidden. |
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
| `type` | `Meal` or `Event`. Displayed on the Quotation's per-date Event Details table (§4.7) under the "Food/Dining Events" grouping (Meal) or "Ceremony Events" grouping (Event) — see Glossary and Assumption A14. |
| **Meal Item fields** | `meal_name` (prefilled + custom), `start_time`/`end_time`, `pax`, `limited_seating` (boolean, default false — see Glossary's **Limited Seating (L.S.)** entry), `cost_per_plate` (auto-suggested from meal type, editable; when `limited_seating` is true this is the flat lump-sum amount, not a per-head rate), `total_cost` *(derived: `pax × cost_per_plate` normally, or `cost_per_plate` alone when `limited_seating` is true — Pax is fixed at `1` for that computation, per Assumption A11)*, `menu_items[]` (search existing Menu Items or add new inline). |
| **Event Item fields** | `event_name` (prefilled + custom), `start_time`/`end_time`, `venue` (prefilled). No pax, cost, or menu fields exist for an Event Item — on the Quotation it renders as an empty, grey, time-only row (§4.7). |

### 4.6 Master Lists (Menu Item, Venue, Event Type, Room Type)

Four organization-wide, admin-managed lists back every prefilled dropdown in the app (§5.8). Each entry can be added, edited, and deactivated by an Event Manager; deactivation removes it from future dropdown selection without altering any Event/Session/Item/Room Line that already references it (FR-CFG-5).

**Menu Item** — shared across all Events/Sessions/Items.

| Field | Notes |
|---|---|
| `name` | Searchable. |
| `default_cost_per_plate` | Used to auto-suggest `cost_per_plate` on a Meal Item by meal type association. |
| `created_via` | Whether added ad hoc during Item entry (then persisted for future reuse) or pre-seeded. |

**Venue Master** — backs the `venue` dropdown on a Session (§4.2).

| Field | Notes |
|---|---|
| `name` | e.g. Poolside, Half Banquet, Full Banquet. |
| `default_venue_cost` | Prefills a Session's `venue_cost` on selection; remains editable per-Session without changing the default. |

**Event Type Master** — backs the `session_type` dropdown on a Session (§4.2).

| Field | Notes |
|---|---|
| `name` | e.g. Engagement, Haldi, Wedding. |

**Room Type Master** — backs the `room_type` dropdown on a Room Line (§4.3).

| Field | Notes |
|---|---|
| `name` | e.g. Deluxe, Executive, Dormitory. |
| `default_tariff` | Prefills a Room Line's `tariff` on selection; remains editable per-Room-Line without changing the default. |

### 4.7 Quotation (PDF export) — finalized structure

Triggered by "Generate Quotation PDF" on the Event Page. As of this revision, each generation also persists a **Quotation Snapshot** (Glossary; §5.4, `Aaradhya_Quotation_PDF_Strategy.md`) — the Event itself remains the single source of truth for the data rendered, but the rendered artifact is no longer discarded after the request.

**Governing principle:** the web data-entry flow collects information in the *same top-to-bottom sequence* it appears in on the rendered Quotation. Every section below names its corresponding data-entry step; no data-entry screen may reorder this sequence, and the rendered PDF must visually match the reference examples (`example_quatation_1.pdf`, `example_quatation_2.pdf`) in layout, font, size, color, weight, cell shading, border weight, and column/row structure — pixel-level styling itself is a Figma/implementation concern (§1.3), but the section order, columns, and computation rules below are binding requirements.

**a. Header.** Left: the Aaradhya logo mark and wordmark (two image assets placed side by side). Right: GST number and business address. One horizontal rule separates the header from the title row.

**b. Title row.** Center: "Event Quotation." Right: **Quotation Date**, always the current date at generation time — never user-editable, never the Event's `created_at` (FR-QUO-6).

**c. Client Details.** One row per Client Contact (§4.1 `client_contacts[]`): contact-type label (no column header), Name, Contact Number. Data-entry step: the existing Client Contact add/remove flow (FR-EVT-2), with an "Add Contact" affordance.

**d. Event Details (overview).** One row per Session, in the order Sessions were added: `session_type`, `start_date`–`end_date` formatted as a single date (or range), `start_time`–`end_time` formatted as e.g. `6pm to 10pm`, `pax`, `venue`, `venue_cost` formatted as `60,000 /-`. Data-entry step: the existing per-Session fields (§4.2, FR-SES-1), with venue cost auto-filled from the Venue Master (§4.6) and remaining editable.

**e. Accommodation Details.** The single Accommodation Block (§4.3): one row per Room Line (`check_in`/`check_out`, `total_days`, `room_type`, `occupancy`, `tariff`, number of rooms, `total_incl_gst`), including the always-present Extra Beds line, plus a footer "Total" row summing `total_occupancy`, room count, and `total_charges`. The `check_in`/`check_out` cells are rendered once, vertically merged down the full height of the room-line rows (date on one line, time below), not repeated per row. The footer's "Total Occ." cell is shaded green and its "Total Charges" cell is shaded yellow/amber (reproduced from both reference quotations' cell coloring). Data-entry step: the existing Accommodation flow (FR-EVT-3), with `tariff` auto-filled from the Room Type Master (§4.6).

**f. Event Details — per date.** One table per distinct calendar date on which at least one Session/Item occurs, headed `Event Details – <date>`. Rows are grouped into two categories (working labels — Assumption A14):
   - **Food/Dining Events** — one row per Meal Item on that date: Meal Name, Time (rendered exactly as entered on the Item — left blank when no time was entered for that particular Item, which both reference quotations do for several rows; there is no rule forcing every row to repeat a time), Number of Pax (`L.S. (Npax)` when `limited_seating` is set, else the bare number — Glossary), Cost, Menu (the Item's resolved `menu_items[]`).
   - **Ceremony Events** — one row per Event Item on that date, rendered as a single grey cell **merged across the full row width** (not five separate empty cells) containing the Event Item's `event_name`, and its `start_time`–`end_time` and/or `venue` appended inline in the same cell when those fields are set (e.g. "Engagement Sangeet - Poolside", "Muhurta 11am – 12:30pm") — omitted inline when not set (e.g. a bare "Muhurta"). No Pax, Cost, or Menu value is ever shown on a Ceremony row. An Event Item with every field blank still renders as a bare grey divider row (both reference quotations contain one) — this is a valid, not an erroneous, state.

   Data-entry step: Items are added per Session (FR-SES-3) with a Meal/Event type toggle; the per-date grouping and table split are a rendering rule over that same data, not a separate entry step.

**g. Total Cost Summary.** A fully auto-generated, read-only rollup (FR-QUO-2, expanded below) built from the sections above plus a small set of manually-added line items — see §5.4 for the exact structure and computation rules.

**h. Static footer.** Terms & Conditions, Documents Required (from Bride & Groom), and Bank Account Details — fixed boilerplate, reproduced verbatim from the reference quotations, not user-editable and not part of any data-entry step.

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
- FR-SES-5: The calendar's primary layout is a full-width month grid, implemented with MUI X Scheduler's `StandaloneMonthView` component on both mobile and desktop (supersedes the earlier week-view decision — see Assumption A12, now resolved), rendering one chip/dot per Event per calendar day, computed via the finalized overlap rule in §4.2 — a Session appears on every date it spans, not only its start date. The calendar occupies the full available horizontal width of its container, with minimal side margins. On mobile, cells are compact (date number + status-colored dot indicators, not full event chips), and selecting a day surfaces that day's events in an agenda list below the grid.
- FR-SES-6: Calendar dropdown filters — Venue, Event, Event Manager, Event Type — apply on top of the overlap-based day rendering (the "Event" filter's exact meaning is flagged — Assumption A10). A status filter (All / Tentative / Confirmed) remains available alongside these.
- FR-SES-7: Clicking a calendar chip opens the corresponding Event Page.
- FR-SES-8: Date-based search/filtering elsewhere in the app (e.g. "events this week") uses the same interval-overlap logic as the calendar, per §4.2.

### 5.3 Client Management Module
*Primary entities: Client Contact (embedded in Event; no standalone client directory in v1 — see Assumption A3).*

- FR-CLI-1: Client Contacts are managed as part of Event Management (FR-EVT-2); there is no separate client CRM/module in v1.
- FR-CLI-2: Reception Desk role sees Client Contact names (Bride/Groom) and POC contact details as part of its filtered Event view.

### 5.4 Quotation Generation Module
*Primary entities: Quotation Snapshot, Event and all its children.*

- FR-QUO-1: "Generate Quotation PDF" is available on the Event Page and produces a PDF in the existing Aaradhya template from the Event's current data, at any point in the Event's lifecycle, following the section order finalized in §4.7.
- FR-QUO-2: The Total Cost Summary section is a 100% read-only rollup (structure below) — no field in it accepts free numeric entry other than the GST% where it varies and the amount on a manually-added line item (FR-QUO-9).
- FR-QUO-3: Regenerating the Quotation after data changes produces a new snapshot reflecting the latest Event state; prior snapshots are retained per FR-QUO-11 (supersedes Assumption A2 — this is no longer an open question).
- FR-QUO-4: The PDF layout paginates automatically from Session/Item data — "page" is not a concept exposed in the data-entry UI.
- FR-QUO-5: The Quotation header renders the Aaradhya logo mark and wordmark left-aligned, and the GST number and business address right-aligned, separated from the title row by one horizontal rule (§4.7a).
- FR-QUO-6: The Quotation Date shown on every generation is always the current date at generation time, never user-editable and never the Event's `created_at` (§4.7b).
- FR-QUO-7: The per-date Event Details tables (§4.7f) are generated one per distinct calendar date spanned by the Event's Sessions/Items, each split into a "Food/Dining Events" group (Meal Items) and a "Ceremony Events" group (Event Items, rendered as empty grey time-only rows).
- FR-QUO-8: A Meal Item flagged `limited_seating` (§4.5) displays Pax as `L.S. (Npax)` on the per-date table, and contributes Pax `= 1` (not the literal headcount) wherever Pax feeds a Total Cost Summary computation (FR-QUO-9).
- FR-QUO-9: The Total Cost Summary is structured as (verified line-by-line, including GST arithmetic, against both reference quotations — this is a binding reproduction of their exact structure, not an approximation):
  - One block per calendar date that has at least one Session, titled e.g. "Wedding Venue and Catering – <date>" (or "Venue and Catering <date>" — the two reference quotations use slightly different label wording; either is acceptable, chosen consistently), rendered as a merged-cell group in the leftmost "Cost Item" column spanning every row belonging to that date:
    - One **venue row per Session on that date** — not one per date: a date with two Sessions (e.g. a Halad and an Engagement on the same day, each at a different venue) gets two venue rows in its block. Sub Cost Item = that Session's selected Venue (§4.2 `venue`); no Pax/Cost-per-Plate/Total Cost — only Total Cost with GST (= that Session's `venue_cost`, used as-is, no GST math applied to it).
    - One **food row** per Meal Item on that date, across all of that date's Sessions: Sub Cost Item = the Meal Item's name; Pax and Cost per Plate pulled directly from the per-date Event Details table (Pax `= 1` when `limited_seating` is set, per FR-QUO-8); Total Cost `= Pax × Cost per Plate`; no value in Total Cost with GST on these rows. Ceremony Events (Event Items) never appear in this summary — only Meal Items feed it.
  - **One aggregate "Food Cost" row for the whole Quotation** (not one per date — confirmed by reproducing both reference quotations' arithmetic exactly): Total Cost = the sum of every food row's Total Cost across every date's block; Total Cost with GST = that sum × `(1 + GST%)`, where GST% is the single org-wide rate from §4.9/Assumption A9 (5% in both reference quotations). This is the only row in the table where "Total Cost with GST" is computed by applying GST% to a Total Cost — every other row's "Total Cost with GST" is either an already-final figure (venue cost, Accommodation's `total_charges`) or a flat manually-entered amount.
  - An **Accommodation row**: only Total Cost with GST is populated, pulled verbatim from §4.3's `total_charges` (already GST-inclusive — no further GST applied here).
  - Zero or more **manually-added rows** (FR-QUO-9a below), each with a name, an optional short free-text note, and a Total Cost with GST amount.
  - A **Grand Total row**: "Grand Total" in the Cost per Plate column, with the sum of every Total Cost with GST value above it in that same column (every venue row + the one Food Cost row + Accommodation + every manual row) — verified to reproduce both reference quotations' printed Grand Total (`Rs. 10,73,208 /-` and `Rs. 9,49,555 /-`) to the rupee after standard rounding.
  - **Color coding** (reproduced from the reference quotations' cell shading, not merely a style preference): the Accommodation Details table's "Total Occ." footer cell is shaded green and its "Total Charges" footer cell is shaded yellow/amber (§4.7e); in the Total Cost Summary, the Food Cost row and the Grand Total row are both shaded yellow/amber to match. No other rows carry background shading.
- FR-QUO-9a: An Event Manager can add any number of arbitrarily-named extra Total Cost Summary line items (e.g. Decoration, Photographer, Bhatji/Pandit fees) directly on the Quotation data, each carrying a name, a Total Cost with GST amount, and an **optional free-text note** rendered in the Sub Cost Item column (e.g. Decoration's note names which sessions/setups it covers, "poolside engagement sangeet + wedding mandap decor"; Bhatji's note might just name the event, "wedding") — both reference quotations carry exactly this kind of note on their manually-added rows, so the field is required to reproduce them exactly, not optional polish. Supersedes the earlier "three fixed named line items" limit — see Assumption A13.
- FR-QUO-10: Terms & Conditions, Documents Required, and Bank Account Details render as fixed, non-editable boilerplate, reproduced verbatim from the reference quotations (§4.7h).
- FR-QUO-11: Every "Generate Quotation PDF" action persists a Quotation Snapshot (`event_id`, `generated_at`, `generated_by`, `storage_key`, `grand_total`) to object storage and a `quotations` collection record, per `Aaradhya_Quotation_PDF_Strategy.md` — there is no separate "confirm as final" step; every generation is saved.
- FR-QUO-12: The Event Page exposes a history list of that Event's prior Quotation Snapshots (timestamp, generated-by, grand total), each re-downloadable via a signed URL — `GET /events/:id/quotations`.

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

### 5.8 Admin / Configuration Settings Module
*Primary entities: Venue Master, Event Type Master, Room Type Master, Menu Item (§4.6).*

- FR-CFG-1: An Event Manager can view, add, edit, and deactivate entries in the Venue Master list, each with a `name` and `default_venue_cost`.
- FR-CFG-2: An Event Manager can view, add, edit, and deactivate entries in the Event Type Master list, each with a `name`.
- FR-CFG-3: An Event Manager can view, add, edit, and deactivate entries in the Room Type Master list, each with a `name` and `default_tariff`.
- FR-CFG-4: Selecting a Venue, Room Type, or Event Type elsewhere in the app reads its *current* master-list default at the moment of selection and prefills the corresponding field (`venue_cost`, `tariff`), remaining independently editable per use without altering the master default.
- FR-CFG-5: Deactivating a master-list entry removes it from future dropdown selection but does not alter any Event/Session/Room Line that already references it — no retroactive data change or cascade delete.
- FR-CFG-6: This module is reachable only by the Event Manager role, consistent with §3.1's exclusive create/edit authority over Events and other configuration.

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
- **Mobile-first web application** (supersedes Assumption A6 — no longer open). Every screen is specified for both a mobile layout and a desktop/laptop layout; no native mobile app is required, but the responsive web layout is a hard requirement, not a nice-to-have.
- Any data table with more columns than fit a mobile viewport must degrade gracefully — either a redesigned mobile-specific layout or a horizontally-scrollable table region — and must never silently clip or overflow columns off-screen. This applies at minimum to the Dashboard's event table, the Events list, the Users list, and every Quotation table rendered in-app for preview.

### 6.8 Navigation Structure
- Primary in-app navigation is a collapsible **side drawer** (opened via a hamburger/menu icon), not a fixed top navigation bar, on every viewport size.
- The Dashboard's page title is center-aligned; per-status event counts are displayed directly below their corresponding status label, not beside it.

### 6.9 Form Input Consistency
- Every date input application-wide uses the MUI Date Picker component; every time-of-day input uses the MUI (Static) Time/Clock Picker component in 12-hour AM/PM format. Native HTML `<input type="date">`/`<input type="time">` elements are not used anywhere in the product.
- Text fields use the application's standard functional/legible font family for entered and displayed values — not a decorative display typeface — and must retain input focus across every keystroke (a focus-loss-per-keystroke defect is a correctness bug against this requirement, not a style preference).

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

These may be revisited as a future phase once v1 is in real use, but are not to be sliced into v1 development stories.

---

## 8. Notes for Story Slicing

Each module in §5 is intended to become one or more independent story groups, roughly in this dependency order:

1. **Auth & User Management (5.6)** — foundational; other modules assume an authenticated, role-bearing User Account.
2. **Admin / Configuration Settings (5.8)** — the Venue, Event Type, and Room Type master lists should exist before Event Management stories that consume their dropdowns/defaults (5.1's Accommodation, 5.2's Session `venue`/`session_type`), the same dependency the existing Menu Item master already has on Item entry.
3. **Event Management (5.1)** — Event, Client Contact, Accommodation, Payment, Documents core CRUD.
4. **Session & Calendar Management (5.2)** — depends on Event existing; the multi-day/overlap logic (§4.2) is its own testable slice, independent of Item/Menu Item work; the month-grid calendar layout and its filters (FR-SES-5/6) can be sliced separately from the overlap-computation logic itself.
5. **Quotation Generation (5.4)** — depends on 5.1, 5.2, and 5.8 having stable data to render; the Total Cost Summary rollup logic (FR-QUO-9) can be built/tested independently of the PDF template rendering itself, and Quotation Snapshot persistence (FR-QUO-11/12) is its own slice on top of a working renderer, per `Aaradhya_Quotation_PDF_Strategy.md`.
6. **Role-Based Dashboards & Views (5.5)** — a filtering/projection layer over 5.1–5.3; can be sliced per role.
7. **Change History (5.7)** — cross-cutting; can be built incrementally alongside each module above rather than as a single story.

---

## 9. Assumptions

Flagged for confirmation before development stories are written. Nothing below was explicitly stated in the source requirements conversation.

- **A1 — Administrative capability for User Accounts.** The source requirements name "Event Manager" as the full-access role but never formally define an Admin/Accounts role for creating and managing User Accounts. This document assumes Event Managers collectively have this capability (FR-AUTH-3). If a distinct Admin role or a single super-admin account is actually intended, §3 and §5.6 need a small revision.
- **A2 — Quotation PDF history. Superseded, no longer open.** Originally assumed generated Quotation PDFs were **not** archived. Reopened and resolved by `Aaradhya_Quotation_PDF_Strategy.md`: every generation now persists a Quotation Snapshot (§4.7, FR-QUO-11/12). Retained here only for traceability.
- **A3 — No standalone Client directory.** Assumed Client Contacts exist only as rows embedded in an Event (no cross-event client history, e.g. "has this couple booked with us before"). If repeat-client tracking matters to the business, that's a distinct module.
- **A4 — Accessibility level.** No WCAG conformance target was specified; assumed "reasonable internal-tool accessibility" rather than a certified standard, given the 15-user internal audience.
- **A5 — Backup/retention policy.** No specific backup frequency or retention period was stated; assumed standard periodic backup is sufficient with no formal SLA.
- **A6 — Device support. Superseded, no longer open.** Originally assumed primarily desktop use with mobile/tablet as "nice to have." Reopened and resolved: the application is now mobile-first, with every screen specified for both mobile and desktop/laptop (§6.7). Retained here only for traceability.
- **A7 — Session Status as a new field.** `session_status` (Active/Cancelled) was introduced in the multi-day amendment to let one Session of a multi-day Event be cancelled independently of the Event's own `status`. The original v1 spec had no session-level status field at all — confirm this is desired before treating it as locked.
- **A8 — Menu Item master list governance.** Assumed any Event Manager (not a curated subset) can add new Menu Items inline, with no dedupe/moderation step — matching the "grows organically" description in the source conversation. If menu-list quality control matters, that's an added requirement.
- **A9 — GST%.** Assumed GST% is a single organization-wide rate applied to food costs, editable per-quotation "if it varies" (as stated), but not modeled as tax-per-Menu-Item or tax-per-Session in v1.
- **A10 — Calendar "Event" filter.** FR-SES-6 lists four calendar filter dropdowns — Venue, Event, Event Manager, Event Type — but only "Event" is new and its meaning is unclear once "Event Type" already covers the Wedding/Corporate/Birthday category filter. Assumed here to mean a search-by-event (name/client/ID) selector that jumps the calendar to a specific Event's occurrences, not a duplicate of Event Type. Confirm before this dropdown is built.
- **A11 — "L.S." abbreviation.** The source material glosses this inconsistently as both "Ladies Sangeet" and "limited seating." Assumed here to mean a **lump-sum/flat-price item** — a Meal Item priced as one fixed amount for the whole gathering rather than per head (e.g. a chaat counter or chai tapri billed as a single amount regardless of headcount, as seen in both reference quotations' "L.S.(Npax)" rows) — reflected in §4.5/Glossary's **Limited Seating (L.S.)** entry and FR-QUO-8. Confirm the exact intended expansion/meaning of the abbreviation, and whether "Ladies Sangeet" is instead a distinct concept that was conflated with this pricing flag, before UI copy is finalized.
- **A12 — Calendar layout. Superseded, no longer open.** Originally assumed a week view (per an earlier reading of "replace the current calendar UI") would become the sole primary layout. Reopened and finalized: the calendar uses MUI X Scheduler's `StandaloneMonthView` component instead, on both mobile and desktop (FR-SES-5). Retained here only for traceability.
- **A13 — Unbounded Total Cost Summary line items.** The earlier v1.1 text fixed the summary's manual inputs to exactly three named items (Decoration/Photographer/Bhatji). The new quotation-flow requirements describe these as examples of an open-ended "user can manually add items" capability. Assumed the fixed-three limit is lifted in favor of arbitrary, arbitrarily-named additional line items (FR-QUO-9a) — confirm this is the intended relaxation and not just a documentation example.
- **A14 — "Ceremony Events" / "Food/Dining Events" labels.** The source material explicitly flags its own working names ("eat event" / "celebrate event") as placeholders needing finalization. This document uses "Food/Dining Events" (Meal Items) and "Ceremony Events" (Event Items) as the per-date Quotation table's group labels (§4.7f, Glossary). Confirm final wording before Figma/UI copy is locked.
