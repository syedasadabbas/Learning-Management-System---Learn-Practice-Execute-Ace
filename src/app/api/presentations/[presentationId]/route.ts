// =============================================================================
// GET    /api/presentations/:presentationId  —  "student" (visibility-scoped)
// PUT    /api/presentations/:presentationId  —  "student" (creator or admin)
// DELETE /api/presentations/:presentationId  —  "student" (creator or admin)
// Feature flag: presentations
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// READ AND WRITE HAVE DIFFERENT SCOPES, and that asymmetry is the point of
// ./_access.ts. Staff may READ every deck (they need to see work in progress to
// help with it, and to grade a submission whose author forgot to publish) but
// may NOT WRITE a student's — an instructor rewriting submitted work and leaving
// it under the student's name is indistinguishable from the student having
// written it. Both scopes are WHERE clauses, so the wrong caller gets a 404.
//
// `slides_json` WINS over `presentation_slides`. DECISIONS.md and the
// schema.presentations.ts header both record this: the jsonb document is the
// editor's, the table is its queryable projection, and when they disagree the
// document is right. So a deck save writes the document and then REBUILDS the
// projection from what was stored — never the reverse, and never both from the
// request independently.
// =============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { presentationSlides, presentations } from "@/db/schema.presentations";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { increment, statusForDbError } from "@/lib/learning/db-errors";
import { parseBody } from "@/lib/learning/schemas";
import { renumberSlides } from "@/lib/presentations/types";
import { parsePositiveInt } from "@/lib/quizzes/params";

import {
  mayReadSpeakerNotes,
  readableFilter,
  slideProjectionRow,
  stripSpeakerNotes,
  writableFilter,
} from "../_access";
import { updatePresentationSchema } from "../_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ presentationId: string }> };

/**
 * Read a deck, including its editor document.
 *
 * Increments `view_count` — a denormalized display counter with no trigger, so
 * this handler maintains it, inside the same transaction as the read.
 * DELIBERATELY NOT INCREMENTED FOR THE CREATOR: an author refreshing their own
 * editor would otherwise drive the number that the gallery presents as
 * "audience interest", making it a measure of how often they saved.
 *
 * @param ctx path: `presentationId`
 * @returns 200 the deck. `slidesJson` has speaker notes stripped unless the
 *          caller is the creator or staff — the notes are the presenter's
 *          script and the audience does not get it.
 * @throws 404 flag off, no such deck, OR a deck this caller may not see. The
 *          three are one answer on purpose: distinguishing them turns the id
 *          space into an enumeration oracle for other students' private work.
 * @throws 401 not signed in
 * @throws 400 `presentationId` is not a positive integer
 */
export async function GET(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const presentationId = parsePositiveInt((await ctx.params).presentationId);
  if (presentationId === null) {
    return apiError(400, "presentationId must be a positive integer.", "invalid_id");
  }

  const row = await db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        id: presentations.id,
        creatorId: presentations.creatorId,
        creatorName: users.name,
        assignmentId: presentations.assignmentId,
        relatedClassId: presentations.relatedClassId,
        title: presentations.title,
        description: presentations.description,
        theme: presentations.theme,
        slidesJson: presentations.slidesJson,
        isPublished: presentations.isPublished,
        isTemplate: presentations.isTemplate,
        isPublic: presentations.isPublic,
        sharedWithRoles: presentations.sharedWithRoles,
        showSpeakerNotes: presentations.showSpeakerNotes,
        showSlideNumbers: presentations.showSlideNumbers,
        allowExport: presentations.allowExport,
        viewCount: presentations.viewCount,
        presentationCount: presentations.presentationCount,
        createdAt: presentations.createdAt,
        updatedAt: presentations.updatedAt,
        publishedAt: presentations.publishedAt,
      })
      .from(presentations)
      .innerJoin(users, eq(users.id, presentations.creatorId))
      .where(and(eq(presentations.id, presentationId), readableFilter(gate.user)))
      .limit(1);

    if (!found) return null;

    if (found.creatorId !== gate.user.id) {
      await tx
        .update(presentations)
        .set({ viewCount: increment(presentations.viewCount) })
        .where(eq(presentations.id, presentationId));
    }

    return found;
  });

  if (!row) return apiError(404, "Presentation not found.", "not_found");

  const notesVisible = mayReadSpeakerNotes(gate.user, row.creatorId);
  return apiOk({
    ...row,
    slidesJson: notesVisible ? row.slidesJson : stripSpeakerNotes(row.slidesJson),
    speakerNotesIncluded: notesVisible,
  });
}

