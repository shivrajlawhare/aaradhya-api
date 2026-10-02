import type { ServerInferRequest, ServerInferResponses } from '@ts-rest/core';
import { isValidObjectId } from 'mongoose';
import type { contract } from '../contract/index.js';
import { ChangeLogEntry, type ChangeLogEntryDocument } from '../models/change-log-entry.js';
import { User } from '../models/user.js';

type ListChangeLogRequest = ServerInferRequest<typeof contract.listChangeLog>;
type ListChangeLogResponse = ServerInferResponses<typeof contract.listChangeLog>;

const toPublicEntry = (entry: ChangeLogEntryDocument, namesById: Map<string, string>) => ({
  id: entry.id,
  entityType: entry.entityType,
  entityId: entry.entityId,
  field: entry.field,
  oldValue: entry.oldValue,
  newValue: entry.newValue,
  changedBy: entry.changedBy,
  changedByName: namesById.get(entry.changedBy) ?? null,
  // STORY-081 — absent (undefined, not null) on any entry written before
  // this field existed; the frontend renders such an entry as its own
  // single-item group.
  groupId: entry.groupId,
  timestamp: entry.timestamp,
});

// No pagination — deliberate for v1. A single Event's lifetime change
// history is small at Aaradhya's scale (SRS §6.1); revisit if that stops
// being true (docs/api-conventions.md).
export const listChangeLog = async ({ query }: ListChangeLogRequest): Promise<ListChangeLogResponse> => {
  const { entityType, entityId } = query;

  const entries = await ChangeLogEntry.find({ entityType, entityId }).sort({ timestamp: -1 });

  // Every actor, soft-deleted ones included (DEV-13, D15: "past activity
  // stays in the history"). changedBy ids that aren't valid ObjectIds are
  // simply not matched.
  const actorIds = [...new Set(entries.map((entry) => entry.changedBy))].filter((id) => isValidObjectId(id));
  const actors = await User.find({ _id: { $in: actorIds } });
  const namesById = new Map(actors.map((actor) => [actor.id, actor.name]));

  return { status: 200, body: entries.map((entry) => toPublicEntry(entry, namesById)) };
};
