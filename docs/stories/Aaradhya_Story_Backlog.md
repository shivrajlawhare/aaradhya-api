# Aaradhya Event Management System — Development Story Backlog

**Source spec:** `Aaradhya_SRS_v1.1.md` (folds in `Spec_Amendment_MultiDate_Sessions.md`)
**Source theme:** the token set from the Aaradhya UI Concept mockup (Prompt 3) — the live Figma build stalled on the Starter-plan MCP rate limit before its Theme page could be created, so token names/values below are taken from the published HTML mockup instead. They are otherwise final and map 1:1 to Figma variables whenever that build resumes.
**Build order:** Auth → Change History (foundational service) → Event Management → Session & Calendar Management → Quotation Generation → Role-Based Dashboards & Views. This follows §8 of the SRS, with Change History promoted earlier because every later module's acceptance criteria depends on it existing. Client Management (§5.3 of the SRS) has no stories of its own — Client Contacts are embedded fields on Event, built inside the Event Management module (STORY-011/014/015).

Each story is scoped to one of: a schema/model (no endpoint, no UI), one or two closely related endpoints against an existing schema (no UI), or one screen/panel against existing endpoints — never more than one of these three at once, per the build constraint. "System flow" describes what happens end-to-end even when a story only implements one leg of it, so the next story's starting point is clear.

**Continues in `Aaradhya_Story_Backlog_Addendum_1.md`** (STORY-076 onward) — post-v1.1 product owner requests not yet folded into the SRS itself: Event Detail page restructure to mirror the wizard's steps, a redesigned Activity tab, save-button dirty-state gating, a toast notification provider, hard-deleting an Event, and two branding fixes.

## Design Token Legend

Referenced by short name in each story's **Tokens** line.

| Short name | Value | Role |
|---|---|---|
| `bg` | `#F5EEE1` (ivory) | Page ground |
| `surface` | `#FFFFFF` | Card / screen surface |
| `surface-2` | `#FBF6EC` | App bar, summary card fill |
| `text` | `#322D28` | Primary text (ink) |
| `text-soft` | `#6F675C` | Secondary text |
| `text-faint` | `#A79C8C` | Captions, placeholders |
| `line` | `#E6DAC4` | Hairline borders/dividers |
| `drawer-bg` | `#333136` (charcoal) | Side drawer / mobile nav dark background |
| `drawer-text` | `#F5EEE1` (ivory) | Primary text/wordmark on the drawer's dark background |
| `drawer-text-muted` | `#B4ACA0` | Unselected nav item label/icon on the drawer's dark background |
| `accent` | `#E4630C` (ember) | Single primary-action color |
| `accent-deep` | `#B84607` | Accent pressed/dark state |
| `accent-tint` | `#FBE3D0` | Accent chip/badge fill |
| `status-tentative` / `-tint` | `#B8862B` / `#F3E4BE` | Tentative status |
| `status-confirmed` / `-tint` | `#B5442F` / `#F1D9D0` | Confirmed status |
| `status-completed` / `-tint` | `#8B8377` / `#EAE5DA` | Completed status |
| `status-cancelled` / `-tint` | `#4A443C` / `#DFDACF` | Cancelled / Session Cancelled status |
| `type-display` | Fraunces 600 | Wordmark, Quotation header only |
| `type-title-l` / `-m` | Inter 600, 22px / 17px | Screen and section titles |
| `type-body-l` / `-m` | Inter 400, 15px / 13px | Body copy |
| `type-label-s` | Inter 600, 11px, uppercase, tracked | Eyebrows, tab labels |
| `space-*` | 4 / 8 / 12 / 16 / 24 / 32 | Layout spacing scale |
| `radius-sm` / `-md` / `-lg` | 8 / 12 / 20px | Corner radius scale |

---

## Module: Authentication & User Management (SRS §5.6)

### STORY-001: User Account schema
**Flow:** No user-facing flow yet — this defines the persisted shape every later Auth story builds on: a User Account with a name, unique username, salted password hash, one of the four Role values, and an `active` flag.
**Acceptance Criteria:**
- [ ] Schema rejects a document missing `name`, `username`, `passwordHash`, or `role`.
- [ ] `role` accepts only `EventManager | FnBHead | Housekeeping | Reception`; any other value is rejected.
- [ ] `username` has a uniqueness constraint enforced at the schema/index level.
- [ ] `active` defaults to `true` when not supplied.
- [ ] Unit tests cover: valid document persists, each required-field omission fails, duplicate username fails, invalid role fails.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Username differing only by case (decide and document whether uniqueness is case-insensitive); attempting to set `role` to an empty string; re-activating a previously deactivated account (schema must allow `active` to flip both ways).
**Decisions (v1):**
- Username uniqueness **is case-insensitive**. `username` is normalised to trimmed
  lowercase on write, so `Admin` and `admin` collide; a plain unique index then
  enforces it. Original casing for display lives in `name`, untouched.
- Empty-string `role` is rejected by Mongoose's `required` validator (a String
  path treats `''` as missing); any non-empty value outside the four is rejected
  by the `enum`.
- `active` has no immutability guard — it flips both ways via a normal update.

### STORY-002: POST /auth/login
**Flow:** A user submits username + password; the server verifies the password hash and returns a signed session token containing the user's id and role.
**Acceptance Criteria:**
- [ ] Correct username/password returns 200 with a token and the user's `id`, `name`, `role`.
- [ ] Wrong password returns 401 with no token.
- [ ] Unknown username returns 401 (same error shape as wrong password — no username enumeration).
- [ ] `active: false` account returns 401 even with correct password.
- [ ] Password is never present in any response body.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Empty-string password; username with leading/trailing whitespace; repeated failed attempts (no lockout required for v1, but confirm this is a deliberate non-requirement, not an oversight).
**Decisions (v1):**
- Response/error envelope settled in `docs/api-conventions.md`: bare success body,
  `{ error: { code, message } }` on failure.
- Every auth failure (unknown user, wrong password, deactivated, empty password)
  returns the identical `401 INVALID_CREDENTIALS` body. Empty-string password is
  a failed login, **not** a 400. A structurally malformed body is still a 400.
- Username with surrounding whitespace / different case is normalised in the
  contract schema (`trim` + `toLowerCase`) to match the stored form from STORY-001.
- **No brute-force protection in v1** — confirmed deliberate (small trusted internal
  user base; not in SRS §6.2). Documented in `docs/api-conventions.md`.
- Token: `HS256` JWT, `sub` = id, `role` claim, `JWT_EXPIRES_IN` default `8h`.
- Password hashing uses `@node-rs/argon2` (prebuilt Argon2 — no node-gyp/Python),
  swapped from the `argon2` package per the architecture doc §4 allowance.

### STORY-003: Auth middleware + role guard
**Flow:** Every protected request carries the token from STORY-002; middleware verifies it, attaches `req.user = {id, role}`, and a `requireRole(...roles)` guard rejects requests from the wrong role before the route handler runs.
**Decisions (v1):**
- **A session is invalidated as soon as the account is deactivated** (not at token
  expiry). `authenticate` re-loads the user from the DB on every protected request:
  a token for a now-`active: false` or deleted account returns 401, and
  `requireRole` checks the *live* DB role, not the token's `role` claim — so a
  demotion takes effect on the next request. Costs one indexed `_id` lookup per
  request, negligible at ~15 users, and keeps the payment/change-log restriction
  (SRS §6.2) from being bypassable with a stale token. Full shapes in
  `docs/api-conventions.md`.
- 401 code `UNAUTHENTICATED` covers missing / malformed / bad-signature / expired
  tokens and the deactivated-account case alike; 403 code `FORBIDDEN` for role.
**Acceptance Criteria:**
- [ ] A request with no token to a protected test route returns 401.
- [ ] A request with a valid token attaches `req.user` and reaches the handler.
- [ ] A request with a valid token but a role not in `requireRole(...)`'s allow-list returns 403.
- [ ] A tampered/invalid-signature token returns 401.
- [ ] Middleware and guard are covered by tests against a throwaway test route, independent of any real feature route.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Expired token; token for a user later deactivated (decide: does an active session stay valid until it expires, or is it invalidated on deactivation? — document the v1 answer at the top of this story before starting it).

### STORY-004: Login screen UI
**Flow:** A user opens the app, sees the login screen, enters username/password, and on success is routed to their role's dashboard (dashboard itself doesn't exist yet — route to a placeholder).
**Acceptance Criteria:**
- [ ] Username and password fields, both required before the submit control is enabled.
- [ ] Submit calls STORY-002; a 401 response shows a single inline error message ("Incorrect username or password.") without indicating which field was wrong.
- [ ] A successful login stores the token and navigates away from the login screen.
- [ ] Password field masks input.
- [ ] No console errors on load or on the error path.
**UI:** Login screen — logo mark, username field, password field, primary button, inline error slot.
**Tokens:** `bg`, `surface`, `text`, `text-faint`, `accent` (button), `type-title-l` (screen title), `type-body-m` (error text), `radius-sm` (inputs/button), `space-16`/`space-24`.
**Edge cases:** Submitting with Enter key, not just the button; double-submit while a request is in flight (button must disable); very long username input.

