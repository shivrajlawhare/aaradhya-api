## API Conventions

Voyager's `docs/graphql-conventions.md` doesn't port over (it's GraphQL/AppSync-shaped —
`Input`/`Response` suffixes, the 3-node `{ success, node/nodes, message }` envelope,
`AppSyncResolverEvent`). This file replaces it for REST. Sections marked **SETTLED**
are load-bearing now; the rest are still open and should be settled alongside the
first endpoint that needs them.

### Response envelope — SETTLED (STORY-002)

- **Success:** the plain resource body, no wrapper.
  `POST /auth/login` → `200 { "token": "...", "user": { "id", "name", "role" } }`.
- **Error:** a single wrapper object, always this shape:
  ```json
  { "error": { "code": "SCREAMING_SNAKE_CASE", "message": "Human-readable sentence." } }
  ```
  `code` is a stable machine string clients can branch on; `message` is display-ready
  English. No `details`/`fields` array yet — add one only when an endpoint needs
  per-field validation feedback (and document its shape here then).

### Error status codes — SETTLED (STORY-002)

- `400` — the request body/params fail the contract's Zod schema (missing key, wrong
  type). Emitted by `@ts-rest/express` before the handler runs.
- `401` — authentication failed or is missing.
- `403` — authenticated but not allowed (role guard — STORY-003).
- `404` — addressed resource does not exist.
- `409` — conflict with existing state (e.g. duplicate `username` — STORY-005).

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
- Claims: `sub` = user id, `role` = the user's Role. The STORY-003 middleware reads
  these back into `req.user = { id, role }`.
- Passed by the client as `Authorization: Bearer <token>` (consumed in STORY-003).

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
