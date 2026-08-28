import { verify } from '@node-rs/argon2';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Role, User } from '../../src/models/user.js';
import { signSessionToken } from '../../src/services/token.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';

const app = createApp();

const seedCaller = async (role: Role = Role.EventManager) => {
  const caller = await User.create({
    name: 'Caller',
    username: `caller-${role.toLowerCase()}`,
    passwordHash: 'not-used-in-these-tests',
    role,
  });
  return signSessionToken({ id: caller.id, role: caller.role });
};

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  name: 'New Hire',
  username: 'newhire',
  password: 'a-strong-initial-password',
  role: Role.Reception,
  ...overrides,
});

const createUserAs = (token: string, body: object) =>
  request(app).post('/users').set('Authorization', `Bearer ${token}`).send(body);

const listUsersAs = (token: string) =>
  request(app).get('/users').set('Authorization', `Bearer ${token}`);

const patchUserAs = (token: string, id: string, body: object) =>
  request(app).patch(`/users/${id}`).set('Authorization', `Bearer ${token}`).send(body);

beforeAll(connectTestDb);
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('POST /users', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).post('/users').send(validPayload());

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 403 for a caller with role %s',
    async (role) => {
      const token = await seedCaller(role);

      const response = await createUserAs(token, validPayload());

      expect(response.status).toBe(403);
    },
  );

  it('creates the account and returns it without the password hash', async () => {
    const token = await seedCaller();

    const response = await createUserAs(token, validPayload());

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: 'New Hire',
      username: 'newhire',
      role: Role.Reception,
      active: true,
    });
    expect(response.body.id).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(response.body).not.toHaveProperty('password');
  });

  it('hashes the supplied password so it verifies with argon2', async () => {
    const token = await seedCaller();

    const response = await createUserAs(
      token,
      validPayload({ password: 'a-strong-initial-password' }),
    );

    const stored = await User.findById(response.body.id);
    if (!stored) {
      throw new Error('expected the created user to be persisted');
    }
    await expect(verify(stored.passwordHash, 'a-strong-initial-password')).resolves.toBe(true);
  });

  it('returns 409 with a clear code when the username is already taken', async () => {
    const token = await seedCaller();
    await User.create({
      name: 'Existing',
      username: 'newhire',
      passwordHash: 'irrelevant',
      role: Role.Reception,
    });

    const response = await createUserAs(token, validPayload());

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: { code: 'USERNAME_TAKEN', message: 'A user with that username already exists.' },
    });
  });

  it('treats username uniqueness as case-insensitive', async () => {
    const token = await seedCaller();
    await User.create({
      name: 'Existing',
      username: 'newhire',
      passwordHash: 'irrelevant',
      role: Role.Reception,
    });

    const response = await createUserAs(token, validPayload({ username: 'NewHire' }));

    expect(response.status).toBe(409);
  });

  it.each(['name', 'username', 'password', 'role'])(
    'returns 400 listing %s when it is missing',
    async (field) => {
      const token = await seedCaller();
      const payload: Record<string, unknown> = { ...validPayload() };
      delete payload[field];

      const response = await createUserAs(token, payload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    },
  );

  it('returns 400 listing the field for an invalid role value', async () => {
    const token = await seedCaller();

    const response = await createUserAs(token, validPayload({ role: 'Admin' }));

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'role' })]),
    );
  });

  it('returns 400, not 201, for an empty-string password', async () => {
    const token = await seedCaller();

    const response = await createUserAs(token, validPayload({ password: '' }));

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
    );
  });

  it('allows creating a second EventManager account — no system-enforced cap', async () => {
    const token = await seedCaller(Role.EventManager);

    const response = await createUserAs(
      token,
      validPayload({ username: 'second-manager', role: Role.EventManager }),
    );

    expect(response.status).toBe(201);
    expect(response.body.role).toBe(Role.EventManager);
  });
});

describe('GET /users', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).get('/users');

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 403 for a caller with role %s',
    async (role) => {
      const token = await seedCaller(role);

      const response = await listUsersAs(token);

      expect(response.status).toBe(403);
    },
  );

  it('returns every account without a password hash', async () => {
    const token = await seedCaller();
    await createUserAs(token, validPayload({ username: 'second-user' }));

    const response = await listUsersAs(token);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(2); // the caller's own account + the one just created
    for (const account of response.body) {
      expect(account).not.toHaveProperty('passwordHash');
      expect(account).not.toHaveProperty('password');
    }
  });
});

describe('PATCH /users/:id', () => {
  it('returns 401 with no token', async () => {
    const token = await seedCaller();
    const created = await createUserAs(token, validPayload());

    const response = await request(app)
      .patch(`/users/${created.body.id}`)
      .send({ active: false });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 403 for a caller with role %s',
    async (role) => {
      const managerToken = await seedCaller();
      const created = await createUserAs(managerToken, validPayload());
      const token = await seedCaller(role);

      const response = await patchUserAs(token, created.body.id, { active: false });

      expect(response.status).toBe(403);
    },
  );

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const token = await seedCaller();

    const response = await patchUserAs(token, '507f1f77bcf86cd799439011', { active: false });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'USER_NOT_FOUND', message: 'No user account with that id.' },
    });
  });

  it('returns 400 for a malformed id', async () => {
    const token = await seedCaller();

    const response = await patchUserAs(token, 'not-an-id', { active: false });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('toggles active independently of role', async () => {
    const token = await seedCaller();
    const created = await createUserAs(token, validPayload());

    const response = await patchUserAs(token, created.body.id, { active: false });

    expect(response.status).toBe(200);
    expect(response.body.active).toBe(false);
    expect(response.body.role).toBe(Role.Reception);
  });

  it('changes role independently of active', async () => {
    const token = await seedCaller();
    const created = await createUserAs(token, validPayload());

    const response = await patchUserAs(token, created.body.id, { role: Role.FnBHead });

    expect(response.status).toBe(200);
    expect(response.body.role).toBe(Role.FnBHead);
    expect(response.body.active).toBe(true);
  });

  it('sets both active and role in one request', async () => {
    const token = await seedCaller();
    const created = await createUserAs(token, validPayload());

    const response = await patchUserAs(token, created.body.id, {
      active: false,
      role: Role.Housekeeping,
    });

    expect(response.status).toBe(200);
    expect(response.body.active).toBe(false);
    expect(response.body.role).toBe(Role.Housekeeping);
  });

  it('a subsequent GET /users reflects the update', async () => {
    const token = await seedCaller();
    const created = await createUserAs(token, validPayload());

    await patchUserAs(token, created.body.id, { active: false, role: Role.FnBHead });
    const listResponse = await listUsersAs(token);

    const updated = listResponse.body.find(
      (account: { id: string }) => account.id === created.body.id,
    );
    expect(updated).toMatchObject({ active: false, role: Role.FnBHead });
  });

  it('allows an Event Manager to deactivate their own account, effective immediately', async () => {
    const self = await User.create({
      name: 'Self',
      username: 'self-manager',
      passwordHash: 'not-used-in-these-tests',
      role: Role.EventManager,
    });
    const token = await signSessionToken({ id: self.id, role: self.role });

    const response = await patchUserAs(token, self.id, { active: false });

    expect(response.status).toBe(200);
    expect(response.body.active).toBe(false);

    // Same token, very next request — authenticate() re-checks `active` against
    // the database on every call (STORY-003), so there's no grace period.
    const followUp = await listUsersAs(token);
    expect(followUp.status).toBe(401);
  });
});
