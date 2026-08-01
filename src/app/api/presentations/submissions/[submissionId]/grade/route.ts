// =============================================================================
// POST /api/presentations/submissions/:submissionId/grade  —  "instructor"
// Feature flag: presentations
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// THE MOST SENSITIVE ENDPOINT IN THIS FEATURE, for the same reason
// POST /api/instructor/submissions/:id/grade is in its own: it writes a score. A
// student who reached it could grade themselves. The guard is the first
// statement after the feature gate and there is no path through this handler
// that writes without it.
//
// "instructor" AND NOT "admin", matching the existing grading route.
// `ROLES_SATISFYING.instructor` admits admins as well, deliberately — an admin
// covering for an instructor should not need a role change to grade.
//
// A GRADE IS WHOLE OR ABSENT. `presentation_submissions_grade_consistent` CHECKs
// `(graded_at IS NULL AND score IS NULL) OR (both NOT NULL)`, so `score`,
// `graded_at`, `graded_by` and `status` are written in ONE `.set()`. Two
// statements would leave a window in which a partially written grade sits in the
// table looking like a finished one.
//
// `graded_by` COMES FROM THE SESSION. An id in the payload would let one
// instructor record a colleague as the grader of a mark they did not give —
// which is the fact a student disputes a grade by asking about.
//
// EVERY GRADE IS ALSO APPENDED TO `presentation_grade_events`, IN THE SAME
// TRANSACTION. Security review Finding 2 (SECURITY_REVIEW_ADDON_WAVE.md:160):
// this endpoint is not owner-scoped, because `assignments` has no owning
// instructor to scope by, so any instructor may overwrite any other's mark. That
// gap cannot be closed here — the column is a shared-contracts seam change with
// cross-stream consequences and is deliberately out of scope. What IS closed is
// the second half of the finding, which is the half that made the first half
// invisible: the overwrite used to leave no trace, since `graded_by` was
// replaced along with the score. Now it does. The regrade still succeeds; it is
// simply no longer destructive and no longer anonymous.
//
// The history INSERT shares the UPDATE's transaction on purpose. Two separate
// statements would allow a grade that took effect with no history row (the
// process dies between them), which is precisely the state the table exists to
// make impossible.
// =============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { presentationGradeEvents, presentationSubmissions } from "@/db/schema.presentations";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { parseBody } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

import { gradePresentationSchema } from "../../../_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ submissionId: string }> };

/**
 * Grade a presentation submission.
 *
 * REGRADING IS ALLOWED and is not a conflict: an instructor correcting a mark
 * they entered wrongly is the common case, and refusing it would send them to a
 * database console. Each grade REPLACES the previous one on the submission row
 * and re-stamps `graded_at` and `graded_by`, so that row always says who gave
 * the mark that is currently on it.
 *
 * AND IS NOW RECORDED. A row is appended to `presentation_grade_events` in the
 * same transaction, carrying the score, feedback, rubric, grader and instant of
 * THIS grading event. The previous grade is therefore still readable after a
 * regrade, attributed to the instructor who actually gave it. This is the
 * mitigation for security review Finding 2, and it is a mitigation rather than a
 * fix — see the module header for what it does not do.
 *
 * NOT SCOPED BY WHO OWNS THE ASSIGNMENT, unlike the live-class routes. There is
 * no instructor-ownership column on `assignments` in this schema, so there is
 * nothing to scope by; every instructor may grade every presentation submission.
 * Stated as a fact of the current model rather than left to be inferred — if
 * assignments gain an owner, this handler needs the same ownership clause the
 * class routes carry, and the history table stops being the only defence.
 *
 * @param request JSON body validated by `gradePresentationSchema`:
 *        `{ score: 0..100, feedback?, rubricScores? }`
 * @param ctx     path: `submissionId`
 * @returns 200 the graded submission
 * @throws 404 flag off, or no such submission
 * @throws 401 / 403 not signed in / not staff
 * @throws 422 body fails validation, or the score CHECK rejects it
 * @throws 400 `submissionId` is not a positive integer
 */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const submissionId = parsePositiveInt((await ctx.params).submissionId);
  if (submissionId === null) {
    return apiError(400, "submissionId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, gradePresentationSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  // ONE instant for both writes. Reading the clock twice would put a history
  // row a few milliseconds away from the submission row it describes, and
  // "which event is the one currently in force?" then needs a tolerance.
  const gradedAt = new Date();

  try {
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(presentationSubmissions)
        .set({
          // The four facts of a grade, in one statement. See the module header on
          // `presentation_submissions_grade_consistent`.
          score: body.value.score,
          feedback: body.value.feedback ?? null,
          rubricScores: body.value.rubricScores,
          gradedBy: gate.user.id,
          gradedAt,
          status: "graded",
        })
        .where(eq(presentationSubmissions.id, submissionId))
        .returning();

      // No such submission: return before appending history for a row that does
      // not exist. The transaction commits with no effect either way.
      if (!updated) return null;

      await tx.insert(presentationGradeEvents).values({
        submissionId,
        score: body.value.score,
        feedback: body.value.feedback ?? null,
        rubricScores: body.value.rubricScores,
        gradedBy: gate.user.id,
        gradedAt,
      });

      return updated;
    });

    if (!row) return apiError(404, "Submission not found.", "not_found");
    return apiOk(row);
  } catch (error) {
    const status = statusForDbError(error);
    if (status) return apiError(status, "The grade was rejected by the database.", "db_rejected");
    throw error;
  }
}
