// =============================================================================
// READ MODELS AND THE SUBMIT PATH. Three audiences, three projections, on purpose.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// =============================================================================
// WHY THREE SEPARATE QUERIES AND NOT ONE WITH A ROLE FLAG.
// =============================================================================
// The three audiences want overlapping data with INCOMPATIBLE privacy rules:
//
//   REVIEWER  (getMyReviewTasks / getReviewTask)
//       sees the submission's artefacts and their own review. Does NOT receive the
//       author's name, email or user id.
//   REVIEWEE  (getReceivedReviews)
//       sees review text and rubric scores. Does NOT receive the reviewer's
//       identity, in any form, ever. Sees nothing at all before release.
//   INSTRUCTOR (getRoundOverview)
//       sees everything INCLUDING who wrote what. Accountability is the entire
//       point of that surface and the whole gaming defence rests on it.
//
// A single query with a `viewerRole` parameter would put those three rules in one
// function whose behaviour depends on a boolean, and a boolean that defaults wrong
// — or a caller that forgets it — is how a student ends up reading the
// instructor's view. Three functions cost three projections and remove that class
// of bug entirely. It is the same argument src/lib/peer-review/visibility.ts makes
// for not threading a role through `canReadReview`.
//
// =============================================================================
// THE ANONYMITY ENFORCEMENT, in the order it actually bites.
// =============================================================================
//   1. `peer_reviews` HAS NO `reviewer_id` COLUMN (src/db/schema.peer-review.ts §2).
//      `getReceivedReviews` reads `peer_reviews` joined to `peer_review_allocations`
//      only to filter by `reviewee_id`; there is no reviewer column in its
//      projection because there is nothing to select.
//   2. `RevealedReview` has NO FIELD an identity could travel in. Adding one would
//      mean widening a type — a visible act in a diff.
//   3. ./reviews.anonymity.test.ts serialises what these functions return and fails
//      if a reviewer id, name or email appears anywhere in the object graph.
//
// COLUMNS ARE ALWAYS NAMED. src/lib/instructor/queue.ts's header states the reason
// and it applies with more force here: `users` carries `passwordHash`, and this
// module joins `users` three times.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { assignments, submissions, users, weeks } from "@/db/schema";
import {
  gradingRubrics,
  peerReviewAllocations,
  peerReviewRounds,
  peerReviews,
} from "@/db/schema.peer-review";

import { parseRubricCriteria, toRubricScoreLines, type RubricScoreLine } from "./rubric";
import { canReadReview, canWriteReview, isRevealedToReviewee, type DenyReason } from "./visibility";
import { parseSubmitPeerReview } from "./validate";

// ---------------------------------------------------------------------------
// REVIEWER SIDE — "what do I have to review?"
// ---------------------------------------------------------------------------

/**
 * One review a student owes, or has written.
 *
 * NOTE WHAT IS ABSENT: no `authorName`, no `authorEmail`, no `revieweeId`. The
 * reviewer is not told whose work this is. See ./visibility.ts's header for the
 * honest limit of that — a GitHub URL usually names its owner — and why this is
 * described as single-blind-enforced rather than double-blind.
 */
export interface ReviewTask {
  allocationId: number;
  roundId: number;
  submissionId: number;
  assignmentTitle: string;
  weekNumber: number;
  /** The artefacts to review. Either may be null; the seeded data has none. */
  githubUrl: string | null;
  liveUrl: string | null;
  /** The student's own notes from the submission form. */
  description: string | null;
  reviewDueAt: Date;
  /** Null until the reviewer submits. Presence means "done, and unchangeable". */
  submittedAt: Date | null;
  /** The reviewer's own words, so they can re-read what they said. */
  content: string | null;
  scoreLines: RubricScoreLine[];
  totalScore: number | null;
  /** True when an instructor withheld it. Shown to the author without the note. */
  flagged: boolean;
}

const TASK_COLUMNS = {
  allocationId: peerReviewAllocations.id,
  roundId: peerReviewAllocations.roundId,
  submissionId: submissions.id,
  assignmentTitle: assignments.title,
  weekNumber: weeks.weekNumber,
  githubUrl: submissions.githubUrl,
  liveUrl: submissions.liveUrl,
  description: submissions.description,
  reviewDueAt: peerReviewRounds.reviewDueAt,
  submittedAt: peerReviews.submittedAt,
  content: peerReviews.content,
  rubricScores: peerReviews.rubricScores,
  totalScore: peerReviews.totalScore,
  flaggedAt: peerReviews.flaggedAt,
  criteria: gradingRubrics.criteria,
} as const;

