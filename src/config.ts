import 'dotenv/config';

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongodbUri: requireEnv('MONGODB_URI'),
  mongodbName: process.env.MONGODB_DB_NAME ?? 'aaradhya',
  jwtSecret: requireEnv('JWT_SECRET'),
  // Any `jose` duration string (e.g. 30m, 8h, 7d). Session length is a
  // technical decision, not a product requirement (SRS FR-AUTH-4).
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  // Used to pin Node's DNS resolver (src/db.ts) — see the comment there.
  // Comma-separated, override with DNS_SERVERS if 8.8.8.8/1.1.1.1 are
  // blocked on your network.
  dnsServers: (process.env.DNS_SERVERS ?? '8.8.8.8,1.1.1.1').split(',').map((server) => server.trim()),
} as const;
