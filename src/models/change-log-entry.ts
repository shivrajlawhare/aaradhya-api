import { Schema, model, type HydratedDocument } from 'mongoose';

export interface ChangeLogEntryAttributes {
  entityType: string;
  entityId: string;
  field: string;
  // Whatever JSON-serialisable shape the field holds — a string, a number, a
  // whole embedded array (e.g. client_contacts). Storing the full
  // before/after value here rather than a diff is the deliberate v1 choice
  // (simpler — see docs/stories/Aaradhya_Story_Backlog.md STORY-008); either
  // can legitimately be absent (a field that had no value before it was
  // first set).
  oldValue?: unknown;
  newValue?: unknown;
  // The id of the User who made the change (STORY-003's req.user.id) —
  // plain string, matching how ids already flow through the rest of this
  // app, not a Mongoose ref. Nothing reads/populates it yet — STORY-008 has
  // no HTTP/read layer.
  changedBy: string;
  timestamp: Date;
}

const changeLogEntrySchema = new Schema<ChangeLogEntryAttributes>({
  entityType: { type: String, required: true },
  entityId: { type: String, required: true },
  field: { type: String, required: true },
  oldValue: { type: Schema.Types.Mixed },
  newValue: { type: Schema.Types.Mixed },
  changedBy: { type: String, required: true },
  // Server-set only: the write helper (src/services/change-log.ts) never
  // accepts one from a caller, and `immutable` blocks any later mutation
  // even by code that bypasses the helper — matches the audit-trail nature
  // of the log (FR-LOG-3: visible record only, never edited after the fact).
  timestamp: { type: Date, required: true, default: Date.now, immutable: true },
});

// The natural access pattern this schema exists for: "the change history for
// this one entity" (FR-LOG-2, an Event Page sub-tab).
changeLogEntrySchema.index({ entityType: 1, entityId: 1 });

export type ChangeLogEntryDocument = HydratedDocument<ChangeLogEntryAttributes>;

export const ChangeLogEntry = model<ChangeLogEntryAttributes>(
  'ChangeLogEntry',
  changeLogEntrySchema,
);
