## Coding Guidelines

Carried over verbatim from the Voyager rules export per `docs/Aaradhya_Dev_Process_and_Structure.md` §0 — genuinely stack-agnostic TypeScript guidance. Framework/REST-specific guidance lives separately in `docs/typescript-rules.md`, `docs/handler-patterns.md`, and `docs/api-conventions.md`.

### Do's

- Use TypeScript for type safety. Prefer interfaces over types.
- When generating code, prioritize TypeScript best practices.
- Follow the coding standards defined in the ESLint configuration.
- Minimize the use of AI generated comments, instead use clearly named variables and functions.
- Use functional and declarative programming patterns; avoid classes.
- Prefer native functions over custom or Lodash's.
- Use Lodash helpers instead of custom solutions.
- Maintain consistency in naming and problem-solving.
- Write indistinguishable, simple, and clean code.
- Use modern (ES6+) solutions, e.g. object destructuring.
- Use arrow functions for consistency.

### Don'ts

- Avoid strings for properties in Lodash functions.
- Prioritize clean code over performance unless necessary.
- Avoid `any` type unless absolutely needed.
- Prefer simple solutions over complex ones.
- Use `async`/`await` instead of callbacks or `.then()`.
- Avoid using `void` before a function call if it doesn't return anything.

> Note carried from the source export as-is: the two Lodash lines above ("prefer native over Lodash" vs. "use Lodash helpers instead of custom solutions") read as contradictory. Aaradhya has no Lodash dependency yet — if one gets added, resolve this tension explicitly rather than leaving both standing.
