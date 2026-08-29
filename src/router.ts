import { initServer } from '@ts-rest/express';
import { contract } from './contract/index.js';
import { login } from './controllers/auth.js';
import { listChangeLog } from './controllers/change-log.js';
import { createEvent } from './controllers/events.js';
import { checkHealth } from './controllers/health.js';
import { createUser, listUsers, updateUser } from './controllers/users.js';
import { authenticate, requireRole } from './middleware/auth.js';
import { Role } from './models/user.js';

const server = initServer();

const eventManagerOnly = [authenticate, requireRole(Role.EventManager)];

export const router = server.router(contract, {
  getHealth: checkHealth,
  login,
  createUser: {
    middleware: eventManagerOnly,
    handler: createUser,
  },
  listUsers: {
    middleware: eventManagerOnly,
    handler: listUsers,
  },
  updateUser: {
    middleware: eventManagerOnly,
    handler: updateUser,
  },
  listChangeLog: {
    middleware: eventManagerOnly,
    handler: listChangeLog,
  },
  createEvent: {
    middleware: eventManagerOnly,
    handler: createEvent,
  },
});
