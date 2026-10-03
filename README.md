# aaradhya-api

REST API for the Aaradhya Event Management System. One Express 5 app — TypeScript,
ts-rest, Mongoose/MongoDB, Zod. See `docs/Aaradhya_Tech_Architecture.md` for the
full rationale and `.claude/CLAUDE.md` for the working rules.

## Requirements

- Node 24 LTS (`.nvmrc` pins it)
- A MongoDB instance (local `mongodb://localhost:27017` or an Atlas cluster)

## Setup

```
nvm use          # Node 24
npm install
cp .env.example .env   # then fill in MONGODB_URI and JWT_SECRET
npm run dev
```

`GET /health` → `200 { "status": "ok" }` once the process is up and the DB
connection succeeds. `POST /auth/login` with `{ username, password }` →
`200 { token, user: { id, name, role } }`, or a uniform `401` on any bad
credential (see `docs/api-conventions.md`).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Watch-mode server via `tsx` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | `tsc -p tsconfig.json` (covers `src/` and `tests/`) |
| `npm test` | Vitest — `tests/**/*.test.ts` |
| `npm run seed:config` | Seed the Venue and Room Type master lists (safe to re-run) |
| `npm run migrate:dev07` | One-off DEV-07 migration: Dormitory → Family Room (see below) |
| `npm run migrate:v220` | One-off v2.2.0 migration: fixed extras → extra line items (see below) |

## Migrations

One-off data migrations live in `src/migrations/` (the logic, tested under
`tests/migrations/`), each with a thin runner in `scripts/`. Every migration is
idempotent.

| Migration | Run | What it does |
|---|---|---|
| DEV-07 `rename-dormitory-room-type.ts` | `npm run migrate:dev07` (also run by `seed:config`) | Renames the "Dormitory" Room Type to "Family Room" (occupancy 6 if it had none yet) and every Event room line whose `roomType` is "Dormitory". If an active "Family Room" already exists, an active "Dormitory" is deactivated instead. |
| DEV-20 (v2.2.0) `convert-legacy-extras.ts` | `npm run migrate:v220` — **run once per environment when deploying v2.2.0** | For every Event, each non-zero fixed extra (`decoration` / `photographer` / `bhatji`) becomes an extra line item named "Decoration" / "Photographer" / "Bhatji" (amount, no note), appended after the existing line items; then the fixed extras are reset to 0. The API no longer reads the fixed extras, so until this runs their amounts are missing from totals and quotations. |

Other DEV-07 data changes need no backfill: Room Types gained `occupancy`
(older records read 0 until Settings or `seed:config` sets it), and
`accommodation.discountPercent` defaults to 0 on existing Events.

## Layout

`src/` follows `docs/directory-structure.md`: `router.ts` (ts-rest wiring, no
logic), `controllers/` (handlers — own the DB call + business logic), `services/`
(pure DB-free computation), `models/` (Mongoose schemas). `tests/` mirrors `src/`,
with shared test infra in `tests/support/`.

## Tests

`tests/support/db.ts` spins up an in-memory MongoDB via `mongodb-memory-server`,
so model/endpoint tests run against a real MongoDB with no external service. The
first run downloads a `mongod` binary (~cached under `~/.cache/mongodb-binaries`
after that) — allow extra time or pre-warm it once on a fast connection.

## Setup decisions (STORY-000 scaffold)

- **Zod is pinned to v3**, not the `^4.4.3` in the architecture library table.
  `@ts-rest/core@3.52.1` declares `zod@^3.22.3` as its peer and does not type
  contract schemas correctly against Zod 4 (the risk §4 of the architecture doc
  flagged). Revisit when ts-rest 3.53 ships stable with Standard Schema support.
- **The ts-rest contract lives in `src/contract/`**, not a shared
  `@aaradhya/contracts` package — that package's home is still an open item in
  `docs/directory-structure.md`. Import sites keep the same shape when it moves.
- **Password hashing uses `@node-rs/argon2`**, not the `argon2` package in the
  architecture library table. `argon2` needs a node-gyp/Python build toolchain
  that isn't guaranteed on a dev machine; `@node-rs/argon2` is the same Argon2
  algorithm with prebuilt native binaries. The doc's §4 explicitly allows this
  swap.
- Not yet scaffolded: lint/format config, `docker-compose.yml`, and the frontend.
