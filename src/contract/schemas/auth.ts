import { z } from 'zod';
import { Role } from '../../models/user.js';

/**
 * Username is normalised (trim + lowercase) here so it matches the stored form
 * from STORY-001, and neither field has a `min` length: an empty or
 * whitespace-only value is a failed credential, answered with the same 401 as
 * any other bad login — never a 400 that would hint at what was wrong.
 * A structurally malformed body (missing key, wrong type) is still a 400.
 */
export const loginBodySchema = z.object({
  username: z.string().trim().toLowerCase(),
  password: z.string(),
});

export const loginResultSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    name: z.string(),
    role: z.nativeEnum(Role),
  }),
});
