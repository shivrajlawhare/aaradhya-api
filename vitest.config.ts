import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // mongodb-memory-server may download a mongod binary on first run.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // config.ts requires these at import time; tests never touch the real DB
    // URI (they use an in-memory server via tests/support/db.ts).
    env: {
      MONGODB_URI: 'mongodb://127.0.0.1:27017/aaradhya-test-unused',
      JWT_SECRET: 'test-only-secret-not-for-production',
    },
  },
});
