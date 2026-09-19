import type { AppRouteMutationImplementation, AppRouteQueryImplementation } from '@ts-rest/express';
import type { ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../contract/index.js';
import { MenuItem, type MenuItemDocument } from '../models/menu-item.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';
import { escapeRegExp } from '../utils/regex.js';

type CreateMenuItemResponse = ServerInferResponses<typeof contract.createMenuItem>;
type UpdateMenuItemResponse = ServerInferResponses<typeof contract.updateMenuItem>;

const toPublicMenuItem = (item: MenuItemDocument) => ({
  id: item.id,
  name: item.name,
  defaultCostPerPlate: item.defaultCostPerPlate,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

// Empty/omitted search returns the full list, not a 400 (this story's own
// edge case) — no filter reads the same as "show me everything," matching
// how an empty search box behaves to someone just browsing the master
// list. $options: 'i' makes the substring match case-insensitive
// (this story's own AC: "paneer" must match "Paneer Tikka").
export const listMenuItems: AppRouteQueryImplementation<typeof contract.listMenuItems> = async ({ query }) => {
  const filter = query.search ? { name: { $regex: escapeRegExp(query.search), $options: 'i' } } : {};
  const items = await MenuItem.find(filter).sort({ name: 1 });
  return { status: 200, body: items.map(toPublicMenuItem) };
};

const nameAlreadyExists: Extract<CreateMenuItemResponse, { status: 409 }> = {
  status: 409,
  body: {
    error: {
      code: 'MENU_ITEM_NAME_TAKEN',
      message: 'A Menu Item with that name already exists.',
    },
  },
};

// Any authenticated caller, not just Event Manager (this story's own AC:
// the master list "grows organically" from any manager's entry, not
// gated by role) — router.ts wires this under authenticatedOnly, not
// eventManagerOnly.
export const createMenuItem: AppRouteMutationImplementation<typeof contract.createMenuItem> = async ({ body }) => {
  try {
    const item = await MenuItem.create({ name: body.name, defaultCostPerPlate: body.defaultCostPerPlate });
    return { status: 201, body: toPublicMenuItem(item) };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return nameAlreadyExists;
    }
    throw error;
  }
};

const menuItemNotFound: Extract<UpdateMenuItemResponse, { status: 404 }> = {
  status: 404,
  body: { error: { code: 'MENU_ITEM_NOT_FOUND', message: 'No Menu Item with that id.' } },
};

// Same authenticatedOnly gating as createMenuItem above (router.ts) — no
// `active` field exists on this model to toggle (settings-sections.ts's
// own comment), so this only ever edits name/defaultCostPerPlate.
//
// KNOWN, UNADDRESSED TRADEOFF: unlike Venue/RoomType (whose name/cost are
// copied into a Session/RoomLine by value at selection time, per those
// models' own comments), a Meal Item stores only a MenuItem ObjectId
// reference (models/event.ts's own `menuItems: [{ ref: 'MenuItem' }]`) and
// every reader (item-card.tsx, quotation-preview-page.tsx) resolves the
// display name live from the CURRENT master list. Renaming a Menu Item
// here therefore retroactively changes what every past Event/Quotation
// that referenced it displays — including one already shared with a
// client — with no audit trail. This story only asked for parity with the
// other three sections' edit action; snapshotting the name at reference
// time (or warning on rename) is a real, separate follow-up, not solved
// by this endpoint's own logic below.
export const updateMenuItem: AppRouteMutationImplementation<typeof contract.updateMenuItem> = async ({
  params,
  body,
}) => {
  const update: { name?: string; defaultCostPerPlate?: number } = {};
  if (body.name !== undefined) {
    update.name = body.name;
  }
  if (body.defaultCostPerPlate !== undefined) {
    update.defaultCostPerPlate = body.defaultCostPerPlate;
  }

  try {
    const item = await MenuItem.findByIdAndUpdate(params.id, update, {
      returnDocument: 'after',
      runValidators: true,
    });

    if (!item) {
      return menuItemNotFound;
    }

    return { status: 200, body: toPublicMenuItem(item) };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return nameAlreadyExists;
    }
    throw error;
  }
};
