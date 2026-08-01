// =============================================================================
// PRESENTATION VISIBILITY RULES.
// Owner: the API stream.
// -----------------------------------------------------------------------------
// WHY THIS FILE LIVES UNDER src/app/api/ AND NOT src/lib/presentations/.
// `src/lib/presentations/` belongs to the Reveal.js stream, which owns the slide
// contract (types.ts), the theme registry and the renderer API. Concurrent
// streams with divided ownership do not share a directory. Only `route.ts`,
// `page.tsx` and the other reserved filenames are routable in the App Router, so
// a plain module here is inert as far as routing is concerned — and it sits next
// to the six route files that are its only consumers.
//
// =============================================================================
// THE RULE, which is the whole reason this is a module and not four `if`s.
//
// A DECK IS STUDENT-OWNED WORK. That single fact is why role-based
// authorization is not enough here and why every presentation route is
// ROUTE_AUTH "student": if the access decision were "is this caller a student",
// every signed-in student could read every other student's unpublished
// coursework. The decision is per ROW, and it is:
//
//   READ  — the creator, OR staff, OR the deck is published, OR the deck is
//           public, OR the caller's role appears in `shared_with_roles`.
//   WRITE — the creator only, plus admins.
//
// STAFF MAY READ EVERY DECK, including unpublished ones. That is a judgement
// worth stating rather than assuming: an instructor needs to see work in
// progress to help with it, and to grade a submission whose author forgot to
// publish. It is not a leak, it is the teaching relationship — and it is the
// same posture the instructor grading queue already takes over submissions.
//
// AN INSTRUCTOR MAY NOT EDIT A STUDENT'S DECK. Writes are creator-only even for
// staff, because an instructor rewriting a student's submitted work and leaving
// it under their name is indistinguishable from the student having written it.
// Admins are exempted for the same operational reason as elsewhere (a deck whose
// author's account is gone still needs to be removable).
//
// SPEAKER NOTES ARE PRESENTER-ONLY. `presentation_slides.speaker_notes` says so
// at the column: "MUST NOT be included in any audience-facing projection". They
// are withheld from everyone who is not the creator or staff, and the mechanism
// is a projection choice made by `slideColumnsFor` below, not a delete after the
// fetch — same reasoning as src/lib/learning/projection.ts.
// =============================================================================

