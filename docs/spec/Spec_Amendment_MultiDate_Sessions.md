# Spec Amendment: Multi-Date Sessions & Calendar Overlap Rendering

**Amends:** §2 (Data Model), §5 (Status & Calendar) of `Aaradhya_Event_Management_Spec_v1.md`
**Scope:** This clause only. No other section of the spec is affected.

## 0. Assumed current shape (pre-amendment)

```
Event {
  event_id, event_family_type, status, event_manager,
  created_by, created_at, change_log[],
  client_details[], accommodation, payment, documents_checklist,
  sessions: Session[]
}

Session {
  session_date,        // single calendar date
  session_type,
  venue, venue_cost,
  start_time, end_time,  // time-of-day on session_date
  pax,
  setup: { seating, tables, chairs, stage, buffet, registration_desk,
           vip_seating, bride_groom_seating, notes },
  items: Item[]
}
```

A `Session` currently anchors to exactly one date. The calendar today places one chip on `session_date` per session and (per §5) draws a spanning band across an event's *session dates*, but there's no field that lets a single session itself run more than one day (e.g. a two-day destination-wedding "Wedding" session, or an overnight "Sangeet + After-party").

## 1. Data model changes

| Field | Before | After |
|---|---|---|
| `session_date` | single `Date`, required | **removed** |
| `start_date` | — | **new**, `Date` (date-only), required |
| `end_date` | — | **new**, `Date` (date-only), required, `end_date >= start_date` |
| `start_time` | time-of-day, applies to `session_date` | applies to `start_date` |
| `end_time` | time-of-day, applies to `session_date` | applies to `end_date` |
| `duration_days` | — | **new, derived** (not stored): `end_date - start_date + 1` |
| `is_multi_day` | — | **new, derived**: `duration_days > 1` |
| `session_status` | — | **new**, enum `Active / Cancelled`, default `Active` — independent of `Event.status` (see Edge Cases) |

Single-day sessions are just the case `start_date === end_date` — no separate code path, no migration branching beyond a one-time backfill (`start_date = end_date = session_date`).

**Not adding:** a stored per-day array (`occupied_dates: Date[]`) on the session. At this scale (~15 users/day) a denormalized date array is write-amplification for no query benefit — a range-overlap query (below) does the same job in one indexed lookup. Revisit only if the calendar view is ever asked to query across thousands of sessions.

**Indexing:** add a compound index on `sessions.start_date, sessions.end_date` (MongoDB, on the embedded array via a wrapping collection or `$` positional index if sessions are stored as subdocuments) to keep the overlap query below cheap.

## 2. Calendar rendering rule

**Plain language:** For any calendar cell representing date `D`, a session's chip appears on `D` if `D` falls anywhere between the session's `start_date` and `end_date` inclusive — not only when `D` equals `start_date`. An event's chip/band on `D` is the union of all its sessions that satisfy this.

```
function sessionOccursOn(session, D):
    return session.session_status == "Active"
       and session.start_date <= D
       and D <= session.end_date

function eventOccursOn(event, D):
    return any(sessionOccursOn(s, D) for s in event.sessions)

function renderMonthGrid(month, events):
    for D in allDatesIn(month):
        cellEvents = [e for e in events if eventOccursOn(e, D)]
        renderCell(D, dedupeByEventId(cellEvents))
```

`dedupeByEventId` collapses multiple same-event sessions active on `D` into one chip (see Edge Case 2).

## 3. Interaction with search / filtering by date

"Show events on date X" must use the same overlap test, not an equality match on a start field:

```
// MongoDB
db.events.find({
  "sessions.session_status": "Active",
  "sessions.start_date": { $lte: X },
  "sessions.end_date":   { $gte: X }
})
```

A date-range search ("events between X and Y") uses the standard interval-overlap condition:
`sessions.start_date <= Y AND sessions.end_date >= X`. Existing filters (status, venue, event manager, event type) apply as an additional `$and` — no change to their logic, since they operate on the `Event`/`Session`, not the date.

## 4. Edge cases

- **Month/year boundary.** No special handling needed — `start_date`/`end_date` are real `Date` values, and `allDatesIn(month)` iterates actual calendar days. A session running 29 Sept–3 Oct (or 28 Dec–2 Jan) simply satisfies the overlap test on both sides of the boundary automatically.
- **Two sessions of the same event overlap on the same date.** Valid (e.g. Haldi at the Lawn and vendor setup at the Banquet Hall, same morning). Calendar shows **one** event chip per day per event (`dedupeByEventId`), not one per session; clicking it opens the Event Page where both sessions are listed under Sessions & Menu. Do not block this at the data layer.
- **A session's range overlaps a date also covered by a different event's session.** Normal, expected (multiple events same day). Both event chips render in the cell; if the cell overflows, use standard "+N more" stacking, same as any Google-Calendar-style grid.
- **Timezone handling.** `start_date`/`end_date` are stored as **date-only** values (no time-of-day component, no UTC conversion) — the venue operates in a single timezone (Asia/Kolkata), so there is no cross-timezone audience to reconcile. Store as ISO date strings (`"2026-09-15"`) or UTC-midnight `Date` objects consistently, and never let the API layer apply the client browser's local timezone when parsing/serializing, or a session can visually shift a day for a user viewing from outside IST. `start_time`/`end_time` are separate local time-of-day fields (`"18:30"`), not merged into a timezone-aware datetime — they're display/scheduling data, not used in the overlap query.
- **Cancelled sessions.** `session_status = "Cancelled"` is independent of `Event.status`, because one session inside a multi-day event can be called off (e.g. an outdoor Haldi rained out and dropped) while the rest of the event stays Confirmed. Cancelled sessions are excluded from calendar rendering and date-search matches (see `sessionOccursOn` above); they remain visible in the Event Page's session list, struck through, for record-keeping.
- **Empty/draft sessions.** A session added to an event but not yet given `start_date`/`end_date` (still mid-entry) must not render on the calendar or match date searches — treat missing `start_date` or `end_date` as equivalent to `session_status = "Cancelled"` for the purposes of §2/§3 until both dates are set.
