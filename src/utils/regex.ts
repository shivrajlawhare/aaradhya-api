// Escapes regex metacharacters in a caller-supplied string before it
// becomes part of a $regex query — a literal search/match for "3.5" or
// "*" must match that literal text, not be interpreted as a pattern.
// Shared by controllers/menu-items.ts (search) and controllers/events.ts
// (case-insensitive exact-name lookup during a Menu Item find-or-create,
// STORY-032) — extracted here once a second real caller needed the exact
// same escaping (directory-structure.md: "only extract to utils/ once a
// pattern genuinely repeats").
export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
