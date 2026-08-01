// =============================================================================
// PUT    /api/presentations/:presentationId/slides/:slideNumber
// DELETE /api/presentations/:presentationId/slides/:slideNumber
//   —  "student" (creator or admin)
// Feature flag: presentations
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// SLIDE NUMBERS ARE 1-BASED. The database CHECKs `slide_number > 0` because
// "slide 0" means nothing to a presenter reading a slide counter, and the
// canonical contract's `slideNumber` is 1-based for the same reason. Array
// indices stay 0-based; the conversion happens here, at the boundary, and the
// two are never mixed in one expression.
//
// BOTH WRITES GO THROUGH THE DOCUMENT. `slides_json` is the source of truth
// (DECISIONS.md), so editing slide 4 rewrites the document and rebuilds that one
// projection row from it; deleting slide 4 removes it from the document,
// renumbers what follows, and rewrites the projection rows whose numbers moved.
// Touching only `presentation_slides` would produce a deck the editor opens
// without the change — the classic two-sources-of-truth failure that the schema
// header warns about by name.
//
// THE DELETE RENUMBERS, and that is why it cannot be a single statement.
// Removing slide 4 of 9 must leave slides 1-8, not a gap at 4:
// `presentation_slides_number_idx` is UNIQUE per deck, so the rows after the gap
// have to move, and moving 5→4 while 5 still exists would collide. The
// implementation deletes every projection row for the deck and re-inserts from
// the renumbered document, inside one transaction — correct by construction, and
// at a 500-slide ceiling the cost is irrelevant.
// =============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { presentationSlides, presentations } from "@/db/schema.presentations";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { parseBody } from "@/lib/learning/schemas";
import { parseSlideDeck, renumberSlides } from "@/lib/presentations/types";
import { parsePositiveInt } from "@/lib/quizzes/params";

import { slideProjectionRow, writableFilter } from "../../../_access";
import { slideBodySchema } from "../../../_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ presentationId: string; slideNumber: string }> };

/** Both path segments, or the 400 naming the bad one. */
async function ids(ctx: Ctx): Promise<{ presentationId: number; slideNumber: number } | Response> {
  const raw = await ctx.params;
  const presentationId = parsePositiveInt(raw.presentationId);
  if (presentationId === null) {
    return apiError(400, "presentationId must be a positive integer.", "invalid_id");
  }
  // `parsePositiveInt` rejects 0, which is the 1-based rule the CHECK enforces.
  const slideNumber = parsePositiveInt(raw.slideNumber);
  if (slideNumber === null) {
    return apiError(400, "slideNumber must be a positive integer (slides are 1-based).", "invalid_id");
  }
  return { presentationId, slideNumber };
}

/**
 * Replace the slide at a position.
 *
 * THE URL STILL ADDRESSES THE SLIDE — the original decision recorded here (the
 * path wins, because that is the only reading of `PUT /slides/4` that means what
 * it says) is preserved. What changed is the handling of a body that DISAGREES
 * with the path.
 *
 * Previously such a body was silently overridden: `PUT /slides/3` carrying
 * `slideNumber: 1` rewrote the CONTENT of slide 3 and returned 200. A client
 * "moving" a slide by editing the number in the body therefore edited the wrong
 * row and was told it had succeeded. Silence is the defect, not the precedence
 * rule.
 *
 * DECISION: REJECT WITH 409, DO NOT HONOUR THE BODY AS A MOVE. A move is not a
 * property of one slide — it renumbers every slide between the old and new
 * position, and the deck's projection rows have to be rebuilt in the order
 * `renumberSlides()` establishes (that is what DELETE does, and why DELETE
 * cannot be a single statement). Inferring that whole operation from a field
 * that every honest edit also sends would make "edit slide 4" and "move slide 4"
 * indistinguishable at the wire. A move belongs in its own endpoint with its own
 * body, and until one exists the correct answer to an ambiguous request is to
 * refuse it rather than to guess. 409 rather than 422 because the body is
 * well-formed; it conflicts with the resource it was addressed to.
 *
 * The check runs BEFORE any database work, so a mismatched request never opens
 * a transaction and never reads the deck.
 *
 * @param request JSON body `{ slide }`, validated by the CANONICAL `slideSchema`
 * @param ctx     path: `presentationId`, `slideNumber`
 * @returns 200 the updated projection row
 * @throws 409 `slide.slideNumber` in the body disagrees with the path
 * @throws 404 flag off, no such deck, the caller is not its creator, or the deck
 *          has no slide at that position
 * @throws 401 not signed in
 * @throws 422 body fails validation, or the stored document is malformed
 * @throws 400 either path segment is malformed
 */
