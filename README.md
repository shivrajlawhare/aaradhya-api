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
