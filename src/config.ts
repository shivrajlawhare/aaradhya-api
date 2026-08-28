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
} as const;
