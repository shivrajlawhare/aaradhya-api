import { ChangeLogEntry, type ChangeLogEntryDocument } from '../models/change-log-entry.js';

export interface LogChangeInput {
  entityType: string;
  entityId: string;
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
  changedByUserId: string;
}

/**
 * Persists one Change Log Entry. The single, shared write path every future
 * PATCH endpoint calls — deliberately dumb:
 * - it never decides whether a change is "real" (oldValue === newValue still
 *   writes an entry; the caller decides what's worth logging before calling
 *   this, so behaviour here stays predictable)
 * - it never merges or overwrites — two calls for the same entityId with
 *   different `field` values always produce two separate entries
 * - `timestamp` is set by the schema, not accepted here
 *
 * Lives here rather than controllers/ or utils/ because the story frames it
 * as exactly that — "the shared service every future PATCH endpoint calls"
 * — even though, unlike this folder's other DB-free computation, it does
 * touch the DB. "Unit-tested directly, no HTTP layer" (the story's own
 * requirement) is what services/ buys it either way.
 */
export const logChange = async ({
  entityType,
  entityId,
  field,
  oldValue,
  newValue,
  changedByUserId,
}: LogChangeInput): Promise<ChangeLogEntryDocument> =>
  ChangeLogEntry.create({
    entityType,
    entityId,
    field,
    oldValue,
    newValue,
    changedBy: changedByUserId,
  });