function taskFrom(row: {
  allocationId: number;
  roundId: number;
  submissionId: number;
  assignmentTitle: string;
  weekNumber: number;
  githubUrl: string | null;
  liveUrl: string | null;
  description: string | null;
  reviewDueAt: Date;
  submittedAt: Date | null;
  content: string | null;
  rubricScores: unknown;
  totalScore: number | null;
  flaggedAt: Date | null;
  criteria: unknown;
}): ReviewTask {
  const criteria = parseRubricCriteria(row.criteria);
  return {
    allocationId: row.allocationId,
    roundId: row.roundId,
    submissionId: row.submissionId,
    assignmentTitle: row.assignmentTitle,
    weekNumber: row.weekNumber,
    githubUrl: row.githubUrl,
    liveUrl: row.liveUrl,
    description: row.description,
    reviewDueAt: row.reviewDueAt,
    submittedAt: row.submittedAt,
    content: row.content,
    scoreLines: row.submittedAt ? toRubricScoreLines(criteria, row.rubricScores) : [],
    totalScore: row.totalScore,
    flagged: row.flaggedAt != null,
  };
}

/**
 * Everything this student has been asked to review.
 *
 * Scoped by `reviewer_id = viewerId` in the WHERE clause, so there is no way to ask
 * this function for somebody else's task list — the parameter IS the scope. Ordered
 * outstanding-first so the work to do is at the top.
 */
export async function getMyReviewTasks(reviewerId: number): Promise<ReviewTask[]> {
  const rows = await db
    .select(TASK_COLUMNS)
    .from(peerReviewAllocations)
    .innerJoin(peerReviewRounds, eq(peerReviewAllocations.roundId, peerReviewRounds.id))
    .innerJoin(gradingRubrics, eq(peerReviewRounds.rubricId, gradingRubrics.id))
    .innerJoin(submissions, eq(peerReviewAllocations.submissionId, submissions.id))
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .leftJoin(peerReviews, eq(peerReviews.allocationId, peerReviewAllocations.id))
    .where(eq(peerReviewAllocations.reviewerId, reviewerId))
    .orderBy(asc(peerReviews.submittedAt), asc(weeks.weekNumber), asc(peerReviewAllocations.id));

  return rows.map(taskFrom);
}

export type ReviewTaskLoad =
  | { ok: true; task: ReviewTask; criteria: ReturnType<typeof parseRubricCriteria> }
  | { ok: false; reason: DenyReason | "not_found" };

/**
 * One task, for the write page.
 *
 * THE AUTHORIZATION IS IN THE QUERY AND THEN AGAIN IN THE DECISION. The WHERE
 * clause pins `reviewer_id` to the viewer, so a student who guesses another
 * allocation's id gets `not_found` and cannot even learn that the row exists. The
 * `canWriteReview` call afterwards is not redundant: it is what produces
 * `already_submitted` rather than a blank form the student would fill in twice.
 */
export async function getReviewTask(
  reviewerId: number,
  allocationId: number,
): Promise<ReviewTaskLoad> {
  if (!Number.isInteger(allocationId) || allocationId <= 0) return { ok: false, reason: "not_found" };

  const [row] = await db
    .select({ ...TASK_COLUMNS, reviewerIdOnRow: peerReviewAllocations.reviewerId, revieweeId: peerReviewAllocations.revieweeId })
    .from(peerReviewAllocations)
    .innerJoin(peerReviewRounds, eq(peerReviewAllocations.roundId, peerReviewRounds.id))
    .innerJoin(gradingRubrics, eq(peerReviewRounds.rubricId, gradingRubrics.id))
    .innerJoin(submissions, eq(peerReviewAllocations.submissionId, submissions.id))
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .leftJoin(peerReviews, eq(peerReviews.allocationId, peerReviewAllocations.id))
    .where(
      and(
        eq(peerReviewAllocations.id, allocationId),
        // THE SCOPE. Not a filter applied in JavaScript afterwards: a row belonging
        // to another reviewer never reaches this process.
        eq(peerReviewAllocations.reviewerId, reviewerId),
      ),
    )
    .limit(1);

  if (!row) return { ok: false, reason: "not_found" };

  const decision = canWriteReview({
    viewerId: reviewerId,
    allocation: { reviewerId: row.reviewerIdOnRow, revieweeId: row.revieweeId },
    existingReview: { submittedAt: row.submittedAt, flaggedAt: row.flaggedAt },
  });

  const task = taskFrom(row);
  if (!decision.allowed) {
    // `already_submitted` still returns the task, because the page's job in that
    // state is to show the reviewer what they wrote — read-only.
    if (decision.reason === "already_submitted") {
      return { ok: true, task, criteria: parseRubricCriteria(row.criteria) };
    }
    return { ok: false, reason: decision.reason };
  }

  return { ok: true, task, criteria: parseRubricCriteria(row.criteria) };
}

