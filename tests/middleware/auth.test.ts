import express from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { authenticate, requireRole } from '../../src/middleware/auth.js';
import { Role, User } from '../../src/models/user.js';
import { signSessionToken } from '../../src/services/token.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET);

// A throwaway app, independent of the real contract/router.
const testApp = express();
testApp.get('/whoami', authenticate, (req, res) => {
  res.json({ user: req.user });
});
testApp.get('/managers-only', authenticate, requireRole(Role.EventManager), (_req, res) => {
  res.json({ ok: true });
});

const getWithToken = (path: string, token: string) =>
  request(testApp).get(path).set('Authorization', `Bearer ${token}`);

const createUser = (overrides: Record<string, unknown> = {}) =>
  User.create({
    name: 'Priya Nair',
    username: 'priya',
    passwordHash: 'not-checked-by-middleware',
    role: Role.EventManager,
    ...overrides,
  });

const expiredTokenFor = (id: string) =>
  new SignJWT({ role: Role.EventManager })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
    .sign(secret());

const wronglySignedTokenFor = (id: string) =>
  new SignJWT({ role: Role.EventManager })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode('a-completely-different-secret'));

beforeAll(connectTestDb);
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('authenticate middleware', () => {
  it('returns 401 when no token is supplied', async () => {
    const response = await request(testApp).get('/whoami');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    });
  });

  it('returns 401 for a non-Bearer Authorization header', async () => {
    const response = await request(testApp).get('/whoami').set('Authorization', 'Basic abc123');

    expect(response.status).toBe(401);
  });

  it('attaches req.user and reaches the handler for a valid token', async () => {
    const user = await createUser();
    const token = await signSessionToken({ id: user.id, role: user.role });

    const response = await getWithToken('/whoami', token);

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({ id: user.id, role: Role.EventManager });
  });

  it('returns 401 for a token with an invalid signature', async () => {
    const user = await createUser();
    const token = await wronglySignedTokenFor(user.id);

    const response = await getWithToken('/whoami', token);

    expect(response.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const user = await createUser();
    const token = await expiredTokenFor(user.id);

    const response = await getWithToken('/whoami', token);

    expect(response.status).toBe(401);
  });

  it('returns 401 when the token subject no longer exists', async () => {
    const user = await createUser();
    const token = await signSessionToken({ id: user.id, role: user.role });
    await User.deleteMany({});

    const response = await getWithToken('/whoami', token);

    expect(response.status).toBe(401);
  });

  it('returns 401 for a valid token belonging to a deactivated account', async () => {
    const user = await createUser();
    const token = await signSessionToken({ id: user.id, role: user.role });
    user.active = false;
    await user.save();

    const response = await getWithToken('/whoami', token);

    expect(response.status).toBe(401);
  });
});

describe('requireRole guard', () => {
  it('reaches the handler when the user has an allowed role', async () => {
    const user = await createUser({ role: Role.EventManager });
    const token = await signSessionToken({ id: user.id, role: user.role });

    const response = await getWithToken('/managers-only', token);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('returns 403 when the user has a role outside the allow-list', async () => {
    const user = await createUser({ role: Role.Reception });
    const token = await signSessionToken({ id: user.id, role: user.role });

    const response = await getWithToken('/managers-only', token);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: { code: 'FORBIDDEN', message: 'You do not have access to this resource.' },
    });
  });

  it('uses the current database role, not the role baked into the token', async () => {
    const user = await createUser({ role: Role.EventManager });
    const token = await signSessionToken({ id: user.id, role: user.role });
    user.role = Role.Reception;
    await user.save();

    const response = await getWithToken('/managers-only', token);

    expect(response.status).toBe(403);
  });
});
