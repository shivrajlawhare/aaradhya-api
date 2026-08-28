## Naming Conventions

Carried over from the Voyager rules export (`docs/naming-conventions.md`) per `docs/Aaradhya_Dev_Process_and_Structure.md` §0 — the `Queries`/`Mutations` field-naming lines were GraphQL-schema-specific and are struck; everything else is stack-agnostic and kept as-is.

- `Boolean`: Start with `is`, `can`, `are` (e.g., `isActive`).
- `Date`: End with `At` (e.g., `createdAt`).
- `Array`: Use plural form (e.g., `invoices`).
- `Object`: Use plural or `Map` suffix (e.g., `invoiceMap`).
- `File Names`: Use lowercase with dashes (e.g., `jobs.ts` or `jobs-utils.ts`).
- `Directories`: Use lowercase with dashes (e.g., `user-documents`).
- `Enums`: Use TitleCase (e.g., `EventStatus`).

### REST-specific naming (new — replaces the struck GraphQL rules)

- **Routes**: plural nouns, kebab-case path segments — `GET /events`, `GET /events/:id`, `POST /events/:id/sessions`.
- **ts-rest contract keys** (in `contracts/src/routes/`): verb+noun matching the operation, not the HTTP verb — `createEvent`, `listEvents`, `updateSessionSchedule`.
- **Zod schemas** (in `contracts/src/schemas/`): `<Entity>Schema` for the persisted shape, `<Entity>InputSchema` for create/update payloads — e.g. `EventSchema`, `EventInputSchema`.
- The full route-naming/response-shape/error-format/pagination convention still needs to be settled in `docs/api-conventions.md` (currently a stub) before it's load-bearing.
