// =============================================================================
// GET  /api/presentations/:presentationId/slides  —  "student" (visibility-scoped)
// POST /api/presentations/:presentationId/slides  —  "student" (creator or admin)
// Feature flag: presentations
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// SPEAKER NOTES ARE PRESENTER-ONLY. `presentation_slides.speaker_notes` says so
// at the column: "MUST NOT be included in any audience-facing projection". The
// barrier here is `slideColumnsFor(...)` in ../../_access.ts — TWO projection
// objects, one of which does not name the column, rather than one projection
// plus a delete. Same reasoning as the answer-key barrier in
// src/lib/learning/projection.ts: a column that is never selected cannot be
// reintroduced by an edit to a response builder.
//
// EVERY WRITE KEEPS `slides_json` AND `presentation_slides` IN STEP. The
// document wins when they disagree (DECISIONS.md), so a slide appended here is
// appended to the document FIRST and the projection row is derived from it,
// inside one transaction. Writing only the table would produce a deck the editor
// opens without the new slide.
// =============================================================================

import { and, asc, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { presentationSlides, presentations } from "@/db/schema.presentations";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { paginated, parsePage } from "@/lib/learning/pagination";
import { parseBody } from "@/lib/learning/schemas";
import { parseSlideDeck, renumberSlides } from "@/lib/presentations/types";
import { parsePositiveInt } from "@/lib/quizzes/params";

import {
  mayReadSpeakerNotes,
  readableFilter,
  slideColumnsFor,
  slideProjectionRow,
  writableFilter,
} from "../../_access";
import { slideBodySchema } from "../../_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ presentationId: string }> };

/**
 * List a deck's slides in order.
 *
 * @param request query: `limit` (1..100, default 20), `offset`
 * @param ctx     path: `presentationId`
 * @returns 200 `{ items, limit, offset, total, speakerNotesIncluded }`.
 *          `speakerNotes` is present only for the creator and staff.
 * @throws 404 flag off, no such deck, or a deck this caller may not see
 * @throws 401 not signed in
 * @throws 422 a bad page window
 * @throws 400 `presentationId` is not a positive integer
 */
export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const presentationId = parsePositiveInt((await ctx.params).presentationId);
  if (presentationId === null) {
    return apiError(400, "presentationId must be a positive integer.", "invalid_id");
  }

  const pageResult = parsePage(new URL(request.url).searchParams);
  if (!pageResult.ok) return apiError(422, pageResult.error, pageResult.code);
  const { page } = pageResult;

  // Visibility is decided on the PARENT deck; `presentation_slides` has no
  // visibility columns of its own. Checked first, so an inaccessible deck is a
  // 404 before any slide is read.
  const [deck] = await db
    .select({ id: presentations.id, creatorId: presentations.creatorId })
    .from(presentations)
    .where(and(eq(presentations.id, presentationId), readableFilter(gate.user)))
    .limit(1);

  if (!deck) return apiError(404, "Presentation not found.", "not_found");

  const notesVisible = mayReadSpeakerNotes(gate.user, deck.creatorId);

  const [items, [totals]] = await Promise.all([
    db
      .select(slideColumnsFor(notesVisible))
      .from(presentationSlides)
      .where(eq(presentationSlides.presentationId, presentationId))
      .orderBy(asc(presentationSlides.slideNumber))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ total: count() })
      .from(presentationSlides)
      .where(eq(presentationSlides.presentationId, presentationId)),
  ]);

  return apiOk({
    ...paginated(items, page, totals?.total ?? 0),
    speakerNotesIncluded: notesVisible,
  });
}

/**
 * Append a slide to a deck.
 *
 * The supplied `slide.slideNumber` is IGNORED for positioning: the slide is
 * appended at the end and renumbered. Honouring a client-chosen number would
 * mean either colliding with `presentation_slides_number_idx` (a 409 for a
 * client that just wanted "add one at the end") or silently reordering the deck.
 * A client that wants to insert mid-deck sends the whole document to
 * PUT /api/presentations/:id, which is the operation that reorders.
 *
 * @param request JSON body `{ slide }`, validated by the CANONICAL `slideSchema`
 *        from src/lib/presentations/types.ts — so a code slide without
 *        `language` and an image slide without `alt` are rejected here, with the
 *        field path, rather than at render time
 * @param ctx     path: `presentationId`
 * @returns 201 the created projection row, with `id` and its assigned
 *          `slideNumber`
 * @throws 404 flag off, no such deck, or the caller is not its creator
 * @throws 401 not signed in
 * @throws 409 the deck is at the 500-slide ceiling the canonical contract sets
 * @throws 422 body fails validation, or the stored document is malformed and
 *          cannot be appended to
 * @throws 400 `presentationId` is not a positive integer
 */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const presentationId = parsePositiveInt((await ctx.params).presentationId);
  if (presentationId === null) {
    return apiError(400, "presentationId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, slideBodySchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  try {
    const outcome = await db.transaction(async (tx) => {
      // The document is loaded under the WRITE scope, so a caller who is not the
      // creator never even reads it.
      const [deck] = await tx
        .select({ id: presentations.id, slidesJson: presentations.slidesJson })
        .from(presentations)
        .where(and(eq(presentations.id, presentationId), writableFilter(gate.user)))
        .limit(1);

      if (!deck) return { kind: "not_found" as const };

      // PARSED, never cast. A stored blob is untrusted input — the canonical
      // contract's header makes this point at length — and `as SlideDeck` on a
      // malformed row produces a crash deep in the renderer naming neither the
      // row nor the field.
      const parsed = parseSlideDeck(deck.slidesJson);
      if (!parsed.ok) {
        return { kind: "bad_document" as const, errors: parsed.errors };
      }

      if (parsed.value.slides.length >= 500) {
        return { kind: "full" as const };
      }

      const slides = renumberSlides([...parsed.value.slides, body.value.slide]);
      const appended = slides[slides.length - 1];

      await tx
        .update(presentations)
        .set({ slidesJson: { ...parsed.value, slides }, updatedAt: new Date() })
        .where(eq(presentations.id, presentationId));

      // The projection row is derived from the RENUMBERED slide, so its
      // `slide_number` cannot disagree with the document.
      const [row] = await tx
        .insert(presentationSlides)
        .values(slideProjectionRow(presentationId, appended))
        .returning();

      return { kind: "ok" as const, row };
    });

    switch (outcome.kind) {
      case "not_found":
        return apiError(404, "Presentation not found.", "not_found");
      case "bad_document":
        return apiError(
          422,
          `The stored deck document is malformed and cannot be appended to: ${outcome.errors.join("; ")}`,
          "corrupt_document",
        );
      case "full":
        return apiError(409, "This deck already has the maximum of 500 slides.", "deck_full");
      case "ok":
        return apiOk(outcome.row, 201);
    }
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 409) {
      return apiError(409, "That slide number is already taken.", "slide_number_taken");
    }
    if (status) return apiError(status, "The slide was rejected by the database.", "db_rejected");
    throw error;
  }
}
