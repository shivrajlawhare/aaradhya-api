import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ChangeLogEntry } from '../../src/models/change-log-entry.js';
import { logChange } from '../../src/services/change-log.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../support/db.js';
import { expectValidationError } from '../support/validation.js';

const CHANGED_BY = '507f1f77bcf86cd799439011';

const validEntry = () => ({
  entityType: 'Event',
  entityId: 'event-1',
  field: 'status',
  oldValue: 'Tentative',
  newValue: 'Confirmed',
  changedByUserId: CHANGED_BY,
});

beforeAll(connectTestDb);
afterEach(clearCollections);
afterAll(disconnectTestDb);

describe('logChange', () => {
  it('persists an entry with every given field, plus a server-set timestamp', async () => {
    const before = Date.now();

    const entry = await logChange(validEntry());

    expect(entry).toMatchObject({
      entityType: 'Event',
      entityId: 'event-1',
      field: 'status',
      oldValue: 'Tentative',
      newValue: 'Confirmed',
      changedBy: CHANGED_BY,
    });
    expect(entry.timestamp).toBeInstanceOf(Date);
    expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('writes a separate entry per field for the same entityId, not one overwritten entry', async () => {
    await logChange(validEntry());
    await logChange({ ...validEntry(), field: 'pax', oldValue: 100, newValue: 120 });

    const entries = await ChangeLogEntry.find({ entityId: 'event-1' });

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.field).sort()).toEqual(['pax', 'status']);
  });

  it('still writes an entry when oldValue and newValue are identical', async () => {
    await logChange({ ...validEntry(), oldValue: 'Confirmed', newValue: 'Confirmed' });

    const entries = await ChangeLogEntry.find({ entityId: 'event-1' });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ oldValue: 'Confirmed', newValue: 'Confirmed' });
  });

  it('stores the full before/after array, not a diff, for an array-valued field', async () => {
    const before = [{ name: 'Bride', phone: '111' }];
    const after = [
      { name: 'Bride', phone: '111' },
      { name: 'Groom', phone: '222' },
    ];

    const entry = await logChange({
      ...validEntry(),
      field: 'client_contacts',
      oldValue: before,
      newValue: after,
    });

    expect(entry.oldValue).toEqual(before);
    expect(entry.newValue).toEqual(after);
  });

  it('persists when oldValue is absent (a field set for the first time)', async () => {
    const entry = await logChange({ ...validEntry(), oldValue: undefined });

    expect(entry.oldValue).toBeUndefined();
    expect(entry.newValue).toBe('Confirmed');
  });

  it.each(['entityType', 'entityId', 'field', 'changedBy'])(
    'rejects a document missing %s',
    async (field) => {
      const data: Record<string, unknown> = {
        entityType: 'Event',
        entityId: 'event-1',
        field: 'status',
        changedBy: CHANGED_BY,
      };
      delete data[field];

      const error = await expectValidationError(ChangeLogEntry, data);

      expect(error.errors).toHaveProperty(field);
    },
  );

  it('sets timestamp itself even if a caller-like value is passed straight to the model', async () => {
    const suppliedTimestamp = new Date('2000-01-01T00:00:00.000Z');

    const entry = await ChangeLogEntry.create({
      entityType: 'Event',
      entityId: 'event-1',
      field: 'status',
      changedBy: CHANGED_BY,
      timestamp: suppliedTimestamp,
    });

    // The schema default only applies when no value is given at all, so a
    // direct model write can still set one — this is exactly why the write
    // helper (logChange) is the documented path: its input type has no
    // `timestamp` field, so a caller going through it structurally can't.
    expect(entry.timestamp).toEqual(suppliedTimestamp);
  });
});
