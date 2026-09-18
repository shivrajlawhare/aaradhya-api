import { roundToCurrency } from '../utils/currency.js';
import { computeInclusiveDayCount } from '../utils/date.js';

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

// STORY-068 — verified line-by-line against both reference quotations
// (docs/example_quatations/): a room line's own printed "Total including
// GST" is tariff × no_of_rooms × total_days × 1.05 exactly (e.g. Deluxe:
// 2500 × 14 rooms × 2 nights × 1.05 = 73,500, reproduced identically in
// both PDFs for every room type). This supersedes STORY-018's original
// formula (tariff × no_of_rooms × config.gstRatePercent, no total_days
// factor at all, defaulting to the org's 18% rate) — that formula predates
// having the reference quotations to verify against and doesn't reproduce
// their numbers. 5% is Accommodation's own rate, distinct from Food's
// (services/quotation.ts) — despite both now defaulting to the same
// number, SRS Assumption A9 only ever described one org-wide rate for
// food; nothing ties these two defaults together going forward.
export const ACCOMMODATION_GST_RATE_PERCENT = 5;

// Inclusive of both the check-in and check-out date: a same-day stay is
// still 1 day, not 0 (this story's own explicit edge case), and check-in/
// check-out one calendar day apart is 2 days, not 1. check_out before
// check_in (an invalid range) is not guarded here — validating that is a
// schema/endpoint concern for STORY-019, not this pure-math function's job.
// Delegates to the shared computeInclusiveDayCount (STORY-026 extracted it
// once Session's start_date/end_date needed the identical formula).
export const computeTotalDays = (checkIn: Date, checkOut: Date): number =>
  computeInclusiveDayCount(checkIn, checkOut);

// tariff × no_of_rooms × total_days, GST-inclusive at the flat
// Accommodation rate above. totalDays is the caller's job to supply (this
// function has no checkIn/checkOut of its own to derive it from) — every
// caller either has a real computeTotalDays(checkIn, checkOut) result, or
// falls back to 1 when check-in/check-out aren't both set yet (a room line
// entered before dates are chosen still shows a sensible provisional
// total instead of always reading 0). A no_of_rooms of 0 is a valid
// placeholder row (this story's own edge case, decided as "allowed") and
// simply computes to 0, not an error.
export const computeRoomLineTotalInclGst = (
  { tariff, noOfRooms }: Pick<RoomLineInput, 'tariff' | 'noOfRooms'>,
  totalDays: number,
  gstRatePercent: number = ACCOMMODATION_GST_RATE_PERCENT,
): number => roundToCurrency(tariff * noOfRooms * totalDays * (1 + gstRatePercent / 100));

// Total guests the block is housing: occupancy is a room type's per-room
// capacity (e.g. Double = 2), so a line contributes occupancy × no_of_rooms
// — summing raw per-room occupancy across lines with different room counts
// wouldn't be a meaningful "total" on its own. Not multiplied by total_days
// — headcount, unlike cost, doesn't scale with nights stayed.
export const computeTotalOccupancy = (roomLines: RoomLineInput[]): number =>
  roomLines.reduce((total, line) => total + line.occupancy * line.noOfRooms, 0);

export const computeTotalCharges = (
  roomLines: RoomLineInput[],
  totalDays: number,
  gstRatePercent: number = ACCOMMODATION_GST_RATE_PERCENT,
): number =>
  roundToCurrency(
    roomLines.reduce((total, line) => total + computeRoomLineTotalInclGst(line, totalDays, gstRatePercent), 0),
  );
