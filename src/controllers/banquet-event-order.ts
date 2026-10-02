import type { ServerInferResponses } from '@ts-rest/core';
import type { AppRouteQueryImplementation } from '@ts-rest/express';
import { config } from '../config.js';
import type { contract } from '../contract/index.js';
import { Event, type EventDocument } from '../models/event.js';
import { MenuItem } from '../models/menu-item.js';
import { User } from '../models/user.js';
import { type BanquetEventOrderSource, buildBanquetEventOrder } from '../services/banquet-event-order.js';
import { renderPdfFromUrl } from '../services/browser-pdf.js';
import { signSessionToken } from '../services/token.js';

type GetBanquetEventOrderResponse = ServerInferResponses<typeof contract.getBanquetEventOrder>;

const eventNotFound: Extract<GetBanquetEventOrderResponse, { status: 404 }> = {
  status: 404,
  body: { error: { code: 'EVENT_NOT_FOUND', message: 'No Event with that id.' } },
};

const toSource = (event: EventDocument): BanquetEventOrderSource => ({
  id: event.id,
  eventId: event.eventId,
  eventFamilyType: event.eventFamilyType,
  clientContacts: event.clientContacts,
  sessions: event.sessions.map((session) => ({
    id: session._id.toString(),
    sessionType: session.sessionType,
    venue: session.venue,
    startDate: session.startDate,
    endDate: session.endDate,
    startTime: session.startTime,
    endTime: session.endTime,
    pax: session.pax,
    sessionStatus: session.sessionStatus,
    setup: session.setup,
    departmentNotes: session.departmentNotes,
    items: session.items,
  })),
});

const loadMenuItemNames = async (event: EventDocument): Promise<Map<string, string>> => {
  const ids = event.sessions.flatMap((session) => session.items.flatMap((item) => item.menuItems));
  const menuItems = await MenuItem.find({ _id: { $in: ids } });
  return new Map(menuItems.map((menuItem) => [menuItem.id, menuItem.name]));
};

// CR-1 D4/D5 (DEV-12) — any authenticated role: the payload carries no
// prices (services/banquet-event-order.ts), so nothing is role-filtered.
export const getBanquetEventOrder: AppRouteQueryImplementation<typeof contract.getBanquetEventOrder> = async ({
  params,
}) => {
  const event = await Event.findById(params.id);
  if (!event) {
    return eventNotFound;
  }
  return { status: 200, body: buildBanquetEventOrder(toSource(event), await loadMenuItemNames(event)) };
};

// The Notes for Department PDF: the web app's own BEO page rendered by a
// headless browser (`?print=1` — just the pages), the same mechanism as
// GET /events/:id/quotation.pdf, signed in as the caller.
export const getBanquetEventOrderPdf: AppRouteQueryImplementation<typeof contract.getBanquetEventOrderPdf> = async ({
  params,
  req,
  res,
}) => {
  const event = await Event.findById(params.id);
  if (!event) {
    return eventNotFound;
  }
  if (!req.user) {
    // Unreachable — authenticatedOnly (router.ts) runs authenticate first.
    throw new Error('getBanquetEventOrderPdf handler ran without an authenticated user.');
  }

  const caller = await User.findById(req.user.id);
  const token = await signSessionToken({ id: req.user.id, role: req.user.role });
  const pdf = await renderPdfFromUrl(config.webAppUrl, `/events/${event.id}/notes-for-department?print=1`, {
    token,
    user: { id: req.user.id, name: caller?.name ?? 'Aaradhya', role: req.user.role },
  });

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `attachment; filename="${event.eventId}-notes-for-department.pdf"`);
  return { status: 200, body: pdf };
};
