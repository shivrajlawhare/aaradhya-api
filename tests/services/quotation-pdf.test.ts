import { PDFParse } from 'pdf-parse';
import { describe, expect, it } from 'vitest';
import { ItemType } from '../../src/models/event.js';
import { renderQuotationPdf, type QuotationPdfInput } from '../../src/services/quotation-pdf.js';

const extractText = async (pdf: Buffer): Promise<string> => {
  const parser = new PDFParse({ data: pdf });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
};

const baseInput: QuotationPdfInput = {
  eventId: 'ARD-EVT-2026-001',
  eventFamilyType: 'Wedding',
  clientContacts: [{ name: 'Priya Nair', contactNumber: '9876543210', role: 'Bride' }],
  sessions: [
    {
      sessionType: 'Wedding',
      venue: 'Lawn',
      venueCost: 5000,
      startDate: new Date('2026-06-15T00:00:00.000Z'),
      endDate: new Date('2026-06-15T00:00:00.000Z'),
      items: [
        {
          type: ItemType.Meal,
          mealName: 'Lunch',
          eventName: null,
          pax: 10,
          costPerPlate: 200,
          totalCost: 2000,
        },
      ],
    },
  ],
  accommodation: { checkIn: null, checkOut: null, roomLines: [], totalCharges: 0 },
  summary: {
    venueTotal: 5000,
    foodSubtotal: 2000,
    foodTotalInclGst: 2360,
    accommodationTotal: 0,
    extrasTotal: 0,
    grandTotal: 7360,
  },
};

describe('renderQuotationPdf', () => {
  it('produces a non-empty PDF byte stream (starts with the %PDF magic bytes)', async () => {
    const pdf = await renderQuotationPdf(baseInput);

    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('includes the client name, a session venue, and the grand total in the extracted text', async () => {
    const pdf = await renderQuotationPdf(baseInput);
    const text = await extractText(pdf);

    expect(text).toContain('Priya Nair');
    expect(text).toContain('Lawn');
    expect(text).toContain('7360');
  });

  it('renders a Session with zero Items without a broken/empty table', async () => {
    const input: QuotationPdfInput = {
      ...baseInput,
      sessions: [{ ...baseInput.sessions[0]!, items: [] }],
    };

    const pdf = await renderQuotationPdf(input);
    const text = await extractText(pdf);

    expect(text).toContain('No Meal Items added yet.');
  });

  it('renders a very long custom venue name in full, without truncating it', async () => {
    const longVenue = 'A'.repeat(300);
    const input: QuotationPdfInput = {
      ...baseInput,
      sessions: [{ ...baseInput.sessions[0]!, venue: longVenue }],
    };

    const pdf = await renderQuotationPdf(input);
    const text = await extractText(pdf);

    // pdfkit wraps a single unbroken word across multiple lines rather than
    // overflowing the page (this story's own edge case) — the extracted
    // text re-inserts line breaks inside the word, so compare with
    // whitespace collapsed rather than expecting one unbroken run.
    expect(text.replace(/\s+/g, '')).toContain(longVenue);
  });

  it('includes the static Terms & Conditions, Documents Required, and Bank Account Details footer', async () => {
    const pdf = await renderQuotationPdf(baseInput);
    const text = await extractText(pdf);

    expect(text).toContain('Terms & Conditions');
    expect(text).toContain('This quotation is valid for one (1) month from the date of issue.');
    expect(text).toContain('Documents Required from Bride and Groom');
    expect(text).toContain('Wedding Card');
    expect(text).toContain('Bank Account Details');
    expect(text).toContain('142320110000165');
    expect(text).toContain('BKID0001423');
  });

  it('renders an identical static footer across two different Events', async () => {
    const otherEventPdf = await renderQuotationPdf({
      ...baseInput,
      eventId: 'ARD-EVT-2026-002',
      clientContacts: [{ name: 'Someone Else', contactNumber: '9000000000', role: 'Groom' }],
    });
    const otherEventText = await extractText(otherEventPdf);
    const baseText = await extractText(await renderQuotationPdf(baseInput));

    const footerStart = 'Terms & Conditions';
    expect(baseText.slice(baseText.indexOf(footerStart))).toEqual(otherEventText.slice(otherEventText.indexOf(footerStart)));
  });
});
