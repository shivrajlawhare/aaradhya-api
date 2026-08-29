import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Role, User } from '../../src/models/user.js';
import { logChange } from '../../src/services/change-log.js';
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

const listChangeLogAs = (token: string, entityType: string, entityId: string) =>
  request(app)
    .get('/change-log')
    .query({ entityType, entityId })
    .set('Authorization', `Bearer ${token}`);

beforeAll(connectTestDb);
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('GET /change-log', () => {
  it('returns 401 with no token', async () => {
    const response = await request(app)
      .get('/change-log')
      .query({ entityType: 'Event', entityId: 'event-1' });

    expect(response.status).toBe(401);
  });

  it.each([Role.FnBHead, Role.Housekeeping, Role.Reception])(
    'returns 403 for a caller with role %s',
    async (role) => {
      const token = await seedCaller(role);

      const response = await listChangeLogAs(token, 'Event', 'event-1');

      expect(response.status).toBe(403);
    },
  );

  it('returns 400 listing entityId when it is missing', async () => {
    const token = await seedCaller();

    const response = await request(app)
      .get('/change-log')
      .query({ entityType: 'Event' })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'entityId' })]),
    );
  });

  it('returns 200 with an empty array for an entity that was never logged', async () => {
    const token = await seedCaller();

    const response = await listChangeLogAs(token, 'Event', 'never-logged');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('returns entries for the requested entity, sorted newest-first', async () => {
    const token = await seedCaller();
    await logChange({
      entityType: 'Event',
      entityId: 'event-1',
      field: 'status',
      oldValue: 'Tentative',
      newValue: 'Confirmed',
      changedByUserId: 'user-1',
    });
    await logChange({
      entityType: 'Event',
      entityId: 'event-1',
      field: 'pax',
      oldValue: 100,
      newValue: 120,
      changedByUserId: 'user-1',
    });

    const response = await listChangeLogAs(token, 'Event', 'event-1');

    expect(response.status).toBe(200);
    expect(response.body.map((entry: { field: string }) => entry.field)).toEqual(['pax', 'status']);
  });

  it('only returns entries matching both entityType and entityId', async () => {
    const token = await seedCaller();
    await logChange({
      entityType: 'Event',
      entityId: 'event-1',
      field: 'status',
      oldValue: 'Tentative',
      newValue: 'Confirmed',
      changedByUserId: 'user-1',
    });
    await logChange({
      entityType: 'Event',
      entityId: 'event-2',
      field: 'status',
      oldValue: 'Tentative',
      newValue: 'Confirmed',
      changedByUserId: 'user-1',
    });
    await logChange({
      entityType: 'Session',
      entityId: 'event-1',
      field: 'startTime',
      oldValue: '10:00',
      newValue: '11:00',
      changedByUserId: 'user-1',
    });

    const response = await listChangeLogAs(token, 'Event', 'event-1');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      entityType: 'Event',
      entityId: 'event-1',
      field: 'status',
    });
  });

  it('includes the full field set per entry, oldValue/newValue included in full', async () => {
    const token = await seedCaller();
    await logChange({
      entityType: 'Event',
      entityId: 'event-1',
      field: 'client_contacts',
      oldValue: [{ name: 'Bride' }],
      newValue: [{ name: 'Bride' }, { name: 'Groom' }],
      changedByUserId: 'user-1',
    });

    const response = await listChangeLogAs(token, 'Event', 'event-1');

    expect(response.body[0]).toMatchObject({
      entityType: 'Event',
      entityId: 'event-1',
      field: 'client_contacts',
      oldValue: [{ name: 'Bride' }],
      newValue: [{ name: 'Bride' }, { name: 'Groom' }],
      changedBy: 'user-1',
    });
    expect(response.body[0].id).toEqual(expect.any(String));
    expect(response.body[0].timestamp).toEqual(expect.any(String));
  });
});
