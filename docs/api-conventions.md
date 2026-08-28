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
