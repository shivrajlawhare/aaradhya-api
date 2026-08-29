import { Schema, model, Types, type HydratedDocument } from 'mongoose';
import { Role, User } from './user.js';
import { generateEventId } from '../services/event-id.js';

/** SRS §5.1 FR-EVT-6 — the only four states an Event can be in. */
export enum EventStatus {
  Tentative = 'Tentative',
  Confirmed = 'Confirmed',
  Completed = 'Completed',
  Cancelled = 'Cancelled',
}

export const EVENT_STATUS_VALUES: EventStatus[] = Object.values(EventStatus);

/** SRS §5.3 — the default rows a Client Contact can be, plus a free-form one. */
export enum ClientContactRole {
  Bride = 'Bride',
  Groom = 'Groom',
  POC = 'POC',
  Custom = 'Custom',
}

export const CLIENT_CONTACT_ROLE_VALUES: ClientContactRole[] = Object.values(ClientContactRole);

export interface ClientContactAttributes {
  name: string;
  contactNumber: string;
  role: ClientContactRole;
}

export interface EventAttributes {
  eventId: string;
  // Free text, not an enum — FR-EVT-1 wants a "dropdown + custom" input, so
  // the schema stays open to whatever value the UI's custom option sends.
  eventFamilyType: string;
  status: EventStatus;
  eventManager: Types.ObjectId;
  clientContacts: ClientContactAttributes[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const clientContactSchema = new Schema<ClientContactAttributes>({
  name: { type: String, required: true, trim: true },
  contactNumber: { type: String, required: true, trim: true },
  role: { type: String, required: true, enum: CLIENT_CONTACT_ROLE_VALUES },
});

// event_manager must point at a real User Account whose role is
// EventManager — any other user's id (or a nonexistent one) is rejected at
// the schema level, not left to the create-endpoint to police.
const isValidEventManagerReference = async (userId: Types.ObjectId): Promise<boolean> => {
  const manager = await User.findById(userId);
  return manager !== null && manager.role === Role.EventManager;
};

const eventSchema = new Schema<EventAttributes>(
  {
    eventId: { type: String, required: true },
    eventFamilyType: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: EVENT_STATUS_VALUES },
    eventManager: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      validate: {
        validator: isValidEventManagerReference,
        message: 'event_manager must reference an existing User Account with the EventManager role.',
      },
    },
    // Zero or more at the schema level — STORY-012's create endpoint is
    // where "at least one" gets enforced, so this schema stays reusable by
    // anything that needs an Event shape without that create-time rule.
    clientContacts: { type: [clientContactSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

eventSchema.index({ eventId: 1 }, { unique: true });

// event_id is always server-generated, never client-supplied — overwritten
// unconditionally on creation, before validation runs (so `required` above
// can never actually fail). Only on creation: an update-path story later
// must not have every `.save()` mint a fresh id and reserve another
// sequence number out from under an existing Event.
eventSchema.pre('validate', async function assignEventId() {
  if (this.isNew) {
    this.eventId = await generateEventId();
  }
});

export type EventDocument = HydratedDocument<EventAttributes>;

export const Event = model<EventAttributes>('Event', eventSchema);
