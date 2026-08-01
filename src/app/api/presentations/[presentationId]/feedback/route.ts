// =============================================================================
// GET  /api/presentations/:presentationId/feedback  —  "student"
// POST /api/presentations/:presentationId/feedback  —  "student"
// Feature flag: presentations
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// WHO MAY READ FEEDBACK IS NARROWER THAN WHO MAY READ THE DECK. Comments on
// someone's work are about the person, not just the artefact, so the rule is:
// the AUTHOR of the deck (it is addressed to them), the WRITER of a comment
// (their own words), and STAFF. A peer who may view a published deck sees the
// slides, not the critique of them — a gallery that shows every deck alongside
// what its classmates said about it is a different product, and not a kind one.
//
// `feedback_type` IS DERIVED, NEVER ACCEPTED. `presentation_feedback_self_typed`
// CHECKs `(from_user_id = to_user_id) = (feedback_type = 'self')`, so the type
// follows from who is writing about whose deck: the author reflecting is 'self',
// staff is 'instructor', anyone else is 'peer'. A client-supplied type would let
// a student label their own five-star review of their own deck as 'peer', and
// the average on the gallery card becomes unusable — which is the exact failure
// that CHECK exists to prevent.
//
// `to_user_id` IS THE DECK'S CREATOR AT WRITE TIME, read from the deck row
// inside the transaction rather than taken from the request. It is denormalized
// so the "feedback addressed to me" inbox is an index lookup, and copying it
// from a payload would let the sender address the comment to somebody else.
// =============================================================================

import { and, count, desc, eq, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { presentationFeedback, presentations } from "@/db/schema.presentations";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { paginated, parsePage } from "@/lib/learning/pagination";
import { parseBody } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

import { isStaff, readableFilter } from "../../_access";
import { presentationFeedbackSchema } from "../../_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ presentationId: string }> };

/**
 * Read the feedback on a deck.
 *
 * @param request query: `limit` (1..100, default 20), `offset`
 * @param ctx     path: `presentationId`
 * @returns 200 `{ items, limit, offset, total }`, newest first. A caller who is
 *          neither the deck's author nor staff sees only the comments they
 *          wrote themselves — see the module header.
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

  // Deck visibility first: no feedback is readable on a deck the caller cannot
  // see at all.
  const [deck] = await db
    .select({ id: presentations.id, creatorId: presentations.creatorId })
    .from(presentations)
    .where(and(eq(presentations.id, presentationId), readableFilter(gate.user)))
    .limit(1);

  if (!deck) return apiError(404, "Presentation not found.", "not_found");

  const filters: SQL[] = [eq(presentationFeedback.presentationId, presentationId)];

  // The narrower rule. Undefined for the author and for staff; for everyone else
  // a clause restricting the read to their own comments.
  const canSeeAll = isStaff(gate.user) || deck.creatorId === gate.user.id;
  if (!canSeeAll) {
    const own = or(
      eq(presentationFeedback.fromUserId, gate.user.id),
      eq(presentationFeedback.toUserId, gate.user.id),
    );
    if (own) filters.push(own);
  }

  const where = and(...filters);

  const [items, [totals]] = await Promise.all([
    db
      .select({
        id: presentationFeedback.id,
        presentationId: presentationFeedback.presentationId,
        fromUserId: presentationFeedback.fromUserId,
        fromUserName: users.name,
        toUserId: presentationFeedback.toUserId,
        feedbackType: presentationFeedback.feedbackType,
        comment: presentationFeedback.comment,
        rating: presentationFeedback.rating,
        category: presentationFeedback.category,
        improvementSuggestions: presentationFeedback.improvementSuggestions,
        createdAt: presentationFeedback.createdAt,
      })
      .from(presentationFeedback)
      .innerJoin(users, eq(users.id, presentationFeedback.fromUserId))
      .where(where)
      .orderBy(desc(presentationFeedback.createdAt), desc(presentationFeedback.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(presentationFeedback).where(where),
  ]);

  return apiOk(paginated(items, page, totals?.total ?? 0));
}

/**
 * Leave feedback on a deck.
 *
 * @param request JSON body validated by `presentationFeedbackSchema`:
 *        `{ comment, rating?, category?, improvementSuggestions? }`. There is no
 *        `feedbackType` and no `toUserId` — both are derived; see the header.
 * @param ctx     path: `presentationId`
 * @returns 201 the created feedback row
 * @throws 404 flag off, no such deck, or a deck this caller may not see —
 *          feedback on an invisible deck would be a way to confirm it exists
 * @throws 401 not signed in
 * @throws 422 body fails validation, or a CHECK rejects it (a rating outside
 *          1-5, or a self/type disagreement this handler should have prevented)
 * @throws 400 `presentationId` is not a positive integer
 *
 * NO DUPLICATE PROTECTION, stated because its absence is deliberate:
 * `presentation_feedback` has no unique index over (presentation, from_user),
 * and it should not — a reviewer legitimately leaves several comments on
 * different aspects of one deck, which is what `category` is for.
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

  const body = await parseBody(request, presentationFeedbackSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  try {
    const created = await db.transaction(async (tx) => {
      const [deck] = await tx
        .select({ creatorId: presentations.creatorId })
        .from(presentations)
        .where(and(eq(presentations.id, presentationId), readableFilter(gate.user)))
        .limit(1);

      if (!deck) return null;

      // DERIVED, in the order the CHECK requires: self wins over role, because
      // an instructor commenting on their OWN deck is reflecting, not marking.
      const feedbackType =
        deck.creatorId === gate.user.id ? "self" : isStaff(gate.user) ? "instructor" : "peer";

      const [row] = await tx
        .insert(presentationFeedback)
        .values({
          presentationId,
          fromUserId: gate.user.id,
          // The recipient is the deck's author, read here — not from the payload.
          toUserId: deck.creatorId,
          feedbackType,
          comment: body.value.comment,
          rating: body.value.rating,
          category: body.value.category,
          improvementSuggestions: body.value.improvementSuggestions,
        })
        .returning();

      return row;
    });

    if (!created) return apiError(404, "Presentation not found.", "not_found");
    return apiOk({ ...created, fromUserName: gate.user.name }, 201);
  } catch (error) {
    const status = statusForDbError(error);
    if (status) return apiError(status, "The feedback was rejected by the database.", "db_rejected");
    throw error;
  }
}
