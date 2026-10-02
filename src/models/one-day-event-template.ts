import { type HydratedDocument, model, Schema, Types } from 'mongoose';
import { SEATING_ARRANGEMENT_VALUES, type SeatingArrangement } from './event.js';

// The single document's fixed key — a unique index on it keeps the
// collection a singleton even if two first reads race to seed it.
export const ONE_DAY_EVENT_TEMPLATE_KEY = 'default';

export interface TemplateSessionSetupAttributes {
  seating?: SeatingArrangement;
  tableCount?: number;
  chairCount?: number;
  stage?: boolean;
  buffet?: boolean;
  registrationDesk?: boolean;
  vipSeating?: boolean;
  brideGroomSeating?: boolean;
  notes?: string;
}

export interface TemplateSessionAttributes {
  sessionType: string;
  venue: string;
  // Unset = take the Venues master's default cost at apply time (D1).
  venueCost?: number;
  startTime: string;
  endTime: string;
  pax: number;
  setup?: TemplateSessionSetupAttributes;
}

export interface TemplateRoomLineAttributes {
  roomType: string;
  noOfRooms: number;
}

export interface TemplateCeremonyAttributes {
  eventName: string;
  startTime: string;
  endTime: string;
}

export interface TemplateMealAttributes {
  mealName: string;
  startTime: string;
  endTime: string;
  pax: number;
  costPerPlate: number;
  limitedSeating: boolean;
  menuItems: Types.ObjectId[];
}

export interface TemplateLineItemAttributes {
  name: string;
  note?: string;
  amount: number;
}

// CR-1 D1 — the editable "One Day Event" template in Settings, seeded with
// example_quatation_4's values. One document for the whole organisation.
export interface OneDayEventTemplateAttributes {
  key: string;
  eventFamilyType: string;
  session: TemplateSessionAttributes;
  roomLines: TemplateRoomLineAttributes[];
  ceremonies: TemplateCeremonyAttributes[];
  meals: TemplateMealAttributes[];
  lineItems: TemplateLineItemAttributes[];
  gstPercent: number;
  createdAt: Date;
  updatedAt: Date;
}

const setupSchema = new Schema<TemplateSessionSetupAttributes>(
  {
    seating: { type: String, enum: SEATING_ARRANGEMENT_VALUES },
    tableCount: { type: Number, min: 0 },
    chairCount: { type: Number, min: 0 },
    stage: { type: Boolean },
    buffet: { type: Boolean },
    registrationDesk: { type: Boolean },
    vipSeating: { type: Boolean },
    brideGroomSeating: { type: Boolean },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const sessionSchema = new Schema<TemplateSessionAttributes>(
  {
    sessionType: { type: String, required: true, trim: true },
    venue: { type: String, required: true, trim: true },
    venueCost: { type: Number, min: 0 },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    pax: { type: Number, required: true, min: 0 },
    setup: { type: setupSchema },
  },
  { _id: false }
);

const roomLineSchema = new Schema<TemplateRoomLineAttributes>(
  {
    roomType: { type: String, required: true, trim: true },
    noOfRooms: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const ceremonySchema = new Schema<TemplateCeremonyAttributes>(
  {
    eventName: { type: String, required: true, trim: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
  },
  { _id: false }
);

const mealSchema = new Schema<TemplateMealAttributes>(
  {
    mealName: { type: String, required: true, trim: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    pax: { type: Number, required: true, min: 0 },
    costPerPlate: { type: Number, required: true, min: 0 },
    limitedSeating: { type: Boolean, required: true, default: false },
    menuItems: [{ type: Schema.Types.ObjectId, ref: 'MenuItem' }],
  },
  { _id: false }
);

const lineItemSchema = new Schema<TemplateLineItemAttributes>(
  {
    name: { type: String, required: true, trim: true },
    note: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const oneDayEventTemplateSchema = new Schema<OneDayEventTemplateAttributes>(
  {
    key: { type: String, required: true, default: ONE_DAY_EVENT_TEMPLATE_KEY, immutable: true },
    eventFamilyType: { type: String, required: true, trim: true },
    session: { type: sessionSchema, required: true },
    roomLines: { type: [roomLineSchema], default: [] },
    ceremonies: { type: [ceremonySchema], default: [] },
    meals: { type: [mealSchema], default: [] },
    lineItems: { type: [lineItemSchema], default: [] },
    gstPercent: { type: Number, required: true, min: 0, max: 100 },
  },
  { timestamps: true }
);

oneDayEventTemplateSchema.index({ key: 1 }, { unique: true });

export type OneDayEventTemplateDocument = HydratedDocument<OneDayEventTemplateAttributes>;

// Collection name per DEV-11: `oneDayEventTemplate`.
export const OneDayEventTemplate = model<OneDayEventTemplateAttributes>(
  'OneDayEventTemplate',
  oneDayEventTemplateSchema,
  'oneDayEventTemplate'
);
