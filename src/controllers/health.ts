import type { ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../contract/index.js';

type HealthResponse = ServerInferResponses<typeof contract.getHealth>;

export const checkHealth = async (): Promise<HealthResponse> => ({
  status: 200,
  body: { status: 'ok' },
});
