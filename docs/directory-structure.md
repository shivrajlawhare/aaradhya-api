## Directory Structure — aaradhya-api

Written fresh for Aaradhya per `docs/Aaradhya_Dev_Process_and_Structure.md` §0 — Voyager's micro-service/module layout (`modules/*`, `services/*`, `packages/*`, per-service `serverless.yml`, AppSync resolvers) doesn't apply. Aaradhya's backend is one Express app, not a services monorepo. The one principle that did carry over: this repo doesn't reach into `aaradhya-web`'s files by path, and vice versa — anything genuinely shared gets its own package, not a cross-repo file reference.

**Open item:** `docs/Aaradhya_Tech_Architecture.md` and `docs/Aaradhya_Dev_Process_and_Structure.md` were written assuming a single npm-workspaces monorepo (`contracts/`, `backend/`, `frontend/` as siblings under one root). This repo (`aaradhya-api`) and `aaradhya-web` currently exist as two separate git repos instead — so the shared `@aaradhya/contracts` package (Zod schemas + ts-rest contract) needs a home both repos can import from: its own repo published to a private registry, a `git+ssh` dependency, or a restructure back into one workspace. That's not yet decided — settle it before either repo starts importing `@aaradhya/contracts` for real.

```
aaradhya-api/
├── .claude/
│   ├── CLAUDE.md                 # root rules for this repo — always loaded
│   └── skills/
│       └── review-standards/
│           └── SKILL.md
├── docs/
│   ├── spec/                     # Aaradhya_SRS_v1.1.md, Spec_Amendment_MultiDate_Sessions.md
│   ├── stories/                  # Aaradhya_Story_Backlog.md (STORY-001-052)
│   ├── coding-guidelines.md
│   ├── typescript-rules.md
│   ├── naming-conventions.md
│   ├── git-guidelines.md
│   ├── directory-structure.md    # this file
│   ├── handler-patterns.md
│   └── api-conventions.md        # stub - settle before real endpoints ship
├── package.json
├── tsconfig.json
├── src/
│   ├── models/                   # Mongoose schemas - Event, Session, User, MenuItem, ChangeLogEntry
│   ├── contract/                  # local home for the ts-rest contract (schemas/ + routes) until @aaradhya/contracts is settled
│   ├── router.ts                 # @ts-rest/express router wired to the contract
│   ├── app.ts                    # builds the Express app (endpoints mounted) - imported by index.ts and by supertest
│   ├── controllers/               # per-route handlers - owns the DB call + business logic
│   ├── services/                 # unit-testable without an HTTP layer - totals, rollups, overlap checks, token sign/verify (DB-free) and change-log writes (touches the DB, STORY-008 - see that story's Decisions)
│   ├── middleware/                # auth, role guard (STORY-003)
│   ├── validations/                # request-specific Zod validation not already in the shared contract schema
│   ├── utils/
│   ├── types/                     # ambient TS augmentation (e.g. express.d.ts adds req.user)
│   ├── config.ts                  # env loading + required-var guard
│   ├── db.ts                      # Mongoose connect()
│   └── index.ts                   # startup: connect DB, then app.listen()
└── tests/                         # mirrors src/ - Vitest + supertest against the real Express app
```

Notes on this layout vs. Voyager's:

- No `resolvers/`, no `graphql/`, no `serverless_config/` — there's no AppSync/Lambda layer; `src/router.ts` mounts one Express app directly.
- `controllers/` is the direct equivalent of Voyager's "resolver" concept from `docs/handler-patterns.md` — same rule, REST framing.
- `validations/` shrinks compared to a hand-rolled REST setup, because most request/response shape validation now lives once in `contracts/src/schemas/` and is imported, not redeclared per repo.