import { eq, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { presentationSlides, presentations } from "@/db/schema.presentations";
import type { AuthUser } from "@/lib/guard";
import type { Slide } from "@/lib/presentations/types";

/** Is this caller staff (instructor or admin)? */
export function isStaff(user: AuthUser): boolean {
  return user.role === "instructor" || user.role === "admin";
}

/**
 * The WHERE predicate that limits a read to decks this caller may see.
 *
 * Returned as a predicate rather than as a boolean about a fetched row, for the
 * reason repeated throughout this wave: fetching first and filtering after means
 * another student's deck was in memory, and it depends on remembering to check.
 * As a clause, an inaccessible deck simply is not there, and "not there" is
 * already every handler's 404 path.
 *
 * @returns `undefined` for staff — Drizzle's "no additional constraint" value —
 *          so callers can spread it into `and(...)` without branching
 */
export function readableFilter(user: AuthUser): SQL | undefined {
  if (isStaff(user)) return undefined;

  return or(
    eq(presentations.creatorId, user.id),
    eq(presentations.isPublished, true),
    eq(presentations.isPublic, true),
    // `shared_with_roles` is a jsonb array of role names. The containment
    // operator `?` cannot be used through Drizzle's parameter binding without
    // escaping ambiguity, so this is an explicit jsonb array membership test
    // with the role bound as a parameter — never interpolated.
    sql`${presentations.sharedWithRoles} @> ${JSON.stringify([user.role])}::jsonb`,
  );
}

/**
 * The WHERE predicate that limits a WRITE to decks this caller may modify.
 *
 * @returns `undefined` for an admin; `creator_id = session.id` for everyone
 *          else, INCLUDING instructors — see the module header on why staff may
 *          read every deck but may not edit a student's
 */
export function writableFilter(user: AuthUser): SQL | undefined {
  return user.role === "admin" ? undefined : eq(presentations.creatorId, user.id);
}

/**
 * May this caller see the deck's speaker notes?
 *
 * The creator (they wrote them) and staff (they are marking the delivery, and
 * the notes are part of what was prepared). Nobody else — a peer viewing a
 * published deck is the AUDIENCE, and the audience does not get the presenter's
 * script.
 *
 * @param user     the session
 * @param creatorId `presentations.creator_id` of the deck in question
 */
export function mayReadSpeakerNotes(user: AuthUser, creatorId: number): boolean {
  return user.id === creatorId || isStaff(user);
}

/**
 * The slide column projection appropriate to this viewer.
 *
 * Two objects rather than one plus a delete: the audience projection does not
 * NAME `speaker_notes`, so the column is never selected, never transferred, and
 * cannot be reintroduced by an unrelated edit to a response builder.
 */
export function slideColumnsFor(includeSpeakerNotes: boolean) {
  const audience = {
    id: presentationSlides.id,
    presentationId: presentationSlides.presentationId,
    slideNumber: presentationSlides.slideNumber,
    type: presentationSlides.type,
    title: presentationSlides.title,
    body: presentationSlides.body,
    contentJson: presentationSlides.contentJson,
    layout: presentationSlides.layout,
    backgroundColor: presentationSlides.backgroundColor,
    backgroundImageUrl: presentationSlides.backgroundImageUrl,
    textColor: presentationSlides.textColor,
    createdAt: presentationSlides.createdAt,
    updatedAt: presentationSlides.updatedAt,
  } as const;

  return includeSpeakerNotes
    ? { ...audience, speakerNotes: presentationSlides.speakerNotes }
    : audience;
}

/**
 * Strip speaker notes from the DECK DOCUMENT (`presentations.slides_json`).
 *
 * The projection above covers `presentation_slides`, the queryable table. The
 * editor document is a single jsonb blob, so a column projection cannot reach
 * inside it — this is the one place where filtering after the fetch is
 * unavoidable, and it is confined to this function so that is visible.
 *
 * Returns the value unchanged when it is not the expected shape: jsonb accepts
 * anything, and a deck whose document is malformed should render as "cannot be
 * opened" downstream rather than be silently emptied here.
 *
 * @param slidesJson the raw jsonb value
 * @returns the same document with `speakerNotes` removed from every slide
 */
export function stripSpeakerNotes(slidesJson: unknown): unknown {
  if (typeof slidesJson !== "object" || slidesJson === null) return slidesJson;
  const doc = slidesJson as { slides?: unknown };
  if (!Array.isArray(doc.slides)) return slidesJson;

  return {
    ...doc,
    slides: doc.slides.map((slide) => {
      if (typeof slide !== "object" || slide === null) return slide;
      const { speakerNotes: _speakerNotes, ...rest } = slide as Record<string, unknown>;
      return rest;
    }),
  };
}

/**
 * The `presentation_slides` row for one validated slide.
 *
 * Lives here rather than in a route file for two reasons. Next.js App Router
 * type-checks `route.ts` against a fixed export surface, so a helper exported
 * from one is a build error. And three write paths need it — create a deck,
 * append a slide, replace a slide — so a copy in each is three chances for a
 * thumbnail to render differently from the deck it came from.
 *
 * `contentJson` receives the WHOLE validated slide rather than a per-variant
 * subset, so a new slide type in the canonical contract needs no change here.
 * The named columns beside it are the ones the projection exists to make
 * queryable; the discriminated union is what actually describes the slide.
 */
export function slideProjectionRow(presentationId: number, slide: Slide) {
  return {
    presentationId,
    slideNumber: slide.slideNumber,
    type: slide.type,
    title: "title" in slide ? slide.title : null,
    body: "body" in slide ? (slide.body ?? null) : null,
    speakerNotes: slide.speakerNotes ?? null,
    contentJson: slide,
    backgroundColor: slide.backgroundColor ?? null,
  };
}
