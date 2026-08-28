import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { apiErrorSchema } from './schemas/common.js';
import { loginBodySchema, loginResultSchema } from './schemas/auth.js';
import { createUserBodySchema, userResultSchema } from './schemas/user.js';

const c = initContract();

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

/**
 * Local home for the ts-rest contract until the shared `@aaradhya/contracts`
 * package location is settled (see docs/directory-structure.md open item).
 * Routes and schemas move to that package once the decision is made — the
 * import sites stay the same shape.
 */
export const contract = c.router({
  getHealth: {
    method: 'GET',
    path: '/health',
    responses: {
      200: healthResponseSchema,
    },
    summary: 'Liveness check',
  },
  login: {
    method: 'POST',
    path: '/auth/login',
    body: loginBodySchema,
    responses: {
      200: loginResultSchema,
      401: apiErrorSchema,
    },
    summary: 'Exchange username + password for a session token',
  },
  createUser: {
    method: 'POST',
    path: '/users',
    body: createUserBodySchema,
    responses: {
      201: userResultSchema,
      409: apiErrorSchema,
    },
    summary: 'Create a User Account (Event Manager only)',
  },
});
