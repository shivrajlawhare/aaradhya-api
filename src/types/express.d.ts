import type { SessionClaims } from '../services/token.js';

// Populated by the `authenticate` middleware (src/middleware/auth.ts).
declare global {
  namespace Express {
    interface Request {
      user?: SessionClaims;
    }
  }
}
