import type { AppRouteQueryImplementation } from '@ts-rest/express';
import type { contract } from '../contract/index.js';
import { Event, EventStatus, SessionStatus, type EventDocument } from '../models/event.js';
import { Role } from '../models/user.js';
import { filterEventForRole } from '../services/event-visibility.js';
import { sessionOverlapsRange } from '../services/session.js';
import { toPublicEvent } from './events.js';

// Same "hydrated subdocument, not the plain attributes interface" reasoning
// events.ts's own SessionSubdocument documents — indexed off EventDocument
// rather than hand-reconstructed, so it always matches whatever Mongoose
// actually infers. Not imported from events.ts, since that alias isn't
// exported there (this is the exact same one-line derivation, not a
// divergent redefinition).
type SessionSubdocument = EventDocument['sessions'][number];

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

// Cancelled and Completed Events are excluded from "today"/"upcoming"
// entirely (both the counts and the list) — this story's own judgment
// call, not spelled out in the SRS/AC. If the whole Event isn't actually
// happening (Cancelled) or is already over (Completed), it shouldn't
// surface as "happening today" or "coming up" even if a stale Session
// record is still marked Active. Session-level Cancelled exclusion is a
// separate, already-established concern (sessionOverlapsRange itself,
// same STORY-034 precedent calendar/search already reuse).
const isLiveEventStatus = (status: EventStatus): boolean =>
  status === EventStatus.Tentative || status === EventStatus.Confirmed;

// "Upcoming" is genuinely undefined anywhere in the SRS or story backlog
// (checked before implementing) — this story's own judgment call: an
// Active Session whose start_date is strictly after today, i.e. it hasn't
// started yet. Deliberately not reusing sessionOverlapsRange's own
// open-ended-range shape here (`{ from: tomorrow }` with no `to` bound)
// — that would also match a Session already underway today that merely
// extends into the future, double-counting it into both "today" and
// "upcoming". A plain startDate comparison keeps the two buckets disjoint
// for the common case (a multi-day Session already in progress today
// counts as "today", not "upcoming").
const isUpcomingSession = (session: SessionSubdocument, today: Date): boolean =>
  session.sessionStatus === SessionStatus.Active && session.startDate.getTime() > today.getTime();

export const getDashboard: AppRouteQueryImplementation<typeof contract.getDashboard> = async ({ req }) => {
  if (!req.user) {
    // Unreachable — authenticatedOnly (router.ts) runs authenticate before
    // this handler ever does; guarded instead of asserted past.
    throw new Error('getDashboard handler ran without an authenticated user.');
  }
  const role = req.user.role;

  const today = startOfUtcDay(new Date());
  const events = await Event.find();

  let todaysEvents = 0;
  let tentative = 0;
  let confirmed = 0;
  const upcoming: { event: (typeof events)[number]; soonestSession: SessionSubdocument }[] = [];

  for (const event of events) {
    if (event.status === EventStatus.Tentative) {
      tentative += 1;
    } else if (event.status === EventStatus.Confirmed) {
      confirmed += 1;
    }

    if (!isLiveEventStatus(event.status)) {
      continue;
    }

    // "At least one Active session overlapping today's date, per the same
    // overlap logic as STORY-034" (this story's own AC) — the exact same
    // sessionOverlapsRange the calendar/search endpoints already use, with
    // a single-day range (from === to).
    if (event.sessions.some((session) => sessionOverlapsRange(session, { from: today, to: today }))) {
      todaysEvents += 1;
    }

    const upcomingSessions = event.sessions.filter((session) => isUpcomingSession(session, today));
    if (upcomingSessions.length > 0) {
      const soonestSession = upcomingSessions.reduce((soonest, session) =>
        session.startDate.getTime() < soonest.startDate.getTime() ? session : soonest,
      );
      upcoming.push({ event, soonestSession });
    }
  }

  // Soonest first — what's coming up next, not creation order.
  upcoming.sort((a, b) => a.soonestSession.startDate.getTime() - b.soonestSession.startDate.getTime());

  const upcomingEvents = upcoming.map(({ event, soonestSession }) => {
    const filtered = filterEventForRole(toPublicEvent(event), role);
    // filterEventForRole already narrowed this session's own `items` to
    // Meal-only, money-stripped for F&B Head specifically (`undefined` for
    // every other role except EventManager, who gets everything
    // unfiltered — both Meal and Event Items) — found by id since
    // `filtered.sessions` is the same array, same order, as
    // `event.sessions`, just each session/item individually filtered.
    // `meals` itself is gated to F&B Head only, not "whichever role
    // happens to have an items array" — this is STORY-049's own new
    // column, deliberately not shown on the Event Manager view (that AC's
    // own "extra column vs. the Event Manager view" framing).
    const filteredSession = filtered.sessions.find((session) => session.id === soonestSession._id.toString());
    return {
      id: filtered.id,
      eventId: filtered.eventId,
      eventFamilyType: filtered.eventFamilyType,
      status: filtered.status,
      date: soonestSession.startDate,
      venue: soonestSession.venue,
      pax: soonestSession.pax,
      clientContacts: filtered.clientContacts,
      meals:
        role === Role.FnBHead
          ? (filteredSession?.items ?? []).map((item) => ({
              mealName: item.mealName,
              startTime: item.startTime,
              endTime: item.endTime,
            }))
          : undefined,
    };
  });

  return {
    status: 200,
    body: {
      counts: { todaysEvents, upcoming: upcoming.length, tentative, confirmed },
      upcomingEvents,
    },
  };
};
