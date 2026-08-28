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
