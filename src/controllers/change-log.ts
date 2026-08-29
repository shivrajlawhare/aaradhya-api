import type { ServerInferRequest, ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../contract/index.js';
import { ChangeLogEntry, type ChangeLogEntryDocument } from '../models/change-log-entry.js';

type ListChangeLogRequest = ServerInferRequest<typeof contract.listChangeLog>;
type ListChangeLogResponse = ServerInferResponses<typeof contract.listChangeLog>;

const toPublicEntry = (entry: ChangeLogEntryDocument) => ({
  id: entry.id,
  entityType: entry.entityType,
  entityId: entry.entityId,
  field: entry.field,
  oldValue: entry.oldValue,
  newValue: entry.newValue,
  changedBy: entry.changedBy,
  timestamp: entry.timestamp,
});

// No pagination — deliberate for v1. A single Event's lifetime change
// history is small at Aaradhya's scale (SRS §6.1); revisit if that stops
// being true (docs/api-conventions.md).
export const listChangeLog = async ({ query }: ListChangeLogRequest): Promise<ListChangeLogResponse> => {
  const { entityType, entityId } = query;

  const entries = await ChangeLogEntry.find({ entityType, entityId }).sort({ timestamp: -1 });

  return { status: 200, body: entries.map(toPublicEntry) };
};
