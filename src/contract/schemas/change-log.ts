import { z } from 'zod';

export const listChangeLogQuerySchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
});

// oldValue/newValue are Schema.Types.Mixed on the model (STORY-008) - whatever
// JSON-serialisable shape the changed field held, not a fixed shape here either.
export const changeLogEntryResultSchema = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  field: z.string(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  changedBy: z.string(),
  // STORY-081 — absent on any entry written before this field existed; the
  // frontend renders such an entry as its own single-item group.
  groupId: z.string().optional(),
  timestamp: z.date(),
});
