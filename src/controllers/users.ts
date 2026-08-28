import { hash } from '@node-rs/argon2';
import type { ServerInferRequest, ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../contract/index.js';
import { Role, User, type UserDocument } from '../models/user.js';

type CreateUserRequest = ServerInferRequest<typeof contract.createUser>;
type CreateUserResponse = ServerInferResponses<typeof contract.createUser>;
type ListUsersResponse = ServerInferResponses<typeof contract.listUsers>;
type UpdateUserRequest = ServerInferRequest<typeof contract.updateUser>;
type UpdateUserResponse = ServerInferResponses<typeof contract.updateUser>;

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

const userNotFound: UpdateUserResponse = {
  status: 404,
  body: { error: { code: 'USER_NOT_FOUND', message: 'No user account with that id.' } },
};

// The public shape every route in this file returns — everything but passwordHash.
const toPublicUser = (account: UserDocument) => ({
  id: account.id,
  name: account.name,
  username: account.username,
  role: account.role,
  active: account.active,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
});

// requireRole(Role.EventManager) already gated this route (src/router.ts) —
// nothing here caps how many EventManager accounts can exist; the "up to 3"
// in the SRS is a current headcount, not a system limit.
export const createUser = async ({ body }: CreateUserRequest): Promise<CreateUserResponse> => {
  const { name, username, password, role } = body;
  const passwordHash = await hash(password);

  try {
    const account = await User.create({ name, username, passwordHash, role });
    return { status: 201, body: toPublicUser(account) };
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

export const listUsers = async (): Promise<ListUsersResponse> => {
  const accounts = await User.find().sort({ createdAt: 1 });
  return { status: 200, body: accounts.map(toPublicUser) };
};

// No self-deactivation guard, deliberately: authenticate() (STORY-003) already
// re-checks `active` and the live role on every request, so an Event Manager
// deactivating or demoting themselves just takes effect on their own next
// request the same way it would for anyone else — nothing extra to enforce here.
export const updateUser = async ({ params, body }: UpdateUserRequest): Promise<UpdateUserResponse> => {
  const update: { active?: boolean; role?: Role } = {};
  if (body.active !== undefined) {
    update.active = body.active;
  }
  if (body.role !== undefined) {
    update.role = body.role;
  }

  const account = await User.findByIdAndUpdate(params.id, update, {
    returnDocument: 'after',
    runValidators: true,
  });

  if (!account) {
    return userNotFound;
  }

  return { status: 200, body: toPublicUser(account) };
};
