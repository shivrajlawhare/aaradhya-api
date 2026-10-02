import { hash } from '@node-rs/argon2';
import type { ServerInferRequest, ServerInferResponses } from '@ts-rest/core';
import type { AppRouteQueryImplementation } from '@ts-rest/express';
import type { contract } from '../contract/index.js';
import { Role, User, type UserDocument } from '../models/user.js';
import { logChange } from '../services/change-log.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';

type CreateUserRequest = ServerInferRequest<typeof contract.createUser>;
type CreateUserResponse = ServerInferResponses<typeof contract.createUser>;
type ListUsersResponse = ServerInferResponses<typeof contract.listUsers>;
type ListEventManagersResponse = ServerInferResponses<typeof contract.listEventManagers>;
type UpdateUserRequest = ServerInferRequest<typeof contract.updateUser>;
type UpdateUserResponse = ServerInferResponses<typeof contract.updateUser>;
type DeleteUserResponse = ServerInferResponses<typeof contract.deleteUser>;

// Soft-deleted accounts (DEV-13) are left out of everything but name
// lookups — `deletedAt: null` also matches documents saved before the field
// existed.
const NOT_DELETED = { deletedAt: null };

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
  const accounts = await User.find(NOT_DELETED).sort({ createdAt: 1 });
  return { status: 200, body: accounts.map(toPublicUser) };
};

// Every Event Manager account, active or not — a deactivated manager can
// still be the `event_manager` on historical Events, so the calendar
// filter picker (STORY-037) needs to keep resolving/displaying their name
// even after deactivation, not just currently-active managers.
export const listEventManagers = async (): Promise<ListEventManagersResponse> => {
  const accounts = await User.find({ role: Role.EventManager }).sort({ name: 1 });
  return { status: 200, body: accounts.map((account) => ({ id: account.id, name: account.name })) };
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

  // A deleted account can't be reactivated or re-roled — it's gone from
  // User Management (DEV-13).
  const account = await User.findOneAndUpdate({ _id: params.id, ...NOT_DELETED }, update, {
    returnDocument: 'after',
    runValidators: true,
  });

  if (!account) {
    return userNotFound;
  }

  return { status: 200, body: toPublicUser(account) };
};

const cannotDeleteEventManager: Extract<DeleteUserResponse, { status: 400 }> = {
  status: 400,
  body: { error: { code: 'EVENT_MANAGER_NOT_DELETABLE', message: "Event Managers can't be deleted." } },
};

const cannotDeleteSelf: Extract<DeleteUserResponse, { status: 400 }> = {
  status: 400,
  body: { error: { code: 'CANNOT_DELETE_SELF', message: "You can't delete your own account." } },
};

/**
 * CR-1 D15 — a soft delete, for F&B Head / Housekeeping / Reception only:
 * sets `deletedAt` and `active: false`, so the account leaves the
 * Users list and can't log in (auth.ts, middleware/auth.ts), while past
 * Change Log entries still resolve its name (GET /change-log). Event
 * Managers — which includes the caller — are never deletable. Logged as a
 * `User` Change Log entry.
 */
export const deleteUser: AppRouteQueryImplementation<typeof contract.deleteUser> = async ({ params, req }) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate first.
    throw new Error('deleteUser handler ran without an authenticated user.');
  }
  if (params.id === req.user.id) {
    return cannotDeleteSelf;
  }

  const account = await User.findOne({ _id: params.id, ...NOT_DELETED });
  if (!account) {
    return { status: 404, body: userNotFound.body };
  }
  if (account.role === Role.EventManager) {
    return cannotDeleteEventManager;
  }

  const deletedAt = new Date();
  account.deletedAt = deletedAt;
  account.active = false;
  await account.save();

  await logChange({
    entityType: 'User',
    entityId: account.id,
    field: 'deletedAt',
    oldValue: null,
    newValue: deletedAt,
    changedByUserId: req.user.id,
  });

  return { status: 204, body: undefined };
};
