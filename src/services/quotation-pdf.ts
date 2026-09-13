import PDFDocument from 'pdfkit';
import { ItemType } from '../models/event.js';
import type { TotalCostSummary } from './quotation.js';

export interface QuotationPdfClientContact {
  name: string;
  contactNumber: string;
  role: string;
}

export interface QuotationPdfItem {
  type: ItemType;
  mealName: string | null;
  eventName: string | null;
  pax: number | null;
  costPerPlate: number | null;
  totalCost: number | null;
}

export interface QuotationPdfSession {
  sessionType: string;
  venue: string;
  venueCost: number;
  startDate: Date;
  endDate: Date;
  items: QuotationPdfItem[];
}

export interface QuotationPdfRoomLine {
  roomType: string;
  occupancy: number;
  tariff: number;
  noOfRooms: number;
  totalInclGst: number;
}

export interface QuotationPdfAccommodation {
  checkIn: Date | null;
  checkOut: Date | null;
  roomLines: QuotationPdfRoomLine[];
  totalCharges: number;
}

export interface QuotationPdfInput {
  eventId: string;
  eventFamilyType: string;
  clientContacts: QuotationPdfClientContact[];
  sessions: QuotationPdfSession[];
  accommodation: QuotationPdfAccommodation;
  summary: TotalCostSummary;
}

const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

// The org's real static Terms & Conditions / Documents Required / Bank
// Account Details block (SRS §4.7's "static T&C/Documents/Bank footer") —
// supplied directly by the business, not a placeholder. Identical on every
// PDF regardless of Event (this story's own AC), so it lives here as a
// fixed constant rather than anything derived from QuotationPdfInput.
const TERMS_AND_CONDITIONS = [
  'The venue rental charges shall be considered as the booking amount and must be paid to confirm the booking.',
  'The remaining balance must be paid on the day of the event or prior to the commencement of the function.',
  'Any additional services or requirements requested beyond this quotation will be charged separately.',
  'Prices are subject to change based on customization and specific event requirements.',
  "The cancellation policy shall apply as per the management's terms and conditions.",
  'Any damage to the hotel property, equipment, furniture, fixtures, décor, or any other assets caused during the event by the client or guests will be chargeable.',
  'This quotation is valid for one (1) month from the date of issue.',
  '200 ml packaged drinking water bottles will be provided as per the confirmed guest count (Pax).',
  'Banquet Hall Timings (with Air Conditioning): 9:00 AM to 3:00 PM. Any extension is subject to management approval and availability.',
  // "Rs." not "₹" — pdfkit's default (non-embedded) Helvetica font uses
  // WinAnsiEncoding, which has no Indian Rupee glyph (U+20B9); rendering ₹
  // directly silently corrupts to the wrong character ("¹") in the actual
  // PDF output rather than erroring, which is worse than not doing it. No
  // Unicode font is embedded in this repo (yet) to render it correctly.
  'Additional hall usage beyond the approved timing will be charged at Rs. 15,000 per hour.',
  'Room Check-in: 12:00 PM | Check-out: 11:00 AM. Early check-in, late check-out, or extended stay will be subject to availability and additional charges.',
  'Ample parking is available within the hotel premises, and security will be provided for vehicles parked inside the campus. However, the management shall not be responsible for any loss, theft, or damage to vehicles parked outside the hotel premises.',
  'The management reserves the right to modify these terms and conditions without prior notice, if required.',
];

const DOCUMENTS_REQUIRED = [
  'Aadhar Card',
  'Pan Card',
  'Leaving / Birth Certificate',
  'Ration Card',
  '2 passport size photos each',
  'Wedding Card',
];

const BANK_ACCOUNT_DETAILS = {
  name: 'Aaradhya Adorer',
  accountNumber: '142320110000165',
  bankName: 'Bank of India',
  branchName: 'Talawade',
  ifsc: 'BKID0001423',
  gstNumber: '27ABLFA0695F1ZC',
};

const writeHeading = (doc: PDFKit.PDFDocument, text: string): void => {
  doc.moveDown();
  doc.fontSize(14).text(text, { underline: true });
  doc.fontSize(10);
};

