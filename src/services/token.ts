import { SignJWT } from 'jose';
import { config } from '../config.js';
import type { Role } from '../models/user.js';

export interface SessionClaims {
  id: string;
  role: Role;
}

const encodedSecret = new TextEncoder().encode(config.jwtSecret);

/**
 * Signs a session token carrying the user's id (as `sub`) and role. The auth
 * middleware in STORY-003 reads these back into `req.user`.
 */
export const signSessionToken = async ({ id, role }: SessionClaims): Promise<string> =>
  new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setIssuedAt()
    .setExpirationTime(config.jwtExpiresIn)
    .sign(encodedSecret);