// ---------------------------------------------------------------------------
// REVIEWEE SIDE — "what did people say about my work?"
// ---------------------------------------------------------------------------

/**
 * A review of the viewer's own submission, as the viewer is allowed to see it.
 *
 * THE ANONYMITY CONTRACT IS THIS TYPE. There is no reviewer field, no allocation
 * id, and no reviewee id — nothing an identity could travel in, and nothing that
 * could be correlated back to a person. `reviewNumber` is a positional label
 * ("Review 1", "Review 2") assigned at read time from the ordering, deliberately
 * NOT the `peer_reviews.id`: a real row id is a global sequence, so a student who
 * received ids 41 and 63 could infer how many reviews the cohort wrote in between,
 * and two students comparing ids could work out who reviewed whom.
 */
export interface RevealedReview {
  /** 1-based label within this submission's revealed reviews. Not a database id. */
  reviewNumber: number;
  content: string;
  scoreLines: RubricScoreLine[];
  totalScore: number | null;
  maxTotal: number;
  /** When the review was written. Coarse enough not to identify anyone. */
  submittedAt: Date;
}

export interface ReceivedReviewsForAssignment {
  assignmentId: number;
  assignmentTitle: string;
  weekNumber: number;
  roundId: number;
  /** False until an instructor releases. When false, `reviews` is EMPTY. */
  released: boolean;
  /** How many reviews were requested per submission, for "1 of 2 received". */
  reviewsPerSubmission: number;
  /**
   * Reviews the viewer may read. Empty before release, and empty of any flagged
   * review after it.
   */
  reviews: RevealedReview[];
}

/**
 * Every peer review of this student's own work that they are allowed to read.
 *
 * TWO GATES, BOTH APPLIED:
 *   * the WHERE clause pins `reviewee_id` to the viewer, so another student's
 *     reviews are not in the result set;
 *   * `isRevealedToReviewee` — the same pure function `canReadReview` uses for the
 *     reviewee branch, asserted equivalent to it in visibility.test.ts — decides
 *     whether each row is included.
 *
 * The release gate is applied HERE, in the mapping, rather than as a SQL predicate,
 * for one reason: the caller still needs to know the round EXISTS and is not yet
 * released, so it can render "your feedback is being reviewed by an instructor"
 * instead of "nobody reviewed your work". Filtering in SQL would make those two
 * states indistinguishable.
 */
