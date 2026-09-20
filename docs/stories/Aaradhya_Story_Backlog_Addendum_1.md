# Aaradhya Event Management System — Story Backlog Addendum 1

**Source:** Product owner request, 2026-09-20 (conversation, not yet folded into `Aaradhya_SRS_v1.1.md`) — nine distinct asks, broken into 12 stories below. Continues the numbering in `Aaradhya_Story_Backlog.md` (last story there: STORY-075), so this addendum starts at **STORY-076**. Same format as the main backlog: **Flow**, **Acceptance Criteria**, **UI**, **Tokens**, **Edge cases**, **Decisions (v1)** where the product owner has already confirmed something during this planning pass, or **Open design calls** where I made a judgment call that still needs a nod before implementation starts.

**Build order recommendation:** 086 → 087 (branding, trivial, no dependencies) → 076 (tab shell) → 078 (Event Details tab) → 079 (Sessions & Items tab — the biggest single piece of work here) → 077 (Client Details tab) → 080 (Review & Quotation tab) → 081 (Activity redesign, independent of the above) → 083 (toast provider) → 082 (dirty-state gating — sequenced after 083 so newly-touched forms don't need a second pass, and after 076–080 so it's auditing the *final* tab layout, not code about to be moved) → 084 → 085 (delete, independent, can move earlier if wanted).

**Testing note (applies to every story below):** per explicit instruction, do not add new test files or new `it(...)` blocks beyond what's needed to keep existing coverage accurate — modify existing tests in place where a change in this addendum alters their expected DOM structure, text, or request/response shape.

---

## Module: Event Detail Page — Wizard Parity (new)

Today's Event Detail page has 6 tabs: Overview, Rooms, Sessions, Payments, Documents, Activity. The product owner wants the first three replaced by the same 5 sections the New Event wizard already uses — Client Details, Event Details, Accommodation, Sessions & Items, Review & Quotation — with Payments/Documents/Activity kept exactly as today ("extras"). This is a bigger structural change than the earlier visual-only restyle pass (STORY commits already shipped for Overview/Rooms/Sessions) — it moves content between tabs, not just their look.

