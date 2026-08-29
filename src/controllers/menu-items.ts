import type { AppRouteMutationImplementation, AppRouteQueryImplementation } from '@ts-rest/express';
import type { ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../contract/index.js';
import { MenuItem, type MenuItemDocument } from '../models/menu-item.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';
import { escapeRegExp } from '../utils/regex.js';

type CreateMenuItemResponse = ServerInferResponses<typeof contract.createMenuItem>;

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
