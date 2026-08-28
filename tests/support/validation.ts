import { Error as MongooseError, type Model } from 'mongoose';

/**
 * Builds `data` into `Model`, runs schema validation, and asserts it fails —
 * shared by every model's "rejects a document missing X" tests.
 */
export const expectValidationError = async <T>(Model: Model<T>, data: Record<string, unknown>) => {
  const caught = await new Model(data).validate().catch((error: unknown) => error);
  if (!(caught instanceof MongooseError.ValidationError)) {
    throw new Error(`expected a ValidationError, got: ${String(caught)}`);
  }
  return caught;
};
