import type { SessionDepartmentNotesAttributes, SessionSetupAttributes } from '../models/event.js';

// A Session's stored setup in its public shape — unset seating/notes read
// as null. Shared by GET /events/:id and the Banquet Event Order (DEV-12).
export const toSessionSetupResult = (setup: SessionSetupAttributes) => ({
  seating: setup.seating ?? null,
  tableCount: setup.tableCount,
  chairCount: setup.chairCount,
  stage: setup.stage,
  buffet: setup.buffet,
  registrationDesk: setup.registrationDesk,
  vipSeating: setup.vipSeating,
  brideGroomSeating: setup.brideGroomSeating,
  notes: setup.notes ?? null,
});

// DEV-12 — Notes for Department in their public shape; unset numbers/note
// read as null, the same convention setup's seating/notes use. Undefined for
// a Session loaded without the field reads as empty.
export const toDepartmentNotesResult = (notes: SessionDepartmentNotesAttributes | undefined) => ({
  vegPax: notes?.vegPax ?? null,
  nonVegPax: notes?.nonVegPax ?? null,
  maintenance: [...(notes?.maintenance ?? [])],
  restaurantNote: notes?.restaurantNote ?? null,
});
