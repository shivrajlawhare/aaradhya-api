import type { Types } from 'mongoose';
import { MenuItem } from '../models/menu-item.js';
import {
  ONE_DAY_EVENT_TEMPLATE_KEY,
  OneDayEventTemplate,
  type OneDayEventTemplateAttributes,
  type OneDayEventTemplateDocument,
} from '../models/one-day-event-template.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';

const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

// example_quatation_4.pdf (CR-1 5B / UI-41): a one-day Wedding at Full
// Banquet. The venue cost is left unset so it comes from the Venues master.
// Grand Total with no rooms booked: 1,20,000 + 2,60,400 + 1,15,000 + 7,000
// = 5,02,400.
const SEED_MEALS = [
  {
    mealName: 'Breakfast',
    startTime: '08:00',
    endTime: '09:30',
    pax: 50,
    costPerPlate: 160,
    limitedSeating: false,
    menuItemNames: ['Tea', 'Coffee', 'Pohe', 'Upma'],
  },
  {
    mealName: 'Welcome Drink',
    startTime: '10:30',
    endTime: '11:00',
    pax: 500,
    costPerPlate: 30,
    limitedSeating: false,
    menuItemNames: ['Kokam Sarbat'],
  },
  {
    mealName: 'Lunch',
    startTime: '12:30',
    endTime: '15:00',
    pax: 500,
    costPerPlate: 450,
    limitedSeating: false,
    menuItemNames: [
      'Plain Rice',
      'Mutter Pulao',
      'Dal Fry',
      'Punjabi Veg',
      'Maharashtrian Veg',
      'Puri',
      'Fulke',
      'Solkadhi',
      'Mix Pakoda',
      'Papad',
      'Pickle',
      'Salad',
      'Gulab jamun',
      'Vanilla Ice Cream',
    ],
  },
];

const SEED_TEMPLATE = {
  eventFamilyType: 'Wedding',
  session: { sessionType: 'Wedding', venue: 'Full Banquet', startTime: '09:00', endTime: '15:00', pax: 500 },
  // D8: Delux 14 · Executive 2 · Family Room 2 · Extra Beds 0.
  roomLines: [
    { roomType: 'Delux', noOfRooms: 14 },
    { roomType: 'Executive', noOfRooms: 2 },
    { roomType: 'Family Room', noOfRooms: 2 },
    { roomType: 'Extra Beds', noOfRooms: 0 },
  ],
  ceremonies: [{ eventName: 'Muhurta', startTime: '11:00', endTime: '12:30' }],
  lineItems: [
    { name: 'Decoration', amount: 115000 },
    { name: 'Photographer', amount: 0 },
    { name: 'Bhatji', note: 'wedding + punyawachan', amount: 7000 },
  ],
  gstPercent: 5,
};

// Find-or-create by name (case-insensitive, like the master's own unique
// index), keeping the given order. A concurrent create of the same name
// falls back to reading the winner.
const findOrCreateMenuItemIds = async (names: string[]): Promise<Types.ObjectId[]> => {
  const ids: Types.ObjectId[] = [];
  for (const name of names) {
    const existing = await MenuItem.findOne({ name }).collation(CASE_INSENSITIVE);
    if (existing) {
      ids.push(existing._id);
      continue;
    }
    try {
      const created = await MenuItem.create({ name });
      ids.push(created._id);
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      const winner = await MenuItem.findOne({ name }).collation(CASE_INSENSITIVE).orFail();
      ids.push(winner._id);
    }
  }
  return ids;
};

const buildSeedTemplate = async (): Promise<Omit<OneDayEventTemplateAttributes, 'createdAt' | 'updatedAt'>> => {
  const meals = [];
  for (const { menuItemNames, ...meal } of SEED_MEALS) {
    meals.push({ ...meal, menuItems: await findOrCreateMenuItemIds(menuItemNames) });
  }
  return { key: ONE_DAY_EVENT_TEMPLATE_KEY, ...SEED_TEMPLATE, meals };
};

/**
 * Returns the One Day Event template, seeding it with the example 4 values
 * (and any missing Menu Items) the first time it's read. Never overwrites
 * an existing template, so `npm run seed:config` keeps the Event Manager's
 * edits.
 */
export const getOrSeedOneDayEventTemplate = async (): Promise<OneDayEventTemplateDocument> => {
  const existing = await OneDayEventTemplate.findOne({ key: ONE_DAY_EVENT_TEMPLATE_KEY });
  if (existing) {
    return existing;
  }
  try {
    return await OneDayEventTemplate.create(await buildSeedTemplate());
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    return OneDayEventTemplate.findOne({ key: ONE_DAY_EVENT_TEMPLATE_KEY }).orFail();
  }
};
