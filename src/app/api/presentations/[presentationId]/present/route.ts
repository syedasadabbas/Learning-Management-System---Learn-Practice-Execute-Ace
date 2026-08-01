// =============================================================================
// POST /api/presentations/:presentationId/present  —  "student" (creator or admin)
// Feature flag: presentations
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// "START PRESENTING" IS A COUNTER AND A PRE-FLIGHT CHECK, not a session.
// `presentations.presentation_count` is a denormalized display counter with no
// trigger, so this handler maintains it — that is the only state this route
// writes. There is no `presentation_sessions` table and this route does not
// pretend there is one: a live delivery is a Jitsi room owned by the live-classes
// feature, and inventing a parallel session concept here would be a second
// source of truth about who is presenting what.
//
// CREATOR-ONLY, unlike the viewer. Presenting is an act by the author; a peer
// who may read the deck may open the VIEWER (GET /api/presentations/:id) and
// that is the route for reading it. Letting anyone increment
// `presentation_count` would make the number mean "times anybody opened
// fullscreen", which is what `view_count` already means.
//
// THE PRE-FLIGHT IS THE USEFUL PART. Discovering mid-presentation that the deck
// has no slides, or that its document does not parse, is the failure this
// endpoint exists to move earlier — to the click before the room is watching.
// =============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { presentations } from "@/db/schema.presentations";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { increment } from "@/lib/learning/db-errors";
import { parseSlideDeck } from "@/lib/presentations/types";
import { parsePositiveInt } from "@/lib/quizzes/params";

import { writableFilter } from "../../_access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ presentationId: string }> };

/**
 * Begin presenting a deck.
 *
 * Transactional: the pre-flight read and the counter increment commit together,
 * so a deck that failed the check does not have its count moved.
 *
 * IDEMPOTENT? NO, and deliberately so. Each call counts one delivery, because
 * "how many times has this been presented" is the question the column answers.
 * A double-clicked button therefore counts twice — an accepted inaccuracy in a
 * DISPLAY HINT that gates nothing, and the alternative (a dedupe window keyed on
 * nothing durable) would be guesswork dressed as correctness.
 *
 * @param ctx path: `presentationId`
 * @returns 200 `{ presentationId, slideCount, presentationCount, theme,
 *          showSpeakerNotes, showSlideNumbers, metadata }` — everything the
 *          presenter view needs to mount, so it does not fetch again before the
 *          first slide paints
 * @throws 404 flag off, no such deck, or the caller is not its creator
 * @throws 401 not signed in
 * @throws 409 the deck has no slides — there is nothing to present, and the
 *          point of this endpoint is to say so before the room is watching
 * @throws 422 the stored document is malformed and cannot be rendered
 * @throws 400 `presentationId` is not a positive integer
 */
export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const presentationId = parsePositiveInt((await ctx.params).presentationId);
  if (presentationId === null) {
    return apiError(400, "presentationId must be a positive integer.", "invalid_id");
  }

  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: presentations.id,
        title: presentations.title,
        theme: presentations.theme,
        slidesJson: presentations.slidesJson,
        showSpeakerNotes: presentations.showSpeakerNotes,
        showSlideNumbers: presentations.showSlideNumbers,
      })
      .from(presentations)
      .where(and(eq(presentations.id, presentationId), writableFilter(gate.user)))
      .limit(1);

    if (!row) return { kind: "not_found" as const };

    // PARSED, never cast — a stored blob is untrusted input, and this is the
    // last moment before it is put in front of an audience.
    const deck = parseSlideDeck(row.slidesJson);
    if (!deck.ok) return { kind: "bad_document" as const, errors: deck.errors };
    if (deck.value.slides.length === 0) return { kind: "empty" as const };

    const [updated] = await tx
      .update(presentations)
      .set({ presentationCount: increment(presentations.presentationCount) })
      .where(eq(presentations.id, presentationId))
      .returning({ presentationCount: presentations.presentationCount });

    return { kind: "ok" as const, row, deck: deck.value, count: updated.presentationCount };
  });

  switch (outcome.kind) {
    case "not_found":
      return apiError(404, "Presentation not found.", "not_found");
    case "empty":
      return apiError(409, "This deck has no slides to present.", "empty_deck");
    case "bad_document":
      return apiError(
        422,
        `This deck's document is malformed and cannot be presented: ${outcome.errors.join("; ")}`,
        "corrupt_document",
      );
    case "ok":
      return apiOk({
        presentationId: outcome.row.id,
        title: outcome.row.title,
        theme: outcome.row.theme,
        slideCount: outcome.deck.slides.length,
        presentationCount: outcome.count,
        showSpeakerNotes: outcome.row.showSpeakerNotes,
        showSlideNumbers: outcome.row.showSlideNumbers,
        metadata: outcome.deck.metadata,
        startedAt: new Date().toISOString(),
      });
  }
}