export async function getReceivedReviews(
  studentId: number,
): Promise<ReceivedReviewsForAssignment[]> {
  const rows = await db
    .select({
      roundId: peerReviewRounds.id,
      assignmentId: assignments.id,
      assignmentTitle: assignments.title,
      weekNumber: weeks.weekNumber,
      reviewsPerSubmission: peerReviewRounds.reviewsPerSubmission,
      releasedAt: peerReviewRounds.releasedAt,
      criteria: gradingRubrics.criteria,
      // --- the review itself. NOTE: no reviewer column is selected, and none
      // exists on `peer_reviews` to select. See the file header.
      content: peerReviews.content,
      rubricScores: peerReviews.rubricScores,
      totalScore: peerReviews.totalScore,
      submittedAt: peerReviews.submittedAt,
      flaggedAt: peerReviews.flaggedAt,
    })
    .from(peerReviewAllocations)
    .innerJoin(peerReviewRounds, eq(peerReviewAllocations.roundId, peerReviewRounds.id))
    .innerJoin(gradingRubrics, eq(peerReviewRounds.rubricId, gradingRubrics.id))
    .innerJoin(assignments, eq(peerReviewRounds.assignmentId, assignments.id))
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .leftJoin(peerReviews, eq(peerReviews.allocationId, peerReviewAllocations.id))
    .where(eq(peerReviewAllocations.revieweeId, studentId))
    .orderBy(asc(weeks.weekNumber), asc(peerReviews.submittedAt));

  const byRound = new Map<number, ReceivedReviewsForAssignment>();

  for (const row of rows) {
    let group = byRound.get(row.roundId);
    if (!group) {
      group = {
        assignmentId: row.assignmentId,
        assignmentTitle: row.assignmentTitle,
        weekNumber: row.weekNumber,
        roundId: row.roundId,
        released: row.releasedAt != null,
        reviewsPerSubmission: row.reviewsPerSubmission,
        reviews: [],
      };
      byRound.set(row.roundId, group);
    }

    const review =
      row.submittedAt != null ? { submittedAt: row.submittedAt, flaggedAt: row.flaggedAt } : null;

    if (!isRevealedToReviewee({ round: { releasedAt: row.releasedAt }, review })) continue;
    // `isRevealedToReviewee` returning true implies submittedAt and content are set.
    if (row.submittedAt == null || row.content == null) continue;

    const criteria = parseRubricCriteria(row.criteria);
    group.reviews.push({
      reviewNumber: group.reviews.length + 1,
      content: row.content,
      scoreLines: toRubricScoreLines(criteria, row.rubricScores),
      totalScore: row.totalScore,
      maxTotal: criteria.reduce((sum, c) => sum + c.maxPoints, 0),
      submittedAt: row.submittedAt,
    });
  }

  return [...byRound.values()];
}

// ---------------------------------------------------------------------------
// THE WRITE PATH
// ---------------------------------------------------------------------------

export type SubmitFailureCode =
  | "not_found"
  | "validation_failed"
  | DenyReason;

export type SubmitReviewResult =
  | {
      ok: true;
      reviewId: number;
      allocationId: number;
      totalScore: number;
      /** Wall-clock duration of the write, in milliseconds (metric units). */
      durationMs: number;
    }
  | { ok: false; code: SubmitFailureCode; error: string; issues?: string[] };

/**
 * Store one peer review. INSERT-ONLY — there is no update path anywhere in this
 * stream, which is what makes "a student cannot edit a submitted review" a property
 * of the code rather than a permission that could be misconfigured.
 *
 * THE ORDER OF CHECKS MATTERS AND IS NOT INTERCHANGEABLE:
 *   1. Load the allocation SCOPED TO THE REVIEWER. A student submitting against
 *      somebody else's allocation id gets `not_found` and learns nothing.
 *   2. `canWriteReview`, for the `already_submitted` sentence.
 *   3. Validate against THIS ROUND'S rubric — read from the database, not from the
 *      payload, so a client cannot submit a rubric of its own invention.
 *   4. INSERT with `ON CONFLICT DO NOTHING` on `peer_reviews_allocation_idx`. A
 *      double-clicked Save is settled by Postgres, not by step 2 — step 2 cannot
 *      see a row that a concurrent request has not committed yet. Same argument as
 *      src/lib/queue/keys.ts's header makes at length for `enqueueJob`.
 */
