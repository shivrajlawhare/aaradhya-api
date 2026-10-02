import { z } from 'zod';
import { objectIdSchema } from './common.js';
import { sessionSetupInputSchema } from './event.js';

// 'HH:mm', the same time string every wizard form stores and submits.
const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour HH:mm time.');

// CR-1 D1 — the One Day Event template's Session. No date: the Event
// Manager picks it when the template is applied. venueCost is optional — an
// unset cost is filled from the Venues master at apply time.
const templateSessionSchema = z.object({
  sessionType: z.string().trim().min(1),
  venue: z.string().trim().min(1),
  venueCost: z.number().min(0).optional(),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  pax: z.number().int().min(0),
  setup: sessionSetupInputSchema.optional(),
});

// Rooms only — occupancy and tariff come from the Room Types master at
// apply time (D1), so a master edit reaches the next prefill.
const templateRoomLineSchema = z.object({
  roomType: z.string().trim().min(1),
  noOfRooms: z.number().int().min(0),
});

const templateCeremonySchema = z.object({
  eventName: z.string().trim().min(1),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
});

const templateMealBaseSchema = z.object({
  mealName: z.string().trim().min(1),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  pax: z.number().int().min(0),
  costPerPlate: z.number().min(0),
  limitedSeating: z.boolean(),
});

const templateLineItemSchema = z.object({
  name: z.string().trim().min(1),
  note: z.string().trim().optional(),
  amount: z.number().min(0),
});

// PUT /settings/one-day-event-template replaces the whole template.
export const updateOneDayEventTemplateBodySchema = z.object({
  eventFamilyType: z.string().trim().min(1),
  session: templateSessionSchema,
  roomLines: z.array(templateRoomLineSchema),
  ceremonies: z.array(templateCeremonySchema),
  meals: z.array(templateMealBaseSchema.extend({ menuItems: z.array(objectIdSchema('Invalid menu item id.')) })),
  lineItems: z.array(templateLineItemSchema),
  gstPercent: z.number().min(0).max(100),
});

// The stored template, with each meal's menu items resolved to their
// current master names so the wizard can show the chips without a lookup.
export const oneDayEventTemplateResultSchema = z.object({
  eventFamilyType: z.string(),
  session: templateSessionSchema.extend({
    venueCost: z.number().nullable(),
    setup: sessionSetupInputSchema.nullable(),
  }),
  roomLines: z.array(templateRoomLineSchema),
  ceremonies: z.array(templateCeremonySchema),
  meals: z.array(templateMealBaseSchema.extend({ menuItems: z.array(z.object({ id: z.string(), name: z.string() })) })),
  lineItems: z.array(templateLineItemSchema.extend({ note: z.string().nullable() })),
  gstPercent: z.number(),
  updatedAt: z.date(),
});
