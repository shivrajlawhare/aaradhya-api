## API Conventions

Voyager's `docs/graphql-conventions.md` doesn't port over (it's GraphQL/AppSync-shaped —
`Input`/`Response` suffixes, the 3-node `{ success, node/nodes, message }` envelope,
`AppSyncResolverEvent`). This file replaces it for REST. Sections marked **SETTLED**
are load-bearing now; the rest are still open and should be settled alongside the
first endpoint that needs them.

### Response envelope — SETTLED (STORY-002, extended STORY-005)

- **Success:** the plain resource body, no wrapper.
  `POST /auth/login` → `200 { "token": "...", "user": { "id", "name", "role" } }`.
  `POST /users` → `201` the created User Account (no `passwordHash`).
- **Error:** a single wrapper object, always this shape:
  ```json
  {
    "error": {
      "code": "SCREAMING_SNAKE_CASE",
      "message": "Human-readable sentence.",
      "details": [{ "field": "password", "message": "Required" }]
    }
  }
  ```
  `code` is a stable machine string clients can branch on; `message` is display-ready
  English. `details` is **optional** — present only on `400 VALIDATION_ERROR` (one
  entry per failing field, `field` is the dotted path into the body); every other
  error omits it.

### Success status codes — SETTLED (STORY-005)

- `200` — read, or a write with no natural "new resource" (e.g. login).
- `201` — a `POST` that creates a resource; body is the created resource.

### Error status codes — SETTLED (STORY-002, extended STORY-005)

- `400 VALIDATION_ERROR` — the request body/params fail the contract's Zod schema
  (missing key, wrong type, wrong enum value). A single global
  `requestValidationErrorHandler` (`src/app.ts`) reshapes ts-rest's default raw-Zod
  400 into the envelope above with `details` populated — every route gets this for
  free, nothing per-route to wire.
- `401` — authentication failed or is missing.
- `403` — authenticated but not allowed (role guard — STORY-003).
- `404` — addressed resource does not exist.
- `409` — conflict with existing state, e.g. `409 USERNAME_TAKEN` on `POST /users`
  for a duplicate `username` (case-insensitive, per STORY-001).

### Authentication failures are uniform — SETTLED (STORY-002)

Every `POST /auth/login` failure — unknown username, wrong password, deactivated
account, empty-string password — returns the **identical** body:
`401 { "error": { "code": "INVALID_CREDENTIALS", "message": "Incorrect username or password." } }`.
No response, timing branch, or status code distinguishes them (no account
enumeration). A structurally malformed body is still a `400` — that reflects the
request shape, not which credential was wrong.

### Session token — SETTLED (STORY-002)

- Signed JWT, `HS256`, secret from `JWT_SECRET`. Lifetime from `JWT_EXPIRES_IN`
  (default `8h`) — a technical knob, not a product requirement (SRS FR-AUTH-4).
- Claims: `sub` = user id, `role` = the user's Role at issue time.
- Passed by the client as `Authorization: Bearer <token>` (scheme is
  case-insensitive).

### Auth middleware + role guard — SETTLED (STORY-003)

- `authenticate` verifies the Bearer token, then **re-loads the user from the
  database** and populates `req.user = { id, role }` from that row. A token is
  only as good as the current account:
  - missing / malformed / bad-signature / expired token → `401`
    `{ "error": { "code": "UNAUTHENTICATED", "message": "Authentication required." } }`
  - token valid but the account is now deleted or `active: false` → same `401`
  - **v1 decision:** deactivation and role changes take effect on the *next*
    request, not at token expiry. Authorization always runs against the live
    `role`, never a stale token claim — matters for the payment/change-log
    restriction (SRS §6.2).
- `requireRole(...roles)` runs after `authenticate`; if `req.user.role` is not in
  the allow-list → `403`
  `{ "error": { "code": "FORBIDDEN", "message": "You do not have access to this resource." } }`.

### POST /users — SETTLED (STORY-005)

- Gated by `requireRole(Role.EventManager)`; no other role may create accounts.
  No caller (missing token) → `401`; wrong role → `403`.
