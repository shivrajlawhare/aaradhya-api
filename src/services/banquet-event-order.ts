import {
  type ClientContactAttributes,
  ItemType,
  type SessionDepartmentNotesAttributes,
  type SessionSetupAttributes,
  SessionStatus,
} from '../models/event.js';
import { getEventDisplayName } from './event-display-name.js';
import { toDepartmentNotesResult, toSessionSetupResult } from './session-result.js';

export interface BanquetEventOrderItemSource {
  type: ItemType;
  mealName?: string;
  eventName?: string;
  startTime?: string;
  endTime?: string;
  menuItems: { toString: () => string }[];
}

export interface BanquetEventOrderSessionSource {
  id: string;
  sessionType: string;
  venue: string;
  startDate: Date;
  endDate: Date;
  startTime?: string;
  endTime?: string;
  pax: number;
  sessionStatus: SessionStatus;
  setup: SessionSetupAttributes;
  departmentNotes?: SessionDepartmentNotesAttributes;
  items: BanquetEventOrderItemSource[];
}

export interface BanquetEventOrderSource {
  id: string;
  eventId: string;
  eventFamilyType: string;
  clientContacts: Pick<ClientContactAttributes, 'name' | 'role'>[];
  sessions: BanquetEventOrderSessionSource[];
}

const compareSessions = (a: BanquetEventOrderSessionSource, b: BanquetEventOrderSessionSource): number =>
  a.startDate.getTime() - b.startDate.getTime() || (a.startTime ?? '').localeCompare(b.startTime ?? '');

/**
 * The Banquet Event Order payload (CR-1 D4/D5): one entry per Active
 * session, in date/time order, carrying only what the BEO prints — client
 * name (D7), date, time, pax, venue, function type, meals with menu item
 * names, ceremony names, setup and the Notes for Department. Built field by
 * field, so no price can ever leak into it. `menuItemNamesById` resolves
 * the stored Menu Item ids; an unknown id is dropped.
 */
export const buildBanquetEventOrder = (event: BanquetEventOrderSource, menuItemNamesById: Map<string, string>) => ({
  id: event.id,
  eventId: event.eventId,
  clientName: getEventDisplayName(event),
  sessions: event.sessions
    .filter((session) => session.sessionStatus === SessionStatus.Active)
    .sort(compareSessions)
    .map((session) => ({
      id: session.id,
      sessionType: session.sessionType,
      venue: session.venue,
      startDate: session.startDate,
      endDate: session.endDate,
      startTime: session.startTime ?? null,
      endTime: session.endTime ?? null,
      pax: session.pax,
      meals: session.items
        .filter((item) => item.type === ItemType.Meal)
        .map((item) => ({
          mealName: item.mealName ?? '',
          startTime: item.startTime ?? null,
          endTime: item.endTime ?? null,
          menuItems: item.menuItems.flatMap((id) => {
            const name = menuItemNamesById.get(id.toString());
            return name === undefined ? [] : [name];
          }),
        })),
      ceremonies: session.items
        .filter((item) => item.type === ItemType.Event)
        .map((item) => item.eventName?.trim() ?? '')
        .filter((name) => name !== ''),
      setup: toSessionSetupResult(session.setup),
      departmentNotes: toDepartmentNotesResult(session.departmentNotes),
    })),
});
