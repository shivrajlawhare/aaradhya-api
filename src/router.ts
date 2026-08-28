import { initServer } from '@ts-rest/express';
import { contract } from './contract/index.js';
import { checkHealth } from './controllers/health.js';

const server = initServer();

export const router = server.router(contract, {
  getHealth: checkHealth,
});
