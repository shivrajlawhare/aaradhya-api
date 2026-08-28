import express from 'express';
import { createExpressEndpoints } from '@ts-rest/express';
import { contract } from './contract/index.js';
import { router } from './router.js';

export const createApp = () => {
  const app = express();
  app.use(express.json());

  createExpressEndpoints(contract, router, app);

  return app;
};
