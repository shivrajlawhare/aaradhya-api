import { describe, expect, it } from 'vitest';
import { ClientContactRole } from '../../src/models/event.js';
import { getEventDisplayName } from '../../src/services/event-display-name.js';

describe('getEventDisplayName (D7)', () => {
  it("prefers the POC contact's name even when it isn't listed first", () => {
    expect(
      getEventDisplayName({
        eventFamilyType: 'Wedding',
        clientContacts: [
          { name: 'Aditi Kulkarni', role: ClientContactRole.Bride },
          { name: 'Suresh Kulkarni', role: ClientContactRole.POC },
        ],
      })
    ).toBe('Suresh Kulkarni');
  });

  it('falls back to the first client contact when there is no POC', () => {
    expect(
      getEventDisplayName({
        eventFamilyType: 'Wedding',
        clientContacts: [
          { name: 'Aditi Kulkarni', role: ClientContactRole.Bride },
          { name: 'Rohan Deshpande', role: ClientContactRole.Groom },
        ],
      })
    ).toBe('Aditi Kulkarni');
  });

  it('falls back to the family type when there are no contacts', () => {
    expect(getEventDisplayName({ eventFamilyType: 'Corporate', clientContacts: [] })).toBe('Corporate');
  });

  it('skips blank names and trims the one it uses', () => {
    expect(
      getEventDisplayName({
        eventFamilyType: 'Wedding',
        clientContacts: [
          { name: '  ', role: ClientContactRole.POC },
          { name: ' Ravi Mehta ', role: ClientContactRole.Custom },
        ],
      })
    ).toBe('Ravi Mehta');
  });
});
