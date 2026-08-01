// =============================================================================
// GET  /api/presentations/submissions  —  "student"
// POST /api/presentations/submissions  —  "student"
// Feature flag: presentations
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// STATIC SEGMENT BEFORE THE DYNAMIC SIBLING. The App Router matches
// `/api/presentations/submissions` here rather than at
// `/api/presentations/[presentationId]`, because a literal segment wins over a
// dynamic one. Noted because the two directories are siblings and the ordering
// is not visible from the file tree.
//
// THE LIST IS SCOPED BY ROLE, NOT BY A PARAMETER. A student sees THEIR OWN
// submissions and nothing else; staff see the grading queue. Expressing that as
// a `studentId` filter would mean any student could read any classmate's
// submitted work by changing a number in a URL, which is the single most
// obvious hole this feature could have.
//
// ONE SUBMISSION PER (ASSIGNMENT, STUDENT). `presentation_submissions` has a
// UNIQUE index on that pair — the reason `student_id` is denormalized onto the
// row at all — and resubmitting REPLACES the deck reference rather than creating
// a second row the instructor would have to choose between. That is implemented
// as `onConflictDoUpdate`, not as check-then-insert: two submits racing would
// both see "no row" and the second would fail with a 500 instead of updating.
// =============================================================================

import { and, asc, count, desc, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { assignments, users } from "@/db/schema";
import { presentationSubmissions, presentations } from "@/db/schema.presentations";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { paginated, parsePage } from "@/lib/learning/pagination";
import { parseBody } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

import { isStaff } from "../_access";
import { submitPresentationSchema } from "../_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["submitted", "under_review", "graded", "returned"] as const;
type Status = (typeof STATUSES)[number];

function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

/**
 * List presentation submissions.
 *
 * @param request query: `assignmentId`, `status` (submitted | under_review |
 *        graded | returned), `limit` (1..100, default 20), `offset`
 * @returns 200 `{ items, limit, offset, total }`. A student's own submissions,
 *          newest first; for staff, the grading queue for the whole cohort,
 *          OLDEST first — a queue is worked front to back, and newest-first
 *          would leave the longest-waiting student permanently at the bottom.
 * @throws 404 the feature flag is off
 * @throws 401 not signed in
 * @throws 422 an unrecognised `status`, a malformed id, or a bad page window
 */
export async function GET(request: Request): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const params = new URL(request.url).searchParams;
  const pageResult = parsePage(params);
  if (!pageResult.ok) return apiError(422, pageResult.error, pageResult.code);
  const { page } = pageResult;

  const staff = isStaff(gate.user);

  const filters: SQL[] = [];
  // THE SCOPE, from the session. A student is pinned to their own rows and
  // there is no parameter that widens it.
  if (!staff) filters.push(eq(presentationSubmissions.studentId, gate.user.id));

  const rawAssignment = params.get("assignmentId");
  if (rawAssignment !== null) {
    const assignmentId = parsePositiveInt(rawAssignment);
    if (assignmentId === null) {
      return apiError(422, "assignmentId must be a positive integer.", "invalid_id");
    }
    filters.push(eq(presentationSubmissions.assignmentId, assignmentId));
  }

  const rawStatus = params.get("status");
  if (rawStatus !== null) {
    if (!isStatus(rawStatus)) {
      return apiError(422, `"${rawStatus}" is not a submission status.`, "invalid_status");
    }
    filters.push(eq(presentationSubmissions.status, rawStatus));
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const [items, [totals]] = await Promise.all([
    db
      .select({
        id: presentationSubmissions.id,
        assignmentId: presentationSubmissions.assignmentId,
        assignmentTitle: assignments.title,
        presentationId: presentationSubmissions.presentationId,
        presentationTitle: presentations.title,
        studentId: presentationSubmissions.studentId,
        studentName: users.name,
        submissionType: presentationSubmissions.submissionType,
        videoUrl: presentationSubmissions.videoUrl,
        videoDurationSeconds: presentationSubmissions.videoDurationSeconds,
        presentationDate: presentationSubmissions.presentationDate,
        audienceCount: presentationSubmissions.audienceCount,
        score: presentationSubmissions.score,
        feedback: presentationSubmissions.feedback,
        rubricScores: presentationSubmissions.rubricScores,
        gradedBy: presentationSubmissions.gradedBy,
        gradedAt: presentationSubmissions.gradedAt,
        submittedAt: presentationSubmissions.submittedAt,
        status: presentationSubmissions.status,
      })
      .from(presentationSubmissions)
      .innerJoin(users, eq(users.id, presentationSubmissions.studentId))
      .innerJoin(assignments, eq(assignments.id, presentationSubmissions.assignmentId))
      .innerJoin(presentations, eq(presentations.id, presentationSubmissions.presentationId))
      .where(where)
      // Oldest first for the queue, newest first for a student's own history.
      // Matches `presentation_submissions_assignment_status_idx`, whose third
      // column is `submitted_at`, when the queue is filtered by assignment.
      .orderBy(
        staff
          ? asc(presentationSubmissions.submittedAt)
          : desc(presentationSubmissions.submittedAt),
      )
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(presentationSubmissions).where(where),
  ]);

  return apiOk(paginated(items, page, totals?.total ?? 0));
}

/**
 * Submit a deck for an assignment, or replace an existing submission.
 *
 * THE DECK MUST BE THE CALLER'S. Checked as `creator_id = session.id` in the
 * lookup, not as an `if` after fetching: without it a student could submit a
 * classmate's published deck as their own work, and the plagiarism would be
 * recorded by this system as a legitimate submission.
 *
 * RESUBMITTING A GRADED SUBMISSION CLEARS THE GRADE. `score`, `feedback`,
 * `graded_by` and `graded_at` are all reset and the status returns to
 * `submitted`, because `presentation_submissions_grade_consistent` requires a
 * grade to be whole or absent and, more importantly, a score attached to work
 * the instructor has not seen is worse than no score. The instructor's queue
 * picks it up again.
 *
 * @param request JSON body validated by `submitPresentationSchema`. No
 *        `studentId`: it comes from the session, and accepting one would both
 *        let a student submit in a classmate's name and — because of the unique
 *        index — silently overwrite that classmate's own submission.
 * @returns 201 on a first submission, 200 on a replacement. The distinction is
 *          real here (unlike /start, where the caller cannot tell): the client
 *          shows "submitted" or "resubmitted" and the two are different
 *          statements to a student about their own work.
 * @throws 404 flag off, the assignment does not exist, or the deck does not
 *          exist / is not the caller's
 * @throws 401 not signed in
 * @throws 422 body fails validation, or a CHECK rejects it
 */
export async function POST(request: Request): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const body = await parseBody(request, submitPresentationSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  try {
    const outcome = await db.transaction(async (tx) => {
      const [assignment] = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(eq(assignments.id, body.value.assignmentId))
        .limit(1);
      if (!assignment) return { kind: "no_assignment" as const };

      // OWNERSHIP OF THE DECK, as a WHERE clause.
      const [deck] = await tx
        .select({ id: presentations.id })
        .from(presentations)
        .where(
          and(
            eq(presentations.id, body.value.presentationId),
            eq(presentations.creatorId, gate.user.id),
          ),
        )
        .limit(1);
      if (!deck) return { kind: "no_deck" as const };

      const [existing] = await tx
        .select({ id: presentationSubmissions.id })
        .from(presentationSubmissions)
        .where(
          and(
            eq(presentationSubmissions.assignmentId, body.value.assignmentId),
            eq(presentationSubmissions.studentId, gate.user.id),
          ),
        )
        .limit(1);

      const values = {
        assignmentId: body.value.assignmentId,
        presentationId: body.value.presentationId,
        studentId: gate.user.id,
        submissionType: body.value.submissionType,
        videoUrl: body.value.videoUrl,
        videoDurationSeconds: body.value.videoDurationSeconds,
        presentationDate: body.value.presentationDate,
        audienceCount: body.value.audienceCount,
        submittedAt: new Date(),
        // The grade is cleared on resubmission — see the JSDoc. All four
        // together, because the CHECK requires a grade to be whole or absent.
        score: null,
        feedback: null,
        gradedBy: null,
        gradedAt: null,
        status: "submitted" as const,
      };

      // UPSERT against the unique index, not check-then-insert: the `existing`
      // read above only decides the STATUS CODE, and a row that appears between
      // the two statements is handled by the conflict target rather than by a
      // 500.
      const [row] = await tx
        .insert(presentationSubmissions)
        .values(values)
        .onConflictDoUpdate({
          target: [presentationSubmissions.assignmentId, presentationSubmissions.studentId],
          set: values,
        })
        .returning();

      return { kind: "ok" as const, row, created: existing === undefined };
    });

    switch (outcome.kind) {
      case "no_assignment":
        return apiError(404, "Assignment not found.", "not_found");
      case "no_deck":
        return apiError(404, "Presentation not found.", "not_found");
      case "ok":
        return apiOk(outcome.row, outcome.created ? 201 : 200);
    }
  } catch (error) {
    const status = statusForDbError(error);
    if (status) {
      return apiError(status, "The submission was rejected by the database.", "db_rejected");
    }
    throw error;
  }
}