const writeStaticFooter = (doc: PDFKit.PDFDocument): void => {
  writeHeading(doc, 'Terms & Conditions');
  for (const term of TERMS_AND_CONDITIONS) {
    doc.text(`• ${term}`);
  }

  writeHeading(doc, 'Documents Required from Bride and Groom');
  DOCUMENTS_REQUIRED.forEach((document, index) => {
    doc.text(`${index + 1}. ${document}`);
  });

  writeHeading(doc, 'Bank Account Details');
  doc.text(`Name: ${BANK_ACCOUNT_DETAILS.name}`);
  doc.text(`Account Number: ${BANK_ACCOUNT_DETAILS.accountNumber}`);
  doc.text(`Bank Name: ${BANK_ACCOUNT_DETAILS.bankName}`);
  doc.text(`Branch Name: ${BANK_ACCOUNT_DETAILS.branchName}`);
  doc.text(`IFSC: ${BANK_ACCOUNT_DETAILS.ifsc}`);
  doc.text(`GST Number: ${BANK_ACCOUNT_DETAILS.gstNumber}`);

  doc.moveDown();
  doc.text('Regards,');
  doc.text('Aaradhya Banquets');
};

/**
 * Renders the client-facing Quotation PDF (SRS §4.7) from already-fetched,
 * plain Event data — no DB access here, same "pure input in, output out"
 * shape as computeTotalCostSummary (STORY-039); the controller (STORY-043)
 * is the one that queries the live Event and assembles this input. Section
 * order matches §4.7 exactly: Client Details -> Event Details per Session
 * -> Accommodation -> F&B per Session -> Total Cost Summary -> static
 * T&C/Documents/Bank footer.
 *
 * Returns a Promise<Buffer> rather than exposing the underlying stream —
 * every caller so far (the STORY-043 handler, this file's own tests) wants
 * the complete bytes, not incremental chunks.
 */
export const renderQuotationPdf = (input: QuotationPdfInput): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('Aaradhya Banquets — Quotation', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10);
    doc.text(`Event ID: ${input.eventId}`);
    doc.text(`Event Type: ${input.eventFamilyType}`);

    writeHeading(doc, 'Client Details');
    for (const contact of input.clientContacts) {
      doc.text(`${contact.name} (${contact.role}) — ${contact.contactNumber}`);
    }

    writeHeading(doc, 'Event Details');
    input.sessions.forEach((session, index) => {
      doc.text(
        `Session ${index + 1}: ${session.sessionType} at ${session.venue}, ` +
          `${formatDate(session.startDate)} to ${formatDate(session.endDate)}, venue cost ${session.venueCost}`,
      );
      // Event Items (Muhurta, Cake Cutting, ...) are schedule markers with
      // no cost fields (SRS §4.5) — they belong in this session-schedule
      // section, not the F&B section below, which only ever lists Meal
      // Items.
      for (const item of session.items) {
        if (item.type === ItemType.Event) {
          doc.text(`  • ${item.eventName ?? 'Event Item'}`);
        }
      }
    });

    writeHeading(doc, 'Accommodation');
    if (input.accommodation.roomLines.length === 0) {
      doc.text('No accommodation booked for this Event.');
    } else {
      doc.text(
        `Check-in: ${input.accommodation.checkIn ? formatDate(input.accommodation.checkIn) : '—'} · ` +
          `Check-out: ${input.accommodation.checkOut ? formatDate(input.accommodation.checkOut) : '—'}`,
      );
      for (const line of input.accommodation.roomLines) {
        doc.text(`${line.roomType}: ${line.occupancy} occupancy × ${line.noOfRooms} rooms — ${line.totalInclGst}`);
      }
      doc.text(`Accommodation total: ${input.accommodation.totalCharges}`);
    }

    writeHeading(doc, 'F&B');
    input.sessions.forEach((session, index) => {
      const mealItems = session.items.filter((item) => item.type === ItemType.Meal);
      doc.text(`Session ${index + 1}: ${session.sessionType}`);
      // A Session with zero Items (this story's own edge case) still
      // renders a valid line here, not a broken/empty table.
      if (mealItems.length === 0) {
        doc.text('  No Meal Items added yet.');
      } else {
        for (const item of mealItems) {
          doc.text(`  • ${item.mealName ?? 'Meal'} — ${item.pax ?? 0} pax × ${item.costPerPlate ?? 0} = ${item.totalCost ?? 0}`);
        }
      }
    });

    writeHeading(doc, 'Total Cost Summary');
    doc.text(`Venue total: ${input.summary.venueTotal}`);
    doc.text(`Food subtotal: ${input.summary.foodSubtotal}`);
    doc.text(`Food total (incl. GST): ${input.summary.foodTotalInclGst}`);
    doc.text(`Accommodation total: ${input.summary.accommodationTotal}`);
    doc.text(`Extras total: ${input.summary.extrasTotal}`);
    doc.fontSize(14).text(`Grand Total: ${input.summary.grandTotal}`);
    doc.fontSize(10);

    writeStaticFooter(doc);

    doc.end();
  });
