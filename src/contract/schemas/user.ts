import { z } from 'zod';
import { Role } from '../../models/user.js';

/**
 * `name`/`username`/`password` all reject blank-after-trim values, not just a
 * missing key — an empty-string password is as unusable a credential as a
 * missing one, so it's a 400 here (unlike login, where an empty password is
 * deliberately routed to the same 401 as any other wrong credential).
 */
export const createUserBodySchema = z.object({
  name: z.string().trim().min(1),
  username: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
  role: z.nativeEnum(Role),
});

// The public User Account shape — everything STORY-001's schema persists
// except `passwordHash`. Shared by createUser, listUsers, updateUser.
export const userResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  role: z.nativeEnum(Role),
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Standard 24-hex-char Mongo ObjectId shape. A malformed id is a 400
// (VALIDATION_ERROR, caught by the global handler) — "not shaped like an id"
// and "shaped like an id but doesn't exist" (404) are different failures.
export const userIdParamsSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid user id.'),
});

// Both fields optional and independently settable — a caller may send just
// `active`, just `role`, or both (STORY-006 AC).
export const updateUserBodySchema = z.object({
  active: z.boolean().optional(),
  role: z.nativeEnum(Role).optional(),
});
