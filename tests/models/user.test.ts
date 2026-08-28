import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Role, User } from '../../src/models/user.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';
import { expectValidationError } from '../support/validation.js';

const validUserData = () => ({
  name: 'Priya Nair',
  username: 'priya',
  passwordHash: 'argon2-hash-placeholder',
  role: Role.EventManager,
});

beforeAll(async () => {
  await connectTestDb();
  // Build the unique index so the duplicate-username case is actually enforced.
  await User.init();
});

afterEach(async () => {
  await clearCollections();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('User model', () => {
  it('persists a valid document', async () => {
    const user = await User.create(validUserData());

    expect(user.id).toBeDefined();
    expect(user.name).toBe('Priya Nair');
    expect(user.username).toBe('priya');
    expect(user.role).toBe(Role.EventManager);
  });

  it.each(['name', 'username', 'passwordHash', 'role'])(
    'rejects a document missing %s',
    async (field) => {
      const data: Record<string, unknown> = { ...validUserData() };
      delete data[field];

      const error = await expectValidationError(User, data);

      expect(error.errors).toHaveProperty(field);
    },
  );

  it('rejects a role outside the four allowed values', async () => {
    const error = await expectValidationError(User, { ...validUserData(), role: 'Admin' });

    expect(error.errors).toHaveProperty('role');
  });

  it('rejects an empty-string role', async () => {
    const error = await expectValidationError(User, { ...validUserData(), role: '' });

    expect(error.errors).toHaveProperty('role');
  });

  it('rejects a second document with the same username', async () => {
    await User.create(validUserData());

    const error = await User.create({ ...validUserData(), name: 'Someone Else' }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({ code: 11000 });
  });

  it('treats username uniqueness as case-insensitive', async () => {
    await User.create({ ...validUserData(), username: 'Priya' });

    const error = await User.create({ ...validUserData(), username: 'PRIYA' }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({ code: 11000 });
  });

  it('normalises username to trimmed lowercase on write', async () => {
    const user = await User.create({ ...validUserData(), username: '  Priya.Nair  ' });

    expect(user.username).toBe('priya.nair');
  });

  it('defaults active to true when not supplied', async () => {
    const user = await User.create(validUserData());

    expect(user.active).toBe(true);
  });

  it('allows active to be set to false and back to true', async () => {
    const user = await User.create({ ...validUserData(), active: false });
    expect(user.active).toBe(false);

    user.active = true;
    await user.save();
    expect(user.active).toBe(true);
  });
});
