# Aaradhya API — Rules

Read before any change:
@docs/coding-guidelines.md
@docs/typescript-rules.md
@docs/naming-conventions.md
@docs/git-guidelines.md
@docs/directory-structure.md
@docs/handler-patterns.md
@docs/api-conventions.md

## Spec is the source of truth
- Full spec: docs/spec/Aaradhya_SRS_v1.1.md (+ docs/spec/Spec_Amendment_MultiDate_Sessions.md)
- Work is sliced into stories: docs/stories/Aaradhya_Story_Backlog.md
- Never implement beyond what the current story's Acceptance Criteria asks for.
  If the spec and the story conflict, or the story is ambiguous, stop and ask -
  don't guess and don't silently expand scope.

## Every change is scoped to one story
- State the STORY-ID you're implementing at the start of the session.
- Commits reference it - see docs/git-guidelines.md for the exact format.

## Layering
- router.ts wires the @ts-rest/express router to @aaradhya/contracts. No logic here.
- controllers/ is the handler - owns the DB call and the business logic
  (see docs/handler-patterns.md - read "resolver" as "route handler").
- services/ holds pure, DB-free computation (totals, rollups, overlap
  queries) so it's unit-testable without a running server or DB.
- Only extract to utils/ once a pattern genuinely repeats - don't
  pre-abstract for a single caller.

## Every derived/computed field is server-computed, never client-trusted
Per the SRS: accommodation totals, payment balance, item total_cost, and
the quotation rollup are always recalculated server-side in services/; a
client-submitted value for any of them is ignored, not validated-and-accepted.

## Stack
TypeScript, Express 5, ts-rest (@ts-rest/express), Mongoose/MongoDB, Zod,
jose (JWT), argon2 (password hashing). REST only - no GraphQL, no AppSync,
no Lambda resolvers; that's Voyager's stack, not this one. Full rationale
and pinned versions: docs/Aaradhya_Tech_Architecture.md.

## Before committing
Run the review-standards skill against the diff (see
.claude/skills/review-standards/SKILL.md) - catches naming, layering, and
smell issues against the docs above before they reach review.