export async function submitReview(
  payload: unknown,
  reviewerId: number,
): Promise<SubmitReviewResult> {
  const startedAt = Date.now();

  const allocationId = Number(
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).allocationId
      : NaN,
  );
  if (!Number.isInteger(allocationId) || allocationId <= 0) {
    return { ok: false, code: "not_found", error: "That review assignment does not exist." };
  }

  const [row] = await db
    .select({
      allocationId: peerReviewAllocations.id,
      reviewerIdOnRow: peerReviewAllocations.reviewerId,
      revieweeId: peerReviewAllocations.revieweeId,
      criteria: gradingRubrics.criteria,
      existingSubmittedAt: peerReviews.submittedAt,
      existingFlaggedAt: peerReviews.flaggedAt,
    })
    .from(peerReviewAllocations)
    .innerJoin(peerReviewRounds, eq(peerReviewAllocations.roundId, peerReviewRounds.id))
    .innerJoin(gradingRubrics, eq(peerReviewRounds.rubricId, gradingRubrics.id))
    .leftJoin(peerReviews, eq(peerReviews.allocationId, peerReviewAllocations.id))
    .where(
      and(
        eq(peerReviewAllocations.id, allocationId),
        eq(peerReviewAllocations.reviewerId, reviewerId),
      ),
    )
    .limit(1);

  if (!row) {
    // Deliberately the same message whether the allocation does not exist or belongs
    // to somebody else. Distinguishing them would confirm the existence of another
    // student's allocation to whoever is probing ids.
    return { ok: false, code: "not_found", error: "That review assignment does not exist." };
  }

  const decision = canWriteReview({
    viewerId: reviewerId,
    allocation: { reviewerId: row.reviewerIdOnRow, revieweeId: row.revieweeId },
    existingReview:
      row.existingSubmittedAt != null
        ? { submittedAt: row.existingSubmittedAt, flaggedAt: row.existingFlaggedAt }
        : null,
  });
  if (!decision.allowed) {
    return {
      ok: false,
      code: decision.reason,
      error:
        decision.reason === "already_submitted"
          ? "You have already submitted this review. A submitted review cannot be changed."
          : "This review is not yours to write.",
    };
  }

  const parsed = parseSubmitPeerReview(payload, parseRubricCriteria(row.criteria));
  if (!parsed.ok) {
    return { ok: false, code: "validation_failed", error: parsed.error, issues: parsed.issues };
  }

  const inserted = await db
    .insert(peerReviews)
    .values({
      allocationId: row.allocationId,
      content: parsed.data.content,
      rubricScores: parsed.data.rubricScores,
      totalScore: parsed.data.totalScore,
      // 'anonymous' is the column default and is not passed, so the default is the
      // single source of that decision. See the schema note: this column records
      // intent and is NOT the enforcement.
    })
    .onConflictDoNothing({ target: peerReviews.allocationId })
    .returning({ id: peerReviews.id });

  if (inserted.length === 0) {
    // Lost the race with a concurrent submit of the same review — a double-clicked
    // Save. The first one won and the review IS stored, so this is reported as the
    // same refusal step 2 would have given a moment later.
    return {
      ok: false,
      code: "already_submitted",
      error: "You have already submitted this review. A submitted review cannot be changed.",
    };
  }

  return {
    ok: true,
    reviewId: inserted[0].id,
    allocationId: row.allocationId,
    totalScore: parsed.data.totalScore,
    durationMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// INSTRUCTOR SIDE — the accountability surface the gaming defence depends on
// ---------------------------------------------------------------------------

/**
 * One allocation as staff see it: WITH both identities.
 *
 * THIS IS THE ONLY PROJECTION IN THE STREAM THAT CARRIES A REVIEWER'S NAME, and it
 * exists because "an instructor can see and override" is the stated answer to the
 * gaming question (./config.ts). It is reachable only from a page and an action
 * guarded by `requireRole("instructor")` / `apiGuard("instructor")`, and it is a
 * different function from anything a student can call — not the same function with a
 * flag.
 */
export interface InstructorReviewRow {
  allocationId: number;
  reviewId: number | null;
  reviewerId: number;
  reviewerName: string;
  revieweeId: number;
  submissionId: number;
  submittedAt: Date | null;
  content: string | null;
  totalScore: number | null;
  /** Trimmed character count — the cheap "is this a real review?" signal. */
  contentChars: number;
  flagged: boolean;
  instructorNote: string | null;
  /** True when this review would be shown to its reviewee right now. */
  revealed: boolean;
}

export interface RoundOverview {
  roundId: number;
  allocations: InstructorReviewRow[];
  /** Distinct reviewers with at least one allocation. */
  reviewers: number;
  submitted: number;
  outstanding: number;
  flagged: number;
}

export async function getRoundOverview(roundId: number): Promise<RoundOverview> {
  const rows = await db
    .select({
      allocationId: peerReviewAllocations.id,
      reviewId: peerReviews.id,
      reviewerId: peerReviewAllocations.reviewerId,
      reviewerName: users.name,
      revieweeId: peerReviewAllocations.revieweeId,
      submissionId: peerReviewAllocations.submissionId,
      submittedAt: peerReviews.submittedAt,
      content: peerReviews.content,
      totalScore: peerReviews.totalScore,
      flaggedAt: peerReviews.flaggedAt,
      instructorNote: peerReviews.instructorNote,
      releasedAt: peerReviewRounds.releasedAt,
    })
    .from(peerReviewAllocations)
    .innerJoin(peerReviewRounds, eq(peerReviewAllocations.roundId, peerReviewRounds.id))
    .innerJoin(users, eq(peerReviewAllocations.reviewerId, users.id))
    .leftJoin(peerReviews, eq(peerReviews.allocationId, peerReviewAllocations.id))
    .where(eq(peerReviewAllocations.roundId, roundId))
    .orderBy(desc(peerReviews.submittedAt), asc(peerReviewAllocations.id));

  const allocations: InstructorReviewRow[] = rows.map((row) => ({
    allocationId: row.allocationId,
    reviewId: row.reviewId,
    reviewerId: row.reviewerId,
    reviewerName: row.reviewerName,
    revieweeId: row.revieweeId,
    submissionId: row.submissionId,
    submittedAt: row.submittedAt,
    content: row.content,
    totalScore: row.totalScore,
    contentChars: row.content?.trim().length ?? 0,
    flagged: row.flaggedAt != null,
    instructorNote: row.instructorNote,
    revealed: isRevealedToReviewee({
      round: { releasedAt: row.releasedAt },
      review: row.submittedAt ? { submittedAt: row.submittedAt, flaggedAt: row.flaggedAt } : null,
    }),
  }));

  return {
    roundId,
    allocations,
    reviewers: new Set(allocations.map((a) => a.reviewerId)).size,
    submitted: allocations.filter((a) => a.submittedAt != null).length,
    outstanding: allocations.filter((a) => a.submittedAt == null).length,
    flagged: allocations.filter((a) => a.flagged).length,
  };
}

/**
 * How many reviews this student has submitted, across every round.
 *
 * Exists for two callers that are NOT in this stream, and is exported rather than
 * inlined so neither has to know the join:
 *   * a `peer_review_master` badge, if the badges stream chooses to add one — see
 *     the TODO in ./config.ts;
 *   * an instructor deciding participation marks in `attendance.participation_score`,
 *     which is the only place peer review can ever reach a score, and only by a
 *     human's decision.
 */
export async function countSubmittedReviewsByReviewer(reviewerId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(peerReviews)
    .innerJoin(peerReviewAllocations, eq(peerReviews.allocationId, peerReviewAllocations.id))
    .where(eq(peerReviewAllocations.reviewerId, reviewerId));
  return row?.n ?? 0;
}

/**
 * A single review read by one of its two parties, for a detail surface.
 *
 * Kept because it is the one place the full `canReadReview` decision — including the
 * `not_a_party` refusal — is exercised against real rows, and it returns the
 * ANONYMOUS shape even to the reviewer, so a shared component cannot leak an
 * identity depending on who is looking.
 */
export async function readReviewAsParty(
  viewerId: number,
  reviewId: number,
): Promise<{ ok: true; review: RevealedReview } | { ok: false; reason: DenyReason | "not_found" }> {
  const [row] = await db
    .select({
      reviewerId: peerReviewAllocations.reviewerId,
      revieweeId: peerReviewAllocations.revieweeId,
      releasedAt: peerReviewRounds.releasedAt,
      submittedAt: peerReviews.submittedAt,
      flaggedAt: peerReviews.flaggedAt,
      content: peerReviews.content,
      rubricScores: peerReviews.rubricScores,
      totalScore: peerReviews.totalScore,
      criteria: gradingRubrics.criteria,
    })
    .from(peerReviews)
    .innerJoin(peerReviewAllocations, eq(peerReviews.allocationId, peerReviewAllocations.id))
    .innerJoin(peerReviewRounds, eq(peerReviewAllocations.roundId, peerReviewRounds.id))
    .innerJoin(gradingRubrics, eq(peerReviewRounds.rubricId, gradingRubrics.id))
    .where(eq(peerReviews.id, reviewId))
    .limit(1);

  if (!row) return { ok: false, reason: "not_found" };

  const decision = canReadReview({
    viewerId,
    allocation: { reviewerId: row.reviewerId, revieweeId: row.revieweeId },
    round: { releasedAt: row.releasedAt },
    review: { submittedAt: row.submittedAt, flaggedAt: row.flaggedAt },
  });
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  const criteria = parseRubricCriteria(row.criteria);
  return {
    ok: true,
    review: {
      reviewNumber: 1,
      content: row.content,
      scoreLines: toRubricScoreLines(criteria, row.rubricScores),
      totalScore: row.totalScore,
      maxTotal: criteria.reduce((sum, c) => sum + c.maxPoints, 0),
      submittedAt: row.submittedAt,
    },
  };
}
