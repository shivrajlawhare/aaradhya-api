import express from 'express';
import { createExpressEndpoints } from '@ts-rest/express';
import { contract } from './contract/index.js';
import { router } from './router.js';
import { config } from './config.js';
import { connectToDatabase } from './db.js';

const startServer = async (): Promise<void> => {
  await connectToDatabase();

  const app = express();
  app.use(express.json());

  createExpressEndpoints(contract, router, app);

  app.listen(config.port, () => {
    console.log(`[api] listening on http://localhost:${config.port}`);
  });
};

startServer().catch((error) => {
  console.error('[api] failed to start', error);
  process.exit(1);
});
