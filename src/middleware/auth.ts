import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Role, User } from '../models/user.js';
import { verifySessionToken } from '../services/token.js';

const unauthenticated = {
  error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
};

const forbidden = {
  error: { code: 'FORBIDDEN', message: 'You do not have access to this resource.' },
};

const bearerToken = (header: string | undefined): string | undefined => {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
};

/**
 * Verifies the Bearer token, then re-loads the user so authorisation runs
 * against current state: a token for a now-deactivated account is rejected, and
 * `req.user.role` reflects the database, not a possibly-stale token claim
 * (v1 decision — see docs/stories/Aaradhya_Story_Backlog.md STORY-003).
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = bearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json(unauthenticated);
    return;
  }

  try {
    const claims = await verifySessionToken(token);
    const account = await User.findById(claims.id);
    if (!account || !account.active) {
      res.status(401).json(unauthenticated);
      return;
    }
    req.user = { id: account.id, role: account.role };
    next();
  } catch {
    res.status(401).json(unauthenticated);
  }
};

/**
 * Gate a route to one or more roles. Runs after `authenticate`; returns 403 when
 * the authenticated user's current role is not in the allow-list.
 */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, res, next) => {
    if (!req.user) {
      res.status(401).json(unauthenticated);
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json(forbidden);
      return;
    }
    next();
  };
