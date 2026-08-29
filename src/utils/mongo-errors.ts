// Recognises a MongoDB duplicate-key error (E11000) — thrown when a
// `.create()`/`.save()` violates a unique index. Shared by
// controllers/users.ts (username) and controllers/menu-items.ts (name) —
// extracted here once a second real caller needed the exact same check
// (directory-structure.md: "only extract to utils/ once a pattern
// genuinely repeats").
export const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
