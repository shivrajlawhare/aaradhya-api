import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { jwtVerify } from 'jose';
import { createApp } from '../../src/app.js';
import { Role, User } from '../../src/models/user.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';

const app = createApp();
const PASSWORD = 'correct-horse-battery-staple';
const INVALID_CREDENTIALS = {
  error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect username or password.' },
};

const seedUser = async (overrides: Record<string, unknown> = {}) => {
  const passwordHash = await hash(PASSWORD);
  return User.create({
    name: 'Priya Nair',
    username: 'priya',
    passwordHash,
    role: Role.EventManager,
    ...overrides,
  });
};

const login = (body: object) => request(app).post('/auth/login').send(body);

beforeAll(connectTestDb);
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('POST /auth/login', () => {
  it('returns 200 with a token and the user id, name, role on correct credentials', async () => {
    const user = await seedUser();

    const response = await login({ username: 'priya', password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.user).toEqual({
      id: user.id,
      name: 'Priya Nair',
      role: Role.EventManager,
    });
  });

  it('signs the id and role into the token', async () => {
    const user = await seedUser();

    const { body } = await login({ username: 'priya', password: PASSWORD });
    const { payload } = await jwtVerify(
      body.token,
      new TextEncoder().encode(process.env.JWT_SECRET),
    );

    expect(payload.sub).toBe(user.id);
    expect(payload.role).toBe(Role.EventManager);
  });

  it('returns 401 and no token on a wrong password', async () => {
    await seedUser();

    const response = await login({ username: 'priya', password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(INVALID_CREDENTIALS);
    expect(response.body.token).toBeUndefined();
  });

  it('returns the same 401 for an unknown username (no enumeration)', async () => {
    const response = await login({ username: 'ghost', password: PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(INVALID_CREDENTIALS);
  });

  it('returns 401 for a deactivated account even with the correct password', async () => {
    await seedUser({ active: false });

    const response = await login({ username: 'priya', password: PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(INVALID_CREDENTIALS);
    expect(response.body.token).toBeUndefined();
  });

  it('never exposes the password hash in the response body', async () => {
    const user = await seedUser();

    const response = await login({ username: 'priya', password: PASSWORD });

    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(user.passwordHash);
  });

  it('matches a username with surrounding whitespace and different case', async () => {
    const user = await seedUser();

    const response = await login({ username: '  PRIYA  ', password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(user.id);
  });

  it('treats an empty-string password as a failed login, not a 400', async () => {
    await seedUser();

    const response = await login({ username: 'priya', password: '' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual(INVALID_CREDENTIALS);
  });

  it('returns 400 for a structurally invalid body', async () => {
    const response = await login({ username: 'priya' });

    expect(response.status).toBe(400);
  });
});