/**
 * Update a deck. Partial.
 *
 * When `deck` is supplied the whole document is replaced atomically and
 * `presentation_slides` is rebuilt from it — delete-then-insert rather than a
 * per-slide upsert, because a save that REMOVED slide 7 leaves an orphan row an
 * upsert would never touch, and `presentation_slides_number_idx` would then
 * reject the next save that reused number 7. Slides are renumbered first with
 * the canonical `renumberSlides`, since the editor reorders by moving array
 * entries and leaves `slideNumber` stale.
 *
 * `publishedAt` is set by the SERVER from `isPublished`, never accepted:
 * `presentations_published_consistent` CHECKs the two agree.
 *
 * @param request JSON body validated by `updatePresentationSchema`
 * @returns 200 the updated deck row (without the document — a save does not
 *          need to echo back what the client just sent)
 * @throws 404 flag off, no such deck, or the caller is not its creator
 * @throws 401 not signed in
 * @throws 422 body fails validation, or a named assignment / class is unknown
 * @throws 400 `presentationId` is not a positive integer
 */
export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const presentationId = parsePositiveInt((await ctx.params).presentationId);
  if (presentationId === null) {
    return apiError(400, "presentationId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, updatePresentationSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  const { deck, ...fields } = body.value;

  const patch: Record<string, unknown> = { ...fields, updatedAt: new Date() };

  if (body.value.isPublished !== undefined) {
    // The timestamp is a consequence of the flag. Set together in one statement
    // so the CHECK can never see a half-applied publish.
    patch.publishedAt = body.value.isPublished ? new Date() : null;
  }

  try {
    const updated = await db.transaction(async (tx) => {
      if (deck !== undefined) {
        // Renumber first — the editor reorders by moving array entries, which
        // leaves `slideNumber` disagreeing with the position the author dragged
        // the slide to, and the presenter view reads that number aloud.
        const slides = renumberSlides(deck.slides);
        patch.slidesJson = { ...deck, slides };
      }

      const [row] = await tx
        .update(presentations)
        .set(patch)
        .where(and(eq(presentations.id, presentationId), writableFilter(gate.user)))
        .returning({
          id: presentations.id,
          creatorId: presentations.creatorId,
          title: presentations.title,
          theme: presentations.theme,
          isPublished: presentations.isPublished,
          isTemplate: presentations.isTemplate,
          isPublic: presentations.isPublic,
          updatedAt: presentations.updatedAt,
          publishedAt: presentations.publishedAt,
        });

      if (!row) return null;

      if (deck !== undefined) {
        // Rebuild the projection FROM the stored document. See the JSDoc on why
        // this is delete-then-insert and not a per-slide upsert.
        await tx
          .delete(presentationSlides)
          .where(eq(presentationSlides.presentationId, presentationId));

        const slides = renumberSlides(deck.slides);
        if (slides.length > 0) {
          await tx.insert(presentationSlides).values(
            slides.map((slide) => slideProjectionRow(presentationId, slide)),
          );
        }
      }

      return row;
    });

    if (!updated) return apiError(404, "Presentation not found.", "not_found");
    return apiOk(updated);
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 422) {
      return apiError(422, "The assignment or class named does not exist.", "unknown_parent");
    }
    if (status) return apiError(status, "The update was rejected by the database.", "db_rejected");
    throw error;
  }
}

/**
 * Delete a deck.
 *
 * `presentation_slides`, `presentation_submissions` and `presentation_feedback`
 * all CASCADE from this row, so this removes a graded submission along with the
 * deck. That is accepted rather than blocked, unlike the equivalent case for a
 * live class: the deck IS the submission's content, so keeping the submission
 * row would leave a grade attached to nothing. A student deleting graded work is
 * a decision they are entitled to make about their own coursework, and the grade
 * itself is recoverable from the instructor's own records.
 *
 * @returns 204 no content
 * @throws 404 flag off, no such deck, or the caller is not its creator
 * @throws 401 not signed in
 * @throws 400 `presentationId` is not a positive integer
 */
export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const presentationId = parsePositiveInt((await ctx.params).presentationId);
  if (presentationId === null) {
    return apiError(400, "presentationId must be a positive integer.", "invalid_id");
  }

  const deleted = await db
    .delete(presentations)
    .where(and(eq(presentations.id, presentationId), writableFilter(gate.user)))
    .returning({ id: presentations.id });

  if (deleted.length === 0) return apiError(404, "Presentation not found.", "not_found");
  return new Response(null, { status: 204 });
}
