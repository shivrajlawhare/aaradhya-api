import { verify } from '@node-rs/argon2';
import type { ServerInferRequest, ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../contract/index.js';
import { User } from '../models/user.js';
import { signSessionToken } from '../services/token.js';

type LoginRequest = ServerInferRequest<typeof contract.login>;
type LoginResponse = ServerInferResponses<typeof contract.login>;

// Identical answer for every failure mode — unknown username, wrong password,
// deactivated account — so the endpoint never reveals which one it was.
const invalidCredentials: LoginResponse = {
  status: 401,
  body: {
    error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect username or password.' },
  },
};

export const login = async ({ body }: LoginRequest): Promise<LoginResponse> => {
  const { username, password } = body;

  const account = await User.findOne({ username });
  if (!account || !account.active) {
    return invalidCredentials;
  }

  const isPasswordValid = await verify(account.passwordHash, password);
  if (!isPasswordValid) {
    return invalidCredentials;
  }

  const token = await signSessionToken({ id: account.id, role: account.role });

  return {
    status: 200,
    body: {
      token,
      user: { id: account.id, name: account.name, role: account.role },
    },
  };
};
