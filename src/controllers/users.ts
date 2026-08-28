import { hash } from '@node-rs/argon2';
import type { ServerInferRequest, ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../contract/index.js';
import { User } from '../models/user.js';

type CreateUserRequest = ServerInferRequest<typeof contract.createUser>;
type CreateUserResponse = ServerInferResponses<typeof contract.createUser>;

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

// requireRole(Role.EventManager) already gated this route (src/router.ts) —
// nothing here caps how many EventManager accounts can exist; the "up to 3"
// in the SRS is a current headcount, not a system limit.
export const createUser = async ({ body }: CreateUserRequest): Promise<CreateUserResponse> => {
  const { name, username, password, role } = body;
  const passwordHash = await hash(password);

  try {
    const account = await User.create({ name, username, passwordHash, role });

    return {
      status: 201,
      body: {
        id: account.id,
        name: account.name,
        username: account.username,
        role: account.role,
        active: account.active,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      },
    };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return {
        status: 409,
        body: {
          error: {
            code: 'USERNAME_TAKEN',
            message: 'A user with that username already exists.',
          },
        },
      };
    }
    throw error;
  }
};
