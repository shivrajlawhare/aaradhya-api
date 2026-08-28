## Handler Patterns (Controllers)

Reinterpreted from the Voyager rules export's "GraphQL Resolver/API Handler" section (`docs/general-code-patterns.md`, backend file) per `docs/Aaradhya_Dev_Process_and_Structure.md` §0. Read every "resolver" below as "route handler / controller" — the rule was already a REST-controller rule wearing a GraphQL label; nothing about the substance changes, only the framing.

1. **The controller owns the business logic and should not be too lean.** Don't push logic into `utils/` just to keep the controller file short — a controller that's mostly delegation is harder to follow than one that does its job in place.
2. **The controller owns the DB call.** Query the Mongoose model directly from the controller; don't wrap a single `Model.find()` in its own utility function purely to shorten the controller.
3. **Only extract to `utils/` once a pattern genuinely repeats across more than one controller** — don't pre-abstract for a single caller.
4. **Avoid repetitive, generic names** like `resolve`, `get`, `handle` for variables and functions — name them for what they actually do (`fetchUpcomingEvents`, not `get`).

### Layering specific to Aaradhya

- `router.ts` wires the `@ts-rest/express` router to the contract from `@aaradhya/contracts` — no logic here; a handler whose return shape doesn't match the contract fails to compile, so this file is deliberately thin.
- `controllers/` is the handler layer described above.
- `services/` holds pure, DB-free computation (accommodation totals, quotation rollup, calendar overlap queries) so it's unit-testable without a running server or database — this is new structure, not in the original Voyager pattern, but follows directly from rule 3 above once "the thing that repeats" turns out to be computation rather than a DB call.
- Every derived/computed field — accommodation totals, payment balance, item `total_cost`, the quotation rollup — is recalculated server-side in `services/`, never trusted from the client. A client-submitted value for any of these is ignored, not validated-and-accepted.

### Not carried over

Voyager's `docs/graphql-conventions.md` (the `AppSyncResolverEvent` handler signature, the two-line CloudWatch log-on-entry convention, `context.callbackWaitsForEmptyEventLoop = false`, the `success`/`node`/`nodes`/`message` response envelope, the `@allmysons/schema/<name>` import path) is entirely AppSync/Lambda-specific and does not apply to a plain Express process. Aaradhya's actual REST response shape, error format, and pagination convention still need to be decided — see `docs/api-conventions.md`.
