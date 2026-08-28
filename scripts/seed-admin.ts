/**
 * Local/dev convenience only — not part of any story, not for production.
 * Creates (or resets the password/role on) one User Account so there's a way
 * to log in before any real account exists via POST /users (which itself
 * requires an EventManager caller — a bootstrap problem this script solves).
 *
 * Usage:
 *   npm run seed:admin
 *   npm run seed:admin -- --username admin --password admin123 --role EventManager --name Admin
 *
 * Safe to re-run: an existing username has its password/role/active reset
 * rather than failing on the STORY-001 uniqueness constraint.
 */
import { hash } from '@node-rs/argon2';
import { z } from 'zod';
import { connectToDatabase } from '../src/db.js';
import { Role, User } from '../src/models/user.js';

const arg = (flag: string, fallback: string): string => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};

const roleSchema = z.nativeEnum(Role);

const seedAdmin = async (): Promise<void> => {
  const name = arg('--name', 'Admin');
  const username = arg('--username', 'admin');
  const password = arg('--password', 'admin123');
  const role = roleSchema.parse(arg('--role', Role.EventManager));

  await connectToDatabase();

  const passwordHash = await hash(password);
  const account = await User.findOneAndUpdate(
    { username: username.trim().toLowerCase() },
    { name, passwordHash, role, active: true },
    { returnDocument: 'after', upsert: true, runValidators: true },
  );

  if (!account) {
    throw new Error('upsert did not return a document');
  }

  console.log(
    `[seed] ready to log in — username: "${account.username}", password: "${password}", role: ${account.role}`,
  );
  process.exit(0);
};

seedAdmin().catch((error) => {
  console.error('[seed] failed', error);
  process.exit(1);
});