- **Empty-string `name`/`username`/`password` is a `400 VALIDATION_ERROR`**, not
  accepted-and-created — unlike login, where an empty password is deliberately
  routed to the same `401` as any other bad credential. Creation has no
  no-enumeration constraint to protect, so there's no reason to accept a
  practically-unusable password; reject it up front instead of persisting an
  account with a credential nobody could reasonably use.
- No cap on how many `EventManager` accounts exist. The SRS's "up to 3 concurrent
  Event Manager accounts" (§3) is a current headcount, not a system limit —
  nothing in this endpoint counts or restricts it.
- The 201 body is `userResultSchema` (`src/contract/schemas/user.ts`) — the same
  shape `GET /users`/`PATCH /users/:id` (STORY-006) reuse, so the public User
  Account shape is defined once.

### GET /users, PATCH /users/:id — SETTLED (STORY-006)

- Both gated by `requireRole(Role.EventManager)`, same as `POST /users`.
- `GET /users` returns a bare array (`200 [ userResultSchema, ... ]`) — no
  wrapper, no pagination. At Aaradhya's scale (~15 users total, an internal
  ops tool) this list never needs paging; if that changes, revisit the
  `Pagination — OPEN` section below rather than bolting a wrapper onto this
  endpoint alone.
- `PATCH /users/:id` accepts `{ active?, role? }`; either, both, or neither may
  be present (an empty body is a harmless no-op 200, not an error).
- Path id must look like a Mongo ObjectId (24 hex chars) — enforced at the
  contract's `pathParams` schema, not in the handler. A malformed id is a
  `400 VALIDATION_ERROR`; a well-formed id with no matching account is
  `404 { "error": { "code": "USER_NOT_FOUND", ... } }`. Different failures,
  different codes — a malformed id was never going to resolve to a real
  account, so it isn't really a "not found."
- **v1 decision (was flagged as open in the story): an Event Manager CAN
  deactivate (or demote) their own account, and it takes effect immediately.**
  No self-modification guard in the handler — `authenticate` (STORY-003)
  already re-checks `active` and the live `role` against the database on
  every request, so a self-deactivation just means the caller's own next
  request gets the normal `401` anyone else's would. Nothing new to build or
  test beyond confirming that existing mechanism covers it.

### GET /change-log — SETTLED (STORY-009)

- `requireRole(Role.EventManager)`, same as the other STORY-005/006/008 routes.
- Query params `entityType` + `entityId` (both required — a `400
  VALIDATION_ERROR` without either); returns every `ChangeLogEntry` for that
  exact pair, sorted `timestamp` descending (newest first).
- An entity with no logged changes returns `200 []`, not `404` — "no history
  yet" isn't an error, and there's no per-entity resource here to be missing.
- **No pagination — deliberate, not an oversight.** Unlike `GET /users`
  (bounded by headcount), this list is bounded by one Event's edit history
  over its lifetime — plausibly dozens of entries, not thousands, at
  Aaradhya's scale (SRS §6.1). Revisit if a single event's change history
  ever gets large enough to matter — see `Pagination — OPEN` below.

### POST /events — SETTLED (STORY-012)

- Gated by `requireRole(Role.EventManager)`, same as the STORY-005/006/008/009 routes.
- `status` is optional in the request body and defaults to `Tentative` when absent —
  not always forced to `Tentative`. FR-EVT-1 names "initial status" as a real
  creation input, so a caller may open an Event directly as e.g. `Confirmed`.
- `client_contacts` must have at least one row, and every row's `name` and
  `contactNumber` must be non-empty — this is where FR-EVT-1's "at least one
  Client Contact" rule is actually enforced (STORY-011's Mongoose schema itself
  allows zero rows, so it stays reusable outside this endpoint). Both violations
  surface as the standard `400 VALIDATION_ERROR`.