export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const parsed = await ids(ctx);
  if (parsed instanceof Response) return parsed;

  const body = await parseBody(request, slideBodySchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  // Refuse an ambiguous request instead of silently editing the wrong row. See
  // the JSDoc above for why this is a refusal and not a move. Deliberately
  // ahead of `db.transaction`: nothing is read or written on this path.
  if (body.value.slide.slideNumber !== parsed.slideNumber) {
    return apiError(
      409,
      `The body describes slide ${body.value.slide.slideNumber} but the URL addresses slide ` +
        `${parsed.slideNumber}. Send the slide with the number it is being written to; ` +
        `reordering a deck is not an edit to one slide.`,
      "slide_number_mismatch",
    );
  }

  try {
    const outcome = await db.transaction(async (tx) => {
      const [deck] = await tx
        .select({ slidesJson: presentations.slidesJson })
        .from(presentations)
        .where(and(eq(presentations.id, parsed.presentationId), writableFilter(gate.user)))
        .limit(1);

      if (!deck) return { kind: "not_found" as const };

      const doc = parseSlideDeck(deck.slidesJson);
      if (!doc.ok) return { kind: "bad_document" as const, errors: doc.errors };

      // 1-based number to 0-based index, once, named.
      const index = parsed.slideNumber - 1;
      if (index >= doc.value.slides.length) return { kind: "no_slide" as const };

      // Redundant since the 409 above proves the two agree, and kept anyway: it
      // is what makes the path authoritative in the type, so a future edit that
      // relaxes the check cannot reintroduce a slide written under a number
      // other than the one in its URL.
      const replacement = { ...body.value.slide, slideNumber: parsed.slideNumber };
      const slides = doc.value.slides.map((s, i) => (i === index ? replacement : s));

      await tx
        .update(presentations)
        .set({ slidesJson: { ...doc.value, slides }, updatedAt: new Date() })
        .where(eq(presentations.id, parsed.presentationId));

      // Only the one projection row changes: the positions of the others are
      // untouched, so a full rebuild would be churn.
      const projection = slideProjectionRow(parsed.presentationId, replacement);
      const [row] = await tx
        .update(presentationSlides)
        .set(projection)
        .where(
          and(
            eq(presentationSlides.presentationId, parsed.presentationId),
            eq(presentationSlides.slideNumber, parsed.slideNumber),
          ),
        )
        .returning();

      // The document had the slide but the projection did not — the two had
      // already drifted. The document wins, so the row is created rather than
      // reporting a 404 for a slide that demonstrably exists.
      if (!row) {
        const [inserted] = await tx.insert(presentationSlides).values(projection).returning();
        return { kind: "ok" as const, row: inserted };
      }

      return { kind: "ok" as const, row };
    });

    switch (outcome.kind) {
      case "not_found":
        return apiError(404, "Presentation not found.", "not_found");
      case "no_slide":
        return apiError(404, "This deck has no slide at that position.", "not_found");
      case "bad_document":
        return apiError(
          422,
          `The stored deck document is malformed: ${outcome.errors.join("; ")}`,
          "corrupt_document",
        );
      case "ok":
        return apiOk(outcome.row);
    }
  } catch (error) {
    const status = statusForDbError(error);
    if (status) return apiError(status, "The slide was rejected by the database.", "db_rejected");
    throw error;
  }
}

/**
 * Remove the slide at a position and close the gap.
 *
 * @param ctx path: `presentationId`, `slideNumber`
 * @returns 204 no content
 * @throws 404 flag off, no such deck, the caller is not its creator, or there is
 *          no slide at that position
 * @throws 401 not signed in
 * @throws 422 the stored document is malformed and cannot be renumbered
 * @throws 400 either path segment is malformed
 */
export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const parsed = await ids(ctx);
  if (parsed instanceof Response) return parsed;

  const outcome = await db.transaction(async (tx) => {
    const [deck] = await tx
      .select({ slidesJson: presentations.slidesJson })
      .from(presentations)
      .where(and(eq(presentations.id, parsed.presentationId), writableFilter(gate.user)))
      .limit(1);

    if (!deck) return { kind: "not_found" as const };

    const doc = parseSlideDeck(deck.slidesJson);
    if (!doc.ok) return { kind: "bad_document" as const, errors: doc.errors };

    const index = parsed.slideNumber - 1;
    if (index >= doc.value.slides.length) return { kind: "no_slide" as const };

    const slides = renumberSlides(doc.value.slides.filter((_, i) => i !== index));

    await tx
      .update(presentations)
      .set({ slidesJson: { ...doc.value, slides }, updatedAt: new Date() })
      .where(eq(presentations.id, parsed.presentationId));

    // Rebuild rather than shift. Moving 5→4 while 5 still exists collides with
    // `presentation_slides_number_idx`; deleting all and re-inserting cannot.
    await tx
      .delete(presentationSlides)
      .where(eq(presentationSlides.presentationId, parsed.presentationId));

    if (slides.length > 0) {
      await tx
        .insert(presentationSlides)
        .values(slides.map((slide) => slideProjectionRow(parsed.presentationId, slide)));
    }

    return { kind: "ok" as const };
  });

  switch (outcome.kind) {
    case "not_found":
      return apiError(404, "Presentation not found.", "not_found");
    case "no_slide":
      return apiError(404, "This deck has no slide at that position.", "not_found");
    case "bad_document":
      return apiError(
        422,
        `The stored deck document is malformed: ${outcome.errors.join("; ")}`,
        "corrupt_document",
      );
    case "ok":
      return new Response(null, { status: 204 });
  }
}
