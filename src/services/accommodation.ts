import { roundToCurrency } from '../utils/currency.js';
import { MS_PER_DAY } from '../utils/date.js';

export interface RoomLineInput {
  occupancy: number;
  tariff: number;
  noOfRooms: number;
}

/**
 * Pure computation for the Accommodation Block (SRS §4.3) — every function
 * here is DB-free and takes/returns plain values, so it's unit-testable with
 * no HTTP layer. None of these values are stored: the schema persists only
 * the inputs (check_in, check_out, room_lines, discount_percent), and
 * whatever reads/returns an Accommodation Block derives the rest on demand,
 * so nothing can drift out of sync.
 *
 * DEV-07 (UI Redesign decision D2, verified against example_quatation_3.pdf):
 * a room line is billed tariff × no_of_rooms × total_nights with **no GST**
 * ("Total Taxable Amount"); the block totals those into Total Charges, takes
 * an optional whole-percent Discount off, and the resulting Final Amount is
 * what the Total Cost Summary adds 5% GST to (services/quotation.ts):
 *   78400 + 15200 + 24000 + 0 = 117600 → 10% = 11760 → 105840 → GST 5292.
 * This supersedes STORY-068's GST-inclusive line totals (× 1.05 per line).
 */

// Accommodation's own GST rate, applied once to the Final Amount in the
// Total Cost Summary — distinct from Food's (services/quotation.ts).
export const ACCOMMODATION_GST_RATE_PERCENT = 5;

// Nights stayed (check_out − check_in), clamped to a minimum of 1 —
// STORY-070's fix: a hotel stay is billed by nights, not inclusive calendar
// days (example_quatation_1.pdf: 10-12-2026 → 12-12-2026 prints 2). A
// same-day check-in/check-out is still 1 night; check_out before check_in
// isn't guarded here — validating the range is the endpoint's/UI's job.
export const computeTotalNights = (checkIn: Date, checkOut: Date): number =>
  Math.max(Math.floor((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY), 1);

// tariff × no_of_rooms × total_nights, no GST. totalNights is the caller's
// to supply — before check-in/check-out are both set, callers fall back to
// 1 so a line still shows a provisional amount instead of 0. A
// no_of_rooms of 0 (a placeholder line, e.g. Extra Beds) computes to 0.
export const computeRoomLineTaxable = (
  { tariff, noOfRooms }: Pick<RoomLineInput, 'tariff' | 'noOfRooms'>,
  totalNights: number
): number => roundToCurrency(tariff * noOfRooms * totalNights);

// Total guests the block is housing: occupancy is a room type's per-room
// capacity (e.g. Delux = 2), so a line contributes occupancy × no_of_rooms.
// Not multiplied by nights — headcount doesn't scale with the stay.
export const computeTotalOccupancy = (roomLines: RoomLineInput[]): number =>
  roomLines.reduce((total, line) => total + line.occupancy * line.noOfRooms, 0);

// Σ each line's taxable amount.
export const computeTotalCharges = (roomLines: RoomLineInput[], totalNights: number): number =>
  roundToCurrency(roomLines.reduce((total, line) => total + computeRoomLineTaxable(line, totalNights), 0));

// A whole-percent discount (0–100, D3) off Total Charges, rounded to the
// rupee as the quotation prints it (10% of 117600 = 11760).
export const computeDiscountAmount = (totalCharges: number, discountPercent: number): number =>
  Math.round((totalCharges * discountPercent) / 100);

export const computeFinalAmount = (totalCharges: number, discountAmount: number): number =>
  roundToCurrency(totalCharges - discountAmount);

// The GST the Total Cost Summary adds on top of the Final Amount.
export const computeAccommodationGst = (finalAmount: number): number =>
  roundToCurrency((finalAmount * ACCOMMODATION_GST_RATE_PERCENT) / 100);

export interface AccommodationTotals {
  totalOccupancy: number;
  totalCharges: number;
  discountAmount: number;
  finalAmount: number;
}

export const computeAccommodationTotals = (
  roomLines: RoomLineInput[],
  totalNights: number,
  discountPercent: number
): AccommodationTotals => {
  const totalCharges = computeTotalCharges(roomLines, totalNights);
  const discountAmount = computeDiscountAmount(totalCharges, discountPercent);
  return {
    totalOccupancy: computeTotalOccupancy(roomLines),
    totalCharges,
    discountAmount,
    finalAmount: computeFinalAmount(totalCharges, discountAmount),
  };
};
