// =============================================================================
// POST /api/classes/:classId/qa/:questionId/upvote  —  "student"
// Feature flag: liveClasses
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// THIS ROUTE IS NOW IDEMPOTENT PER USER, AND THE DATABASE IS WHAT MAKES IT SO.
//
// It did not used to be. `class_qa` had an `upvotes` INTEGER and nothing recorded
// WHO had voted, so this handler shipped a bounded increment with a ceiling of
// 500 and a header explaining, at length, that a student could hold down the
// button to climb a queue ordered by that number. The realtime service's contract
// (services/realtime/src/store/types.ts) promised "one vote per user" and could
// not deliver it either. Two writers, one hole.
//
// `class_qa_votes(question_id, user_id)` closes it, with the pair as the PRIMARY
// KEY — see src/db/schema.live-classes.ts §5 for the argument, which is the same
// one src/db/schema.peer-review.ts makes: an invariant enforced by a constraint is
// enforced, one enforced by application code is enforced until two tabs race. The
// ceiling and its comment are gone with the hole they described.
//
// WHAT A SECOND VOTE DOES: nothing, and says so. `ON CONFLICT DO NOTHING` tells us
// whether the row was new, and the response carries `counted` so a client can
// distinguish "your vote landed" from "you had already voted" without guessing
// from an unchanged total. It is a 200 either way: the caller asked for this
// question to carry their vote, and after the call it does.
//
// TRANSACTIONAL, because two rows move. `class_qa.upvotes` survives as a
// denormalized display hint — it is what `class_qa_class_unanswered_idx` orders
// the instructor's continuously polled queue by, and a `count(*)` over the ledger
// would take that query off its index. It is incremented ONLY when the ledger
// insert actually inserted, inside the same transaction, so the counter cannot
// drift upward on a repeated press. The ledger, never the counter, decides
// anything.
//
// A STUDENT MAY NOT UPVOTE THEIR OWN QUESTION. Unchanged, and still checked in
// the statement rather than around it.
// =============================================================================

import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { classQa, classQaVotes, liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string; questionId: string }> };

/**
 * Upvote a question. Idempotent per user.
 *
 * @param ctx path: `classId`, `questionId`
 * @returns 200 `{ id, upvotes, counted }` — the total after the call, and whether
 *          THIS call is what added a vote. `counted: false` means the caller had
 *          already voted and nothing changed.
 * @throws 404 flag off, no such class, or no such question in that class
 * @throws 403 the caller asked the question
 * @throws 401 not signed in
 * @throws 400 either path segment is malformed
 */
export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const raw = await ctx.params;
  const classId = parsePositiveInt(raw.classId);
  if (classId === null) return apiError(400, "classId must be a positive integer.", "invalid_id");
  const questionId = parsePositiveInt(raw.questionId);
  if (questionId === null) {
    return apiError(400, "questionId must be a positive integer.", "invalid_id");
  }

  const outcome = await db.transaction(async (tx) => {
    const [cls] = await tx
      .select({ id: liveClasses.id })
      .from(liveClasses)
      .where(eq(liveClasses.id, classId))
      .limit(1);
    if (!cls) return { kind: "no_class" as const };

    // The eligibility read and the ledger insert are in ONE transaction, so the
    // "is this my own question?" answer cannot go stale between them. The row is
    // located by (id, class_id): a question id from another class must not be
    // votable through this class's URL.
    const [question] = await tx
      .select({ id: classQa.id, studentId: classQa.studentId })
      .from(classQa)
      .where(and(eq(classQa.id, questionId), eq(classQa.classId, classId)))
      .limit(1);
    if (!question) return { kind: "no_question" as const };
    if (question.studentId === gate.user.id) return { kind: "own" as const };

    const insertedVotes = await tx
      .insert(classQaVotes)
      .values({ questionId, userId: gate.user.id })
      // THE PRIMARY KEY IS THE RULE. No read-then-write, so two tabs submitting
      // at the same instant produce one vote rather than two.
      .onConflictDoNothing()
      .returning({ questionId: classQaVotes.questionId });

    if (insertedVotes.length === 0) {
      // Already voted. Read the total back rather than assuming it, because
      // another student may have voted in the meantime.
      const [current] = await tx
        .select({ id: classQa.id, upvotes: classQa.upvotes })
        .from(classQa)
        .where(eq(classQa.id, questionId))
        .limit(1);
      return { kind: "ok" as const, row: { ...current, counted: false } };
    }

    // `+ 1` evaluated by Postgres on the locked row, not read-modify-written
    // here, so concurrent first-time votes cannot lose one another. `ne` on the
    // asker is belt-and-braces beside the check above; the two disagreeing would
    // mean the row changed hands mid-transaction, which cannot happen.
    const [row] = await tx
      .update(classQa)
      .set({ upvotes: sql`${classQa.upvotes} + 1` })
      .where(and(eq(classQa.id, questionId), ne(classQa.studentId, gate.user.id)))
      .returning({ id: classQa.id, upvotes: classQa.upvotes });

    return { kind: "ok" as const, row: { ...row, counted: true } };
  });

  switch (outcome.kind) {
    case "no_class":
      return apiError(404, "Class not found.", "not_found");
    case "no_question":
      return apiError(404, "Question not found.", "not_found");
    case "own":
      return apiError(403, "You cannot upvote your own question.", "own_question");
    case "ok":
      return apiOk(outcome.row);
  }
}
