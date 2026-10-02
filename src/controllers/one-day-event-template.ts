import type { ServerInferResponses } from '@ts-rest/core';
import type { AppRouteMutationImplementation, AppRouteQueryImplementation } from '@ts-rest/express';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { contract } from '../contract/index.js';
import { MenuItem } from '../models/menu-item.js';
import type { OneDayEventTemplateDocument } from '../models/one-day-event-template.js';
import { logChange } from '../services/change-log.js';
import { getOrSeedOneDayEventTemplate } from '../services/one-day-event-template.js';

type UpdateOneDayEventTemplateResponse = ServerInferResponses<typeof contract.updateOneDayEventTemplate>;

const CHANGE_LOG_ENTITY_TYPE = 'OneDayEventTemplate';

// The template's editable sections — one Change Log entry per section an
// update actually changes.
const TEMPLATE_FIELDS = [
  'eventFamilyType',
  'session',
  'roomLines',
  'ceremonies',
  'meals',
  'lineItems',
  'gstPercent',
] as const;

type TemplateField = (typeof TEMPLATE_FIELDS)[number];

// Plain JSON per section (ObjectIds as strings), for comparing and logging.
const toTemplateSnapshot = (template: OneDayEventTemplateDocument): Record<TemplateField, unknown> => {
  const plain = template.toJSON({ flattenObjectIds: true });
  return {
    eventFamilyType: plain.eventFamilyType,
    session: plain.session,
    roomLines: plain.roomLines,
    ceremonies: plain.ceremonies,
    meals: plain.meals,
    lineItems: plain.lineItems,
    gstPercent: plain.gstPercent,
  };
};

// Resolves every meal's menu item ids to their master names, keeping the
// stored order. A missing master entry (none can be deleted today) is
// skipped rather than failing the read.
const toPublicTemplate = async (template: OneDayEventTemplateDocument) => {
  const menuItemIds = template.meals.flatMap((meal) => meal.menuItems);
  const menuItems = await MenuItem.find({ _id: { $in: menuItemIds } });
  const namesById = new Map(menuItems.map((menuItem) => [menuItem.id, menuItem.name]));
  const { session } = template;

  return {
    eventFamilyType: template.eventFamilyType,
    session: {
      sessionType: session.sessionType,
      venue: session.venue,
      venueCost: session.venueCost ?? null,
      startTime: session.startTime,
      endTime: session.endTime,
      pax: session.pax,
      setup: session.setup ?? null,
    },
    roomLines: template.roomLines.map(({ roomType, noOfRooms }) => ({ roomType, noOfRooms })),
    ceremonies: template.ceremonies.map(({ eventName, startTime, endTime }) => ({ eventName, startTime, endTime })),
    meals: template.meals.map((meal) => ({
      mealName: meal.mealName,
      startTime: meal.startTime,
      endTime: meal.endTime,
      pax: meal.pax,
      costPerPlate: meal.costPerPlate,
      limitedSeating: meal.limitedSeating,
      menuItems: meal.menuItems.flatMap((id) => {
        const name = namesById.get(id.toString());
        return name === undefined ? [] : [{ id: id.toString(), name }];
      }),
    })),
    lineItems: template.lineItems.map(({ name, note, amount }) => ({ name, note: note ?? null, amount })),
    gstPercent: template.gstPercent,
    updatedAt: template.updatedAt,
  };
};

export const getOneDayEventTemplate: AppRouteQueryImplementation<typeof contract.getOneDayEventTemplate> = async () => {
  const template = await getOrSeedOneDayEventTemplate();
  return { status: 200, body: await toPublicTemplate(template) };
};

const unknownMenuItem: Extract<UpdateOneDayEventTemplateResponse, { status: 400 }> = {
  status: 400,
  body: { error: { code: 'MENU_ITEM_NOT_FOUND', message: 'A meal references a Menu Item that does not exist.' } },
};

// Replaces the whole template (Settings → One Day Event → Save template).
// Later prefills read the new values; Events already created are untouched.
export const updateOneDayEventTemplate: AppRouteMutationImplementation<
  typeof contract.updateOneDayEventTemplate
> = async ({ body, req }) => {
  if (!req.user) {
    // Unreachable — eventManagerOnly (router.ts) runs authenticate first.
    throw new Error('updateOneDayEventTemplate handler ran without an authenticated user.');
  }
  const changedByUserId = req.user.id;

  const menuItemIds = [...new Set(body.meals.flatMap((meal) => meal.menuItems))];
  const knownCount = await MenuItem.countDocuments({ _id: { $in: menuItemIds } });
  if (knownCount !== menuItemIds.length) {
    return unknownMenuItem;
  }

  const template = await getOrSeedOneDayEventTemplate();
  const before = toTemplateSnapshot(template);

  template.set({
    eventFamilyType: body.eventFamilyType,
    session: body.session,
    roomLines: body.roomLines,
    ceremonies: body.ceremonies,
    meals: body.meals,
    lineItems: body.lineItems,
    gstPercent: body.gstPercent,
  });
  await template.save();

  const after = toTemplateSnapshot(template);
  const changedFields = TEMPLATE_FIELDS.filter((field) => !isDeepStrictEqual(before[field], after[field]));
  // One groupId per save, the same grouping the Event PATCH routes use.
  const groupId = randomUUID();
  await Promise.all(
    changedFields.map((field) =>
      logChange({
        entityType: CHANGE_LOG_ENTITY_TYPE,
        entityId: template.id,
        field,
        oldValue: before[field],
        newValue: after[field],
        changedByUserId,
        groupId,
      })
    )
  );

  return { status: 200, body: await toPublicTemplate(template) };
};
