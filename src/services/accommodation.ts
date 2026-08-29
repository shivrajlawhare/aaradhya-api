import { config } from '../config.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RoomLineInput {
  occupancy: number;
  tariff: number;
  noOfRooms: number;
}

/**
 * Pure computation for the Accommodation Block (SRS §4.3) — every function
 * here is DB-free and takes/returns plain values, so it's unit-testable with
 * no HTTP layer (this story's own requirement). Deliberately not wired into
 * src/models/event.ts: these are never stored, only computed on demand by
 * whatever reads/returns an Accommodation Block (STORY-019's PATCH endpoint,
 * and later the Quotation rollup) — the schema only persists the inputs
 * (check_in, check_out, room_lines), never these derived values, so there's
 * nothing that can drift out of sync with them.
 */

// Inclusive of both the check-in and check-out date: a same-day stay is
// still 1 day, not 0 (this story's own explicit edge case), and check-in/
// check-out one calendar day apart is 2 days, not 1. check_out before
// check_in (an invalid range) is not guarded here — validating that is a
// schema/endpoint concern for STORY-019, not this pure-math function's job.
export const computeTotalDays = (checkIn: Date, checkOut: Date): number =>
  Math.floor((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY) + 1;

// Rounds to whole paise/cents — repeated floating-point addition of GST-
// inclusive amounts (e.g. 0.1 + 0.2) can otherwise drift by fractions of a
// currency unit.
const roundToCurrency = (amount: number): number => Math.round(amount * 100) / 100;

// tariff × no_of_rooms, GST-inclusive at the org's single flat rate
// (config.gstRatePercent — SRS Assumption A9's "single organization-wide
// rate", not a per-room-type/tariff-bracket slab). A no_of_rooms of 0 is a
// valid placeholder row (this story's own edge case, decided as "allowed")
// and simply computes to 0, not an error.
export const computeRoomLineTotalInclGst = (
  { tariff, noOfRooms }: Pick<RoomLineInput, 'tariff' | 'noOfRooms'>,
  gstRatePercent: number = config.gstRatePercent,
): number => roundToCurrency(tariff * noOfRooms * (1 + gstRatePercent / 100));

// Total guests the block is housing: occupancy is a room type's per-room
// capacity (e.g. Double = 2), so a line contributes occupancy × no_of_rooms
// — summing raw per-room occupancy across lines with different room counts
// wouldn't be a meaningful "total" on its own.
export const computeTotalOccupancy = (roomLines: RoomLineInput[]): number =>
  roomLines.reduce((total, line) => total + line.occupancy * line.noOfRooms, 0);

export const computeTotalCharges = (
  roomLines: RoomLineInput[],
  gstRatePercent: number = config.gstRatePercent,
): number =>
  roundToCurrency(
    roomLines.reduce((total, line) => total + computeRoomLineTotalInclGst(line, gstRatePercent), 0),
  );
