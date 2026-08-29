import { z } from 'zod';

/**
 * The one error envelope every route uses (docs/api-conventions.md). `details`
 * is optional — only the global request-validation handler (src/app.ts)
 * populates it today; a handler-returned error (409, ...) omits it unless a
 * future story needs per-field feedback there too.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  }),
});

// Standard 24-hex-char Mongo ObjectId shape, reused wherever a request
// references an existing document by id. A malformed id is a 400
// (VALIDATION_ERROR) — it was never going to resolve to a real document,
// so it isn't the same failure as "well-formed but doesn't exist" (404).
export const objectIdSchema = (message = 'Invalid id.') =>
  z.string().regex(/^[0-9a-fA-F]{24}$/, message);