### STORY-076: Event Detail tab shell restructure
**Flow:** An Event Manager (or any role who can already see the equivalent old tab) opens an Event and sees the tab strip read Client Details / Event Details / Accommodation / Sessions & Items / Review & Quotation / Payments / Documents / Activity, in that order, instead of today's Overview / Rooms / Sessions / Payments / Documents / Activity.
**Acceptance Criteria:**
- [ ] `event-detail-page.tsx`'s `DetailTab` union grows to `'client-details' | 'event-details' | 'accommodation' | 'sessions-items' | 'review' | 'payments' | 'documents' | 'activity'`.
- [ ] `Accommodation` tab renders exactly what today's `Rooms` tab renders (`rooms-tab.tsx`, unchanged) — a pure rename/re-slot, no behavior change.
- [ ] `Payments`, `Documents`, `Activity` tabs are untouched — same components, same role gates, same position relative to each other (still the last three tabs).
- [ ] Every existing role gate (`canSeeRooms`, `canSeeSessions`, `canSeeClientContacts`, `canEdit`, etc.) is re-derived for the new tab names without silently widening or narrowing who sees what — a role that could see Rooms today can see Accommodation tomorrow, nothing more or less.
- [ ] `Client Details`, `Event Details`, and `Sessions & Items` tabs can ship as placeholder panels reusing the current Overview/Sessions logic verbatim in this story — STORY-077/078/079 replace those placeholders with the real per-tab redesigns. This story's own job is only the shell (tab list, routing/state, role gates), so it can ship and be verified on its own before the bigger rebuilds land.
**UI:** Tab strip only — no new visual design in this story beyond the renamed/reordered `Tab` labels.
**Tokens:** N/A (structural only — reuses existing tab-strip styling as-is).
**Edge cases:** A role that previously saw neither Overview-equivalent content nor Sessions (e.g. Housekeeping doesn't see Client Details today) must not gain visibility into a tab it couldn't see before, purely because the tab got a new name/slot.
**Open design calls:**
- Tab state stays a local `useState` (not URL-routed) — matches the existing Event Detail convention and the plan's own earlier non-goal ("don't make Event Detail's tabs URL-routed"); flag if that should change now that there are 8 tabs instead of 6.

### STORY-077: Client Details tab
**Flow:** An Event Manager edits Event Status and Client Contacts from a dedicated Client Details tab instead of finding them inside a general Overview tab.
**Acceptance Criteria:**
- [ ] Everything currently on Overview *except* the Total Cost Summary panel and the PDF/Preview Quotation links moves here verbatim: the Status `Select` (EventManager-only, immediate-commit) and the Client Contacts editor/read-only view (role-gated exactly as today).
- [ ] No new fields, no behavior change — this is a relocation, not a redesign (the visual card treatment already shipped in the earlier restyle pass carries over unchanged).
- [ ] `overview-tab.tsx` is retired (renamed/split) once nothing references it; no dead code left behind.
**UI:** Same two cards ("Event Status", "Client contacts") already shipped in the visual-restyle pass, now living under the Client Details tab instead of Overview.
**Tokens:** Unchanged from the existing `overview-tab.styles.ts` cards.
**Edge cases:** None beyond what Overview already handled — this is a pure move.
**Open design call:** Event Status has no equivalent step in the wizard (status doesn't exist before an Event is created) — defaulting to keeping it here, paired with Client Contacts, since that's the closest existing pairing and avoids inventing a 6th tab just for one field. Confirm this is acceptable, or say where Status should live instead.

### STORY-078: Event Details tab (Sessions list + Setup, Items removed)
**Flow:** An Event Manager adds/edits a Session's own fields (type, venue, venue cost, dates, times, pax) and its Setup (seating/tables/chairs/stage/buffet/etc.) — the same fields `event-details-step.tsx` collects in the wizard — without also being shown that Session's Food/Ceremony Items inline (Items move to STORY-079's own tab).
**Acceptance Criteria:**
- [ ] Renders what `sessions-tab.tsx` + `session-form.tsx` already render today (list ↔ add/edit-form mode-swap, unchanged interaction model per the earlier restyle pass's own non-goal), minus the nested `<ItemsSection>` — a Session's Add/Edit form no longer shows its Items at all.
- [ ] `session-form.tsx`'s `onItemsChanged` prop and the `<ItemsSection>` import are removed; `items-section.tsx`/`item-card.tsx`/`menu-item-search.tsx` are NOT deleted (STORY-079 reuses `menu-item-search.tsx`, and `item-card.tsx`'s form-field logic is the direct basis for STORY-079's own per-item edit form) — only the *nesting inside SessionForm* goes away.
- [ ] The Sessions list row's existing Housekeeping-only "Setup: ..." and FnBHead-only "Menu: ..." summary lines (`sessions-tab.tsx`) are unaffected — those read from `session.setup`/`session.items` directly off the Event, not from anything being removed here.
- [ ] Existing tests for `session-form.tsx`'s Items-editing behavior (via `event-detail-page.test.tsx`'s Sessions-tab-edit-mode assertions) are updated to reflect Items no longer appearing inside the Session edit form, not deleted outright — per the "modify existing tests" instruction.
**UI:** Identical to today's Sessions tab list/form, minus the Items section at the bottom of the edit form.
**Tokens:** Unchanged.
**Edge cases:** A Session with existing Items, edited via this trimmed form, must not lose or corrupt those Items — this story only stops *displaying* Items here; the Items themselves stay exactly as stored until edited via STORY-079's own tab.

### STORY-079: Sessions & Items tab (day-tabbed Ceremony/Food editor, real data)
**Flow:** An Event Manager opens the Sessions & Items tab and sees the exact same UX the wizard's own `sessions-items-step.tsx` already has — one Tabs strip across every distinct calendar date the Event's Sessions span, and within each date, two sections (Ceremony Events, Food/Dining Events), each a persistent entry form above a list of already-added row cards. Clicking a row card re-populates the form for in-place editing (submit replaces, not duplicates); each row also has its own delete affordance. This is the largest single piece of new frontend work in this addendum — it's a genuine rebuild against real persisted data, not a copy-paste of the wizard step (which operates on wizard-local, not-yet-submitted state).
**Acceptance Criteria:**
- [ ] Date tabs are derived from the Event's real `sessions[]` (via the existing `getDistinctDates`/`enumerateDates` utils in `src/utils/session-dates.ts` — already shared by the wizard, reusable here with real Session data instead of wizard rows).
- [ ] Adding a new Ceremony or Food/Dining Item calls the existing `POST /events/:id/sessions/:sid/items` (`createItem`, already used by `item-card.tsx`'s own "new card" path) — the same endpoint, no backend change needed for create.
- [ ] Clicking an already-added row populates the shared form for that Item type/date and submitting calls the existing `PATCH .../items/:iid` (`updateItem`) — same endpoint `item-card.tsx` already uses for an existing Item, no backend change needed for update.
- [ ] Each row has a delete control that calls the existing `DELETE .../items/:iid` (`deleteItem` — already in the contract and already exposed as the "Remove" button in the current nested Items UI) — reused as-is, no backend change needed for delete.
- [ ] A Food/Dining Item's selected Menu Items render by **resolved name**, never a raw ObjectId — reusing the exact `menuItemsById` lookup pattern `items-section.tsx`/`item-card.tsx` already establish (`tsr.listMenuItems.useQuery()` once, mapped to `{id, name}`), and `menu-item-search.tsx` is reused as-is for the picker. This directly addresses the product owner's "menu items showing as their object id instead of name" complaint, scoped to this new tab.
- [ ] A date newly covered by more than one Session (two Sessions sharing a date) still assigns each Item to exactly one Session, same "first Session in entry order that covers this date" convention `review-step.tsx`'s own `mapSessionsForSubmit` already documents for the wizard — ported here for consistency, not reinvented.
- [ ] Since this tab reads/writes real data immediately (unlike the wizard, which holds everything in `sessionStorage` until Step 5's single submit), there is no "Next"/readiness gate and no draft state to lose on navigation — every Add/Save/Delete is an immediate, independent API call, matching how `item-card.tsx` already behaves today (each Item already has its own create/update/delete mutation).
**UI:** Same visual language as `sessions-items-step.tsx` — a Tabs strip for dates, a Paper-carded entry form per Item type, `surface2`/`radiusSm` row cards below listing already-added Items (click to edit, an inline "Remove"/delete icon per row), an accent-bordered row card while it's the one being edited.
**Tokens:** Reuses `sessions-items-step.styles.ts`'s own recipe (`sectionCardStyles`, `rowCardStyles`, `rowCardEditingStyles`, `rowListStyles`) as the direct visual reference — duplicate the values into a new `sessions-items-tab.styles.ts` (same "documented duplication over premature cross-directory import" convention already used throughout this codebase), rather than importing across `event-creation/`↔`event-detail/`.
**Edge cases:** An Event with zero Sessions (no dates to tab across) — render an empty state, not a crash; a Session added/removed via STORY-078's own tab while this tab is open elsewhere in the same browser tab — this tab re-fetches on `onEventChanged`, same "parent owns the refetch" convention every other tab already follows, so it can't drift from a stale date list.
**Open design call:** The wizard's own per-date "reminder" line (showing which Session/venue owns this date) is worth carrying over here too, so an Event Manager editing dates with multiple Sessions can see at a glance which Session an Item lands under — confirm this is wanted, or if a simpler view (no reminder line) is preferred for v1.

### STORY-080: Review & Quotation tab
**Flow:** An Event Manager reviews the Total Cost Summary and generates/previews the Quotation from a dedicated Review & Quotation tab instead of finding those controls at the bottom of a general Overview tab.
**Acceptance Criteria:**
- [ ] `TotalCostSummaryPanel`, `GenerateQuotationPdfButton`, and the "Preview Quotation" link move here verbatim from the old Overview tab — same component, same `canEdit`/`event.extras` gating, no behavior change.
- [ ] No new content — this is a relocation, matching STORY-077's own "move, don't redesign" scope.
**UI:** Unchanged `TotalCostSummaryPanel` card, now under its own tab.
**Tokens:** Unchanged.
**Edge cases:** None beyond what Overview already handled.

---

## Module: Change History — Organized Activity View (extends SRS §5.7 / STORY-008–010)

Confirmed by direct investigation: the underlying data model is already a per-field diff (not a full before/after snapshot the product owner's own description suggested) — `ChangeLogEntry` stores one `{entityType, entityId, field, oldValue, newValue, changedBy, timestamp}` row per changed field, and `field` already carries a human-readable identity (e.g. `sessions[Wedding].pax`, `sessions[Wedding].items[Hi Tea].menuItems`), not a raw index or id. The real gaps: compound values (a Session's whole `setup` object, `roomLines` array, or an Item's `menuItems` id array) fall through to a raw `JSON.stringify(...)` with no per-sub-field formatting and no name resolution; multiple fields changed by one PATCH render as unrelated separate rows instead of one grouped edit; and `changedBy` shows a raw User id, never a name.

### STORY-081: Humanized, grouped Activity tab rendering
**Flow:** An Event Manager opens Activity and sees, per real edit action, one grouped entry naming who made it and when, followed by a readable list of what changed — "Priya Nair edited the Wedding session's Setup: Seating changed from — to Round Tables, Tables changed from 0 to 20" rather than a raw `sessions[Wedding].setup: {"seating":null,...} → {"seating":"RoundTables",...}` line.
**Acceptance Criteria:**
- [ ] **Grouping:** entries from the same PATCH request render as one visual block, not N separate rows. Requires a backend addition: `logChange`'s call sites (`controllers/events.ts`) generate one request-scoped group id (e.g. `crypto.randomUUID()`) per handler invocation and pass it to every `ChangeLogEntry` written from that request; `ChangeLogEntry`'s schema gains a `groupId: String` field (backward-compatible — existing rows keep `groupId: undefined`, rendered as their own single-row group).
- [ ] **`changedBy` resolution:** the frontend resolves each entry's `changedBy` (a raw User id) to a display name via `tsr.listUsers.useQuery()` — already EventManager-only, matching Activity's own existing EventManager-only visibility, so no new backend endpoint or privacy exposure is introduced. Falls back to the raw id only if the user account has since been deleted (defensive, not an expected path).
- [ ] **Field-path humanization:** `sessions[Wedding].pax` renders as something like "Wedding session — Pax"; `sessions[Wedding].items[Hi Tea].mealName` as "Wedding session — Hi Tea — Meal name"; top-level fields (`clientContacts`, `status`) render by their own plain label. A small parser/lookup table maps the existing bracket-path convention to display labels — no change to how `field` strings are written on the backend, only how the frontend reads them.
- [ ] **Compound-value formatting:** a `setup` object diff lists only the sub-fields that actually changed (e.g. "Seating: — → Round Tables, Tables: 0 → 20"), not the whole object twice; a `roomLines` array diff summarizes what changed (added/removed/edited row count at minimum, full per-row detail as a stretch goal) rather than two raw arrays; an Item's `menuItems` diff resolves each id to its Menu Item name via the same `tsr.listMenuItems`-backed lookup `items-section.tsx` already establishes elsewhere, reused here — this is the second, independent fix for the product owner's "menu items as their object id" complaint (the first is STORY-079's own new-tab scope; this one covers the Activity trail for edits made anywhere, including via the old nested-Items flow before STORY-078/079 ship).
- [ ] Existing `tests/pages/activity-tab.test.tsx`-equivalent coverage (wherever `activity-tab.tsx` is currently tested — via its own file or through `event-detail-page.test.tsx`) is updated in place for the new rendering, not duplicated.
**UI:** One card/block per grouped edit action — header line (actor + relative timestamp), then a small bulleted list of humanized field changes underneath. Empty state ("No changes yet") unchanged.
**Tokens:** Reuses existing Activity tab tokens (`surface`, `line`, `text-faint` for timestamps) — no new palette needed, just a restructured layout (a block per group instead of a flat row per field).
**Edge cases:** A very old `ChangeLogEntry` with no `groupId` (written before this story ships) renders as its own single-item group, never crashes or gets silently dropped; a field whose `oldValue`/`newValue` is `null` (a value set for the first time) keeps the existing "— → value" convention (STORY-010's own edge case), just inside the new humanized/grouped layout.

---

## Module: Form UX — Save Button Dirty-State Gating (new)

### STORY-082: Save buttons enabled only while the form is actually dirty
**Flow:** Across every editable form on the Event Detail page (and Settings, where the same pattern applies), a "Save …" button starts disabled, becomes enabled the moment any field is actually changed from its last-saved value, and becomes disabled again immediately after a successful save (until the next real edit) — never enabled just because the form rendered, and never left enabled after a save round-trips successfully.
**Acceptance Criteria:**
- [ ] Every react-hook-form-backed Save button in `aaradhya-web/src/pages/event-detail/` (Client Details' "Save contacts", Event Details' "Save session"/"Add session", Accommodation's "Save accommodation", Sessions & Items' per-item "Save Item", Payments' "Save payment", Total Cost Summary's "Save extras") gates on that form's own `formState.isDirty` in addition to its existing `mutation.isPending` check — `disabled={!isDirty || isPending}`.
- [ ] Every mutation's own `onSuccess` calls `reset(...)` with the freshly-saved values (most already do, per the existing "hold last-saved response, reset the form to it" convention) — confirmed this naturally clears `isDirty` back to `false` post-save, not just visually but in RHF's own dirty-tracking state.
- [ ] Settings page forms (Menu Item edit, master-list edit dialogs) get the same treatment where they use react-hook-form; a plain-`useState`-backed form (if any remain) gets an equivalent manual dirty flag (compare current values to the last-saved snapshot) rather than being skipped.
- [ ] Immediate-commit controls with no separate Save button (Event Status's `Select`, Documents Checklist's per-item `Switch`) are explicitly out of scope — there's no "dirty" state to gate when every change commits on its own, and the product owner's own ask is about "save changes button," not these.
**UI:** No visual change beyond the disabled/enabled state of existing buttons — same buttons, same labels, same position.
**Tokens:** N/A — MUI's own default disabled-button treatment applies, already used everywhere else `disabled` is set on a `Button`.
**Edge cases:** A field changed and then changed back to its original value before saving — RHF's own `isDirty` does NOT automatically clear in this case (it tracks "has this field ever diverged from its default," not "does it currently differ") — decide and document whether that's acceptable for v1 (RHF's default behavior) or whether a value-equality check against the last-saved snapshot is needed instead for a true "currently different" semantics; recommend accepting RHF's default (`isDirty`) as the pragmatic v1 choice, since matching it exactly to a live diff check would need extra wiring on every single form for a rare edge case.

---

## Module: Notifications — Toast Provider (new)

### STORY-083: Global toast provider + save/create/error wiring
**Flow:** Any successful create/update/delete anywhere in the app shows a brief, dismissible success toast ("Session saved.", "Event created.", "Item deleted."); any failed mutation that isn't already surfaced as an inline field-level error (e.g. the endDate-range validation message) shows an error toast instead of, or in addition to, today's inline `<Alert severity="error">` banners.
**Acceptance Criteria:**
- [ ] A `ToastProvider` (React context + a mounted MUI `Snackbar`/`Alert` stack, or an equivalent minimal-dependency approach — no new heavy third-party toast library needed given MUI already ships `Snackbar`) wraps the app once, near the existing `AuthProvider`/`QueryClientProvider` root in `main.tsx`/`app.tsx`.
- [ ] Exposes a simple `useToast()` hook (`showSuccess(message)`, `showError(message)`) callable from any component/mutation `onSuccess`/`onError`.
- [ ] Wired into every existing mutation across Event Detail (Sessions, Accommodation, Payments, Client Contacts, Extras, Items — including the new Sessions & Items tab from STORY-079), the New Event wizard's own `createEvent` submit, and Settings' master-list/Menu Item mutations — success toast on 2xx, error toast on an unhandled failure.
- [ ] Field-level inline errors that already exist and are more specific than a generic toast (e.g. `session-form.tsx`'s end-date-before-start-date message mapped onto the field itself) are **kept as-is**, not replaced by a toast — a toast is additive for the generic "something went wrong" cases, not a wholesale replacement of existing inline validation UX.
- [ ] Existing tests that assert on today's inline `<Alert>` error banners are updated only where this story actually removes/changes that banner (most inline banners for structured 400s stay — see previous bullet); tests are not rewritten wholesale just because a toast now also appears.
**UI:** A small stack of dismissible toasts anchored to one corner of the viewport (bottom-right or bottom-center, MUI `Snackbar` default positioning is fine), each auto-dismissing after a few seconds.
**Tokens:** `accent`/`accentDeep` for a success toast's accent bar (consistent with the app's single primary-action color), a neutral/red tone for error toasts — reuse whatever semantic error color the app already has (check `theme/tokens.ts` for an existing error/danger token before introducing a new one).
**Edge cases:** Two mutations resolving in quick succession (e.g. rapid double-click before a Save button disables) — toasts stack rather than one replacing/hiding the other; a toast fired from a component that unmounts immediately after (e.g. navigating away right after a successful save) doesn't throw.

---

## Module: Event Lifecycle — Hard Delete (new)

**Confirmed collection scope (product owner sign-off, 2026-09-20):** deleting an Event hard-deletes the `Event` document itself plus every `ChangeLogEntry` row where `entityType === 'Event'` and `entityId === <the Event's own _id, as a string>` — this already covers every Session/Item-level change too, since those are logged under the parent Event's own entity id, never their own. Sessions, Items, Accommodation, Payment, Documents Checklist, and Extras are embedded sub-documents on the Event schema itself (not separate collections), so they're removed automatically with the Event document — no separate cleanup logic needed for them. `User`, `MenuItem`, `Venue`, `EventType`, and `RoomType` are master/shared lists an Event only ever references outward (never owns), so none of them are touched.

### STORY-084: DELETE /events/:id (backend)
**Flow:** An Event Manager permanently deletes an Event; the server removes the Event document and every Change Log Entry recorded against it, then returns success.
**Acceptance Criteria:**
- [ ] `DELETE /events/:id`, EventManager-only (403 otherwise, per the existing `requireRole` middleware convention).
- [ ] Deletes the `Event` document by id; deletes every `ChangeLogEntry` where `entityType === 'Event' && entityId === id` (string match, per the confirmed scope above — `ChangeLogEntry.entityId` is a plain string field, not an ObjectId ref, so match against the id's string form).
- [ ] Unknown `:id` returns 404, matching every other `:id`-scoped route's existing convention.
- [ ] Since this codebase has no precedent anywhere for `mongoose.startSession()`/multi-document transactions (confirmed — grepped the whole backend, zero matches), and a plain standalone dev MongoDB instance can't run transactions without a replica set, this story does the two deletes sequentially (Event first, then its ChangeLogEntry rows) rather than introducing transactional infrastructure new to this codebase for a single low-traffic admin action — document this as a deliberate, not-fully-atomic choice: if the process crashes between the two deletes, an orphaned `ChangeLogEntry` set could remain (never a duplicated/corrupted Event, since Event deletion still completes and returns success only after it succeeds).
- [ ] A real, response-verified test asserts both the Event and its Change Log Entries are gone after the call (query the DB directly in the test, don't just trust the 200).
**UI:** None (backend only).
**Tokens:** N/A.
**Edge cases:** An Event with zero Change Log Entries (e.g. created and immediately deleted before any edit) — the `deleteMany` call still runs and simply matches nothing, no special-casing needed; a concurrent request to edit the same Event mid-delete — out of scope for v1 (no locking), same "small trusted internal user base" reasoning STORY-002's own no-brute-force-protection decision already documents for this codebase's general risk posture.
**Decisions (v1):** Sequential (non-transactional) delete, Event-then-ChangeLogEntry order, confirmed acceptable given no other collection needs touching and no transactional precedent exists in this codebase.

### STORY-085: Delete Event UI
**Flow:** An Event Manager clicks "Delete Event" somewhere on the Event Detail page, confirms via a dialog that clearly states this is permanent, and is returned to the Events list once the delete succeeds.
**Acceptance Criteria:**
- [ ] A "Delete Event" control, EventManager-only, visible from the Event Detail page's own header/shell (not buried inside a specific tab, since deleting isn't scoped to any one tab's content) — exact placement (a menu item, a plain danger-colored button) is an implementation call, but it must not be reachable by a single accidental click (see confirmation requirement next).
- [ ] Clicking it opens a confirmation dialog naming the Event (its `eventId`, e.g. "ARD-EVT-2026-021") and stating the action is permanent and cannot be undone, before calling `DELETE /events/:id`.
- [ ] On success: navigate back to the Events list, and show a success toast (STORY-083) confirming the deletion — no orphaned "Event not found" screen left behind for the user to stumble onto.
- [ ] On failure: show an error toast (STORY-083), leave the Event Detail page as-is (don't navigate away on a failed delete).
**UI:** A confirmation `Dialog` (MUI) with the Event's own id in the body text, a destructive-styled confirm button (reuse whatever the app's existing danger/destructive color convention is — check for one before introducing a new token), and a Cancel button as the safer default focus.
**Tokens:** A destructive/danger color for the confirm button — check `theme/tokens.ts` for an existing one (e.g. a status-cancelled-family token might already be closest) before adding a new palette entry, matching this codebase's own "reuse the closest existing token" convention already seen elsewhere (e.g. `accommodation-step.styles.ts`'s own footer cell color reasoning).
**Edge cases:** Double-clicking "Delete" before the first request resolves — button disables immediately on click, same pattern every other mutating button in this app already follows.

---

## Module: Branding (new)

### STORY-086: Browser favicon
**Flow:** Opening the app in a browser tab shows the Aaradhya crown mark as the tab's favicon instead of the browser's default blank/generic icon.
**Acceptance Criteria:**
- [ ] `index.html` gains a `<link rel="icon" href="/src/assets/aaradhya-mark.svg" type="image/svg+xml" />` (Vite resolves and rewrites this path through its own asset pipeline at build time, the same way it already does for `main.tsx`'s own script tag — no separate `public/` copy needed).
- [ ] Verified in a real built/served instance (not just `npm run dev`, since favicon caching/resolution can behave differently) that the tab icon renders as the Aaradhya mark.
**UI:** Browser tab icon only.
**Tokens:** N/A — reuses the existing `aaradhya-mark.svg` asset as-is.
**Edge cases:** Some browsers cache favicons aggressively — note in the story that a hard refresh may be needed to see it during manual verification, not a sign of failure.

### STORY-087: Sidebar wordmark → header-text.svg image
**Flow:** The side navigation drawer shows the same Aaradhya header image (the "AARADHYA / A COMPLETE DESTINATION" wordmark, already used in the Quotation document's own header) instead of a plain "Aaradhya" text label.
**Acceptance Criteria:**
- [ ] `app-shell-nav.tsx`'s `<Typography variant="display" sx={wordmarkStyles}>Aaradhya</Typography>` (line 30–32) is replaced with `<Box component="img" src={aaradhyaHeaderText} alt="Aaradhya — A Complete Destination" sx={...} />`, importing the same `../../assets/header-text.svg` asset already used in `quotation-document.tsx`.
- [ ] Sized to fit the drawer's own width without overflowing or looking cramped — a new `wordmarkImageStyles` (or repurposed `wordmarkStyles`) in `app-shell-nav.styles.ts` controls this, likely a fixed height with `width: auto` to preserve the asset's own ~5.07:1 aspect ratio, matching the sizing convention `quotation-document.styles.ts`'s own `headerTextImageStyles` already establishes.
- [ ] Verified live against the drawer's actual dark background (`colorTokens.drawerBg`, `#333136`) — the asset is a raster-embedded SVG whose own colors aren't currently known to read well on a dark background (it was designed for the Quotation's white page background). If it doesn't read legibly as-is, resolve with a light/white rounded backing chip behind the image (simplest, lowest-risk fix) rather than attempting a CSS color-filter hack on embedded raster data.
**UI:** Drawer header area — same position/padding (`wordmarkStyles`'s existing `px`/`py`), image instead of text.
**Tokens:** `space-8`/`space-16` (existing `wordmarkStyles` padding, reused).
**Edge cases:** None functional — this is a pure visual swap; the main risk is the legibility concern above, called out explicitly so it's checked during implementation rather than shipped unseen.
