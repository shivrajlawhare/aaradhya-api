## API Conventions — STATUS: not yet settled

Flagged as a gap in `docs/Aaradhya_Dev_Process_and_Structure.md` §0 and §5: Voyager's `docs/graphql-conventions.md` doesn't port over (it's entirely GraphQL/AppSync-shaped — `Input`/`Response` type suffixes, the 3-node `{ success, node/nodes, message }` envelope, `AppSyncResolverEvent`), and nothing has replaced it yet for REST. Settle this before or alongside real endpoint work — the `@aaradhya/contracts` package needs a fixed response shape to define contracts against; don't let it get decided implicitly, one endpoint at a time.

Decide and document here:

### Route naming
Verb-free, plural-noun REST paths — e.g. `GET /events`, `POST /events/:id/sessions` — confirm the exact convention for nested/sub-resources.

### Response envelope
Plain resource body vs. a wrapper object; if a wrapper, what shape. Note that Voyager's `{ success, node/nodes, message }` is GraphQL-resolver-shaped and probably isn't the right REST equivalent as-is.

### Error format
HTTP status code conventions, error body shape, how validation errors from the shared Zod schemas surface to the client.

### Pagination
Cursor vs. offset, query param names, default/max page size.

Once decided, this file becomes the thing `contracts/src/schemas/` and every `@ts-rest/express` route in `router.ts` are held to — reference it from `.claude/CLAUDE.md` the same way `docs/handler-patterns.md` already is.
