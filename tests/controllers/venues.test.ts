import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Venue } from '../../src/models/venue.js';
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

const listVenuesAs = (token: string) => request(app).get('/venues').set('Authorization', `Bearer ${token}`);

const createVenueAs = (token: string, body: object) =>
  request(app).post('/venues').set('Authorization', `Bearer ${token}`).send(body);

const patchVenueAs = (token: string, id: string, body: object) =>
  request(app).patch(`/venues/${id}`).set('Authorization', `Bearer ${token}`).send(body);

beforeAll(async () => {
  await connectTestDb();
  await Venue.init();
});
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('GET /venues', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).get('/venues');

    expect(response.status).toBe(401);
  });

  it.each([Role.EventManager, Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'allows a caller with role %s',
    async (role) => {
      const token = await seedCaller(role);

      const response = await listVenuesAs(token);

      expect(response.status).toBe(200);
    },
  );

  it('returns both active and inactive entries', async () => {
    const token = await seedCaller();
    await Venue.create({ name: 'Poolside', defaultVenueCost: 60000 });
    await Venue.create({ name: 'Lawn', defaultVenueCost: 50000, active: false });

    const response = await listVenuesAs(token);

    expect(response.body).toHaveLength(2);
  });
});

describe('POST /venues', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app).post('/venues').send({ name: 'Poolside', defaultVenueCost: 60000 });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const token = await seedCaller(role);

    const response = await createVenueAs(token, { name: 'Poolside', defaultVenueCost: 60000 });

    expect(response.status).toBe(403);
  });

  it('creates the Venue and returns it', async () => {
    const token = await seedCaller();

    const response = await createVenueAs(token, { name: 'Poolside', defaultVenueCost: 60000 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: 'Poolside', defaultVenueCost: 60000, active: true });
    expect(typeof response.body.id).toBe('string');
  });

  it('returns 400 when defaultVenueCost is missing', async () => {
    const token = await seedCaller();

    const response = await createVenueAs(token, { name: 'Poolside' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a negative defaultVenueCost', async () => {
    const token = await seedCaller();

    const response = await createVenueAs(token, { name: 'Poolside', defaultVenueCost: -1 });

    expect(response.status).toBe(400);
  });

  it('returns 409, not a duplicate row, when the active name already exists', async () => {
    const token = await seedCaller();
    await Venue.create({ name: 'Poolside', defaultVenueCost: 60000 });

    const response = await createVenueAs(token, { name: 'Poolside', defaultVenueCost: 60000 });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: { code: 'VENUE_NAME_TAKEN', message: 'A Venue with that name already exists.' },
    });
  });

  it('treats name uniqueness as case-insensitive', async () => {
    const token = await seedCaller();
    await Venue.create({ name: 'Poolside', defaultVenueCost: 60000 });

    const response = await createVenueAs(token, { name: 'poolside', defaultVenueCost: 60000 });

    expect(response.status).toBe(409);
  });

  it('allows creating a Venue whose name belongs only to a deactivated entry', async () => {
    const token = await seedCaller();
    await Venue.create({ name: 'Poolside', defaultVenueCost: 60000, active: false });

    const response = await createVenueAs(token, { name: 'Poolside', defaultVenueCost: 65000 });

    expect(response.status).toBe(201);
  });
});

describe('PATCH /venues/:id', () => {
  it('returns 401 with no token', async () => {
    const token = await seedCaller();
    const created = await createVenueAs(token, { name: 'Poolside', defaultVenueCost: 60000 });

    const response = await request(app).patch(`/venues/${created.body.id}`).send({ active: false });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])('returns 403 for a caller with role %s', async (role) => {
    const managerToken = await seedCaller();
    const created = await createVenueAs(managerToken, { name: 'Poolside', defaultVenueCost: 60000 });
    const token = await seedCaller(role);

    const response = await patchVenueAs(token, created.body.id, { active: false });

    expect(response.status).toBe(403);
  });

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const token = await seedCaller();

    const response = await patchVenueAs(token, '507f1f77bcf86cd799439011', { active: false });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'VENUE_NOT_FOUND', message: 'No venue with that id.' },
    });
  });

  it('returns 400 for a malformed id', async () => {
    const token = await seedCaller();

    const response = await patchVenueAs(token, 'not-an-id', { active: false });

    expect(response.status).toBe(400);
  });

  it('deactivates the Venue without deleting it', async () => {
    const token = await seedCaller();
    const created = await createVenueAs(token, { name: 'Poolside', defaultVenueCost: 60000 });

    const response = await patchVenueAs(token, created.body.id, { active: false });

    expect(response.status).toBe(200);
    expect(response.body.active).toBe(false);
    const stored = await Venue.findById(created.body.id);
    expect(stored).not.toBeNull();
  });

  it('edits name and defaultVenueCost independently of active', async () => {
    const token = await seedCaller();
    const created = await createVenueAs(token, { name: 'Poolside', defaultVenueCost: 60000 });

    const response = await patchVenueAs(token, created.body.id, { name: 'Poolside Deck', defaultVenueCost: 62000 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: 'Poolside Deck', defaultVenueCost: 62000, active: true });
  });

  it('returns 409 when renaming to a name already active on another Venue', async () => {
    const token = await seedCaller();
    await createVenueAs(token, { name: 'Poolside', defaultVenueCost: 60000 });
    const lawn = await createVenueAs(token, { name: 'Lawn', defaultVenueCost: 50000 });

    const response = await patchVenueAs(token, lawn.body.id, { name: 'Poolside' });

    expect(response.status).toBe(409);
  });
});
