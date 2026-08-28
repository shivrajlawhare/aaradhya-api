import cors from 'cors';
import express from 'express';
import { createExpressEndpoints } from '@ts-rest/express';
import { config } from './config.js';
import { contract } from './contract/index.js';
import { router } from './router.js';

export const createApp = () => {
  const app = express();
  // aaradhya-web calls this API from a different origin (Vite dev server on
  // :5173 vs this API on :4000) — every browser request is cross-origin, so
  // this isn't optional even in local dev. Bearer-token auth, no cookies, so
  // no `credentials: true` needed.
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());

  createExpressEndpoints(contract, router, app, {
    // Reshape ts-rest's default (raw ZodError) 400 body into the documented
    // { error: { code, message, details } } envelope (docs/api-conventions.md)
    // — one place, applies to every route's request-schema validation.
    requestValidationErrorHandler: (error, _req, res, next) => {
      const zodError = error.body ?? error.pathParams ?? error.query ?? error.headers;
      if (!zodError) {
        next(error);
        return;
      }

      const details = zodError.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request failed validation.',
          details,
        },
      });
    },
  });

  return app;
};
