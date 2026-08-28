## TypeScript Rules

Reinterpreted from the Voyager rules export's "Typescript Types" sections (`docs/general-code-patterns.md`, both the frontend and backend exports) per `docs/Aaradhya_Dev_Process_and_Structure.md` §0. The originals assumed a GraphQL-codegen pipeline; Aaradhya has no codegen step at all (see `docs/Aaradhya_Tech_Architecture.md` §2) — types come from the shared `@aaradhya/contracts` package instead.

1. **Do not use type assertions (`as`)** or hand-rolled `is` type guards. Use proper type narrowing, or fix the underlying type instead of casting past it.
2. **Never use `any`** unless there's genuinely no better option — and if you reach for it, say why in a comment.
3. **Types come from `@aaradhya/contracts`, not from hand-written duplicates.** The contract package's Zod schemas are the single source of truth for every request/response shape; import the inferred TypeScript types directly (`import type { ... } from '@aaradhya/contracts'`) instead of redeclaring a matching type locally. There's no generated-file step to keep in sync — the compiler enforces the match — so "types are already defined, don't redeclare them" now means "the types live in `contracts/`," not "run codegen first."
4. **Use constants for labels and repeated string values** — session status strings, role names, event categories — rather than inline magic strings.
