import { type ClientContactAttributes, ClientContactRole } from '../models/event.js';

export interface DisplayNameSource {
  eventFamilyType: string;
  clientContacts: Pick<ClientContactAttributes, 'name' | 'role'>[];
}

/**
 * The name a calendar tile shows for an Event (UI Redesign decision D7):
 * the POC contact's name, else the first client contact's name, else the
 * Event's family type. Computed server-side so GET /calendar can label
 * tiles for every role without exposing `clientContacts` to roles that
 * filterEventForRole hides it from (Housekeeping).
 */
export const getEventDisplayName = ({ eventFamilyType, clientContacts }: DisplayNameSource): string => {
  const named = clientContacts.filter((contact) => contact.name.trim().length > 0);
  const contact = named.find((candidate) => candidate.role === ClientContactRole.POC) ?? named[0];
  return contact ? contact.name.trim() : eventFamilyType;
};