### STORY-005: POST /users
**Flow:** An Event Manager creates a new User Account (name, username, initial password, role) from the not-yet-built User Management screen.
**Acceptance Criteria:**
- [ ] Only a caller with role `EventManager` (via STORY-003's guard) can call this endpoint; others get 403.
- [ ] Valid payload creates a User Account per STORY-001's schema and returns it without the password hash.
- [ ] Duplicate username returns 409 with a clear error code/message.
- [ ] Missing required field returns 400 listing which field(s).
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Creating a user with role `EventManager` itself (must be allowed — nothing in the spec caps the count at exactly 3, that's a current headcount, not a system limit); empty-string password.
**Decisions (v1):**
- Empty-string `password` (and `name`/`username`) is a `400 VALIDATION_ERROR`,
  not created. Different call than STORY-002's login, on purpose: login can't
  distinguish "empty password" from "wrong password" without leaking which
  field was wrong, but creation has no such constraint — reject an unusable
  credential outright rather than persist an account with one.
- The `400` field-listing behaviour (AC 4) is generic, not endpoint-specific: a
  new global `requestValidationErrorHandler` in `src/app.ts` reshapes every
  route's contract-validation failure into `{ error: { code: "VALIDATION_ERROR",
  message, details: [{ field, message }] } }`. Documented in
  `docs/api-conventions.md`.
- Confirmed no EventManager cap — this endpoint doesn't count existing accounts
  by role at all.

### STORY-006: GET /users, PATCH /users/:id
**Flow:** An Event Manager lists all User Accounts and can deactivate one or change its role.
**Acceptance Criteria:**
- [ ] `GET /users` (EventManager-only, 403 otherwise) returns all accounts, passwords excluded.
- [ ] `PATCH /users/:id` can toggle `active` and change `role`; both are independently settable.
- [ ] Response reflects the update; a subsequent `GET /users` shows the new state.
- [ ] Attempting to deactivate or edit a non-existent `:id` returns 404.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** An Event Manager deactivating their own account (decide and document: allowed but they lose access immediately, or blocked — this is a real product decision, flag it back to the user if not already answered).
**Decisions (v1):**
- Flagged back to the user as instructed; answer: **self-deactivation/demotion is
  allowed, effective immediately.** No special-case guard — STORY-003's
  `authenticate` already re-checks `active`/role from the database on every
  request, so it just works. (Blocking it outright, and blocking only the
  last active EventManager, were both considered and declined.)
- `GET /users` returns a bare array, no pagination — not needed at this scale;
  see `docs/api-conventions.md`'s `Pagination — OPEN` note if that changes.
- A malformed `:id` (not 24 hex chars) is a `400`, not folded into the `404`
  path — caught at the contract schema layer, not the handler.

### STORY-007: User Management screen UI
**Flow:** An Event Manager opens User Management, sees the account list from STORY-006, and creates or edits accounts via a form calling STORY-005/006.
**Acceptance Criteria:**
- [ ] Screen is unreachable (route-guarded) for any role other than EventManager, verified by attempting navigation as a non-EventManager session.
- [ ] Table lists name, username, role, active/inactive state for every account.
- [ ] "New user" form requires name, username, password, role before submit is enabled; success adds a row without a full page reload.
- [ ] Deactivate control flips `active` via STORY-006 and the row updates in place.
- [ ] Role change control updates via STORY-006 and the row updates in place.
**UI:** User Management screen — table + "New user" form (name, username, password, role dropdown), row-level deactivate toggle and role dropdown.
**Tokens:** `surface`, `line` (table rows), `text`, `text-soft`, `status-tentative`/`status-completed` tints repurposed as active/inactive indicators, `type-title-l`, `type-label-s` (column headers), `radius-md` (cards).
**Edge cases:** Deactivating the account that is currently logged in and viewing this exact screen; role list must exactly match the four SRS roles, no free text.

---

## Module: Change History (SRS §5.7)

Built early because every write in every later module needs it. Placed here, not after Event Management, so it exists before the first Event write story.

### STORY-008: Change Log Entry schema + write helper
**Flow:** No direct user flow — this is the shared service every future PATCH endpoint calls: given `(entityType, entityId, field, oldValue, newValue, changedByUserId)`, it persists one Change Log Entry.
**Acceptance Criteria:**
- [ ] Schema stores `entityType`, `entityId`, `field`, `oldValue`, `newValue`, `changedBy`, `timestamp` (server-set, not client-supplied).
- [ ] The write helper is a single importable function; calling it twice with different `field` values for the same `entityId` produces two separate entries, not one overwritten entry.
- [ ] Calling the helper with `oldValue === newValue` still writes an entry (the helper doesn't decide whether a change is "real" — the caller does that before invoking it, so behavior stays predictable).
- [ ] Unit-tested directly, with no HTTP layer involved.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Very large `oldValue`/`newValue` (e.g. a whole embedded array like `client_contacts`) — decide and document whether the log stores the full before/after array or a diff; storing the full value is the simpler v1 choice, note it as such.
**Decisions (v1):**
- Stores the **full** before/after value, never a diff — the story's own
  "simpler v1 choice." `oldValue`/`newValue` are `Schema.Types.Mixed`, and
  both are optional (a field set for the first time has no prior value).
- `entityType`/`entityId`/`changedBy` are plain strings, not Mongoose refs —
  `entityType` is deliberately open (not a closed enum): the set of loggable
  entities isn't known yet, and locking it down now means guessing at
  modules that don't exist. A compound `{ entityType: 1, entityId: 1 }`
  index is in place for the natural "history for this entity" query
  STORY-009 will need.
- `timestamp` has a schema `default: Date.now` and `immutable: true` (blocks
  mutation after creation) — but the real "not client-supplied" guarantee is
  the write helper's input type, which has no `timestamp` field at all.
  `immutable` doesn't stop a value being set at creation time by code that
  bypasses the helper and calls the model directly; `logChange` is the one
  documented path, and structurally can't accept one. Verified both halves
  with a test.
- Lives in `src/services/` despite touching the DB (unlike this folder's
  other pure computation) — the story's own framing ("the shared service...")
  and its "unit-tested directly, no HTTP layer" requirement are what that
  folder buys either way.

### STORY-009: GET /change-log
**Flow:** An Event Manager viewing an Event's Activity tab requests all Change Log Entries for that Event.
**Acceptance Criteria:**
- [ ] `GET /change-log?entityType=Event&entityId=:id` returns entries for that entity, EventManager-only (403 otherwise, per STORY-003).
- [ ] Entries are sorted newest-first.
- [ ] Empty result set returns `200` with an empty array, not a 404.
- [ ] Verified against fixture data seeded directly via STORY-008's helper — no dependency on any Event Management story existing yet.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Requesting logs for an `entityId` that was never logged (empty array, not an error); pagination is out of scope for v1 given the data scale, but note that as a deliberate choice if the list could ever grow large within one event's lifetime.
**Decisions (v1):**
- No pagination, deliberately (per the edge case) — one Event's edit history
  over its lifetime is bounded by usage, not by data scale the way a
  cross-entity list would be. Documented in `docs/api-conventions.md`
  alongside the note to revisit if that assumption stops holding.
- `entityType` + `entityId` are both required query params, not optional —
  there's no sensible "all entities" default for what's meant to be one
  Event Page's Activity tab, and a missing one is a `400`, matching how
  every other route's contract-level validation already works.
- Fixtures seeded directly via STORY-008's `logChange`, exactly as
  instructed — no Event model or Event Management story involved.

### STORY-010: Activity tab UI (reusable component)
**Flow:** An Event Manager opens an Event's Activity sub-tab and sees a chronological list of every field change on that Event.
**Acceptance Criteria:**
- [ ] Component takes an `entityType`/`entityId` prop, calls STORY-009, and renders `field`, `old → new`, `changedBy`, relative timestamp per row.
- [ ] Empty state renders a plain "No changes yet" message, not a blank panel.
- [ ] Component is tested standalone against fixture API responses (does not require a real Event to exist).
- [ ] Component is not visible to non-EventManager roles when embedded later (verified once embedded — flag as a re-check item on STORY-017).
**UI:** Activity list — one row per entry (field name, old→new values, actor, timestamp).
**Tokens:** `surface`, `line` (row dividers), `text`, `text-faint` (timestamps), `type-body-m`, `space-8`.
**Edge cases:** A change where `oldValue` is empty/null (new field being set for the first time — render as "— → value", not "null → value").

---

## Module: Event Management (SRS §5.1) — includes Client Contacts (§5.3)

### STORY-011: Event core schema
**Flow:** No user flow yet — defines the Event document: auto-generated `event_id` (`ARD-EVT-2026-001` format), `event_family_type`, `status`, `event_manager` (ref to a User Account with that role), `created_by`/`created_at`, and embedded `client_contacts[]` (each with `name`, `contactNumber`, `role` — Bride/Groom/POC/Custom).
**Acceptance Criteria:**
- [ ] `event_id` is generated server-side in the documented format and is unique; client-supplied `event_id` is ignored.
- [ ] `status` accepts only `Tentative | Confirmed | Completed | Cancelled`.
- [ ] `event_manager` must reference an existing User Account whose role is `EventManager`; referencing any other user's id is rejected.
- [ ] `client_contacts[]` accepts zero or more rows at the schema level (the "at least one" rule is enforced at the create-endpoint level in STORY-012, not the schema, so the schema stays reusable).
- [ ] Unit tests cover id-format generation, id uniqueness across repeated creation, and rejection of an invalid `event_manager` reference.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Two Events created in the same millisecond (id-generation must not collide under concurrent creation — test with parallel calls, not just sequential); `event_family_type` custom values (schema must accept a free-text value alongside the enum, per FR-EVT-1's "dropdown + custom").

**Decisions (v1):**
- `event_id` generation is a per-year atomic counter (`src/models/event-id-counter.ts` + `src/services/event-id.ts`), one document per calendar year keyed by the year itself, incremented via `findOneAndUpdate({...}, {$inc:{seq:1}}, {upsert:true})`. That single Mongo-level atomic operation — not a read-then-write in application code — is what actually makes concurrent creation collision-free; a unique index on `eventId` is kept as a belt-and-braces safety net, not the primary defense.
- `eventId` is assigned in a `pre('validate')` hook, gated on `this.isNew`, so it fires once at creation and never re-mints (and never re-reserves a sequence number) on a later `.save()` of an existing Event — relevant once an update story exists, even though none does yet.
- `status` has no schema-level default — deliberately left to STORY-012's create endpoint (its own AC already says "`status` defaults to `Tentative`"), so this schema stays usable by anything that wants to construct an Event without silently assuming that default.
- `event_manager`'s reference check is a Mongoose async custom validator that loads the referenced User and checks `role === EventManager`; it does not check `active` — STORY-006 already decided deactivation is enforced by `authenticate` re-checking on every request, not by every place that stores a user reference re-implementing that check.
- `created_by` has no role restriction (unlike `event_manager`) — the story only asks for the `event_manager` reference to be role-checked; who is allowed to *be* `created_by` is an authorization question STORY-012's `requireRole` guard already owns, not a schema-level concern.
- `client_contacts[]` subdocuments keep Mongoose's default auto-generated `_id` per row (not disabled) — FR-EVT-2's add/remove/edit-row behavior needs a stable per-row identifier, and that's the natural, idiomatic Mongoose shape for it rather than something bolted on early.

### STORY-012: POST /events
**Flow:** An Event Manager creates a new Event, choosing family type, assigning an Event Manager, and entering at least one Client Contact (Bride, Groom, and/or POC).
**Acceptance Criteria:**
- [ ] EventManager-only (403 otherwise).
- [ ] Request with zero `client_contacts` rows (or all rows with an empty `name`) returns 400.
- [ ] Valid request creates the Event via STORY-011's schema, `status` defaults to `Tentative`, and returns the created document including its generated `event_id`.
- [ ] `created_by` is set from `req.user.id`, never from the request body.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** A `client_contacts` row with a name but no `contactNumber` (decide: allowed or required — document the choice); assigning `event_manager` to a user account that is `active: false`.

**Decisions (v1):**
- `contactNumber` is **required** on every `client_contacts` row, not optional — matches STORY-011's Mongoose schema, which already requires it per row. Making it optional at the contract layer would just let a request through the 400 gate here only to fail as a raw Mongoose `ValidationError` one line later inside `Event.create`; requiring it up front keeps the failure a clean, single `400 VALIDATION_ERROR`.
- Assigning `event_manager` to a **deactivated** (`active: false`) User Account is **allowed**, not rejected — this restates STORY-011's already-built behavior (its reference validator checks `role`, not `active`) rather than introducing anything new. Consistent with STORY-006's decision that `active` enforcement lives solely in `authenticate`'s live re-check on every request.
- `status` is **optional and honored when present** — not always forced to `Tentative` regardless of input. FR-EVT-1 lists "initial status" as a real creation input alongside `event_family_type` and `event_manager`; this AC's "status defaults to Tentative" reads as "the default when absent," not "the endpoint ignores any status the caller sends."
- The invalid-`event_manager` case (nonexistent id, or a real id whose role isn't `EventManager`) is surfaced as `400 VALIDATION_ERROR` with `details: [{ field: "eventManager", ... }]` — the same code every other bad-body field uses, rather than a new bespoke code, even though the check itself runs as a Mongoose validator after the request already cleared the contract's own Zod schema.
- The response's `client_contacts` rows carry no `id` field yet — STORY-011 kept Mongoose's default per-row `_id` for future edit/remove support, but nothing in this story reads or returns it; adding it now with no consumer would be speculative, so it's deferred to whichever future story actually addresses one row.

### STORY-013: GET /events, GET /events/:id
**Flow:** Any authenticated user retrieves the full Event list or a single Event by id (role-based field filtering is a separate later story — this one returns the full document to any authenticated caller, as the foundation those filters wrap).
**Acceptance Criteria:**
- [ ] `GET /events` returns all Events with core fields (no sessions/accommodation detail required yet if not built — extend as those stories land).
- [ ] `GET /events/:id` returns 404 for a non-existent id.
- [ ] Both require a valid token (401 with none) but impose no role restriction yet.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Malformed `:id` (not a valid ObjectId/format) returns 400, not a 500.

**Decisions (v1):**
- Both routes are gated by `authenticate` only — no `requireRole` — matching the Flow's explicit statement that field filtering by role is a separate later story. Every field STORY-011's schema persists comes back to any authenticated caller.
- `GET /events` reuses the no-pagination, bare-array convention `GET /users` already established — same reasoning (no volume at Aaradhya's scale that needs it yet).
- Malformed `:id` is validated at the contract's `pathParams` schema (reusing the `objectIdSchema` helper STORY-012 extracted), not in the handler — same "malformed vs. well-formed-but-missing are different failures" split `PATCH /users/:id` already uses (400 vs. 404).

### STORY-014: PATCH /events/:id (core fields + Client Contacts)
**Flow:** An Event Manager edits an Event's family type, status, assigned manager, or adds/edits/removes Client Contact rows; each changed field is logged via STORY-008.
**Acceptance Criteria:**
- [ ] EventManager-only (403 otherwise).
- [ ] Changing `status` (including to `Cancelled` from any prior status) succeeds and is reflected on the next GET.
- [ ] Editing one field writes exactly one Change Log Entry with the correct `field`/`oldValue`/`newValue`, verifiable via STORY-009.
- [ ] Editing `client_contacts` (add a row, remove a row, edit a name) writes a Change Log Entry for that change.
- [ ] Removing the last remaining Client Contact row is rejected with 400 (an Event must always retain at least one contact, mirroring the create-time rule).
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** A PATCH that changes nothing (identical values submitted) — decide whether this still writes a Change Log Entry, and be consistent with STORY-008's documented behavior; concurrent edits to the same Event by two Event Managers (last-write-wins is acceptable for v1 — document it as a deliberate non-requirement, not a bug).

**Decisions (v1):**
- **A PATCH resending identical values writes no Change Log Entry.** STORY-008 documented that `logChange` itself always writes when *invoked*, even with `oldValue === newValue` — that's the helper staying "dumb" so its own behavior is predictable. This story is exactly the "caller" that line assumed would decide what's worth invoking it for: `updateEvent` compares each submitted field's value against what's currently stored and only calls `logChange` (and only `$set`s the field at all) when they genuinely differ. The two decisions don't conflict — the helper's contract is unchanged, only this endpoint's use of it is selective.
- **Concurrent edits: last write wins, no locking, no conflict response.** A plain `findByIdAndUpdate` after loading the pre-update document for diffing is exactly last-write-wins already — nothing added or removed to get that behavior. Confirmed deliberate, not revisited unless real conflicts turn out to matter.
- `client_contacts` changes log the **full before/after array**, not a per-row diff — same choice STORY-008 already made and demonstrated with this exact field as its example.
- Removing the last Client Contact row is rejected via the **same Zod `.min(1)` shape** `POST /events` uses on its own `clientContacts`, just marked `.optional()` here for PATCH semantics — not a hand-rolled "count before vs. after" check in the controller.
- Multiple changed fields in one PATCH write multiple Change Log Entries (one per field), consistent with STORY-008's "two calls, two entries" behavior — never one entry summarizing several field changes.

### STORY-015: Event Creation screen UI
**Flow:** An Event Manager taps "New Event," fills family type, assigns themself or another manager, adds Client Contact rows, and submits.
**Acceptance Criteria:**
- [ ] Family type is a dropdown with a "Custom…" option that reveals a free-text field.
- [ ] Client Contact rows default to Bride/Groom/POC with add/remove controls; submit is disabled until at least one row has a non-empty name.
- [ ] Successful submit (via STORY-012) navigates to the new Event's detail screen (STORY-017).
- [ ] A 400 from the server (e.g. zero valid contacts) surfaces as an inline form error, not a silent failure.
**UI:** Event Creation form — family type dropdown+custom, event manager picker, Client Contact row list with add/remove, submit button.
**Tokens:** `surface`, `line`, `text`, `accent` (submit button), `type-title-l`, `radius-sm`, `space-12`/`space-16`.
**Edge cases:** Removing a row that has unsaved text in it (must not silently keep it in the submitted payload); rapid add/remove clicking (row identity/order must stay correct).

### STORY-016: Event List screen UI
**Flow:** Any user opens the Event list and sees every Event they're permitted to see (role filtering lands in the Role Dashboards module — this story shows the unfiltered list for EventManager, the only role built so far with a landing screen).
**Acceptance Criteria:**
- [ ] Renders `event_id`, family type, status (as a colored chip using status tokens), assigned manager, and the Bride/Groom names from `client_contacts`, from STORY-013's list endpoint.
- [ ] Status chip color maps 1:1 to the four status tokens — verified by asserting the rendered color/class per status value, not just that a chip exists.
- [ ] Empty list (no Events yet) renders a plain empty state, not a blank screen.
- [ ] Tapping a row navigates to that Event's detail screen (STORY-017).
**UI:** Event list — one row per Event (id, status chip, family type, manager, client names).
**Tokens:** `surface`, `line`, `status-tentative/confirmed/completed/cancelled` + tints, `text`, `text-faint`, `type-body-m`, `space-8`.
**Edge cases:** An Event with a very long custom family-type value (must truncate, not break the row layout).

### STORY-017: Event Detail — Overview tab UI
**Flow:** A user opens a single Event and sees/edits its core fields and status on the Overview tab; the Activity sub-tab (STORY-010) is embedded here for the first time.
**Acceptance Criteria:**
- [ ] Header shows `event_id`, status chip, family type per STORY-013's GET.
- [ ] Status control lets an Event Manager move to any of the four statuses (not just the "next" one in sequence) and persists via STORY-014.
- [ ] Client Contact rows are editable in place and persist via STORY-014.
- [ ] Activity sub-tab (STORY-010) renders real log entries after an edit is made on this screen — confirms the two stories actually connect, not just pass their own isolated tests.
- [ ] Screen is reachable by navigating from both STORY-016's list and (later) STORY-031's calendar chip.
**UI:** Event Detail shell (header + tab strip) with Overview tab content; Activity sub-tab embedded.
**Tokens:** `surface`, `text`, status tokens (header chip), `type-title-l` (event name/id), `type-label-s` (tab labels), `line` (tab underline), `radius-md`.
**Edge cases:** Navigating directly to an Event Detail URL for an id that doesn't exist (404 state, not a crash); switching status to `Cancelled` and back — must remain fully editable, no lock-out.

### STORY-018: Accommodation schema + computation functions
**Flow:** No user flow yet — extends the Event schema with one Accommodation Block (`check_in`, `check_out`, `room_lines[]` of `room_type`/`occupancy`/`tariff`/`no_of_rooms`), and defines the pure functions that compute `total_days`, each room line's `total_incl_gst`, `total_occupancy`, and `total_charges`.
**Acceptance Criteria:**
- [ ] Given fixed `check_in`/`check_out`, `total_days` computation is unit-tested against exact expected values (including a same-day case = 1 day, not 0).
- [ ] Given a fixed set of room lines, `total_occupancy` and `total_charges` sum correctly, tested with 0, 1, and multiple room lines.
- [ ] Per-line `total_incl_gst` applies the org GST rate correctly against `tariff × no_of_rooms`, tested with a known rate and known inputs.
- [ ] Functions are pure (no DB access), independently unit-tested with no HTTP layer.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** `check_out` equal to `check_in` (must not produce a negative or zero day count that breaks downstream cost math); a room line with `no_of_rooms = 0` (decide: allowed as a placeholder row, or rejected — document the choice).

**Decisions (v1):**
- **The four computed values (`total_days`, per-line `total_incl_gst`, `total_occupancy`, `total_charges`) are never stored** — `src/services/accommodation.ts` holds pure, DB-free functions computed on demand by whatever needs them (STORY-019's endpoint, later the Quotation rollup). The Mongoose schema (`src/models/event.ts`) only persists the inputs (`checkIn`, `checkOut`, `roomLines[]` of `roomType`/`occupancy`/`tariff`/`noOfRooms`) — nothing derived is stored, so nothing derived can drift out of sync with its inputs. This is the most direct reading of CLAUDE.md's "every derived/computed field is server-computed, never client-trusted."
- **`total_days` is inclusive of both the check-in and check-out date**: same-day = 1 day (the story's explicit case), one calendar day apart = 2 days, five days apart = 6 days. `check_out` before `check_in` (an invalid range) is not guarded by this function — that's a schema/endpoint-level validation concern for STORY-019, out of scope for a pure-math function.
- **`no_of_rooms: 0` is allowed**, both at the schema level (`min: 0`, not `min: 1`) and in the computation functions (contributes 0 to every total, not an error) — a harmless placeholder row, matching the same "schema stays permissive" precedent `client_contacts[]` already established.
- **The "org GST rate" is one new config value**, `config.gstRatePercent` (env `GST_RATE_PERCENT`, default 18) — SRS Assumption A9 explicitly frames this as "a single organization-wide rate," not a per-room-type or per-tariff-bracket slab, so one flat percentage is the correct model, not a lookup table.
- **`total_occupancy` sums `occupancy × no_of_rooms` per line, not raw `occupancy` alone** — the SRS table just says "sum across room lines" without a formula; `occupancy` is a room type's per-room capacity (e.g. Double = 2), so multiplying by room count is the only reading that produces a meaningful "total guests" figure when different lines have different room counts.
- **`accommodation` is optional on the Event schema, and `checkIn`/`checkOut` are optional within it** — STORY-012's create endpoint doesn't populate it (unchanged, not touched by this story), so a freshly created Event simply has no `accommodation` at all until STORY-019 adds one; this needed no change to STORY-012 to keep working, verified by the full existing suite passing unchanged.
- **All amounts round to whole currency units** (`Math.round(x * 100) / 100`) — not explicitly asked for, but repeated floating-point addition of GST-inclusive line totals can otherwise drift by fractions of a currency unit; a natural correctness bar for money math, not new scope.

### STORY-019: PATCH /events/:id/accommodation
**Flow:** An Event Manager edits the Accommodation Block; the server persists the input fields and recomputes every derived field via STORY-018, discarding any derived value the client tried to submit.
**Acceptance Criteria:**
- [ ] EventManager-only (403 otherwise).
- [ ] Submitting a `total_charges` (or any other derived field) in the request body has no effect — the response always reflects the server-computed value.
- [ ] Adding/removing/editing a room line writes a Change Log Entry per changed field via STORY-008.
- [ ] Response includes all derived fields freshly computed, not stale values from before the edit.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Submitting `room_lines` as an empty array (Accommodation with zero rooms — allowed, since not every Event needs guest rooms; totals should compute to zero, not error).

**Decisions (v1):**
- **The response is the Accommodation Block itself, not the parent Event** — `PATCH /events/:id/accommodation` is a sub-resource route, so it returns that sub-resource, matching REST convention rather than nesting it inside a full Event body.
- **"Response always reflects the server-computed value" is satisfied structurally, not by a runtime override**: the request body schema simply has no `totalCharges`/`totalOccupancy`/`totalDays`/`totalInclGst` keys at all, so a caller submitting them has nothing to override — the response is built entirely from STORY-018's pure functions run against the just-updated document.
- **`checkIn`/`checkOut`/`roomLines` are the three tracked "fields"**, at the exact same granularity `PATCH /events/:id` already uses for the rest of the Event — one Change Log Entry per changed field, and a whole-array `roomLines` change is ONE entry with the full before/after array (mirroring how `clientContacts` is logged), not one entry per room line. "Adding/removing/editing a room line" in the AC reads as "the roomLines field changed," the same way STORY-014 already treats any `clientContacts` edit as one field-level change.
- **The logged `roomLines` value is the raw stored shape only, never `totalInclGst`** — that value is never stored (STORY-018), so logging it would put a transient, always-recomputed number into a permanent audit record, which could read as if it had been a real stored value at that point in time.
- **A no-op PATCH (identical `roomLines`) writes no Change Log Entry**, matching STORY-014's exact "the caller decides whether a change is real before invoking `logChange`" precedent — restated here rather than re-decided.
- **`checkIn`/`checkOut` values round-trip through `z.coerce.date()`** on input and plain `Date` on output (matching every other date field in this contract) — this is the first endpoint in the app to accept a date as request input, not just return one.

### STORY-020: Accommodation (Rooms) tab UI
**Flow:** An Event Manager opens the Rooms tab, edits check-in/out and room lines, and sees every derived total update live from the server response — no client-side math.
**Acceptance Criteria:**
- [ ] Room line rows are editable (room type, occupancy, tariff, count); totals shown are exactly what STORY-019's response returned, never independently calculated in the UI.
- [ ] `total_days`, `total_occupancy`, `total_charges`, and each line's `total_incl_gst` render as read-only, non-editable fields.
- [ ] Adding a room line and saving reflects the new row and updated totals without a full page reload.
**UI:** Rooms tab — check-in/out fields, room-line table (editable inputs + read-only computed columns), footer totals.
**Tokens:** `surface-2` (footer totals band), `text`, `type-body-m`, `type-label-s` (column headers), tabular-nums for all numeric columns, `space-12`.
**Edge cases:** Editing a field, then navigating away before saving (must prompt or discard cleanly, not leave the record in an inconsistent local state).

**Decisions (v1) — aaradhya-api side of this story:**
- This story is UI-only per its own "UI: None (backend only)" being absent (it *has* a UI) — but building it surfaced a real backend gap: **`GET /events/:id` never returned `accommodation` at all**, and no story had added a dedicated GET for it (STORY-019 only added the PATCH). The Rooms tab has no way to show the *current* Accommodation Block on first render without one. Fixed minimally: `accommodation` (via STORY-019's own `toPublicAccommodation`) was added to `eventResultSchema`/`toPublicEvent()` — purely additive, verified against the full existing test suite passing unchanged before adding new coverage for it.

### STORY-021: Payment schema + balance computation
**Flow:** No user flow yet — extends Event with a Payment Record (`total_estimated_amount`, `advance_required`, `advance_paid`, `advance_paid_date`, `payment_mode`) and the pure `balance` function.
**Acceptance Criteria:**
- [ ] `balance = total_estimated_amount − advance_paid`, unit-tested against fixed inputs including `advance_paid = 0` and `advance_paid > total_estimated_amount` (a negative balance must be representable, not clamped or errored).
- [ ] Schema fields default to `0`/unset appropriately for a brand-new Event with no payment activity yet.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Negative `advance_paid` input (reject at the schema/endpoint level — money in can't be negative).

**Decisions (v1):**
- **`payment` is always instantiated with defaulted fields, unlike `accommodation`** — a deliberate difference from STORY-018's "optional, may be entirely absent" choice. This story's own AC frames it as "fields default to 0/unset," not "the record may not exist yet," so `payment` uses Mongoose's `default: () => ({})` to guarantee a brand-new Event always has `payment.totalEstimatedAmount === 0` etc. without STORY-012's create endpoint needing any change.
- **`balance` is never stored**, same reasoning as every derived value in this schema so far (STORY-018's totals) — `src/services/payment.ts` computes it on demand; nothing persisted can drift out of sync with `total_estimated_amount`/`advance_paid` if it's never written down.
- **`min: 0` applies to all three money fields** (`total_estimated_amount`, `advance_required`, `advance_paid`), not just `advance_paid` — the edge case only names `advance_paid`, but "money in can't be negative" applies just as much to an estimate or a required-advance figure; none of the three can sensibly go negative.
- **`payment_mode` is a free-text string, not an enum** — the SRS gives no fixed list for it (unlike `event_family_type`), matching the same "no list given → stay open" call already made for `room_type`.
- **`payment_status` (mentioned in SRS §4.4 alongside `balance`) is deliberately not built here** — this story's own Flow/AC never names it, only the five listed fields plus `balance`; adding it now would be scope beyond what was actually asked for.
- **Extracted `roundToCurrency` to `src/utils/currency.ts`**, shared by `services/accommodation.ts` and this story's `services/payment.ts` — the second real caller of the exact same rounding logic, the trigger `directory-structure.md` names for moving something into `utils/`.

### STORY-022: PATCH /events/:id/payment
**Flow:** An Event Manager records/updates payment fields; `balance` is recomputed server-side on every write.
**Acceptance Criteria:**
- [ ] EventManager-only — verified this is enforced by role, distinctly from every other role getting 403 (not just "not logged in").
- [ ] Submitting a `balance` value in the request body is ignored; response always reflects server computation.
- [ ] Each changed field writes a Change Log Entry via STORY-008.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Setting `advance_paid_date` without `advance_paid` being set yet (decide and document whether this is allowed).

**Decisions (v1):**
- **Setting `advance_paid_date` before `advance_paid` is ever set is allowed, not rejected** — no cross-field validation between the two. A caller may record an expected/planned advance-payment date before the money is actually confirmed as received; nothing in the spec suggests these two fields must move together.
- **The response is the Payment Record itself, not the parent Event** — same "sub-resource route returns its sub-resource" convention `PATCH /events/:id/accommodation` already established, for the same reason.
- **`min: 0` rejects a negative value on all three money-input fields** (`total_estimated_amount`, `advance_required`, `advance_paid`), not just `advance_paid` as the edge case literally names — consistent with the same broadening already made in STORY-021's schema decision. `balance` itself is unaffected and can still go negative — that's the correct, representable overpayment state, not an error.
- **`GET /events/:id` does *not* yet include `payment`**, unlike `accommodation` (added STORY-020) — deliberately not pulled forward, since no story has needed to read it yet, matching "don't implement beyond what the current story's AC asks for." Flagged here explicitly: this will very likely need the exact same fix STORY-020 needed for accommodation, the first time STORY-023 (Payments tab UI) needs to display current payment data on load.

### STORY-023: Payments tab UI (Event Manager only)
**Flow:** An Event Manager opens the Payments tab (invisible to every other role) and records/edits payment fields, seeing the computed balance update.
**Acceptance Criteria:**
- [ ] Tab is not rendered in the DOM at all for a non-EventManager session (not just visually hidden — verify via DOM query, since a hidden-but-present field is a real data leak here).
- [ ] Balance field is read-only and always matches STORY-022's response.
- [ ] Saving a field change reflects immediately without a full reload.
**UI:** Payments tab — total estimated amount, advance fields, payment mode, read-only balance.
**Tokens:** `surface-2`, `accent-deep` (balance emphasis when negative/outstanding), `type-title-m`, tabular-nums, `space-12`.
**Edge cases:** A very large amount value (formatting must not overflow the card on a narrow viewport).

**Decisions (v1) — aaradhya-api side of this story:**
- Same gap as STORY-020: `GET /events/:id` never returned `payment`, and no story had added a dedicated GET for it (STORY-022 only added the PATCH). Fixed minimally — `payment` (via STORY-022's own `toPublicPayment`) added to the already-public `eventResultSchema`/`toPublicEvent()`, additive only, verified against the full existing suite before this frontend work continued.
- This is the concrete instance of the role-filtering gap `docs/api-conventions.md`'s `GET /events, GET /events/:id` section already flagged back at STORY-013 ("hiding payment data from Reception is a later story that wraps this one"). `GET /events/:id` still has no role restriction — every authenticated role can currently read `payment` via the raw API, even though this story's UI never renders the tab for non-EventManager sessions. Deliberately not fixed here — that's Module 5.5 (Role-Based Dashboards & Views)'s job, not this story's.

### STORY-024: Documents Checklist schema + PATCH endpoint
**Flow:** An Event Manager toggles each of the six fixed Document Checklist items (Aadhar, PAN, Leaving/Birth Certificate, Ration Card, passport photos, Wedding Card) to Yes/No.
**Acceptance Criteria:**
- [ ] The set of checklist item keys is a server-defined constant; the endpoint rejects any key not in that fixed list (no ad hoc items via the API).
- [ ] Each item persists as a boolean; toggling one writes one Change Log Entry.
- [ ] EventManager-only (403 otherwise).
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** A new Event with no checklist state yet (all items should read as `false`/not-received by default, not error or return `null`).

**Decisions (v1):**
- **The fixed set is a flat object with six named boolean fields, not an array-of-`{key, value}` items** — the SRS's own `documents_checklist[]` array notation is just describing "a fixed set of Document Checklist Items" conceptually; since the set can never grow or shrink via this endpoint (the story's own AC requires rejecting any key outside it), a flat object is functionally identical and far simpler to validate/update/query than modeling six items that will only ever exist as exactly six.
- **`.strict()` on the Zod body schema is what implements "rejects any key not in that fixed list"** — Zod's default object behavior silently strips unknown keys, which would look like a successful no-op to a caller who mistyped one; `.strict()` turns that into a real `400 VALIDATION_ERROR` instead.
- **`documentsChecklist` is always instantiated with defaulted (`false`) fields**, the same `default: () => ({})` shape STORY-021 used for `payment` — not `accommodation`'s "may be entirely absent" shape. Every Event genuinely has a checklist from day one; there's no "not applicable" case the way there is for accommodation on an Event with no guest rooms.
- **The update-diff logic loops over `DOCUMENT_CHECKLIST_ITEM_KEYS`** rather than repeating one `if` block per field by hand (`buildEventUpdate`/`buildAccommodationUpdate`/`buildPaymentUpdate`'s shape) — every item here is a plain boolean with the same `!==` comparison, so there's no per-field custom logic (date/array/ObjectId compares) forcing it into that more repetitive pattern the way the other three needed.
- **`GET /events/:id` does not yet include `documentsChecklist`** — deliberately not pulled forward, consistent with the same choice made for `accommodation` and `payment`. Flagged here explicitly: expect the same retroactive-addition fix once STORY-025 (Documents tab UI) needs to read current checklist state on load.

**Decisions (v1) — aaradhya-api side of STORY-025:**
- Same gap as STORY-020/STORY-023: `GET /events/:id` never returned `documentsChecklist`, and no story had added a dedicated GET for it (STORY-024 only added the PATCH). Fixed minimally — `documentsChecklist` (via STORY-024's own `toPublicDocumentsChecklist`) added to the already-public `eventResultSchema`/`toPublicEvent()`, additive only, verified against the full existing suite before this frontend work continued.
- No role-filtering concern here unlike `payment` — the SRS doesn't restrict Documents Checklist visibility by role, so this addition doesn't touch the still-deferred Module 5.5 work.

### STORY-025: Documents Checklist tab UI
**Flow:** An Event Manager opens the Documents tab and checks off items as they're physically received.
**Acceptance Criteria:**
- [ ] Renders exactly the six fixed items, in a stable order, each as a Yes/No toggle bound to STORY-024.
- [ ] No "add item" control exists anywhere on this screen (matches the fixed-list, no-file-upload scope).
- [ ] Toggling an item persists immediately and survives a page reload.
**UI:** Documents tab — fixed checklist with toggles.
**Tokens:** `surface`, `line`, `accent` (checked state), `type-body-l`, `space-8`.
**Edge cases:** None beyond the fixed-list constraint already covered — flagged here explicitly because a screen this simple is where scope creep ("just let them add one more document type") is most tempting; don't.

---

## Module: Session & Calendar Management (SRS §5.2)

### STORY-026: Session schema + derived-field functions
**Flow:** No user flow yet — extends Event with `sessions[]`: `session_type`, `venue`, `venue_cost`, `start_date`/`end_date`, `start_time`/`end_time`, `pax`, `session_status` (`Active`/`Cancelled`, default `Active`), and the `setup` sub-object. Also defines the pure `duration_days`/`is_multi_day` functions from the finalized multi-day amendment.
**Acceptance Criteria:**
- [ ] Schema rejects `end_date < start_date` at the validation level.
- [ ] `start_date === end_date` (single-day session) is valid and is the same code path as a multi-day range — no separate "single day mode" flag exists.
- [ ] `duration_days` and `is_multi_day` are unit-tested pure functions, covering a 1-day session (`is_multi_day = false`) and a 3-day session (`duration_days = 3`).
- [ ] `session_status` defaults to `Active` when not supplied.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** A session spanning a month boundary (e.g. `2026-09-29` to `2026-10-01`) — `duration_days` must compute correctly across the boundary using real date arithmetic, not string comparison.

**Decisions (v1):**
- **`items[]` is deliberately absent from this story's `sessionSchema`** — this story's own Flow line lists exactly `session_type`/`venue`/`venue_cost`/`start_date`/`end_date`/`start_time`/`end_time`/`pax`/`session_status`/`setup`, not Items; SRS §4.2 lists `items[]` too, but that's a later story's schema to add (§4.5/FR-SES-3), not this one's.
- **`session_type` and `venue` are free text, not enums** — the SRS phrases both exactly like `event_family_type` ("dropdown + custom"/"+ custom"), which STORY-011 already decided means an open string field, not a closed enum with a `Custom` member. `setup.seating`, by contrast, is a closed enum (`SeatingArrangement`) with an `Other` terminal value — its own SRS phrasing lists a fixed parenthetical set with no "+ custom" wording, the same shape `EventStatus`/`ClientContactRole` already use.
- **`sessions` is zero-or-more at the schema level**, same "shape now, enforce at the endpoint later if needed" precedent `clientContacts` already set at STORY-011 — this story defines the shape only; STORY-027 (`POST /events/:id/sessions`) owns any create-time requirement.
- **`setup` is always instantiated with defaulted fields** (`default: () => ({})`), the same STORY-021/STORY-024 "every [sub-record] genuinely exists from day one" shape used for `payment`/`documentsChecklist` — not `accommodation`'s "may be entirely absent" shape, since every Session has a setup record the moment it exists, even before any of its fields are filled in.
- **`end_date >= start_date` is enforced via a Mongoose field-level `validate` on `endDate`**, referencing `this.startDate` — the same "reject an invalid range at the schema/validation level" requirement this story's own AC states outright, mirroring the pattern `isValidEventManagerReference` (STORY-011) already established for a different kind of cross-field/cross-document check. `this` had to be narrowed with a plain `'startDate' in this` check (not an `as` cast) to satisfy Mongoose's own `Query | Document` validator-context typing (typescript-rules rule 1).
- **`duration_days`/`is_multi_day` (`src/services/session.ts`) delegate to a newly extracted `computeInclusiveDayCount` (`src/utils/date.ts`)** — the exact same "`end − start + 1`" formula STORY-018's `computeTotalDays` already used for Accommodation's `check_in`/`check_out`. Extracted once this second real caller needed the identical math (the same "second use, not speculative" principle STORY-021 already applied to `roundToCurrency`); `computeTotalDays` now delegates to the shared helper too, behavior-preserving (its own existing test suite passes unchanged).
- **`startTime`/`endTime` are optional strings, not `Date`s** — local time-of-day values (`"18:30"`) per the finalized multi-day amendment, never merged into a timezone-aware datetime and never part of the overlap query; no format validation added (e.g. an `HH:mm` regex) since no AC asks for it — same "don't implement beyond the current story's AC" restraint applied elsewhere.
- **No `POST`/`PATCH` endpoint yet, no `sessions` field on the public `eventResultSchema`** — this story is schema-only, matching STORY-011/STORY-018/STORY-021's own precedent (schema first, endpoint in a dedicated follow-up story). Expect the by-now-familiar retroactive-`GET`-addition pattern (STORY-020/STORY-023/STORY-025) to recur a fourth time once a UI story needs to read session data.

### STORY-027: POST /events/:id/sessions
**Flow:** An Event Manager adds a Session to an Event, choosing type, venue (with cost auto-fill), date range, times, pax, and setup fields.
**Acceptance Criteria:**
- [ ] EventManager-only (403 otherwise).
- [ ] Valid payload creates a Session via STORY-026's schema, returned with its generated sub-id.
- [ ] `end_date < start_date` returns 400 with a clear message (re-confirms schema-level validation is actually reachable through the endpoint, not just in isolated unit tests).
- [ ] `venue_cost` submitted by the client is accepted as-is at creation (it's editable, auto-filled client-side from a venue→cost lookup — this endpoint doesn't own that lookup).
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Adding a Session to an Event that is `Cancelled` at the Event level (decide: blocked or allowed — document the choice, since it affects STORY-029's form).

**Decisions (v1):**
- **Adding a Session to a `Cancelled` Event is allowed, not blocked.** No other write route on Event checks the parent's current `status` before writing (`PATCH /events/:id`, `/accommodation`, `/payment`, `/documents` all ignore it entirely), and FR-EVT-6 already treats `Cancelled` as reversible, not a locked terminal state. Consistent with existing behavior rather than a fresh judgment call. STORY-029's Add Session form needs no "Event is Cancelled" guard as a result.
- **`session_status` is not accepted in the create body at all** — this story's own Flow line lists exactly type/venue/date range/times/pax/setup as what an Event Manager chooses when adding a Session, not status; a new Session always starts `Active` (`sessionSchema`'s own STORY-026 default).
- **`durationDays`/`isMultiDay` ride along in the response**, reusing STORY-026's own pure functions, even though no AC bullet explicitly names them — this follows the same "derived fields always accompany their sub-resource's response" convention already established for `totalDays`/`totalInclGst` (accommodation) and `balance` (payment); STORY-026 built those functions specifically so a consumer like this endpoint could use them.
- **`201`, matching `POST /events`** — a genuine creation, not a `200` like the PATCH sub-resource routes.
- **No Change Log Entry is written** — same "creation isn't logged, only edits are" precedent `POST /events` (the top-level Event create) already established; it never calls `logChange` either.
- **The Session's generated sub-id is the first sub-id any Event sub-resource route has ever needed to expose** — `clientContacts`/`roomLines` rows have never returned theirs. This required retyping `EventAttributes.sessions` from a plain `SessionAttributes[]` to `Types.DocumentArray<SessionAttributes>` (`src/models/event.ts`) so `.create()`/subdocument `_id` access type-check — `clientContacts`/`roomLines` stay plain arrays since nothing has ever needed their own typed subdocument methods.
- **`end_date < start_date` is caught as a Mongoose `ValidationError` on `.save()` and reshaped into a `400 VALIDATION_ERROR`** via a narrow `isInvalidSessionDateRangeError` check (looking for an `.endDate`-suffixed error path), the same pattern `isInvalidEventManagerError` already established for `POST /events` — this endpoint doesn't re-implement the range check itself, it just translates the schema's own rejection into a clean response, which is exactly what this story's own AC is confirming is reachable.

### STORY-028: PATCH/DELETE /events/:id/sessions/:sid
**Flow:** An Event Manager edits a Session's fields (including its date range) or removes it entirely.
**Acceptance Criteria:**
- [ ] Editing `start_date`/`end_date` re-validates `end_date >= start_date` on every update, not just at creation.
- [ ] Each changed field writes a Change Log Entry scoped with the session's identity in the `field` name (e.g. `sessions[Wedding].end_date`) so the Activity tab can distinguish which session changed.
- [ ] Setting `session_status` to `Cancelled` succeeds independently of the parent Event's `status` (a Confirmed Event can have one Cancelled Session).
- [ ] DELETE removes the session from the array; a subsequent GET no longer includes it.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Deleting the only Session an Event has (allowed — an Event with zero Sessions is a valid, if incomplete, draft state; it simply won't appear on the calendar per STORY-034's exclusion rule).

**Decisions (v1):**
- **The handler mutates the live subdocument and calls `.save()`, not a raw `findByIdAndUpdate`/`$set`** — this is what makes "re-validates `end_date >= start_date` on every update" (the AC's own first bullet) actually true: `sessionSchema`'s field-level validator (STORY-026) runs the identical way it does on `POST /events/:id/sessions`, so the same `invalidSessionDateRange`/`isInvalidSessionDateRangeError` pair from that story is reused unchanged rather than rebuilt.
- **The Change Log field-name identity (`sessions[<session_type>].<field>`) is captured from the Session's `sessionType` *before* any of this request's own edits apply** — even when `sessionType` itself is one of the changed fields, every entry in that same request uses the old name, since that's the identity a reader of the Activity tab would recognize at the moment of the edit.
- **The logged field segment stays camelCase (`endDate`), not the story text's own `end_date`** — every Change Log Entry this controller has ever written (`totalEstimatedAmount`, `aadharCard`, etc.) already uses camelCase matching the API's own field names; the AC's snake_case is that document's prose convention (the SRS itself writes every field name that way), not a wire-format instruction. Documented explicitly since it's a deliberate reading of an ambiguous-looking example, not an oversight.
- **`setup` is one field, not nine** — diffed and logged as a single whole-object change, the same convention `roomLines` already set for Accommodation. A caller resends the full `setup` it wants changed.
- **`session_status` is accepted here (unlike `POST /events/:id/sessions`, which deliberately excludes it)** — cancelling an *existing* Session is what this story's AC calls for; a *brand-new* Session still always starts `Active`, per STORY-027's own decision.
- **`DELETE` writes no Change Log Entry** — deleting a whole Session isn't a field-level edit, the same "creation isn't logged, only edits are" precedent `POST /events`/`POST /events/:id/sessions` already established, applied symmetrically to removal. This is a judgment call (FR-LOG-1 doesn't explicitly exempt deletions) worth revisiting if a later story's audit requirements need it.
- **A distinct `SESSION_NOT_FOUND` 404**, not a reused `EVENT_NOT_FOUND` — a stale `:sid` on a real Event is a genuinely different failure than a nonexistent `:id`, and the distinction costs nothing extra to implement.
- **`204` with `c.noBody()` on the response only (not the request)** — ts-rest v3 treats a `DELETE` route with no `body` key at all as its own `AppRouteDeleteNoBody` contract variant, implemented with the same no-body handler shape a `GET` route uses (`AppRouteQueryImplementation`), despite the HTTP method being `DELETE`. Adding an explicit `body: c.noBody()` to match `POST`/`PATCH`'s shape actually breaks this — it re-classifies the route as `AppRouteMutation`, which then requires the mutation handler shape instead. First `DELETE`/first `204` in this API; this quirk is worth remembering the next time one's added.

**Decisions (v1) — aaradhya-api side of STORY-029:**
- Same gap as STORY-020/STORY-023/STORY-025: `GET /events/:id` never returned `sessions`, and no story had added a dedicated GET for it (STORY-027 only added the POST, STORY-028 the PATCH/DELETE). Fixed minimally — `sessions` (via STORY-027's own `toPublicSession`, mapped over the array) added to the already-public `eventResultSchema`/`toPublicEvent()`, additive only, verified against the full existing suite before this frontend work continued. `toPublicSession`/`toPublicSessionSetup`/the `SessionSubdocument` type alias moved above `toPublicEvent` for correct dependency order, same relocation every prior instance of this fix has needed.
- No role-filtering concern here — the SRS doesn't restrict Session visibility by role; every role's own "Sees:" list (§3.2-3.4) includes fields that live on Session (venue, pax, date(s), and Housekeeping's "seating/setup requirements").

### STORY-029: Session Creation/Edit form UI
**Flow:** An Event Manager adds or edits a Session: picks type and venue (cost auto-fills, editable), sets the date range and times, enters pax, and fills the setup fields — all on one mobile-first form.
**Acceptance Criteria:**
- [ ] Date range is presented as two explicit date fields (or a single range picker) — never a single date input; this is the story that most directly exercises the finalized multi-day model, so a reviewer must be able to see two dates on screen, not one.
- [ ] Venue selection auto-fills `venue_cost` from a lookup table; the field remains editable afterward.
- [ ] Setup section renders the seating dropdown, table/chair number inputs, five boolean toggles (stage/buffet/registration desk/VIP/bride-groom seating), and exactly one free-text notes field — no second free-text field anywhere on this screen.
- [ ] Submit calls STORY-027 (create) or STORY-028 (edit) depending on entry point; a 400 (bad date range) surfaces inline on the date fields specifically, not as a generic banner.
**UI:** Session form — type dropdown+custom, venue dropdown+custom with cost auto-fill, start/end date fields, start/end time fields, pax, setup section, notes field.
**Tokens:** `surface`, `line`, `text`, `accent-tint` (active toggle state), `type-title-m`, `type-label-s` (setup toggle labels), `radius-sm`, `space-12`.
**Edge cases:** Picking an end date before the currently-selected start date in the UI (must block or auto-correct before submit, not rely solely on the server 400); toggling a boolean off after turning it on (must actually persist `false`, not omit the field).

### STORY-030: Menu Item master list schema + endpoints
**Flow:** No standalone user flow — this is the shared, org-wide list that STORY-033's item-adding flow searches and appends to. `GET /menu-items?search=` finds existing items; `POST /menu-items` adds a new one.
**Acceptance Criteria:**
- [ ] Schema: `name` (unique), `default_cost_per_plate`.
- [ ] `GET /menu-items?search=paneer` returns case-insensitive substring matches.
- [ ] `POST /menu-items` with a `name` that already exists (case-insensitive) returns 409 rather than creating a duplicate.
- [ ] Any authenticated user (not just EventManager) can search and add — the spec describes this as growing organically from any manager's entry, not gated by role.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Searching with an empty query string (return the full list or a 400 — pick one and document it, don't leave it undefined behavior).

**Decisions (v1):**
- **Empty/omitted `search` returns the full list, not a 400** — this story's own edge case explicitly asks for one or the other; chosen because an empty filter reading as "no filter" is the least surprising behavior for whatever UI eventually calls this (STORY-033), and matches how an empty search box would naturally behave.
- **`name` uniqueness is case-insensitive via a MongoDB collation index (`{ locale: 'en', strength: 2 }`)**, not a shadow lowercase field like `User.username` uses — a Menu Item's `name` is user-facing display text ("Paneer Tikka"), so lowercasing it on write (as `username` does, where display casing doesn't matter) would corrupt what's actually shown. The collation makes only the *uniqueness check* case-insensitive, leaving the stored value exactly as entered.
- **`isDuplicateKeyError` (the E11000-check `POST /users` already used for `USERNAME_TAKEN`) moved to `src/utils/mongo-errors.ts`** — this story is its second real caller, the same "extract once a pattern genuinely repeats" principle already applied to `roundToCurrency`/`computeInclusiveDayCount`.
- **The search term is regex-escaped before building the `$regex` query** — a literal search for `"3.5"` or `"*"` must match that literal substring, not be interpreted as a pattern; this wasn't explicitly asked for by the AC but is basic input-safety hygiene for the first search feature in this API, not scope creep.
- **`default_cost_per_plate` is optional at creation**, defaulting to `0` — same "money field defaults to 0" convention `venueCost`/`pax` already use; a Menu Item added ad hoc mid-Item-entry may not have an agreed cost yet.
- **`created_via` (SRS §4.6's own field) is deliberately not implemented** — outside this story's own AC (`name`/`default_cost_per_plate` only); add it only when a later story's AC actually needs to distinguish ad-hoc-added from pre-seeded entries.
- **New controller (`controllers/menu-items.ts`) follows the newer `AppRouteMutationImplementation`/`AppRouteQueryImplementation` typing style `controllers/events.ts` has used throughout Module 5.2**, not the older `ServerInferRequest`/`ServerInferResponses`-parameter style `controllers/users.ts`/`change-log.ts`/`auth.ts` still use — the more current convention for new files, per no documented rule mandating either but the newest, most-actively-developed file setting the de facto standard.
- **`MenuItem` gets its own top-level Mongoose model/collection**, unlike `Session` (embedded in `Event`) — matches `directory-structure.md`'s own listing (`Event, Session, User, MenuItem, ChangeLogEntry`) and the SRS's own framing ("organization-wide, shared across all Events/Sessions/Items"), which is exactly the shape a standalone collection (not a per-Event embedded array) is for.

### STORY-031: Item schema + total_cost computation
**Flow:** No user flow yet — extends Session with `items[]`, each either a Meal Item (`meal_name`, times, `pax`, `cost_per_plate`, `menu_items[]` refs, computed `total_cost`) or an Event Item (`event_name`, times, `venue`).
**Acceptance Criteria:**
- [ ] `total_cost = pax × cost_per_plate`, unit-tested as a pure function against fixed inputs.
- [ ] Schema enforces `type: "Meal" | "Event"` and requires the correct field set for whichever type is set (an Event Item must not require `cost_per_plate`, and vice versa).
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** `pax = 0` on a Meal Item (valid — `total_cost` computes to 0, e.g. a placeholder row being filled in); `cost_per_plate` as a decimal (must not round incorrectly in the multiplication).

**Decisions (v1):**
- **A flat schema with per-field conditional `required` functions**, not Mongoose's schema-discriminator feature — a shared `requiredForItemType(type)` factory returns the actual `required` function for each of `mealName`/`pax`/`costPerPlate` (`ItemType.Meal`) and `eventName`/`venue` (`ItemType.Event`), rather than five near-identical inline closures. This repo doesn't use discriminators anywhere yet, and a flat shape matches every other cross-field rule already in this file (`sessionSchema`'s own `endDate` validator) rather than introducing a new pattern for just this one case — this is the concrete schema-level enforcement of this story's own AC.
- **`total_cost` (`computeTotalCost`, `src/services/item.ts`) is never stored**, always freshly computed from `pax`/`cost_per_plate` — same "derived, never trusted from the client" convention `totalDays`/`totalInclGst`/`balance`/`durationDays` already established. It reuses `roundToCurrency` (now its third caller), which is exactly what resolves this story's own decimal-rounding edge case — `roundToCurrency(pax * costPerPlate)` avoids the floating-point drift a raw multiplication (`33.33 * 3` → `99.98999999999999` in JS) would otherwise produce.
- **`menuItems` is a plain `Types.ObjectId[]` ref array, no existence validation** — matches the "shape now, enforce later only if a story actually needs it" precedent already set (e.g. `sessions` didn't validate anything beyond its own field-level rules until an endpoint needed to); no AC bullet here asks for reference validation.
- **`created_via`/full `menu_items[]` add-inline UX are out of scope** — this story is schema + the one pure function; STORY-032/033 own the actual endpoints/UI.
- **`Session.items` stays a plain `ItemAttributes[]`, not `Types.DocumentArray<ItemAttributes>`** — unlike `Event.sessions` (retyped in STORY-027 specifically because that story needed `.create()`/typed `_id` access), nothing in this schema-only story reads an Item's own sub-id. Expect the same retyping STORY-027 needed for `sessions` to recur for `items` once STORY-032's endpoint needs it.

### STORY-032: POST/PATCH/DELETE /events/:id/sessions/:sid/items
**Flow:** An Event Manager adds a Meal or Event Item to a Session, searching/adding Menu Items inline for Meal Items via STORY-030.
**Acceptance Criteria:**
- [ ] `total_cost` submitted by the client is ignored; response always reflects server-computed value from STORY-031.
- [ ] Adding a Menu Item that doesn't yet exist in the master list (by name) creates it via STORY-030's POST as part of this flow, then references it — verified by then finding it via `GET /menu-items?search=`.
- [ ] Editing `pax` or `cost_per_plate` on an existing item recomputes `total_cost` and writes a Change Log Entry for each changed field.
- [ ] DELETE removes the item; Session's item list no longer includes it on a subsequent GET.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Referencing a `menu_items[]` id that doesn't exist (400, not a silent no-op).

**Decisions (v1):**
- **`menuItems` accepts a mix of `{ id }` (must already exist) and `{ name }` (found-or-created) entries** — this is the concrete reading of "search existing Menu Items or add new inline" (SRS §4.5) plus this story's own two, seemingly-different-sounding requirements: AC bullet 2 (a not-yet-existing name gets created and referenced) and the edge case (a nonexistent id is a 400, not silently created or skipped). One input shape, two resolution rules, both driven by whichever key the caller sent.
- **Found-or-create leans on the database's own unique index, not a check-then-create sequence** — `MenuItem.create({ name })` is attempted first; only a caught `isDuplicateKeyError` triggers a re-query for the existing case-insensitive match. A naive "search first, create if missing" would race two concurrent callers both adding the same brand-new name.
- **`POST`'s body is a Zod discriminated union on `type`**, not a flat optional-everything shape — cleaner than `itemSchema`'s own per-field `required` functions (STORY-031) for expressing "this bullet's" AC at the request-validation layer specifically, and this repo's first use of `z.discriminatedUnion` (worth remembering as the idiom for "the field set depends on a sibling enum field" at the *contract* layer, distinct from STORY-031's Mongoose-level answer to the same question at the *persistence* layer).
- **`PATCH` offers no `type` field** — converting a Meal Item into an Event Item (or back) isn't something this story's AC asks for.
- **The Change Log field-identity convention extends one layer deeper**: `sessions[<session_type>].items[<item_identity>].<field>`, `item_identity` being `mealName` (falling back to `eventName`), both captured before the request's own edits — directly extending STORY-028's `sessions[<session_type>].<field>` pattern rather than inventing a new one.
- **`Session.items` retyped to `Types.DocumentArray<ItemAttributes>`** — flagged as expected in STORY-031's own Decisions block; this is that recurrence, for the same reason (`.create()`/typed sub-id access) `Event.sessions` needed it in STORY-027.
- **`escapeRegExp` moved to `src/utils/regex.ts`** — this story's own Menu Item find-or-create needed the identical escaping `GET /menu-items?search=` (STORY-030) already used, its second real caller.
- **No Change Log Entry on `POST`/`DELETE`**, only `PATCH` — creation/deletion isn't a field-level edit, applied symmetrically at this third nesting level the same way it already was for `POST /events`, `POST /events/:id/sessions`, and `DELETE /events/:id/sessions/:sid`.

**Decisions (v1) — aaradhya-api side of STORY-033:**
- Same gap as STORY-020/STORY-023/STORY-025/STORY-028: `GET /events/:id` never returned a Session's `items`, and no story had added a dedicated GET for it. Fixed minimally — `items` (via this story's own `toPublicItem`, mapped over the array) added to the already-nested `sessionResultSchema`/`toPublicSession()`, additive only, verified via `npm run typecheck`/`npm run build` (the full Vitest suite could not be run this session — the machine's C: drive was at 0 bytes free, blocking `mongodb-memory-server`'s cache; new tests were still written and are typecheck-clean, pending a real run once disk space is freed). `toPublicItem`/the `ItemSubdocument` type alias moved above `toPublicSession` for correct dependency order, the same relocation every prior instance of this fix has needed.
- No role-filtering concern — the SRS doesn't restrict Item visibility by role any more than it does Session's own fields.

### STORY-033: Items UI within Session form
**Flow:** Within the Session form (STORY-029), an Event Manager adds Meal/Event item cards, searching the shared Menu Item list and adding new items inline when needed.
**Acceptance Criteria:**
- [ ] Meal Item card shows a searchable menu-item field (STORY-030); selecting an existing result attaches it, and submitting a not-found name offers "Add '<name>' as a new menu item" which calls STORY-032's create-and-attach flow.
- [ ] `total_cost` is displayed read-only and always matches the server response — never computed client-side and shown before save.
- [ ] Removing an item card removes it on save (via STORY-032's DELETE), not just from local view state.
**UI:** Item card list (Meal/Event toggle, fields per type, menu-item search+add-new for Meal Items).
**Tokens:** `accent-tint` (selected menu-item chip), `text-faint` (search placeholder), `type-body-m`, tabular-nums for cost fields, `space-8`.
**Edge cases:** Adding the same menu item twice to one Meal Item's `menu_items[]` (decide: de-dupe or allow — document the choice).

### STORY-034: GET /calendar (overlap query)
**Flow:** The calendar screen requests all Sessions active on any date within a given month; this is the endpoint that makes the finalized overlap rule real, not just documented.
**Acceptance Criteria:**
- [ ] `GET /calendar?month=9&year=2026` returns every Active session where `start_date <= monthEnd AND end_date >= monthStart` — verified with a fixture 3-day session (e.g. Sept 12–14) and a query for September, confirming it's returned even though the query itself never names the 13th specifically.
- [ ] A session spanning a month boundary (e.g. Sept 29–Oct 1) is returned by both the September and the October query.
- [ ] A `session_status: "Cancelled"` session is excluded even if its dates fall in range.
- [ ] A session missing `start_date` or `end_date` (an incomplete draft) is excluded.
- [ ] Each returned session includes enough of its parent Event's data (id, name/family type, status) for the calendar to render a chip without a second round-trip per session.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** A month query with zero matching sessions returns `200` with an empty array; two sessions of the same Event both active on the same day (both are returned raw — dedup for display is a client-side rendering concern, handled in STORY-035, not this endpoint).

**Decisions (v1):**
- **`$elemMatch` narrows the Mongo query, then the exact same predicate (`sessionOverlapsMonth`) re-filters each matched Event's own sessions in-memory** — querying `sessionStatus`/`startDate`/`endDate` as three separate top-level conditions on an array of subdocuments lets MongoDB satisfy each condition against a *different* array element (e.g. an Event with one Cancelled session in-range and one unrelated Active session out of range would wrongly match); `$elemMatch` requires all three against the *same* session. The matched Event can still carry other, non-qualifying sessions, so the response is built by re-running the identical test client-side to flatten down to only the sessions that actually qualify — one predicate, shared by both layers, so they can't drift apart.
- **The overlap predicate and the month-boundary math are pure, DB-free functions in `services/session.ts`** (`computeMonthRange`, `sessionOverlapsMonth`), alongside STORY-026's own `computeDurationDays`/`computeIsMultiDay` — matches `docs/handler-patterns.md`'s "services/ holds pure computation... calendar overlap queries" and made the month-boundary/leap-year/missing-dates edge cases unit-testable with no HTTP layer or database.
- **The "session missing `start_date` or `end_date`" edge case is unreachable through the live API today** — both fields are `required` at the schema level since STORY-026, and neither `createSessionBodySchema` nor `updateSessionBodySchema` offers a way to un-set an existing date. The exclusion is still implemented (defensively, in `sessionOverlapsMonth`) and unit-tested directly against the pure function with a hand-built object bypassing Mongoose entirely, rather than skipped as "can't happen" — this story's own AC explicitly lists it, and the Spec Amendment names it as a real edge case the moment a future story ever relaxes that requirement (e.g. a genuine multi-step "save a draft Session" flow).
- **The response reuses `sessionResultSchema` wholesale** (via the existing `toPublicSession`), extended with a slim `event: { id, eventFamilyType, status }` summary rather than a hand-carved leaner shape — the AC's own "without a second round-trip per session" reasoning argues for handing back the richer shape the client already knows how to read from `GET /events`, not a third Session representation to keep in sync. No new field-mapping code needed beyond the event summary itself.
- **`GET /calendar` is `authenticatedOnly`, no role restriction** — matches `GET /events`/`GET /events/:id`/`GET /menu-items`, the only other no-role-check routes; nothing in the SRS restricts calendar visibility by role, and `sessionResultSchema` carries no Payment data (the one field the SRS actually does gate by role).
- **`authenticate`/`requireRole` (`src/middleware/auth.ts`) were retyped from bare `Request`/`RequestHandler` to `Request<any, any, any, any>`/`RequestHandler<any, any, any, any>`** — the first query schema in this codebase to coerce to a non-string type (`getCalendarQuerySchema`'s `z.coerce.number()` for `month`/`year`) made ts-rest's inferred per-route request type (`query: { month: number; year: number }`) structurally incompatible with Express's default `Request<...>` (`query: ParsedQs`, all-string). Every prior query schema stayed string-shaped, so this mismatch never surfaced before now; the `any` is commented in place per `typescript-rules.md` rule 2.

### STORY-035: Calendar Month View UI
**Flow:** A user opens the calendar, sees the current month, and every Session's chip appears on every date it spans — including continuing visually across a week-row break — per the finalized overlap rule.
**Acceptance Criteria:**
- [ ] For a fixture 3-day session, a chip is visibly present on all three of its dates, including when that means two different calendar rows (week 1 showing days 1–2 of the span, week 2 showing day 3).
- [ ] Two sessions of the same Event active on the same day render as one chip for that Event on that day (dedup happens here, per STORY-034's note).
- [ ] Two different Events both active on the same day render as two separate stacked chips.
- [ ] Chip color matches the parent Event's status token.
- [ ] Tapping any chip is wired to navigate to that Event's detail screen (implementation may be a stub pointing at STORY-017's route if that story hasn't landed yet — confirm the route target once it has).
**UI:** Month calendar grid — day-of-week header, day cells with date numbers, event chip strip per day (supporting multi-day visual continuation).
**Tokens:** `surface`, `line`, `text-soft` (day numbers), `text-faint` (out-of-month days), status tokens (chip fills), `type-title-m` (month label), tabular-nums (day numbers).
**Edge cases:** A month with a session spanning in from the previous month and one spanning out to the next (both boundary directions in the same visible grid); five-week vs. six-week months (grid must not assume a fixed row count).

### STORY-036: GET /events/search (date range + filters)
**Flow:** A user searches/filters Events by a date range plus status, venue, event manager, or event type.
**Acceptance Criteria:**
- [ ] Date-range matching uses the same interval-overlap logic as STORY-034 (`sessions.start_date <= to AND sessions.end_date >= from`), not equality.
- [ ] Each additional filter (`status`, `venue`, `event_manager`, `event_type`) narrows results with AND semantics when combined.
- [ ] Omitting the date range entirely returns all Events matching the other filters (date range is optional, not required).
- [ ] Verified with a fixture session spanning a range that only partially overlaps the query range — it must still be returned (overlap, not containment).
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** A filter combination that matches zero Events (200, empty array); `event_type` filtering on a custom (non-enum) value entered at creation time.

**Decisions (v1):**
- **The overlap test is a literal reuse, not a reimplementation**: `services/session.ts`'s `sessionOverlapsMonth` (STORY-034) is now a thin wrapper over a new, more general `sessionOverlapsRange(session, {from?, to?})`, both bounds independently optional — an omitted side means "no bound on that side," not "matches nothing." This story's own AC ("same interval-overlap logic as STORY-034") is made literal by having both stories' pure functions share one implementation rather than two that could drift; STORY-034's own existing tests/behavior are unchanged (verified against the full suite, unaffected).
- **"Same interval-overlap logic as STORY-034" is read as the *full* §4.2 rule, not just its date-math half** — FR-SES-8 explicitly says date-based search "uses the same interval-overlap logic as the calendar, per §4.2," and §4.2's own rule is `session_status == Active AND start_date <= D AND D <= end_date`, not just the date comparison in isolation. So a Cancelled Session (or one missing a date) is excluded from a **venue** search too, not only a date-range search — this is a judgment call, since this story's own AC bullet 1 only names the date-math explicitly, but it's the only reading consistent with FR-SES-8's own cross-reference and with STORY-034's own established behavior for the identical rule.
- **`venue`/`from`/`to` combine into one `$elemMatch`; `status`/`eventManager`/`eventFamilyType` stay plain top-level query keys** — the former three are Session-level fields that must all hold on the *same* Session (the same "don't let Mongo match different conditions against different array elements" reasoning STORY-034's own Decisions block already covers); the latter three are Event-level fields Mongo ANDs automatically as sibling keys, no `$elemMatch` needed.
- **No in-memory re-filter needed, unlike STORY-034** — this endpoint returns whole Events (reusing `toPublicEvent`, same shape as `GET /events`), not flattened Sessions. `$elemMatch`'s own "at least one Session satisfies every condition" semantics are exactly what should make an Event match; there's nothing to flatten down to afterward.
- **The query param is named `eventFamilyType`, not `eventType`** — the AC's own prose shorthand ("event_type") doesn't match any persisted field; the actual field, established since STORY-011, is `eventFamilyType` throughout this codebase and the SRS itself. Naming the param after the real field avoids introducing a second name for the same concept.
- **`GET /events/search` is registered *before* `GET /events/:id` in the contract's own route order** — `createExpressEndpoints` mounts routes in the contract object's key order, and Express matches path patterns in registration order; registering `/events/:id` first would swallow `/events/search` requests (treating `"search"` as an event id) before this handler is ever reached. A dedicated test confirms the literal path wins.
- **`mongoose` v9 renamed `FilterQuery` to `QueryFilter`** — a genuinely new type name, not a typo; discovered via a typecheck error, confirmed by grepping the installed package's own `.d.ts` files. Worth remembering for any future Mongoose-filter-typed code in this codebase.
- **`status`/`venue`/`eventFamilyType` filters are exact matches, not substring/case-insensitive search** — unlike `GET /menu-items?search=`, these are closed-selection *filters* (a dropdown of existing distinct values), not free-text search; a caller filters by one specific already-known value, the same way a `status` filter naturally must (a fixed enum).

### STORY-037: Calendar filter chips UI
**Flow:** On the calendar screen, a user taps a filter chip (All/Tentative/Confirmed/Venue/Event Manager/Event Type) to narrow what's shown, calling STORY-036.
**Acceptance Criteria:**
- [ ] Selecting a status filter re-renders the grid showing only chips matching that status; "All" clears all filters.
- [ ] Venue/Event Manager/Event Type filters open a selectable list sourced from actual existing values (not a hardcoded list), via STORY-036's endpoint or a lightweight distinct-values endpoint if one is needed — flag that dependency if it doesn't exist yet.
- [ ] Active filter chip is visually distinguished (not just color — also a checked/selected state, for accessibility) from inactive ones.
**UI:** Filter chip row above the calendar grid.
**Tokens:** `text`, `surface` (inactive chip), `text` fill / `surface` text (active chip, inverted), `type-label-s`, `radius-lg` (pill shape), `space-8`.
**Edge cases:** Combining two filters that together match nothing (grid renders genuinely empty, with a message, not a loading spinner stuck forever).

**Decisions (v1) — aaradhya-api side of STORY-037:**
- **The flagged "distinct existing values" dependency (AC bullet 2) is resolved without any new distinct-values endpoint for Venue/Event Type** — both are already present on every session `GET /calendar` returns (`venue` via `sessionResultSchema`, `eventFamilyType` via `calendarEventSummarySchema`), so aaradhya-web derives the picker's option lists client-side from the already-fetched month's data (or `GET /events` for the full cross-month distinct set) — the same "fetch once, derive client-side" precedent Menu Items (STORY-030/033) already established at this app's stated scale.
- **A genuinely new, narrowly-scoped endpoint was needed for Event Manager names specifically**: `GET /event-managers` → `{id, name}[]`, `authenticatedOnly`. `GET /users` (which has manager names) is `eventManagerOnly`, but `GET /calendar` — and so this filter chip — has no role restriction; every other role would get a 403 trying to resolve manager names via `GET /users`. The new endpoint deliberately returns only `{id, name}`, not the full `userResultSchema` (no `username`/`active`/timestamps), so it leaks no more than a filter picker needs even to roles that could never call `GET /users` themselves. Includes deactivated managers too — a deactivated manager can still be the `event_manager` on historical Events, which the filter must keep resolving correctly.
- **`eventManager` added to `calendarEventSummarySchema`** (the sixth occurrence of this session's own retroactive-GET-field-addition pattern) — `status`/`venue`/`eventFamilyType` were already present on every calendar-returned session, but `eventManager` wasn't; adding it lets the Event Manager filter, like the other three, filter the already-fetched month's data client-side rather than requiring a second network round-trip (`GET /events/search`) per filter interaction.
- **Filtering itself is NOT wired through `GET /events/search` (STORY-036)**, despite this story's own Flow line saying "calling STORY-036" — with all four filterable fields (status/venue/eventManager/eventFamilyType) now present on every session `GET /calendar` already returns for the visible month, filtering can be done instantly, client-side, against that same already-fetched data, with no additional request per filter click. This is judged to satisfy the Flow's *intent* (the same combined AND-filtering rule, over the same underlying data) while being strictly better UX (no round-trip latency per chip tap) and avoiding a second response shape (`GET /events/search` returns nested Events, not flattened Sessions) that the UI would otherwise have to transform into the same shape `GET /calendar` already provides. `GET /events/search` itself is unaffected and remains available for any future feature that genuinely needs server-side date-range + filter search outside the calendar's own already-fetched-month context.

### STORY-038: Calendar-to-detail navigation
**Flow:** A user taps any calendar chip or an event row anywhere in the app and lands on that exact Event's detail screen.
**Acceptance Criteria:**
- [ ] Tapping a calendar chip (STORY-035) navigates to `/events/:id` and the correct Event renders.
- [ ] Tapping a row in the Event list (STORY-016) does the same.
- [ ] Browser/app back navigation from the detail screen returns to the calendar or list, whichever was the entry point, preserving any active filter state from STORY-037.
**UI:** None new — this story is the navigation wiring between existing screens.
**Tokens:** N/A (routing story, no new visual surface).
**Edge cases:** Deep-linking directly to `/events/:id` without having come from the calendar or list (must still work, per STORY-017's existing acceptance criteria — this story just confirms the two entry points funnel into the same place correctly).

---

## Module: Quotation Generation (SRS §5.4)

### STORY-039: Total Cost Summary computation function
**Flow:** No user flow yet — the pure function that turns an Event's sessions, items, accommodation, and extras into the rollup: venue total, food subtotal, food-with-GST, accommodation total, extras total, grand total.
**Acceptance Criteria:**
- [ ] Given a fixed fixture Event (2 sessions, known venue costs, known item costs, known GST%, known accommodation total, known extras), every output field matches an exact expected number.
- [ ] Function takes no DB dependency — pure input object in, totals object out — independently unit-testable.
- [ ] GST is applied only to the food subtotal, per the SRS's documented assumption (A9) — verified by a fixture where venue/accommodation/extras are non-zero and confirming GST doesn't touch them.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** An Event with zero sessions (all totals compute to 0, not `NaN` or an error); a GST rate of 0% (grand total should just equal the pre-GST food subtotal plus everything else, sanity-checking the formula isn't hardcoded to a nonzero rate).

**Decisions (v1):**
- `computeTotalCostSummary` lives in `src/services/quotation.ts`, matching `accommodation.ts`/`item.ts`'s established pure-function shape: named `interface` inputs, a `gstRatePercent: number = config.gstRatePercent` defaultable trailing param (same convention as `computeRoomLineTotalInclGst`/`computeTotalCharges`), every money output run through `roundToCurrency`.
- "Food subtotal" = sum of `computeTotalCost` (from `item.ts`) over every Item across every Session **where `type === ItemType.Meal`** — confirmed against SRS §4.5's own table, which lists `total_cost` only for Meal Items; Event Items (`eventName`/`venue`/times, no `pax`/`costPerPlate`) are architecturally incapable of contributing a cost and are filtered out rather than passed to `computeTotalCost`.
- GST (SRS Assumption A9) is applied only to the food subtotal to produce `foodTotalInclGst` — venue costs, Accommodation's `total_charges` (already GST-inclusive from its own separate `computeTotalCharges` call, STORY-018), and extras all pass through untaxed by this function.
- `extras` (decoration/photographer/bhatji, SRS FR-QUO-2) is accepted as a plain input object rather than read off `EventAttributes`, since STORY-040 (the PATCH endpoint that will actually store these) hasn't been built yet; each of the three fields is optional and defaults to 0, satisfying STORY-041's future "before any Session/Accommodation/extras data exists" all-zero edge case.
- Output is exactly the 6 fields this story's AC lists (`venueTotal`, `foodSubtotal`, `foodTotalInclGst`, `accommodationTotal`, `extrasTotal`, `grandTotal`) — no per-extra breakdown or GST-amount-only field added, since nothing in this story's AC asks for them; STORY-040/041 can extend the shape when they actually need to.

### STORY-040: PATCH /events/:id/extras
**Flow:** An Event Manager enters the three optional simple line-item amounts — Decoration, Photographer, Bhatji — that feed into the Total Cost Summary.
**Acceptance Criteria:**
- [ ] Exactly three fields accepted (`decoration`, `photographer`, `bhatji`); any other key in the payload is ignored or rejected (pick one, document it).
- [ ] Each is a plain numeric amount, no computation applied to it.
- [ ] EventManager-only (403 otherwise); each changed field writes a Change Log Entry.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Negative amount input (reject — these are costs, not adjustments, in v1's model).

**Decisions (v1):**
- Unknown keys are **rejected**, not ignored: `updateEventExtrasBodySchema` is `.strict()`, matching STORY-024's `documentsChecklistFieldsSchema` precedent (also a small, closed, non-extensible field set) rather than `payment`'s default-strip behavior — a caller mistyping `decoration` shouldn't get a silent 200 no-op.
- `extras` is a new, always-instantiated `EventAttributes` sub-object (`ExtrasAttributes { decoration, photographer, bhatji }`, each defaulting to 0), the same "always exists, fields default to 0" shape `payment` uses — not `accommodation`'s "may be entirely absent" shape — so a brand-new Event reads all three as 0, satisfying STORY-041's future all-zero-summary edge case without any extra null-handling.
- `buildExtrasUpdate` uses three explicit `!==` comparisons (`buildPaymentUpdate`'s shape), not a loop over a shared keys array (`buildDocumentsChecklistUpdate`'s shape) — three fields is no more repetitive than threading a keys array would be.
- Not wired into `GET /events/:id`'s `eventResultSchema` yet — this story's own "UI: None" line means nothing reads it back yet; deferred to whichever future story first needs to, following the same `accommodation`(STORY-020)/`payment`(STORY-023)/`documentsChecklist`(STORY-025) recurrence.
- Field names (`decoration`/`photographer`/`bhatji`) match STORY-039's `QuotationExtrasInput` exactly, so STORY-041 can pass `event.extras` straight into `computeTotalCostSummary` with no field-mapping layer.

### STORY-041: GET /events/:id/quotation-summary
**Flow:** The Quotation Preview and Event Detail screens request the live rollup for one Event, combining STORY-039's function with that Event's actual session/accommodation/extras data.
**Acceptance Criteria:**
- [ ] Returns every field STORY-039 produces, computed from the Event's current live data (not cached from an earlier request).
- [ ] Changing any input (e.g. editing a session's `venue_cost` via STORY-028) and calling this endpoint again reflects the change immediately — confirms there is no separate stored "quotation" object per Assumption A2.
- [ ] Any authenticated role can call this (not EventManager-only — F&B/Housekeeping/Reception may need partial visibility into totals later, and restricting it here would block that without adding value now; document this as the deliberate choice).
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Calling this before any Session or Accommodation data exists on a brand-new Event (all-zero summary, not an error).

**Decisions (v1):**
- `authenticatedOnly`, not `eventManagerOnly` — the AC's own explicit reasoning (F&B/Housekeeping/Reception may need partial visibility later; restricting now blocks that for no present benefit).
- **A Cancelled Session's venue cost and item costs are excluded from the rollup.** The SRS is silent on this specifically for §5.4/FR-QUO-2 (it says "per-Session"/"across Sessions" with no status qualifier), and the one existing Cancelled-exclusion precedent (`sessionOverlapsRange`) is explicitly scoped in its own comment to calendar/search visibility, not cost accounting — confirmed via research before implementing, since this genuinely wasn't settled anywhere. Judgment call: a cancelled Session isn't actually happening, so the client shouldn't be charged for its venue/food, consistent with how Cancelled is treated as "not part of what's scheduled" everywhere else it already appears (calendar, date search). Verified with a dedicated test (cancel a Session with a Meal item, confirm `venueTotal`/`foodSubtotal` both drop to 0).
- The controller builds `QuotationSessionInput[]`/`accommodationTotalCharges`/`extras` straight from the live `EventDocument` on every call and passes them into STORY-039's `computeTotalCostSummary` unchanged — no caching, no stored quotation object, satisfying AC-2 (Assumption A2) by construction rather than by an explicit invalidation mechanism.
- `event.extras` is passed straight through with no mapping layer, confirming STORY-040's own decision to name its three fields identically to `QuotationExtrasInput`.
- Response schema (`quotationSummaryResultSchema`) mirrors `computeTotalCostSummary`'s output shape field-for-field rather than redeclaring or renaming anything, so the two can never drift silently out of sync in a way TypeScript wouldn't catch.

### STORY-042: Total Cost Summary UI panel
**Flow:** An Event Manager (or anyone viewing the Overview tab) sees the live rollup, and edits the three extras fields inline.
**Acceptance Criteria:**
- [ ] Every line except Decoration/Photographer/Bhatji renders as read-only text — no input control exists for venue total, food subtotal, GST, or accommodation total anywhere on this panel.
- [ ] Editing an extras field calls STORY-040 and the Grand Total visibly updates on save, sourced from a fresh STORY-041 call (not recalculated client-side).
- [ ] Grand Total is visually the most prominent number on the panel (largest type / display font per the theme).
**UI:** Total Cost Summary panel — line items, three editable extras fields, emphasized grand total.
**Tokens:** `surface-2`, `type-display` (grand total, Fraunces), `type-body-m` (line items), `accent-deep` (grand total color), tabular-nums throughout, `space-12`.
**Edge cases:** A grand total large enough to need thousands-grouping (must render correctly, not just as a raw digit string).

**Decisions (v1) — aaradhya-api side of STORY-042:**
- `eventResultSchema` now includes `extras` — the sixth occurrence of the retroactive-field-addition pattern (`accommodation`/`payment`/`documentsChecklist`/`sessions`/`items` before it): the panel needs current `decoration`/`photographer`/`bhatji` values to prefill its three editable fields on first render, and STORY-040 only ever added the PATCH, never a way to read current values back on the parent Event. Reuses STORY-040's own `toPublicExtras`.
- No other backend change needed — `GET /events/:id/quotation-summary` (STORY-041) already returns everything else the panel displays.

### STORY-043: Quotation PDF generation endpoint
**Flow:** An Event Manager requests the client-facing PDF; the server renders the Aaradhya template (Client Details → Event Details per Session → Accommodation → F&B per Session → Total Cost Summary → static T&C/Documents/Bank footer) from the Event's current live data.
**Acceptance Criteria:**
- [ ] `GET /events/:id/quotation.pdf` returns `Content-Type: application/pdf` and a non-empty byte stream.
- [ ] PDF text content (verified via a PDF text-extraction step in the test) includes the Event's client names, at least one session's venue, and the computed grand total from STORY-039/041 — confirming the render actually pulls live data rather than a hardcoded template.
- [ ] Regenerating after an edit (e.g. changing `pax` on a session) produces a PDF with the updated numbers — no caching of a stale render.
- [ ] The static T&C/Documents/Bank footer text is present and identical across two different Events' PDFs (confirms it's the shared static block, not per-event content).
**UI:** None (backend only).
**Tokens:** N/A (backend only — the PDF has its own print-oriented styling, out of scope for the web theme tokens; flag as a follow-up whether the PDF should visually echo the theme, since the spec doesn't currently require it).
**Edge cases:** An Event with a Session that has zero Items (PDF must render that Session's section without a broken/empty table); very long custom venue or menu-item names (must wrap, not overflow the page).

**Decisions (v1):**
- Asked the user for the real static footer content before implementing — no repo doc anywhere (SRS, Collections/API doc, Tech Architecture) contains actual Terms & Conditions wording or bank account details, only the structural description "static T&C/Documents/Bank footer." The user supplied the real text directly; it's hard-coded verbatim in `src/services/quotation-pdf.ts` (not a placeholder), with one substitution: "Rs." instead of "₹" (pdfkit's default font has no Rupee glyph and silently corrupts it rather than erroring).
- **Rendering library: `pdfkit`**, not the Playwright direction `docs/Aaradhya_Tech_Architecture.md`/`docs/Aaradhya_Quotation_PDF_Strategy.md` propose. Those two docs are open proposals — never merged into the SRS, the story backlog's own AC, or `docs/Aaradhya_Collections_and_API.md`, all of which describe (and this story implements) a pure live-render-and-return endpoint. `pdfkit` needs no headless-browser runtime for a text/line-based document like this one; `pdf-parse` (dev-only) does the AC's own "PDF text-extraction step" for tests.
- **No persistence** — every call renders fresh from the live Event and returns the bytes; nothing is written to disk/S3/R2. This is Assumption A2 taken literally ("not archived/versioned"), not an oversight — the Strategy doc's persistence direction is a real, separate scope addition if the business ever wants it, not something this story silently adopted or silently skipped without checking.
- **`eventManagerOnly`**, not `authenticatedOnly` like `GET /events/:id/quotation-summary`. This story's own AC never names a role restriction, so it's a judgment call: the PDF carries the same Payment-Record-adjacent financial detail (Grand Total, bank account number) the SRS scopes to Event Manager visibility elsewhere.
- Section order and content follow SRS §4.7 literally: Event Details per Session lists each session's own schedule plus any Event-type Items (Muhurta, Cake Cutting — no cost fields, so they read naturally as schedule points); F&B per Session is a second pass over the same Sessions listing only Meal Items (the only Item type with a cost). A Cancelled Session is excluded from both passes, and from Accommodation/Total Cost Summary too — same reasoning STORY-041 already established for the rollup, applied consistently to the whole document rather than leaving an inconsistency where a session's cost isn't charged but it still appears as a real scheduled item.
- `computeEventQuotationSummary` extracted as a shared helper in `src/controllers/events.ts` — this handler is the second real caller of the exact input-assembly `getQuotationSummary` already had, so the construction moved out rather than being duplicated a second time.

### STORY-044: "Generate Quotation PDF" button
**Flow:** On the Event Detail screen, an Event Manager taps "Generate Quotation PDF," triggering STORY-043 and downloading/opening the result.
**Acceptance Criteria:**
- [ ] Button is visible only on the Event Manager's view of the Overview tab (matches STORY-052's later per-role tab gating — flag for re-check once that story lands).
- [ ] Tapping it calls STORY-043 and the resulting PDF opens or downloads without a full page navigation away from the Event.
- [ ] Button shows a loading state while the request is in flight and re-enables on completion or error.
- [ ] A failed generation (e.g. server error) surfaces an inline error, not a silent failure.
**UI:** Primary button on the Event Detail Overview tab.
**Tokens:** `accent` (button fill), `type-label-s` (button text), `radius-sm`, `space-16` (button padding).
**Edge cases:** Double-tapping the button while a generation is already in flight (must not fire two requests).

### STORY-045: Quotation Preview screen UI
**Flow:** Before generating the PDF, an Event Manager can open an in-app preview mirroring the same data — a mobile screen, not the PDF itself — to sanity-check the numbers.
**Acceptance Criteria:**
- [ ] Renders Client Details, per-Session details, Accommodation, and the Total Cost Summary (reusing STORY-042's panel) from STORY-041's live endpoint.
- [ ] Uses the display typeface prominently for the header, per the theme's rule that Fraunces appears only where the app is "speaking as Aaradhya" — this is one of those places.
- [ ] Every number on this screen matches the PDF's numbers exactly for the same Event at the same point in time (cross-check against STORY-043 in the same test run).
- [ ] A "Share PDF" action on this screen triggers the same flow as STORY-044.
**UI:** Quotation Preview screen — header (crest/wordmark, event name, dates), Client Details, per-session list, accommodation summary, Total Cost Summary panel, Share action.
**Tokens:** `type-display` (header), `surface`, `line`, `type-body-m`, tabular-nums, `accent-deep` (grand total).
**Edge cases:** An Event with no Accommodation entered at all (section should render as "None" or be omitted cleanly, not show a broken empty table).

---

## Module: Role-Based Dashboards & Views (SRS §5.5)

### STORY-046: Role-based field-filtering serializer
**Flow:** No new user-facing screen — wraps the existing `GET /events/:id` (STORY-013) so the fields returned depend on `req.user.role`, per the SRS §3 visibility table.
**Acceptance Criteria:**
- [ ] Calling the endpoint as `EventManager` returns every field (no regression from STORY-013's current behavior).
- [ ] Calling as `FnBHead` returns event name, date(s), POC name/contact, venue, pax, menu/meal timing/food instructions — and the response body genuinely omits `payment` and non-food `setup` fields (not just hides them client-side — verify by inspecting the raw JSON).
- [ ] Calling as `Housekeeping` omits `payment` and menu/item fields, includes setup/rooms.
- [ ] Calling as `Reception` omits `payment` and menu fields, includes client names, rooms, check-in/out.
- [ ] The same fixture Event, requested with four different role tokens in the same test run, produces four different (and independently asserted) response shapes.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** A field that's borderline between two roles' allow-lists (e.g. `venue` — confirm it's genuinely visible to all four roles per the SRS table, not accidentally filtered for one).

**Decisions (v1):**
- **Asked the user how far "no financial data" should extend before implementing.** The SRS explicitly hides only the `payment` object, and predates `extras`/per-session `venueCost`/room `tariff` entirely (never named anywhere). Chosen: hide **all** money figures for every non-EventManager role — `payment`, `extras`, each Session's `venueCost`, each Item's `costPerPlate`/`totalCost`, and each Accommodation room line's `tariff`/`totalInclGst` plus the block's own `totalCharges`. This is the strictest of three options offered, not the SRS's literal minimum.
- **"Event name"** (SRS §3.2-3.4's own phrasing) has no literal model field — mapped to the always-visible identification fields (`id`/`eventId`/`eventFamilyType`/`status`), since no SRS "Does not see" list ever restricts these and stripping them would make the endpoint unusable for the personas it's meant to serve.
- **`clientContacts`**: F&B (§3.2 "POC name/contact") and Reception (§3.4 "Bride/Groom names") only — not Housekeeping, whose §3.3 list never mentions POC/client names at all, and this story's own AC bullet for Housekeeping doesn't either.
- **`accommodation`**: Housekeeping and Reception only ("rooms booked" — §3.3/§3.4); not F&B, whose §3.2 list never mentions rooms. When visible, the whole block is included except the money sub-fields named above — no finer per-leaf redaction beyond that (e.g. `roomType`/`occupancy`/`noOfRooms`/`checkIn`/`checkOut`/`totalDays`/`totalOccupancy` all stay, since neither the SRS nor this story's AC asks for anything narrower).
- **`setup`**: Housekeeping only ("seating/setup requirements, hall setup" — §3.3). F&B's own "Does not see... non-food setup details" is read as excluding the *whole* `setup` object, since none of `SessionSetupAttributes`' fields (seating/tableCount/chairCount/stage/buffet/registrationDesk/vipSeating/brideGroomSeating/notes) are specifically food-related enough to carve out a "food setup" subset without inventing a distinction the model doesn't actually draw. Reception's §3.4 never mentions setup either.
- **`items`**: F&B sees Meal Items only (§3.2's "menu... meal timing... food instructions") — Event Items (Muhurta, Cake Cutting) aren't menu content, same reasoning STORY-043's own PDF renderer already applied to its "F&B per Session" section. Housekeeping and Reception get no items at all (both AC bullets say "omits... menu/item fields" without qualification).
- **`documentsChecklist`**: every role, unchanged — the SRS never restricts it, and STORY-024's own Decisions already settled this exact question ("No role-filtering concern here unlike payment").
- **Mechanism**: `src/services/event-visibility.ts`'s `filterEventForRole` is a pure function operating on `toPublicEvent`'s already-built plain object, returning the same shape with omitted fields set to `undefined` (not deleted, not nulled) — `JSON.stringify`/Express's `res.json` drop an `undefined`-valued key from the wire response entirely, which is what "genuinely omits the field, verify the raw JSON" requires; Zod's own `.optional()` on the contract's new `filteredEventResultSchema` accepts `undefined` the same way. Kept as a standalone, reusable function (not inlined into `getEvent`) since STORY-047 explicitly reuses it "via STORY-046" for a different endpoint.
- **Contract**: a new `filteredEventResultSchema` (built via `.extend()` on `eventResultSchema` and its nested schemas) is used only for `GET /events/:id`'s own response — `createEvent`/`updateEvent`/`updateEventAccommodation`/etc. all stay `eventManagerOnly` and keep using the original, fully-required `eventResultSchema` unchanged, so this change has zero ripple on any route that was never role-variable to begin with.
- **Out of scope, deliberately**: `GET /events` (`listEvents`) is untouched — this story's own Flow explicitly scopes to "wraps the existing `GET /events/:id`," and STORY-047's own dashboard reuse targets "the upcoming-events list," not this endpoint. A parallel gap remains in `GET /events` until/unless a future story extends this same filtering there.
- **Frontend compatibility flag**: aaradhya-web's `TotalCostSummaryPanel` (rendered unconditionally on the Overview tab for every role) currently reads `event.extras.decoration` unconditionally, and `RoomsTab`'s read-only footer reads `event.accommodation.totalCharges` unconditionally — both fields this change can now genuinely omit for non-EventManager viewers. Since this story is backend-only by its own "UI: None" line, the frontend isn't touched here, but a non-EventManager viewer hitting the Overview tab today would hit a runtime error against these now-role-filtered fields once the frontend actually points at this endpoint's real (not currently role-filtered) behavior. Flagging this explicitly as a follow-up audit item for whichever story next touches the frontend's Overview tab.
### STORY-047: GET /dashboard (role-filtered aggregate)
**Flow:** Any user opens their dashboard; the endpoint returns counts (today's events, upcoming, tentative, confirmed) and an upcoming-events list, filtered to that role's permitted fields via STORY-046.
**Acceptance Criteria:**
- [ ] Counts are computed from real Event/Session data (today's events = at least one Active session overlapping today's date, per the same overlap logic as STORY-034), not a naive `status` count alone.
- [ ] The upcoming-events list applies STORY-046's field filtering per the caller's role.
- [ ] Called by four different role tokens against the same fixture data, each gets correctly scoped fields in the list portion; counts themselves are identical across roles (counts aren't sensitive data, only per-event field detail is).
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** "Today" boundary — an event whose session ends exactly at midnight (confirm which side of the boundary it falls on, and that this matches STORY-034's overlap semantics for consistency).

**Decisions (v1):**
- **"Today" boundary resolved via `sessionOverlapsRange(session, { from: today, to: today })`** — the exact same function STORY-034's calendar/STORY-036's search already use, with a single-day range (`from === to`). Since every date in this domain is stored as a UTC-midnight instant representing a whole calendar day (never a literal end-of-day timestamp), a session whose `endDate` equals today's UTC midnight passes the `>=` check inclusively — same side of the boundary the calendar already resolved this to, confirmed by a dedicated test (a session from yesterday to today counts as "today", per this exact inclusive semantics).
- **"Upcoming" is genuinely undefined anywhere** — the SRS (FR-ROLE-2) and every later story only ever name it, never define its range/limit/sort. Checked before implementing. Defined here as: an Active Session whose `startDate` is strictly after today (hasn't started yet) — deliberately a plain date comparison, not `sessionOverlapsRange`'s own open-ended-range shape (`{from: tomorrow}` with no `to` bound), because that would also match a Session already underway today that merely extends into the future, double-counting it into both "today" and "upcoming" buckets. The plain comparison keeps the two buckets disjoint for the common case.
- **Cancelled and Completed Events are excluded from both "today" and "upcoming" entirely** (counts and list) — not asked for explicitly anywhere, but the alternative (a Cancelled Event's stale Active Session still surfacing as "happening today") seemed clearly wrong for a dashboard whose whole purpose is showing what's actually live. Verified with a dedicated test. Status-based counts (`tentative`/`confirmed`) are unaffected either way, since Cancelled/Completed were never going to match those anyway.
- **No limit on the upcoming-events list** — nothing in the SRS or this story's AC asks for pagination or a cutoff window (e.g. "next 30 days"), so none was invented.
- **List row shape**: `{id, eventId, eventFamilyType, status, date, venue, pax, clientContacts?}` — maps FR-ROLE-2's named columns ("date, event, client, venue, pax, status") onto existing field names/shapes rather than inventing new ones (`event` → `eventFamilyType`/`eventId`, matching STORY-046's own "event name" mapping decision; `client` → the same `clientContacts` array shape `eventResultSchema` already uses everywhere, not a flattened display string nothing else in this codebase produces). `date`/`venue`/`pax` come from the Event's own **soonest upcoming Session** — verified by a dedicated test when an Event has more than one qualifying Session.
- **Field filtering is literally STORY-046's `filterEventForRole`, not a reimplementation** — each row is built by running the Event's own `toPublicEvent()` output through the exact same function `GET /events/:id` uses, then picking the FR-ROLE-2 columns out of the *already-filtered* result. `clientContacts` on a row is present/absent exactly as STORY-046 already decided per role (F&B/Reception yes, Housekeeping no) — genuinely absent from the raw JSON, not null, same convention.
- **`toPublicEvent` exported from `controllers/events.ts`** so `controllers/dashboard.ts` can reuse it directly — the alternative (duplicating the whole `toPublicEvent`/`toPublicSession`/`toPublicItem` projection chain in a second file) would drift from the original the moment either changed.
- **`GET /dashboard`, no role restriction** (`authenticatedOnly`) — this story's own Flow ("Any user opens their dashboard") is unambiguous, matching `GET /calendar`'s identical precedent.
### STORY-048: Event Manager Dashboard UI
**Flow:** An Event Manager logs in and lands on their dashboard: aggregate counts plus the upcoming-events table.
**Acceptance Criteria:**
- [ ] Renders the four count tiles (today/upcoming/tentative/confirmed) from STORY-047.
- [ ] Renders the upcoming-events table with date, event, client, venue, pax, status — matching the SRS §6 mock layout.
- [ ] This is the screen a successful STORY-004 login now actually routes to (close the placeholder-routing gap from that earlier story).
**UI:** Event Manager Dashboard — count tiles row, upcoming-events table.
**Tokens:** `surface`, `accent-tint` (count tile emphasis), `type-display` or `type-title-l` (count numbers), status tokens (table status column), tabular-nums.
**Edge cases:** Zero upcoming events (table renders an empty state, tiles still render with `0`, not blank).

### STORY-049: F&B Head Dashboard UI
**Flow:** An F&B Head logs in and sees the same dashboard structure as STORY-048, restricted to their permitted fields.
**Acceptance Criteria:**
- [ ] Reuses STORY-048's layout component, fed by STORY-047 called with an F&B Head token.
- [ ] The rendered table has no payment column and no non-food setup column — verified by DOM inspection, not just "the design doesn't show it."
- [ ] Menu/meal-timing information is visible where the layout has room for it (may extend the table with an extra column vs. the Event Manager view, if that's how the F&B-specific detail is surfaced — decide and document).
**UI:** F&B Head Dashboard (shared layout, role-filtered data).
**Tokens:** Same as STORY-048.
**Edge cases:** An event with a Cancelled session that would otherwise have been an F&B Head's only reason to see that event (confirm it's excluded per STORY-034/047's Active-only rule, consistently).

**Decisions (v1) — aaradhya-api side of STORY-049:**
- `dashboardUpcomingEventResultSchema` gains a new `meals` field — the "menu/meal-timing information... decide and document" bullet has no existing backend shape to reuse (STORY-047's dashboard row never carried anything beyond `date/venue/pax/status/clientContacts`), so this is a genuine backend addition, not just a frontend reuse of an existing field like STORY-049's other two AC bullets (no-payment/no-setup-column are already trivially true — those fields were never on the dashboard row for any role).
- **Scoped to `{mealName, startTime, endTime}` per Meal Item on the soonest upcoming Session — not each Meal's resolved `menuItems` dish names.** Those ids resolve to actual dish names only via a separate `GET /menu-items` join (see `event-detail`'s own `menuItemsById` lookup on the frontend) — pulling that resolution into a dashboard summary row is a scope well beyond what "meal-timing information visible" asks for literally. If a future story wants the actual dish list on the dashboard, that's a new, explicit AC.
- `meals` is gated to `role === Role.FnBHead` specifically in the controller, not "whichever role happens to have a filtered `items` array." `filterEventForRole` leaves EventManager's own session `items` completely unfiltered (both Meal and Event Items, per its own "everything, unchanged" rule) — without this explicit gate, EventManager's dashboard row would also carry a `meals` key, contradicting the AC's own framing of this as an F&B-Head-only "extra column vs. the Event Manager view."
- Present as `[]` (not omitted) when F&B Head can see it but the soonest session has no Meal Items yet — same "role can see the field, but its content is empty" distinction `clientContacts` already draws elsewhere, kept consistent rather than collapsing "no data" and "not allowed to see it" into the same absent-key signal.
- Cancelled-session exclusion needed no new logic — `isUpcomingSession`'s existing `SessionStatus.Active` check (STORY-047) already applies before any role sees the event at all; added a dedicated test with an F&B Head token to confirm this holds for this role specifically, per the AC's own edge case.

### STORY-050: Housekeeping Head Dashboard UI
**Flow:** Same pattern as STORY-049, for the Housekeeping role.
**Acceptance Criteria:**
- [ ] Reuses STORY-048's layout, fed by STORY-047 with a Housekeeping token.
- [ ] No payment column, no menu column; setup/rooms detail visible.
**UI:** Housekeeping Dashboard (shared layout, role-filtered data).
**Tokens:** Same as STORY-048.
**Edge cases:** Same boundary/Cancelled-session case as STORY-049, re-verified for this role.

**Decisions (v1) — aaradhya-api side of STORY-050:**
- Two new dashboard-row fields, both reusing existing shapes rather than inventing new ones (same precedent as STORY-047's `clientContacts` reuse): `setup` reuses `sessionSetupResultSchema` verbatim for the row's soonest upcoming Session (now exported from `event.ts` for this); `accommodation` reuses `filteredAccommodationResultSchema` verbatim, the Event-level rooms-booked detail with money fields already stripped (`tariff`/`totalInclGst`/`totalCharges`), matching SRS §3.3's "seating/setup requirements, hall setup, rooms booked."
- `accommodation` is gated to Housekeeping **and** Reception (`filterEventForRole`'s own `canSeeAccommodation`), not Housekeeping alone — this directly satisfies STORY-051's own "rooms, check-in/out visible" bullet too, so no further backend change is needed when that story lands.
- Both fields are gated by an explicit `role ===` check in the controller, the same way `meals` (STORY-049) had to be — `filterEventForRole` leaves `setup`/`accommodation` unconditionally present for EventManager (its own "everything, unchanged" branch), so reading the already-filtered value directly would leak both onto the Event Manager's dashboard row, contradicting this story's own "extra column vs. the Event Manager view" framing.
- Cancelled-session exclusion needed no new logic (same as STORY-049) — re-verified with a dedicated Housekeeping-token test.

### STORY-051: Reception Desk Dashboard UI
**Flow:** Same pattern again, for Reception.
**Acceptance Criteria:**
- [ ] Reuses STORY-048's layout, fed by STORY-047 with a Reception token.
- [ ] No payment column, no menu column; Bride/Groom names, rooms, check-in/out visible.
**UI:** Reception Dashboard (shared layout, role-filtered data).
**Tokens:** Same as STORY-048.
**Edge cases:** Same as STORY-049/050.

**Decisions (v1) — aaradhya-api side of STORY-051:**
- **No backend code change needed** — `accommodation` (STORY-050) was already gated to Housekeeping **and** Reception (`filterEventForRole`'s own `canSeeAccommodation`), already carries `checkIn`/`checkOut` (unfiltered — they're dates, not money, so `filteredAccommodationResultSchema` never strips them), and `clientContacts` (STORY-046) was already gated to F&B **and** Reception. Every field this story's AC names was already on the wire for a Reception token before this story started; only new tests were added to prove it explicitly for this role rather than relying on STORY-046/047/050's own generic (not-Reception-specific) coverage.
- `checkIn`/`checkOut` serialize as full ISO datetime strings (`Date.prototype.toISOString()`), not plain `YYYY-MM-DD` — confirmed by test, since `accommodationResultSchema` types them `z.date()` and nothing in this path truncates to a date-only string before `res.json` serializes it. Worth noting for aaradhya-web's own STORY-051 formatting (it already has a date-truncating helper, `toDateInputValue`, used elsewhere on this same dashboard row's own `date` field).

### STORY-052: Event Detail tab-visibility gating by role
**Flow:** A non-Event-Manager role opens an Event Detail screen and sees only their relevant tab(s), pre-filtered; the Event Manager still sees all seven tabs built across this backlog (Overview, Client, Sessions & Menu, Setup, Rooms, Payments, Documents).
**Acceptance Criteria:**
- [ ] F&B Head sees only Overview (filtered) and Sessions & Menu; Payments and Setup tabs are absent from the DOM, not just unclickable.
- [ ] Housekeeping sees Overview (filtered), Setup, and Rooms; Payments and Sessions & Menu (the menu part specifically) are absent.
- [ ] Reception sees Overview (filtered), Client, and Rooms; Payments and Sessions & Menu are absent.
- [ ] Event Manager's view is unchanged by this story (regression check against STORY-017 and every tab story since).
- [ ] Every earlier "verify this once role gating lands" flag from STORY-010, STORY-023, and STORY-044 is re-checked here and confirmed correct.
**UI:** Tab strip visibility logic on the existing Event Detail shell — no new visual surface, but real behavioral change.
**Tokens:** N/A (reuses existing tab tokens from STORY-017).
**Edge cases:** A role navigating directly to a tab URL they shouldn't see (e.g. an F&B Head hitting `/events/:id/payments` directly) — must redirect or 403-render, not just hide the tab button while leaving the route open.

---

# Stories 053+: Mobile-First UI Redesign, Event Creation Flow & Exact-Match Quotation Rebuild

**Source:** `Aaradhya_SRS_v1.1.md` v1.2 (§4.6, §4.7, §5.2, §5.4, §5.8, §6.7–6.9) and the finalized Figma prototype (file "Aaradhya Event Management App" — pages Foundations, Prototype). These stories close every gap between the current build and both: (a) the new Figma screens, and (b) the two reference quotation PDFs (`example_quatation_1.pdf` — Sneha & Nishant wedding; `example_quatation_2.pdf` — Saish Rege wedding), which are treated throughout as literal fixtures, not illustrations. Every quotation-generation story below was written by reproducing both PDFs' numbers by hand first (see SRS §5.4 FR-QUO-9's arithmetic note) — the acceptance criteria encode what actually makes those totals come out right, not an approximation of the layout.

**Build order for this batch:** Navigation shell (053) before every other UI story, since all of them render inside it → Dashboard/Events/Users responsive fixes (054–056) → global input consistency (057) → Calendar (058–060) → Admin/Configuration (061–062, a dependency of the wizard's dropdowns) → New Event wizard (063–068) → Quotation exact-match rebuild (069–075, depends on the wizard producing real data to render). Quotation Snapshot persistence (074) and the fidelity test (075) close the batch.

## Module: UI Redesign — Navigation, Dashboard & Responsive Layout (SRS §6.7–6.9, §5.5)

### STORY-053: Global navigation shell — side drawer (desktop) + full-screen mobile nav
**Flow:** Every authenticated screen currently renders `DashboardNav` — a plain row of text-styled buttons above the page content, sized the same on every viewport. This story replaces it everywhere with the Figma-finalized navigation shell: a persistent dark side drawer on desktop/laptop widths, and a hamburger-triggered full-screen nav on mobile widths, matching the dark charcoal treatment already locked into the design tokens.
**Acceptance Criteria:**
- [ ] A new `AppShell` layout component wraps every authenticated route (Dashboard, Events, Calendar, New Event, User Management, Settings, Event Detail) — replacing each page's standalone `DashboardNav` usage. `DashboardNav` itself is deleted once nothing references it.
- [ ] At desktop/laptop widths (≥900px, matching MUI's `md` breakpoint), `AppShell` renders a persistent, non-collapsible left rail, 280px wide, filled `drawer-bg`, containing: the Aaradhya logo mark + wordmark (in `drawer-text`) at the top; nav rows for Dashboard, Events, Calendar, New Event, User Management, Settings (role-gated per below); a Logout row pinned to the bottom via a flex spacer.
- [ ] At mobile widths (<900px), `AppShell` renders a top bar (56px, `surface` background, `line` bottom border) with a hamburger icon (left) and the current screen's title centered — replacing whatever fixed/left-aligned title each page currently renders as an `h1`. Tapping the hamburger opens a full-screen nav view (same row set as the desktop rail, same `drawer-bg` styling) that fully replaces the current screen; a close (×) icon in its header returns to whatever screen opened it (browser/router "go back" semantics, not a hardcoded destination, since the nav is opened from every screen).
- [ ] Each nav row shows a distinct icon (matching the Figma icon set — a grid glyph for Dashboard, a list glyph for Events, a calendar glyph for Calendar, a calendar-plus glyph for New Event, a people glyph for User Management, a gear glyph for Settings, a door/arrow glyph for Logout) plus a label; the row for the current screen is visually selected — `accent`-tinted background overlay at 18% opacity, `accent`-colored icon and label (Semi Bold), everything else in `drawer-text-muted` (Regular weight).
- [ ] New Event and User Management rows render only for `Role.EventManager`, matching `EVENT_CREATE_PATH`/`USER_MANAGEMENT_PATH`'s existing `RequireRole` gates in `app.tsx` — every other role sees Dashboard, Events, Calendar, Settings*, and Logout only. (*Settings' own role gate is set in STORY-062, which creates the route; until then this row is Event-Manager-only by the same convention.)
- [ ] Clicking any nav row navigates via `react-router-dom`'s `Link`/`useNavigate` (no full page reload) to that row's existing route constant; Logout calls the existing `useAuth().logout()` then navigates to `LOGIN_PATH`, replacing history (unchanged behavior from the current `DashboardNav`, just relocated).
- [ ] Every existing page whose own component previously rendered its `<h1>` title (Dashboard, Events, Calendar, User Management) is updated so the title now appears once — either in the mobile top bar or, on desktop, centered at the top of the page's own content area — never duplicated between `AppShell` and the page.
**UI:** New `AppShell` component (drawer rail / mobile top bar + full-screen nav), replacing `DashboardNav` on every authenticated screen.
**Tokens:** `drawer-bg`, `drawer-text`, `drawer-text-muted`, `accent`, `accent-tint` (18% opacity variant, not the flat tint swatch), `surface`, `line`, `type-title-l`.
**Edge cases:** A role with only Dashboard/Events/Calendar/Logout (F&B Head, Housekeeping, Reception) still gets the full-height drawer/nav with the remaining rows simply absent (not disabled-and-visible) — re-verify this doesn't collapse the drawer's bottom-pinned Logout row upward oddly when fewer rows precede it. The mobile nav's "close" affordance must not strand a user who opened it from a deep route (e.g. mid-wizard) — closing returns to that exact screen, not to Dashboard.

### STORY-054: Dashboard UI fixes — centered title, count-below-label tiles, responsive table
**Flow:** An Event Manager (or any role) opens the Dashboard. The title reads centered, each count tile shows its number below its label (not beside it), and the upcoming-events table either fits the viewport or scrolls horizontally within its own card rather than clipping columns.
**Acceptance Criteria:**
- [ ] The "Dashboard" `<h1>` is center-aligned within its container at every viewport width (desktop: centered over the content column next to the drawer; mobile: centered in `AppShell`'s top bar per STORY-053).
- [ ] `CountTiles` renders each tile's `labelS` text directly above its `titleL` value in a vertical stack (already the DOM order in `count-tiles.tsx`; this story's job is to verify/fix that no `sx` override anywhere forces a row layout at any breakpoint, since that's the reported bug) — add an explicit regression test asserting the label's bounding box is above the value's bounding box, not beside it.
- [ ] On mobile, the four count tiles wrap into a 2×2 grid (not a single squeezed row) — `rowStyles`' `flexWrap: 'wrap'` already supports this; verify each tile's `minWidth`/`flex-basis` is tuned so exactly two fit per row at 390px width without text truncation.
- [ ] `UpcomingEventsTable` is wrapped in a horizontally-scrollable container on mobile (`overflow-x: auto` on the `Paper`, or an inner scroll div) so no column is ever clipped or hidden — all columns the caller's role is entitled to (per STORY-046/049/050/051's field filtering) remain reachable by horizontal swipe, matching the Figma mobile Dashboard mock's scroll-fade affordance.
- [ ] On desktop/laptop widths the table renders full-width with every column visible without scrolling, unchanged from current behavior.
**UI:** `dashboard-page.tsx`, `count-tiles.tsx`/`.styles.ts`, `upcoming-events-table.tsx`/`.styles.ts`.
**Tokens:** `accent-tint` (tile fill), `type-label-s`, `type-title-l`, `space-16`.
**Edge cases:** Zero upcoming events on mobile — the existing empty-state `Paper` must not itself force horizontal scroll or look truncated. A role whose filtered response has only 3 of the 6 base columns (e.g. Housekeeping, no `clientContacts`) still gets correct horizontal-scroll behavior with fewer columns — the scroll container must not scroll further than its actual (narrower) content width.

### STORY-055: Events List — mobile card redesign
**Flow:** On mobile, the Events List no longer renders `EventsTable`'s five-column table (which doesn't fit 390px) — it renders one card per Event instead, matching the Figma mobile mock; desktop keeps the existing table unchanged.
**Acceptance Criteria:**
- [ ] Below the `md` breakpoint, `EventListPage` renders a new `EventsCardList` component instead of `EventsTable`: one card per Event, each showing family type (Semi Bold, `titleM`-equivalent size) and `StatusChip` on the same top row, the Event ID below in `labelS`/`textSoft`, and a final line combining Bride/Groom names (via the existing `getBrideGroomNames` helper, unchanged) and the assigned Manager separated by " · ".
- [ ] Each card has the same click/keyboard activation as today's table rows — reuses `createEventRowActivation` unchanged, navigating to `eventDetailPath(event.id)`.
- [ ] At/above `md`, `EventsTable` renders exactly as it does today — no visual or behavioral change on desktop.
- [ ] The "+ New Event" action (Event-Manager-only) appears as a full-width primary button above the card list on mobile, and keeps its current placement/style on desktop.
- [ ] Empty state ("No Events yet") renders correctly in the mobile card layout too, not just the desktop table's `Paper`.
**UI:** New `EventsCardList` component (mobile only); `event-list-page.tsx` picks between it and `EventsTable` by breakpoint.
**Tokens:** `surface`, `line`, `type-title-m`, `type-label-s`, `type-body-m`, `status-*` (via `StatusChip`, unchanged).
**Edge cases:** A very long Bride/Groom name string must not force the card wider than the viewport — wrap or truncate rather than overflow.

### STORY-056: User Management — mobile card redesign
**Flow:** Same responsive pattern as STORY-055, applied to the User Management table (Name / Role / Status columns), which currently has the same mobile-overflow bug.
**Acceptance Criteria:**
- [ ] Below `md`, the User Management list renders one card per user: name (Semi Bold) and status (`Active`/`Inactive`, colored via the existing status-confirmed/text-faint convention already used elsewhere for binary state) on the top row, role name below in `text-soft`.
- [ ] At/above `md`, the existing table (Name/Role/Status columns) is unchanged.
- [ ] "+ Add User" renders as a full-width primary button above the mobile card list; unchanged placement on desktop.
**UI:** New mobile card list for the User Management screen, breakpoint-swapped against the existing table.
**Tokens:** `surface`, `line`, `type-title-m`, `type-body-m`, `status-confirmed`, `text-faint`.
**Edge cases:** A deactivated user's card must be visually distinct (muted, per existing "Inactive" convention) in the card layout too, not only in the table.

### STORY-057: Global input consistency — MUI date/time pickers, functional font, focus-loss fix
**Flow:** Every date field in the app becomes a real MUI Date Picker, every time-of-day field a real MUI (Static) Time Picker in 12-hour AM/PM format, text fields render in the app's functional Inter typeface rather than any decorative face, and the reported "cursor defocuses after every keystroke" bug in the New Event/Quotation forms is fixed at its root.
**Acceptance Criteria:**
- [ ] Every native `<input type="date">`/`<input type="time">` (or MUI `TextField` with `type="date"`/`type="time"`) anywhere in the codebase is replaced with `@mui/x-date-pickers`' `DatePicker` (for dates) or `StaticTimePicker` (for times, 12-hour format with an explicit AM/PM control — the always-visible clock face, per SRS §6.9's "MUI (Static) Time/Clock Picker" wording; the popover-only `TimePicker` does not satisfy this story) — grep the codebase for `type="date"` and `type="time"` as the completion check; zero matches remain outside test fixtures.
- [ ] All text fields (`TextField`, and any custom input built from a plain `<input>`) use `fontFamilyTokens.body` (Inter) exclusively for both the label and the entered value — audit any component that set a different `fontFamily` inline or via `sx`, since `type-display` (Fraunces) must never appear inside an editable field.
- [ ] The root cause of the per-keystroke focus loss is identified and fixed: this is almost always a component (the input, or an ancestor) being re-created with a new identity on every render — e.g. an inline component defined inside another component's render body, or a `key` prop that changes every render, or a controlled-input value computed from a freshly-allocated object/array each render. Whichever it is, the fix removes the remount, not a workaround (e.g. not `autoFocus` re-applied on every render, which masks the symptom without fixing re-creation).
- [ ] A regression test types a multi-character string into an affected field (e.g. a Client Contact name field) character-by-character (simulating real typing, not `fireEvent.change` with the full final string in one call) and asserts focus remains on the same input element throughout.
**UI:** Cross-cutting fix across every form screen (New Event wizard steps, Event Detail's editable tabs, Accommodation, Settings' master-list forms).
**Tokens:** `type-body-l`/`type-body-m` (field text), N/A for the picker components themselves (MUI-native styling, themed via the existing MUI `theme.ts` palette).
**Edge cases:** A date field whose value is cleared (no date selected) must show a placeholder, not an invalid/NaN date. A time field's AM/PM toggle must be reachable via keyboard, not mouse-only.

## Module: Calendar — Month View (SRS §5.2, FR-SES-5/6)

### STORY-058: Calendar Month View — desktop (MUI StandaloneMonthView)
**Flow:** An Event Manager (or any role) opens Calendar on a desktop/laptop viewport and sees a full-width month grid — weekday headers, one box per date, each date's Events listed inside its own box — built with `@mui/x-scheduler`'s `StandaloneMonthView`, not a hand-rolled grid or a week view.
**Acceptance Criteria:**
- [ ] `@mui/x-scheduler` is added as a dependency. The Calendar screen imports `SchedulerEvent` from `@mui/x-scheduler/models` and `StandaloneMonthView` from `@mui/x-scheduler/month-view` (the exact import paths the library's own docs use), and renders:
  ```tsx
  <StandaloneMonthView
    events={events}
    resources={resources}
    defaultVisibleDate={defaultVisibleDate}
    onEventsChange={setEvents}
  />
  ```
  where `events` is a `SchedulerEvent[]` mapped from the existing `GET /calendar` response (one `SchedulerEvent` per Event per date it occurs on, per the overlap rule already finalized in SRS §4.2 — a multi-day Session's Event appears in every date cell it spans, exactly as today's chip logic already computes, just re-targeted at the new component's data shape instead of a hand-built chip); `defaultVisibleDate` is the current real-world month on first load, or the month implied by the URL/query state when navigating month-to-month; `onEventsChange` wires `StandaloneMonthView`'s own internal event-state callback back into the page's state (this app has no in-grid drag/resize editing of Events, so in practice this callback only needs to keep local state in sync with what the library renders, not persist anything — Event data is still only ever mutated through the Event Detail/wizard screens).
- [ ] **`resources` maps to the four Event `status` values**, not to Venue or Event Manager: one resource per status (Tentative/Confirmed/Completed/Cancelled), each carrying that status's existing color token (`status-tentative`/`status-confirmed`/`status-completed`/`status-cancelled`) as its resource color, and each `SchedulerEvent`'s `resourceId` set to that Event's current `status`. This uses the library's native resource-coloring feature to reproduce the by-status coloring already used everywhere else in the app (`StatusChip`, calendar chips) rather than fighting the library's own coloring model with a manual override.
- [ ] The grid spans the full available width of its container with minimal side margins (regression check against the "too much margin" bug this story exists to fix) — no fixed max-width wrapping it on desktop.
- [ ] Each date cell shows the date number top-right (bold when it's the current real-world date, muted for cells belonging to the adjacent month) and, below it, one row per Event on that date formatted as a small color dot (colored by its resource/status, per the mapping above) + start time + Event label, truncating with an ellipsis (not wrapping or overflowing the cell) when too long to fit on one line.
- [ ] An Event whose Session spans more than one date within the same displayed week renders as a single highlighted bar across those date cells (not a repeated per-cell dot+text row) — reproducing `StandaloneMonthView`'s own multi-day rendering, fed by the Session's real `start_date`/`end_date` range.
- [ ] Clicking a date cell's Event row (dot+text or bar) navigates to that Event's Detail page via `eventDetailPath`.
- [ ] Month navigation (previous/next month chevrons, already present as `ChevronLeftIcon`/`ChevronRightIcon` imports on the existing Calendar page) re-queries `GET /calendar` for the newly-selected month's date range.
**UI:** Calendar screen rebuilt around `StandaloneMonthView`; the app's own light theme tokens are applied to it (not the library's own default/dark demo styling) via its theming props, so it matches the rest of the app rather than forking the visual language for one screen.
**Tokens:** `surface`, `surface-2` (weekday header row fill), `line` (grid lines), `text`, `text-soft`, `text-faint` (adjacent-month dates), `status-*` (event dots/bars), `type-label-s` (weekday headers).
**Edge cases:** A date with more Events than fit in its cell needs a "+N more" affordance (matching `StandaloneMonthView`'s own overflow behavior) rather than growing the cell or clipping silently. A month with a Session spanning a week boundary renders that Session's bar as two separate segments (one per week row), not one bar breaking across rows.

### STORY-059: Calendar Month View — mobile (full-screen, not a compact widget)
**Flow:** On mobile, Calendar renders the same full month grid as desktop — not a shrunken widget with a separate agenda list below it. Cells are narrower but keep the same date-number-top-right + dot/truncated-title-per-event structure, scaled down.
**Acceptance Criteria:**
- [ ] Below `md`, the Calendar screen renders the same `StandaloneMonthView` grid (not an alternate compact/agenda component) sized to the mobile viewport's full width and as much height as the viewport allows below the top bar and filter row — this explicitly supersedes any earlier "small calendar + agenda list" pattern; there is exactly one calendar-rendering component shared by both breakpoints, only its container sizing differs.
- [ ] Each date cell shows the date number and up to 2 events as dot + truncated title (time omitted at this width if it doesn't fit — title truncation via ellipsis takes priority over showing the time); a "+N more" affordance appears when a date has more events than fit.
- [ ] Weekday headers use single-letter abbreviations at this width (S/M/T/W/T/F/S) rather than the desktop's three-letter form, to keep columns legible at ~50px each.
- [ ] Tapping a date cell's event navigates to that Event's Detail page, same as desktop.
- [ ] Month navigation chevrons and the filter row (STORY-060) sit above the grid, both reachable without scrolling past the grid itself.
**UI:** Shared `StandaloneMonthView`-based Calendar component from STORY-058, mobile container sizing only.
**Tokens:** Same set as STORY-058, applied at mobile-appropriate font sizes.
**Edge cases:** A date cell too narrow to show even a truncated title alongside its dot — fall back to dot-only with the count of events, still tappable to see them (e.g. via the "+N more" surface, or by opening that date's Event Detail directly when there's exactly one).

### STORY-060: Calendar dropdown filters (Venue, Event, Manager, Event Type, Status)
**Flow:** Above the month grid (both breakpoints), a row of dropdown filters narrows which Events' dots/bars render, without changing which dates are shown.
**Acceptance Criteria:**
- [ ] Five filters render: Status (All/Tentative/Confirmed — the existing filter set, unchanged), Venue (populated from the Venue Master list, STORY-061), Event (a search-by-event selector — typing filters a list of matching Events by name/ID/client, selecting one highlights just that Event's cells; see Decision note below on this filter's meaning), Event Manager (populated from active `EventManager`-role User Accounts), Event Type (populated from the Event Type Master list, STORY-061).
- [ ] Filters combine with AND semantics — selecting a Venue and a Status together shows only Events matching both.
- [ ] On mobile, filters render as a horizontally-scrollable chip row (matching the Figma mock) rather than wrapping to multiple lines.
- [ ] Clearing a filter (selecting its "All" option) removes that constraint without resetting the others.
- [ ] Filtering is client-side against the already-fetched month's Events (no additional network round-trip per filter change), consistent with the existing calendar data-loading pattern.
**UI:** New filter row above the Calendar grid, both breakpoints.
**Tokens:** `surface`, `line`, `text`, `text-soft` (chevron icons).
**Edge cases:** The "Event" filter combined with a date navigation to a month where the selected Event doesn't occur — the filter selection persists (doesn't silently reset) even though it currently matches nothing, so navigating back to the right month re-shows the highlight.
**Note:** SRS Assumption A10 flags that "Event" filter's exact meaning as unconfirmed — this story implements it as a search-by-Event selector (name/ID/client) per that assumption's stated interpretation; confirm with stakeholders before or during implementation that this, and not a duplicate of Event Type, is what's wanted.

## Module: Admin / Configuration Settings (SRS §5.8, §4.6)

### STORY-061: Venue, Event Type, and Room Type master-list schemas and endpoints
**Flow:** No end-user-visible flow yet — this defines the three master lists the Settings screen (STORY-062) and every venue/event-type/room-type dropdown across the app (Session entry, Room Line entry) will read from and write to.
**Acceptance Criteria:**
- [ ] Three new collections/schemas: `venues` (`name`, `defaultVenueCost`, `active`), `eventTypes` (`name`, `active`), `roomTypes` (`name`, `defaultTariff`, `active`) — each with `active` defaulting to `true`.
- [ ] `GET /venues`, `GET /event-types`, `GET /room-types` — list all entries (both active and inactive; the caller decides whether to filter, e.g. a dropdown shows only `active` ones while the Settings screen shows all).
- [ ] `POST /venues`, `POST /event-types`, `POST /room-types` — create a new entry; `POST /venues` and `POST /room-types` require their respective default-cost field, `POST /event-types` requires only `name`.
- [ ] `PATCH /venues/:id`, `PATCH /event-types/:id`, `PATCH /room-types/:id` — edit name/default cost, or toggle `active`.
- [ ] Deactivating an entry (`active: false`) never deletes it and never cascades to any Event/Session/Room Line already referencing its name — those keep displaying whatever value they already captured (Venue/Room Type selection copies the name and current default cost at selection time onto the Session/Room Line, per SRS FR-CFG-4; it does not store a live reference to the master-list document).
- [ ] All six write endpoints (`POST`/`PATCH` × 3) are `eventManagerOnly`, matching SRS FR-CFG-6; the three `GET` endpoints are `authenticatedOnly` (every role's dropdowns need to read them, even though only Event Manager can edit them).
- [ ] Seed data: pre-populate `venues` with the four venues named across both reference quotations (Poolside 60000, Half Banquet 60000, Full Banquet 120000, and a reasonable default for any others already in use) and `roomTypes` with Deluxe/Executive/Dormitory/Extra Beds at the tariffs seen in `example_quatation_1.pdf` (2500/3500/5000/700), so the wizard and Settings screen have real data on first run rather than an empty state.
**UI:** None (backend only).
**Tokens:** N/A (backend only).
**Edge cases:** Creating a venue/room-type/event-type with a name that already exists (including a deactivated one) — decide and document whether this is rejected as a duplicate or allowed (two "Poolside" entries, one active one not); recommended: reject case-insensitive duplicates among currently-`active` entries only, so a deactivated name can be reintroduced.

### STORY-062: Settings screen UI — Venue / Event Type / Room Type / Menu Item management
**Flow:** An Event Manager opens Settings from the nav shell (STORY-053) and manages the four master lists (the three new ones from STORY-061, plus the existing Menu Item list) from one tabbed screen.
**Acceptance Criteria:**
- [ ] The Settings route (`/settings`, `eventManagerOnly` via `RequireRole`, matching the New Event/User Management convention) renders inside `AppShell`; its own nav row (STORY-053) only appears for Event Manager.
- [ ] Desktop: a left-hand section list (Venues / Event Types / Room Types / Menu Items) beside a right-hand panel showing the selected list as a table (Name, Default Cost where applicable, Status) with a "+ Add" button per section.
- [ ] Mobile: the section list renders as a horizontally-scrollable chip row above a card list (one card per entry: name + default cost + status), matching STORY-055/056's card pattern.
- [ ] "+ Add" opens a small form (name, and default cost for Venues/Room Types) that calls the matching `POST` endpoint from STORY-061 and appends the new row to the list on success without a full reload.
- [ ] Each row has an Edit action (inline or a small dialog) that calls the matching `PATCH` endpoint, and a Deactivate/Reactivate toggle reflecting and updating `active`.
- [ ] The Menu Item section reuses the existing add-Menu-Item capability already present in Item entry (STORY-in-Sessions-and-Menu, wherever that currently lives) — this screen becomes a second, browsable entry point onto the same underlying Menu Item list, not a separate/duplicate data store.
**UI:** New Settings screen — desktop split-panel, mobile chip-row + cards.
**Tokens:** `surface`, `surface-2`, `line`, `accent`, `accent-tint`, `status-confirmed` (Active label), `text-faint` (Inactive label), `type-title-l`/`-m`.
**Edge cases:** Deactivating the Venue/Room Type currently selected mid-entry in an open New Event wizard session elsewhere — that in-progress selection is unaffected (per STORY-061's "copy at selection time, not a live reference" decision), so this is a non-issue by construction; call this out in a test rather than leaving it as an assumption.

## Module: New Event Creation Flow (SRS §5.1, §5.2, §4.3, §4.7 data-entry sequence)

### STORY-063: New Event wizard shell — stepper, routing, cross-step state
**Flow:** An Event Manager clicks "New Event" and lands on a 5-step wizard (Client Details → Event Details → Accommodation → Sessions & Items → Review & Quotation) whose step order is fixed to exactly the sequence the Quotation itself renders in (SRS §4.7's governing principle), replacing whatever single-page `event-creation-form.tsx` currently does.
**Acceptance Criteria:**
- [ ] A new route family under `EVENT_CREATE_PATH` (e.g. `/events/new/client-details`, `/events/new/event-details`, `/events/new/accommodation`, `/events/new/sessions-items`, `/events/new/review`) — deep-linking to any step directly is allowed (no forced replay of earlier steps) but each step's own validation still applies before its own "Next" enables.
- [ ] A stepper component renders across every step: five numbered pills (Client Details / Event Details / Accommodation / Sessions & Items / Review & Quotation), the current step filled `accent`, completed steps filled `accent-tint` with `accent-deep` text, remaining steps outlined only.
- [ ] Wizard state (everything entered across all steps) lives in one client-side store (e.g. a dedicated Zustand/context store, matching whatever state pattern `stores/` already uses elsewhere in the codebase) for the duration of the wizard, persisted to `sessionStorage` so a reload mid-wizard doesn't lose entered data — cleared on successful submission (STORY-068) or explicit cancel.
- [ ] "Next"/"Back" footer buttons appear on every step (Step 1 has no Back; Step 5's "Next" is instead "Generate Quotation," STORY-068); Back never discards already-entered data on the step being left.
- [ ] On mobile, the five-step stepper condenses to a compact "Step N of 5 — <Step Name>" label plus a thin progress bar, matching the Figma mobile mock, rather than showing all five pills at once (they don't fit at 390px).
**UI:** New wizard shell (stepper + step-routing outlet), replacing the single-page New Event form.
**Tokens:** `accent`, `accent-tint`, `accent-deep`, `line`, `type-label-s`/`-m`.
**Edge cases:** Navigating away from the wizard mid-entry (e.g. clicking a nav-shell link) — prompt before discarding unsaved wizard state, or persist it (per the `sessionStorage` requirement above) so returning to `/events/new/...` later resumes rather than restarting blank.

### STORY-064: Wizard Step 1 — Client Details
**Flow:** The first wizard screen collects Client Contacts — the same three default rows (Bride, Groom, Point of Contact) as today's Event creation, with the ability to add/remove custom rows, per SRS FR-EVT-2.
**Acceptance Criteria:**
- [ ] Three default rows render pre-labeled Bride / Groom / Point of Contact, each with a Name field and a Contact Number field; both fields are optional at this step (per `example_quatation_2.pdf`, where Bride/Groom are legitimately left blank on a real quotation) — nothing here blocks "Next" for an empty field.
- [ ] "+ Add Contact" appends a new row with an editable role-label field (free text, not restricted to the three defaults) plus Name and Contact Number; each added row has a remove (×) affordance the three default rows don't need (they're always present, per FR-EVT-2's "default rows Bride, Groom, POC").
- [ ] Data entered here is held in the wizard store (STORY-063), not submitted to the backend until Step 5 (SRS FR-EVT-8 — there is exactly one data-entry flow, no partial per-step submission creating a half-formed Event record).
- [ ] "Next: Event Details →" always enables (no required fields on this step) and advances to Step 2, carrying the entered contacts forward in wizard state.
**UI:** Step 1 screen — one card containing the three default rows + any added rows + "Add Contact", inside the wizard shell.
**Tokens:** `surface`, `line`, `type-title-m` (card heading), `type-body-m` (field labels).
**Edge cases:** Adding a contact row, filling it in, then removing it — the wizard store must actually drop that row's data, not just hide it (verify by navigating to Step 5's review and confirming a removed row never appears).

### STORY-065: Wizard Step 2 — Event Details (Session entry)
**Flow:** The second wizard screen adds one or more Sessions (Engagement, Wedding, Halad, etc.) — event type, venue, date/time range, and guest count — building the exact rows that become the Quotation's "Event Details" overview table (SRS §4.7d).
**Acceptance Criteria:**
- [ ] A form collects, per Session: Event Type (dropdown sourced from the Event Type Master, STORY-061, plus a free-text custom option), Venue (dropdown sourced from the Venue Master, STORY-061; selecting one auto-fills Venue Cost from that venue's `defaultVenueCost`, remaining independently editable — SRS FR-CFG-4), Venue Cost (numeric, auto-filled/editable per above), Pax (numeric), Start Date and End Date (MUI `DatePicker`, `end_date >= start_date` enforced — a single-day Session is simply `start_date === end_date`, SRS §4.2), Start Time and End Time (MUI `StaticTimePicker` from `@mui/x-date-pickers`, 12-hour AM/PM — the always-visible clock face, not the popover-triggered `TimePicker`, per SRS §6.9's "MUI (Static) Time/Clock Picker" requirement).
- [ ] "+ Add Event" appends the filled form's values as a new row in a table below (Event Type / Date / Duration / Guests / Venue / Cost — the same six columns the Quotation's Event Details table uses, SRS §4.7d), then clears the form for the next entry; multiple Sessions (including more than one on the same date, per `example_quatation_2.pdf`'s Halad+Engagement both on 26 Feb) are fully supported.
- [ ] Duration displays in the added-rows table formatted exactly as the Quotation will show it (e.g. "6pm to 10pm"), derived from the entered start/end times — this formatting function is written once and reused verbatim by the Quotation renderer (STORY-069), not reimplemented twice.
- [ ] Each added row has a remove affordance; removing a Session here also removes any Sessions & Items (Step 4) already entered against that Session's date, with a confirmation prompt if any exist.
- [ ] "Next: Accommodation →" requires at least one Session added; "← Back" returns to Step 1 without losing Step 2's own entered rows.
**UI:** Step 2 screen — entry form + added-Sessions table, inside the wizard shell.
**Tokens:** `surface`, `line`, `type-title-m`, `type-body-m`, `type-label-s` (table headers).
**Edge cases:** Two Sessions on the same date with different venues (per `example_quatation_2.pdf`'s Poolside/Half Banquet Engagement) — both must carry through distinctly into Step 4's per-date grouping and into the Quotation's per-date venue rows (SRS FR-QUO-9's "one venue row per Session on that date, not one per date").

### STORY-066: Wizard Step 3 — Accommodation
**Flow:** The third wizard screen enters the single Accommodation Block for the whole Event (SRS §4.3 — one block per Event, not per Session): check-in/check-out and one or more Room Lines.
**Acceptance Criteria:**
- [ ] Check-in and Check-out are MUI `DatePicker` + `StaticTimePicker` pairs (the always-visible clock face, not the popover `TimePicker` — SRS §6.9) matching the reference quotations' "10-12-2026 / 12pm" two-line display; `total_days` is derived and displayed read-only, never manually entered.
- [ ] Room Lines: Room Type (dropdown sourced from the Room Type Master, STORY-061; selecting one auto-fills Tariff from `defaultTariff`, remaining editable), Occupancy, Tariff, Number of Rooms, and a derived read-only Total (incl. GST) per line, computed the same way the existing Accommodation total-computation already does (FR-EVT-3 — never manually enterable).
- [ ] An **Extra Beds room line is present by default and cannot be removed** (it may be left at zero occupancy/rooms/tariff-times-zero) — matching SRS §4.3's note that both reference quotations always print this row even at zero, so the data model must always carry it rather than the UI conditionally offering to add it.
- [ ] "+ Add Room Line" adds further custom room lines beyond the seeded defaults (Deluxe/Executive/Dormitory/Extra Beds); each non-Extra-Beds line has a remove affordance.
- [ ] A footer row shows Total Occupancy (summed) and Total Charges (summed), read-only, styled with the green/yellow shading called out in SRS §4.7e — this exact coloring carries through unchanged to the Quotation's own Accommodation table (STORY-070), so it's introduced here rather than invented twice.
- [ ] "Next: Sessions & Items →" requires Check-in and Check-out to be set; room lines may all be zero (an Event with no accommodation booked is valid — not every booking needs rooms).
**UI:** Step 3 screen — check-in/out fields + Room Line rows + totals footer, inside the wizard shell.
**Tokens:** `surface`, `line`, `type-title-m`, `type-body-m`, plus the green/`status-confirmed`-family and yellow/`accent-tint`-family shades for the totals footer (reuse existing tokens rather than introducing new raw hex values — confirm the closest existing token match during implementation, e.g. a green success tone if one exists elsewhere in the palette, else flag for a token addition).
**Edge cases:** Check-out before check-in — block with a validation message rather than producing a negative `total_days`. Editing Check-in/Check-out after Room Lines are already entered must recompute `total_days` live without requiring the user to re-enter room data.

### STORY-067: Wizard Step 4 — Sessions & Items (Ceremony/Food-Dining split, L.S. toggle)
**Flow:** The fourth wizard screen is where the per-date Ceremony Events and Food/Dining Events are entered — the data that becomes the Quotation's per-date Event Details tables (SRS §4.7f) verbatim. This is the most novel screen in the flow and the one most directly load-bearing for exact-match quotation output.
**Acceptance Criteria:**
- [ ] A row of date tabs, one per distinct date across every Session entered in Step 2 (e.g. two tabs for a two-day wedding, three tabs if a Halad/Engagement/Wedding span three distinct dates) — selecting a tab shows only that date's entry form and already-added items.
- [ ] Each date tab shows a read-only reminder line naming that date's Session(s) and venue(s) (e.g. "Venue for this date: Poolside · 60,000/- (from Event Details)"), pulled from Step 2's data, never re-entered here.
- [ ] **Ceremony Events section:** a form with Event Name (dropdown + custom, matching SRS §4.2's `session_type`-style prefilled-plus-custom convention) and Start/End Time (MUI `StaticTimePicker`, the always-visible clock face — SRS §6.9); "+ Add Ceremony Event" appends a row to a list below. No Pax/Cost/Menu fields exist here at all — matching the Event Item's actual field set (SRS §4.5), not merely hidden.
- [ ] **Food/Dining Events section:** a form with Meal Name (dropdown + custom), Start/End Time (MUI `StaticTimePicker`, same as above), Pax (numeric), an **L.S. (lump sum) toggle**, Cost per Plate — relabeled live to "Flat Cost" when the L.S. toggle is on — and a Menu field (searchable multi-select against the existing Menu Item master list, with an "add new" option that persists the new Menu Item for future reuse, per SRS FR-SES-3). "+ Add Food/Dining Event" appends a row.
- [ ] Toggling L.S. on a given row updates a live preview line under that row reading "Shown on Quotation as: L.S. (Npax)" (N = the entered Pax) when on, or "Shown on Quotation as: N" when off — this is not cosmetic flavor text, it is the literal rule the Quotation renderer applies (SRS §4.5/Glossary's Limited Seating entry, FR-QUO-8), surfaced here so the person entering data can see exactly what will print before generating anything.
- [ ] Each added Ceremony or Food/Dining row has a remove affordance and can be re-edited (clicking a row re-populates the form above it for editing rather than only supporting append/delete).
- [ ] "Next: Review & Quotation →" requires nothing further to be added (a date with zero Ceremony/Food-Dining rows is valid — not every date needs both categories) but does require every date tab to have been visited at least once (tracked in wizard state) so a user doesn't accidentally skip a whole date's entry unnoticed.
**UI:** Step 4 screen — date tabs + Ceremony section + Food/Dining section, each with its own add-row form and list, inside the wizard shell.
**Tokens:** `surface`, `surface-2` (row card fill), `line`, `accent` (L.S. toggle "on" state and its label color), `text-faint` (L.S. toggle "off" label color), `type-title-m`, `type-body-m`, `type-label-s` (mini field labels).
**Edge cases:** An L.S. row's Pax value changing after the toggle is already on — the preview line updates live to reflect the new N. A Ceremony Event added with every field left blank is allowed to persist (SRS §4.7f's "an Event Item with every field blank still renders as a bare grey divider row… a valid, not an erroneous, state") — do not add validation that blocks this, since both reference quotations contain exactly this case.

### STORY-068: Wizard Step 5 — Review & Generate Quotation
**Flow:** The final wizard screen shows a read-only Total Cost Summary computed live from every prior step's data (SRS §5.4 FR-QUO-9, exactly as it will appear on the generated PDF), lets the Event Manager add manual line items (Decoration, Photographer, Bhatji, etc.) with optional notes, then submits the whole Event in one call and immediately offers the generated Quotation.
**Acceptance Criteria:**
- [ ] The Total Cost Summary renders using the exact structure finalized in SRS FR-QUO-9: one merged block per date (venue row(s) + food rows), a single aggregate Food Cost row (Total Cost = sum of every food row's Total Cost across every date; Total Cost with GST = that sum × (1 + GST%), GST% defaulting to 5% and editable here since SRS §4.9 allows it to vary per-quotation), an Accommodation row (pulled from Step 3's computed `total_charges`), zero or more manual rows, and a Grand Total row summing every "Total Cost with GST" value above it — this is a live preview, not yet a persisted or rendered PDF.
- [ ] "+ Add Line Item" lets the Event Manager add any number of arbitrarily-named rows (Decoration, Photographer, Bhatji, or anything else), each with a name, an **optional short note** (rendered in the Sub Cost Item column — e.g. "poolside engagement sangeet + wedding mandap decor"), and a Total Cost with GST amount — per SRS FR-QUO-9a, since both reference quotations carry exactly this kind of note and it is not optional polish for an exact-match rebuild.
- [ ] "Generate Quotation" submits the entire wizard's accumulated state as one `POST /events` call (creating the Event, its Sessions, Items, Accommodation, and Client Contacts together — FR-EVT-8's "exactly one data-entry flow," never a sequence of partial per-step writes), then immediately calls `GET /events/:id/quotation.pdf` (or triggers whatever the existing Generate-Quotation action does today) and navigates to the Quotation Preview screen for the newly-created Event.
- [ ] On successful submission, the wizard's `sessionStorage` state (STORY-063) is cleared.
- [ ] A submission failure (network error, validation rejection) keeps the user on this step with their data intact and shows a clear error, rather than silently losing the wizard's accumulated state.
**UI:** Step 5 screen — live Total Cost Summary + "Add Line Item" affordance + "Generate Quotation" primary action, inside the wizard shell.
**Tokens:** `surface`, `surface-2`, `line`, `accent-tint` (Food Cost / Grand Total row shading), `type-title-m`, `type-body-m`.
**Edge cases:** Adding a manual line item, then going Back to Step 4 and adding another Food/Dining Event, then returning to Step 5 — the live summary recomputes to include the new item without the manually-added rows being lost or duplicated.

## Module: Quotation Generation — Exact-Match Rebuild (SRS §4.7, §5.4)

**Governing constraint for every story in this module:** `example_quatation_1.pdf` and `example_quatation_2.pdf` are the acceptance fixtures. Every number named in an Acceptance Criterion below was independently recomputed from those two PDFs (not eyeballed) before being written down — see SRS FR-QUO-9's arithmetic note for the worked Food-Cost/GST/Grand-Total derivation. Where the two reference PDFs disagree on a formatting detail (see STORY-071's dash-format note), the story picks one convention and applies it consistently rather than reproducing the inconsistency.

### STORY-069: Quotation header, title row, Client Details & Event Details tables
**Flow:** The top of every generated Quotation PDF, from the letterhead through the Event Details overview table — the first thing anyone sees when a Quotation is opened.
**Acceptance Criteria:**
- [ ] Header: the Aaradhya logo mark and wordmark render left-aligned (two image assets placed side by side, per SRS §4.7a — real brand asset files, not the placeholder circle+sparkle used in the Figma mock, must be sourced/uploaded before this story ships); GST number, address (two lines), and contact number render right-aligned in a smaller regular weight; one horizontal rule spans the full page width directly below this header block, before the title row.
- [ ] Title row: "Event Quotation" centered, bold, using the same size/weight as both reference PDFs (visually matched against the fixtures, not an arbitrary guess); "Quotation Date: DD/MM/YYYY" bold, right-aligned on the same row, always the current server date at generation time — never user-editable, never the Event's `created_at` (SRS FR-QUO-6).
- [ ] Client Details table: heading styled in the same accent/italic-ish blue used for every section heading across both reference PDFs (a distinct heading style from body text, applied consistently to every subsequent section heading in this module); table with an unlabeled first column, "Name", "Contact Number"; exactly the rows present in `client_contacts[]` in entry order (Bride/Groom/POC defaults plus any custom rows) — a contact with a blank name and/or contact number (per `example_quatation_2.pdf`'s blank Bride/Groom) renders as an empty cell, not an omitted row.
- [ ] Event Details table: heading same style as above; columns "Event Type", "Event Date", "Event Duration", "No. Of Guests", "Venue Selected", "Selected Venue Cost"; one row per Session in entry order; Event Date formatted `DD/MM/YYYY` (standardizing on `example_quatation_1.pdf`'s format rather than `example_quatation_2.pdf`'s "26 Feb 2027" — pick one and apply it to every generated Quotation, since the two source PDFs are inconsistent with each other and the system must not be); Duration formatted `<start> to <end>` using lowercase `am`/`pm` with no space before them (`6pm to 10pm`, `9am to 3pm`) — this exact string format, produced by the same formatter Step 2 of the wizard (STORY-065) already uses for its own added-rows table, not a second implementation; Venue Cost formatted `X,XX,XXX/-` (Indian digit grouping, trailing `/-`, no currency symbol).
- [ ] Two or more Sessions on the same date (per `example_quatation_2.pdf`'s Halad+Engagement) render as two separate Event Details rows, each with its own full column set — never merged into one row.
**UI:** Quotation PDF rendering component (the same React component tree used for both the on-screen Quotation Preview and the server-side Playwright PDF render, per `Aaradhya_Quotation_PDF_Strategy.md` §4 — one template, not two).
**Tokens:** N/A — the Quotation's own typography/color is a fixed reproduction of the reference PDFs' letterhead styling, not the app's interactive-UI token set; treat font choices here as a separate, explicit design decision to be pinned once (e.g. against the reference PDFs' apparent serif/sans mix) rather than left to reuse whatever the surrounding app theme happens to be.
**Edge cases:** An Event with only one Session still renders the Event Details table with exactly one row and full-width column headers (not a degenerate single-column layout). A Client Contact row where only the Contact Number is filled and Name is blank (the inverse of the reference PDFs' pattern) must still render correctly — don't assume Name is always the one left blank.

### STORY-070: Quotation Accommodation Details table (Extra Beds row, color-coded totals)
**Flow:** The Accommodation Details section of the Quotation, immediately following Event Details.
**Acceptance Criteria:**
- [ ] Columns: "Check in", "Check out", "Total Days", "Room Type", "Occ.", "Tariff", "No. Of Rooms", "Total including GST".
- [ ] Check-in and Check-out cells are vertically merged down the full height of the Room Line rows (date on the first line, time — `12pm`/`11am` style — on the second line within the same merged cell), reproducing both reference PDFs' layout exactly, not repeated per row.
- [ ] Room Line rows render in a fixed order: whatever custom room types were entered, in entry order, followed always by Extra Beds last — Extra Beds prints even when its Occupancy/Tariff/Rooms/Total are all zero (per SRS §4.3's note, confirmed against both reference PDFs which both print a zero Extra Beds row).
- [ ] A footer row spans: "Total Occ. <N>" in a cell shaded **green**, then "Total Charges" label, then "Rs. X,XX,XXX /-" in a cell shaded **yellow/amber** — both colors reproduced from the reference PDFs' own cell shading (SRS §4.7e), not a design guess.
- [ ] `Total Days`, each Room Line's `Total including GST`, `Total Occ.`, and `Total Charges` are every one of them computed values, never independently re-typed anywhere in this table — a change to a Room Line's Occupancy/Tariff/Rooms upstream in the wizard (or a future edit flow) must be reflected here on next generation without manual reconciliation (SRS §6.5's reliability requirement, applied specifically here).
**UI:** Quotation PDF rendering component, Accommodation Details section.
**Tokens:** N/A (fixed reproduction, per STORY-069's note) — the two specific fill colors (green, yellow/amber) should be sampled from the reference PDFs directly during implementation rather than approximated from the app's own `status-confirmed`/`accent-tint` tokens, since an approximate match is not acceptable for a story whose entire purpose is exact reproduction.
**Edge cases:** An Event with zero Room Lines at all except the mandatory Extra Beds row (accommodation not actually booked, matching STORY-066's "may all be zero" allowance) — the table still renders with its full column headers and the one Extra Beds row, footer totals correctly showing 0/`Rs. 0 /-` rather than an empty or hidden table.

### STORY-071: Quotation per-date Event Details tables (Ceremony merged rows, L.S. display, exact time handling)
**Flow:** One table per distinct date, appearing after Accommodation Details, in date order — the section both reference PDFs devote the most rows to.
**Acceptance Criteria:**
- [ ] One table per distinct calendar date spanned by the Event's Sessions, headed `Event Details – DD/MM/YYYY` (standardizing the heading format — `example_quatation_1.pdf` uses an en-dash with spaces, `example_quatation_2.pdf` uses a plain hyphen with no leading space before the date; this story picks the en-dash-with-spaces form and applies it consistently, since the two sources disagree with each other).
- [ ] Columns: unlabeled first column, "Time", "Number of Pax", "Cost", "Menu".
- [ ] Food/Dining rows (one per Meal Item on that date, in entry order): first column = Meal Name; Time = exactly what was entered on that Item (blank when the Item's own time fields were left blank — both reference PDFs leave most rows' Time blank after the first, and this story reproduces that by rendering whatever is actually stored, not by inventing a "only show time once" rule); Number of Pax = the bare entered number, or `L.S. (Npax)` when that Item's `limited_seating` flag is set (SRS Glossary, FR-QUO-8); Cost = `X,XXX/-` format; Menu = a plain numbered list of the Item's resolved Menu Item names (matching both reference PDFs' `1. Tea 2. Coffee …` style), or blank when no Menu Items were attached (per `example_quatation_1.pdf`'s blank-menu "Engagement Cake" row).
- [ ] Ceremony rows (one per Event Item on that date): render as a single cell **merged across all five columns** (not five empty bordered cells), shaded grey, containing the Event Item's name with its time and/or venue appended inline exactly as entered (e.g. "Engagement Sangeet - Poolside" when a venue was set but no time; "Muhurta 11am – 12:30pm" when a time was set but no venue; bare "Muhurta" when neither was set) — reproducing every one of the three inline-label variants seen across both reference PDFs, not just the simplest case.
- [ ] An Event Item with every field left blank still renders as a bare grey merged row (matching `example_quatation_2.pdf`'s one wholly-blank divider row) — this is allowed, not filtered out.
- [ ] Rows render in the same order Ceremony and Food/Dining Items were entered relative to each other for that date (both reference PDFs interleave them — e.g. Ceremony rows appear between Food/Dining rows, not grouped into two separate blocks) — the renderer must preserve entry/time order across both categories on a given date's table, not sort Food/Dining rows first and Ceremony rows second (or vice versa).
**UI:** Quotation PDF rendering component, per-date Event Details section.
**Tokens:** N/A (fixed reproduction) — the grey shade used for Ceremony rows should be sampled from the reference PDFs.
**Edge cases:** A date with only Ceremony rows and zero Food/Dining rows (unlikely but not disallowed by the data model) still renders a valid table with headers and just the grey row(s). A Menu list long enough to need multiple lines (per `example_quatation_1.pdf`'s 16-item Dinner menu) must not be truncated or force an awkward page break mid-list — allow the row to grow to fit its full numbered list.

### STORY-072: Quotation Total Cost Summary (aggregate Food Cost, per-Session venue rows, manual line items with notes, Grand Total)
**Flow:** The Total Cost Summary section, the last data table before the static footer — this is the section STORY-072 through the arithmetic in SRS FR-QUO-9 exists specifically to get exactly right.
**Acceptance Criteria:**
- [ ] Columns: "Cost Item" (leftmost, merged per date-block), "Sub Cost Item", "Pax", "Cost Per Plate", "Total Cost", "Total Cost with GST".
- [ ] One merged block per date, labeled "Wedding Venue and Catering – DD/MM/YYYY" (or "Venue and Catering DD/MM/YYYY" — pick one of the two reference PDFs' label conventions and apply it consistently to every Quotation this system generates, rather than reproducing the fact that the two sources phrase it differently).
- [ ] Within each date's block: one venue row per Session on that date (not one per date — a date with two Sessions at two venues, per `example_quatation_2.pdf`'s Halad+Engagement, gets two venue rows), each showing only Total Cost with GST = that Session's venue cost, no Pax/Cost-Per-Plate/Total-Cost value; then one row per Meal Item on that date showing Sub Cost Item, Pax (`1` when that Item's `limited_seating` is set, per FR-QUO-8, feeding this computation — not the literal headcount), Cost Per Plate, and Total Cost = Pax × Cost Per Plate, with no value in the Total Cost with GST column on these rows.
- [ ] **Exactly one "Food Cost" row for the entire table** (not one per date-block) whose Total Cost equals the sum of every Meal Item's Total Cost across every date, and whose Total Cost with GST equals that sum × (1 + GST%) — verified against both reference PDFs' printed figures: `597150` / `627007.5` (5% GST) for `example_quatation_1.pdf`, and `391500` / `411075` (5% GST) for `example_quatation_2.pdf`. A per-date subtotal row is an explicit non-goal here — this story exists partly to correct that exact mistake from an earlier draft of this spec.
- [ ] An Accommodation row: only Total Cost with GST populated, equal to the Accommodation Block's own `total_charges` (already GST-inclusive — no further GST math applied to it here).
- [ ] Zero or more manually-added rows (from wizard Step 5, STORY-068): name in Cost Item, optional note in Sub Cost Item (e.g. "poolside engg sangeet + Wedding(Vidhi mandap with saptapadi)" for Decoration, "wedding" for Bhatji — both reference PDFs carry exactly this kind of note, so the field renders when present and is blank when not, never fabricated), and the entered flat amount in Total Cost with GST.
- [ ] A Grand Total row: "Grand Total" in the Cost Per Plate column, and the sum of every Total Cost with GST value above it (every venue row + the one Food Cost row + Accommodation + every manual row) in the Total Cost with GST column — verified to reproduce `Rs. 10,73,208 /-` and `Rs. 9,49,555 /-` respectively (to the rupee, after standard rounding of the 0.5 in `1073207.5`).
- [ ] The Food Cost row and the Grand Total row are both shaded yellow/amber (SRS §4.7e/FR-QUO-9's color-coding note); no other row in this table carries background shading.
**UI:** Quotation PDF rendering component, Total Cost Summary section.
**Tokens:** N/A (fixed reproduction) — sample the yellow/amber shade from the reference PDFs.
**Edge cases:** A Meal Item with Pax or Cost Per Plate genuinely entered as 0 (per `example_quatation_1.pdf`'s one blank/zero row between Chai Tapri and Drinks) contributes 0 to the Food Cost sum without being hidden or erroring — render it as a real 0 row, matching the reference PDF's own inclusion of it. A GST% edited away from the 5% default for one specific generation (SRS §4.9 allows per-quotation variance) must be the rate actually used in that generation's Food Cost with-GST computation, and that same rate (not always 5%) must be what a fidelity re-check computes against for that specific Quotation.

### STORY-073: Quotation static footer — Terms & Conditions, Documents Required, Bank Details
**Flow:** The fixed boilerplate that closes every Quotation, unchanged regardless of the Event's data.
**Acceptance Criteria:**
- [ ] Terms & Conditions renders as a bulleted list with the exact wording from the reference PDFs' Terms & Conditions section, verbatim — every bullet reproduced character-for-character (the twelve bullets covering booking amount, balance timing, additional charges, price changes, cancellation policy, property damage, one-month validity, water bottles, banquet hall timing/overtime rate, room check-in/out timing, parking/security disclaimer, and the right to modify terms), not paraphrased or summarized.
- [ ] Documents Required from Bride and Groom renders as a numbered list, verbatim: Aadhar Card, Pan Card, Leaving/Birth Certificate, Ration Card, 2 passport size photos each, Wedding Card — in that exact order.
- [ ] Bank Account Details renders as a table with rows Name/Account Number/Bank Name/Branch Name/IFSC/GST Number, values taken verbatim from the reference PDFs (Aaradhya Adorer / 142320110000165 / Bank of India / Talawade / BKID0001423 / 27ABLFA0695F1ZC) — these are organization-level constants, not per-Event data, so they're hardcoded (or pulled from a single org-settings source, if one already exists) rather than entered per Quotation.
- [ ] "Regards / Aaradhya Banquets" renders as the final closing line.
- [ ] None of this section is user-editable from any screen in the app — it is compiled into the PDF template directly (SRS FR-QUO-10).
**UI:** Quotation PDF rendering component, static footer section.
**Tokens:** N/A (fixed reproduction).
**Edge cases:** None specific to data — this section's correctness is purely a text-fidelity check (STORY-075 covers verifying it word-for-word against the reference PDFs).

### STORY-074: Quotation Snapshot persistence and history list
**Flow:** Every time "Generate Quotation PDF" runs (from Event Detail, STORY-052's existing action, or from the wizard's Step 5, STORY-068), the render is persisted as a Quotation Snapshot, and the Event Page exposes a list of every prior generation for that Event — per `Aaradhya_Quotation_PDF_Strategy.md` and SRS FR-QUO-11/12.
**Acceptance Criteria:**
- [ ] A new `quotations` collection stores, per generation: `eventId`, `generatedAt`, `generatedBy` (the User Account that triggered it), `storageKey` (the object-storage key — never a bare public URL), and `grandTotal` (the snapshot's own computed Grand Total, so a history list can render without re-fetching/re-rendering the PDF itself).
- [ ] `GET /events/:id/quotation.pdf` (the existing endpoint) is extended so that, alongside streaming the freshly-rendered PDF back to the caller as it does today, it also uploads that same render to object storage and writes the corresponding `quotations` document — every call both serves and persists; there is no separate "confirm as final" step.
- [ ] A new `GET /events/:id/quotations` endpoint lists that Event's Quotation Snapshots, newest first, with `generatedAt`/`generatedBy`/`grandTotal` per entry and a short-lived signed download URL per entry (never a permanent public link stored or returned as-is).
- [ ] The Event Page (Overview tab or a small dedicated area near the "Generate Quotation PDF" action) renders this history list, each entry re-downloadable via its signed URL.
- [ ] `eventManagerOnly` gating on both new/extended endpoints, matching every other financial-adjacent endpoint's existing convention (Payment Record, full Change Log).
**UI:** A small quotation-history list on the Event Page, fed by the new list endpoint.
**Tokens:** `surface`, `line`, `type-body-m`, `type-label-s`.
**Edge cases:** Regenerating a Quotation for an Event whose data changed since the last generation produces a new snapshot with a different Grand Total — the history list must show both snapshots distinctly (by timestamp and Grand Total), never overwrite or merge them.

### STORY-075: Quotation fidelity acceptance test — golden-file comparison against the two reference PDFs
**Flow:** No new user-facing flow — this is the story that proves STORY-069 through STORY-073 actually reproduce `example_quatation_1.pdf` and `example_quatation_2.pdf`, rather than merely believing they do.
**Acceptance Criteria:**
- [ ] Two fixture Events are seeded in a test database, with every field populated to exactly match the data underlying `example_quatation_1.pdf` (Sneha & Nishant) and `example_quatation_2.pdf` (Saish Rege) respectively — every Client Contact, every Session, every Accommodation Room Line (including the zero-valued Extra Beds row), every Meal/Ceremony Item (including L.S. flags and blank-field Ceremony rows), and the manually-added Decoration/Photographer/Bhatji line items with their notes, taken field-for-field from the two source PDFs.
- [ ] For each fixture Event, generating a Quotation produces a Total Cost Summary whose Food Cost row reads exactly `597150` / `627007.5` (fixture 1) and `391500` / `411075` (fixture 2), and whose Grand Total row reads exactly `Rs. 10,73,208 /-` (fixture 1) and `Rs. 9,49,555 /-` (fixture 2) — asserted as exact string/number equality in an automated test, not visual inspection.
- [ ] Every table's row count, column headers, and cell values (Client Details, Event Details, Accommodation Details including the Extra-Beds row and the green/yellow footer shading, both per-date Event Details tables including every Ceremony merged-row variant, and the Total Cost Summary) are asserted against the corresponding values transcribed from the two reference PDFs, table by table, in an automated snapshot-style test.
- [ ] The static footer (Terms & Conditions, Documents Required, Bank Details) is asserted word-for-word against the reference PDFs' text, catching any drift introduced after STORY-073 ships.
- [ ] This test suite is wired into CI so any future change to the Quotation renderer that breaks fidelity against either reference PDF fails the build, rather than silently regressing.
**UI:** None (test-only story).
**Tokens:** N/A (test-only story).
**Edge cases:** A future GST% change (org-wide default, SRS §4.9) must not silently break this test — the two fixture Events pin their own GST% explicitly to 5% (matching what both reference PDFs actually used) regardless of whatever the org-wide default happens to be at test-run time, so the fixtures stay valid even if the default rate is changed later.