- `event_manager` referencing a nonexistent User Account, or one whose role
  isn't `EventManager`, is also a `400 VALIDATION_ERROR` (`details: [{ field:
  "eventManager", ... }]`) — reusing the same code as any other bad-body field
  rather than inventing a new one, even though this particular check runs as a
  Mongoose validator (STORY-011) after the request already passed the
  contract's Zod schema, not inside that schema itself.
- `event_manager` may reference a User Account that is currently
  `active: false` — allowed, not rejected. Consistent with STORY-006/011: only
  `authenticate` enforces `active` (on every request, re-checked live), so
  nothing that merely stores a user reference re-implements that check.
- `created_by` always comes from `req.user.id`; any `createdBy` sent in the
  request body is silently ignored, never persisted.
- `201` body is `eventResultSchema` (`src/contract/schemas/event.ts`). Client
  Contact rows in the response carry no `id` — STORY-011's schema keeps
  Mongoose's default per-row `_id` for later edit/remove support, but nothing
  reads/returns it yet; add it to the response shape when a story actually
  needs to address one row.

### GET /events, GET /events/:id — SETTLED (STORY-013)

- Both gated only by `authenticate` — no `requireRole`. Any authenticated
  caller, regardless of role, gets the full Event document. Role-based field
  filtering (e.g. hiding payment data from Reception) is a later story that
  wraps this one; nothing here narrows the response yet.
- `GET /events` returns a bare array (`200 [ eventResultSchema, ... ]`), same
  shape/no-pagination convention as `GET /users` — no Event volume at
  Aaradhya's scale needs paging yet.
- `GET /events/:id` — malformed id (not 24 hex chars) is a `400
  VALIDATION_ERROR` at the contract's `pathParams` schema, same convention as
  `PATCH /users/:id`; a well-formed id with no matching Event is `404 {
  "error": { "code": "EVENT_NOT_FOUND", ... } }`.
- **`eventResultSchema` includes `accommodation` as of STORY-020** — added
  retroactively (this section stayed "STORY-013" since nothing else about
  it changed): STORY-020's Rooms tab needed a way to read the *current*
  Accommodation Block on first render, and no story had ever added a GET
  for it (STORY-019 only added the PATCH). Reuses STORY-019's own
  `toPublicAccommodation`, so the shape is identical to that PATCH
  endpoint's response body — purely additive, every existing consumer of
  `eventResultSchema` (`POST /events`, `GET /events`, `PATCH /events/:id`)
  just gained one more field.

### PATCH /events/:id — SETTLED (STORY-014)

- Gated by `requireRole(Role.EventManager)`, same as the other write routes
  on Event.
- Every field is optional (`eventFamilyType`, `status`, `eventManager`,
  `clientContacts`) — a caller sends only what changed, same `PATCH`
  semantics as `PATCH /users/:id`.
- A submitted `clientContacts` array still needs at least one row — the
  same "at least one Client Contact" rule `POST /events` enforces at create
  time, restated here because *removing* the last row is exactly what this
  endpoint has to reject. Violation is `400 VALIDATION_ERROR`.
- **A field is only written, and only logged, when its submitted value
  actually differs from what's stored.** A PATCH that resends identical
  values for every field it includes writes zero Change Log Entries and
  still returns `200` with the unchanged Event — not an error, not a no-op
  log entry. This is the controller acting as the "caller" STORY-008's
  `logChange` helper already assumes exists: the helper itself is
  unchanged and would still write an entry if invoked with equal
  `oldValue`/`newValue` (STORY-008's own documented behavior) — this
  endpoint simply doesn't invoke it for a field that didn't change.
- Editing several fields in one request writes one Change Log Entry per
  *changed* field (not one entry summarizing the whole PATCH) — matches
  STORY-008's "two calls for the same entity with different `field` values
  always produce two separate entries."
- `clientContacts` changes log the **full before/after array** as
  `oldValue`/`newValue` (not a per-row diff) — same "store the full value,
  simpler v1 choice" STORY-008 already made for exactly this field.
- `event_manager` referencing a nonexistent or wrong-role User Account is a
  `400 VALIDATION_ERROR` (`details: [{ field: "eventManager", ... }]`) —
  identical shape and reasoning to `POST /events`'s same check; the update
  is rejected wholesale (no partial write) when this happens.
- Concurrent edits to the same Event by two Event Managers are **not**
  reconciled — last write to reach the database wins, exactly as a plain
  `findByIdAndUpdate` behaves with no extra locking. Deliberate
  non-requirement for v1, not a bug; revisit only if real conflicting
  concurrent edits turn out to matter in practice.

### PATCH /events/:id/accommodation — SETTLED (STORY-019)

- Gated by `requireRole(Role.EventManager)`, same as the other write routes
  on Event.
- Every field is optional (`checkIn`, `checkOut`, `roomLines`) — same PATCH
  semantics as `PATCH /events/:id`.
- The **response body is the Accommodation Block itself**, not the parent
  Event — `{ checkIn, checkOut, totalDays, roomLines: [{ roomType,
  occupancy, tariff, noOfRooms, totalInclGst }], totalOccupancy,
  totalCharges }`. `checkIn`/`checkOut`/`totalDays` are `null`, not omitted,
  when no accommodation has been entered yet.
- `totalDays`, per-line `totalInclGst`, `totalOccupancy`, and `totalCharges`
  are **always freshly computed from the just-updated document** (STORY-018's
  pure functions) — never stored, so a submitted value for any of them
  (`{ "totalCharges": 999999 }`, say) is silently ignored, not
  validated-and-rejected: the response schema simply doesn't accept those
  keys as input at all.
- `roomLines` as `[]` is a valid, ordinary request — an Accommodation Block
  with zero rooms, not an error; every total computes to `0`.
- Each of `checkIn`/`checkOut`/`roomLines` that actually changes writes its
  own Change Log Entry (same "one entry per changed field" granularity
  `PATCH /events/:id` already uses) — a whole-array change to `roomLines` is
  ONE entry with the full before/after array (matching how `clientContacts`
  is logged), not one entry per room line. The logged `roomLines` value is
  always the raw stored shape (`roomType`/`occupancy`/`tariff`/`noOfRooms`)
  — never `totalInclGst`, since that's never stored and logging a transient,
  always-recomputed value would misrepresent what's actually persisted.

### PATCH /events/:id/payment — SETTLED (STORY-022)

- Gated by `requireRole(Role.EventManager)`, same as the other write routes
  on Event.
- Every field is optional (`totalEstimatedAmount`, `advanceRequired`,
  `advancePaid`, `advancePaidDate`, `paymentMode`) — same PATCH semantics
  as every other sub-resource on Event.
- The **response body is the Payment Record itself**, not the parent Event
  — same "sub-resource route returns its sub-resource" convention
  `PATCH /events/:id/accommodation` already established. `balance` is
  always freshly computed (STORY-021's `computeBalance`) from whatever
  `totalEstimatedAmount`/`advancePaid` are currently stored — never itself
  stored, so a submitted `balance` in the request body is silently ignored
  (the schema doesn't accept the key at all).
- `totalEstimatedAmount`, `advanceRequired`, and `advancePaid` all reject a
  negative value as `400 VALIDATION_ERROR` — "money in can't be negative"
  applies to all three, not just `advance_paid`. `balance` itself, being
  derived, is unaffected — it can still go negative (overpayment), which is
  the correct, representable state, not an error.
- **No cross-field validation between `advancePaidDate` and `advancePaid`**
  — setting `advancePaidDate` while `advancePaid` is still `0` is allowed,
  not rejected. Decided (this story's own edge case) as: a caller may
  record an expected/planned advance-payment date before the money is
  actually confirmed as received.
- Each of the five fields that actually changes writes its own Change Log
  Entry — same "one entry per changed field" granularity every other Event
  PATCH uses.
- `GET /events/:id` does **not** yet include `payment` in its response
  (unlike `accommodation`, added in STORY-020) — no story has needed to
  read it yet. Expect this to recur the same way it did for accommodation,
  the first time a story needs to display current payment data (likely the
  Payments tab UI).

### No brute-force protection in v1 — SETTLED (STORY-002)

No login rate-limiting or account lockout. Deliberate: ~15 internal, trusted users
(SRS §6.1), and §6.2's security list is limited to server-side RBAC, payment/log
restriction, and salted hashing — brute-force defence is not called for. Revisit if
the user base or threat model changes.

### Route naming — OPEN

Verb-free, plural-noun paths (`GET /events`, `POST /events/:id/sessions`). Confirm
the exact convention for nested/sub-resources before Event Management stories.

### Pagination — OPEN

Cursor vs. offset, param names, default/max page size. Settle before the first
list endpoint that can return more than a screenful.
