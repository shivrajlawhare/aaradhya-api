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
