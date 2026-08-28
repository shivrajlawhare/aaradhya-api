import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { config } from '../config.js';
import { Role } from '../models/user.js';

export interface SessionClaims {
  id: string;
  role: Role;
}

const encodedSecret = new TextEncoder().encode(config.jwtSecret);

const sessionClaimsSchema = z.object({
  sub: z.string().min(1),
  role: z.nativeEnum(Role),
});

/**
 * Signs a session token carrying the user's id (as `sub`) and role. The auth
 * middleware reads these back into `req.user`.
 */
export const signSessionToken = async ({ id, role }: SessionClaims): Promise<string> =>
  new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setIssuedAt()
    .setExpirationTime(config.jwtExpiresIn)
    .sign(encodedSecret);

/**
 * Verifies signature + expiry and returns the claims. Throws (jose error or Zod
 * error) on a missing/tampered/expired token or a malformed claim set — the
 * caller treats any throw as "not authenticated".
 */
export const verifySessionToken = async (token: string): Promise<SessionClaims> => {
  const { payload } = await jwtVerify(token, encodedSecret);
  const { sub, role } = sessionClaimsSchema.parse(payload);
  return { id: sub, role };
};
