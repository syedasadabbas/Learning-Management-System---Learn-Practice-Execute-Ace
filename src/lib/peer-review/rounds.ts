// =============================================================================
// ROUNDS — open, allocate, release. The write side of the instructor's controls.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// Three operations, each of which an instructor can trigger more than once, so each
// one is IDEMPOTENT and says so:
//
//   openRound       INSERT ... ON CONFLICT (assignment_id) DO NOTHING, then read.
//                   Two instructors pressing "Open peer review" at the same instant
//                   produce one round, decided by `peer_review_rounds_assignment_idx`
//                   rather than by a read-then-write check that both would pass.
//                   Same argument as src/lib/queue/keys.ts's header makes for
//                   `jobs.idempotency_key`: only the database can settle a race.
//
//   allocateRound   RECONCILE, never reshuffle. See the block comment on it.
//
//   releaseRound    Sets `released_at` once. Re-releasing is a no-op rather than a
//                   new timestamp, because the timestamp is shown to students as
//                   "feedback released on ..." and moving it would rewrite history.
//
// THIS MODULE WRITES TO NO TABLE IT DOES NOT OWN. It reads `submissions`,
// `assignments`, `weeks` and `users`; it writes only the four tables in
// src/db/schema.peer-review.ts. Nothing here touches `submissions.score`,
// `attendance`, `progress` or `leaderboard`, and nothing fires a `ScoringEvent` —
// see ./config.ts for why that is the design and not an omission.
//
// AUTHORIZATION IS THE CALLER'S. Every function takes the acting user's id as an
// argument rather than reading a session, following
// src/lib/instructor/grading.ts#applyGrade: "this function cannot authorize
// anything, and taking the id as an argument makes that obvious". The callers are
// ./actions.ts, whose every export begins with a guard.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { assignments, submissions, users, weeks } from "@/db/schema";
import {
  gradingRubrics,
  peerReviewAllocations,
  peerReviewRounds,
  peerReviews,
} from "@/db/schema.peer-review";

import { planAllocations, type AllocationPlan } from "./allocate";
import {
  DEFAULT_REVIEW_WINDOW_MS,
  DEFAULT_REVIEWS_PER_SUBMISSION,
  MAX_REVIEWS_PER_SUBMISSION,
} from "./config";
import { DEFAULT_RUBRIC_CRITERIA, DEFAULT_RUBRIC_NAME } from "./rubric";

export type RoundFailureCode =
  | "assignment_not_found"
  | "round_not_found"
  | "invalid_input";

export type RoundResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: RoundFailureCode; error: string };

/** A round with the assignment context every surface shows beside it. */
export interface RoundSummary {
  roundId: number;
  assignmentId: number;
  assignmentTitle: string;
  weekId: number;
  weekNumber: number;
  rubricId: number;
  rubricName: string;
  rubricCriteria: unknown;
  reviewsPerSubmission: number;
  reviewDueAt: Date;
  allocatedAt: Date | null;
  releasedAt: Date | null;
  createdAt: Date;
}

const ROUND_COLUMNS = {
  roundId: peerReviewRounds.id,
  assignmentId: peerReviewRounds.assignmentId,
  assignmentTitle: assignments.title,
  weekId: weeks.id,
  weekNumber: weeks.weekNumber,
  rubricId: peerReviewRounds.rubricId,
  rubricName: gradingRubrics.name,
  rubricCriteria: gradingRubrics.criteria,
  reviewsPerSubmission: peerReviewRounds.reviewsPerSubmission,
  reviewDueAt: peerReviewRounds.reviewDueAt,
  allocatedAt: peerReviewRounds.allocatedAt,
  releasedAt: peerReviewRounds.releasedAt,
  createdAt: peerReviewRounds.createdAt,
} as const;

/**
 * Every round, newest assignment first. The instructor overview's top-level list.
 *
 * COLUMNS ARE NAMED EXPLICITLY, always, for the reason
 * src/lib/instructor/queue.ts states in its own header: `users` carries
 * `passwordHash`, and a `select().from(users)` anywhere in a join chain puts the
 * credential table one careless serialisation away from a page. Nothing in this
 * projection touches `users` at all, which is the stronger version of the same
 * defence.
 */
export async function listRounds(): Promise<RoundSummary[]> {
  return db
    .select(ROUND_COLUMNS)
    .from(peerReviewRounds)
    .innerJoin(assignments, eq(peerReviewRounds.assignmentId, assignments.id))
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .innerJoin(gradingRubrics, eq(peerReviewRounds.rubricId, gradingRubrics.id))
    .orderBy(weeks.weekNumber, assignments.id);
}

/** One round by id, or null. */
export async function getRound(roundId: number): Promise<RoundSummary | null> {
  const [row] = await db
    .select(ROUND_COLUMNS)
    .from(peerReviewRounds)
    .innerJoin(assignments, eq(peerReviewRounds.assignmentId, assignments.id))
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .innerJoin(gradingRubrics, eq(peerReviewRounds.rubricId, gradingRubrics.id))
    .where(eq(peerReviewRounds.id, roundId))
    .limit(1);
  return row ?? null;
}

/**
 * Open a peer-review round over an assignment, or return the one that exists.
 *
 * Creates a default rubric if the assignment has none. The rubric is created FIRST
 * and inside the same transaction as the round, because `rubric_id` is NOT NULL
 * with `onDelete: "restrict"` — a round without a rubric is not representable, and
 * that is deliberate (see the schema comment).
 */
export async function openRound(
  input: {
    assignmentId: number;
    reviewsPerSubmission?: number;
    reviewDueAt?: Date;
  },
  actingUserId: number,
): Promise<RoundResult<{ round: RoundSummary; created: boolean }>> {
  const assignmentId = Number(input.assignmentId);
  if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
    return { ok: false, code: "invalid_input", error: "Invalid assignment id." };
  }

  const [assignment] = await db
    .select({ id: assignments.id, dueAt: assignments.dueAt })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!assignment) {
    return { ok: false, code: "assignment_not_found", error: "That assignment does not exist." };
  }

  const k = clampReviews(input.reviewsPerSubmission ?? DEFAULT_REVIEWS_PER_SUBMISSION);
  // Default window measured from NOW rather than from the assignment deadline: a
  // round opened a week late would otherwise be born with its review window already
  // expired, and `review_due_at` is what the student-facing surface shows.
  const reviewDueAt = input.reviewDueAt ?? new Date(Date.now() + DEFAULT_REVIEW_WINDOW_MS);

  const created = await db.transaction(async (tx) => {
    // Reuse the assignment's newest rubric if one exists; otherwise seed the
    // default. A rubric is never rewritten in place — see the schema note on
    // `grading_rubrics`.
    const [existingRubric] = await tx
      .select({ id: gradingRubrics.id })
      .from(gradingRubrics)
      .where(eq(gradingRubrics.assignmentId, assignmentId))
      .orderBy(sql`${gradingRubrics.id} desc`)
      .limit(1);

    let rubricId = existingRubric?.id;
    if (!rubricId) {
      const [inserted] = await tx
        .insert(gradingRubrics)
        .values({
          assignmentId,
          name: DEFAULT_RUBRIC_NAME,
          criteria: [...DEFAULT_RUBRIC_CRITERIA],
          createdBy: actingUserId,
        })
        .returning({ id: gradingRubrics.id });
      rubricId = inserted.id;
    }

    const insertedRound = await tx
      .insert(peerReviewRounds)
      .values({
        assignmentId,
        rubricId,
        reviewsPerSubmission: k,
        reviewDueAt,
        createdBy: actingUserId,
      })
      // Names the index explicitly, as src/lib/queue/store.ts#enqueueJob does: an
      // untargeted conflict clause would also swallow a primary-key collision and
      // report it as a successful de-duplication.
      .onConflictDoNothing({ target: peerReviewRounds.assignmentId })
      .returning({ id: peerReviewRounds.id });

    return insertedRound.length > 0;
  });

  const [round] = await db
    .select(ROUND_COLUMNS)
    .from(peerReviewRounds)
    .innerJoin(assignments, eq(peerReviewRounds.assignmentId, assignments.id))
    .innerJoin(weeks, eq(assignments.weekId, weeks.id))
    .innerJoin(gradingRubrics, eq(peerReviewRounds.rubricId, gradingRubrics.id))
    .where(eq(peerReviewRounds.assignmentId, assignmentId))
    .limit(1);

  if (!round) {
    // Only reachable if the round vanished between the transaction and this read.
    return { ok: false, code: "round_not_found", error: "The round could not be read back." };
  }
  return { ok: true, round, created };
}

export interface AllocationOutcome {
  roundId: number;
  /** Plan the allocator produced, including the degradation report. */
  plan: AllocationPlan;
  /** Rows newly INSERTed by this run. */
  inserted: number;
  /** Rows already present that this run left alone. */
  unchanged: number;
  /**
   * Stale allocations REMOVED because the reviewer or reviewee is no longer in the
   * pool AND no review had been written against them. Never removes a reviewed one.
   */
  removed: number;
  /** Reviewers who gained at least one new allocation. Drives the notification. */
  newlyAllocatedReviewerIds: number[];
  /** Wall-clock duration of the write, in milliseconds (metric units). */
  durationMs: number;
}

/**
 * Allocate (or re-allocate) reviewers for a round.
 *
 * =============================================================================
 * RE-RUNNING IS A RECONCILE, NOT A RESHUFFLE. This is the whole design of this
 * function and the reason `planAllocations` is a pure function of a seed.
 * =============================================================================
 *
 * Ingestion is hourly and unattended (vercel.json, `/api/cron/ingest-submissions`),
 * so the submission pool GROWS after a round is opened: a student who hands in late
 * appears in `submissions` an hour later. An instructor will press "Allocate" again,
 * and the naive implementation — delete everything, re-plan, re-insert — would
 * repair that at the cost of re-pairing every student who had already started
 * reading someone's work, and orphaning reviews already written.
 *
 * So the reconcile has three parts and each one is one SQL statement:
 *   1. PLAN over the CURRENT pool with the SAME seed (`assignments.id`). Because
 *      the plan is deterministic in (pool, K, seed), the pairs for students who were
 *      already in the pool are mostly stable — the ring changes shape when n changes,
 *      but the pairs that survive survive by construction, not by luck.
 *   2. INSERT the plan with `ON CONFLICT DO NOTHING` on
 *      `peer_review_allocations_pair_idx`. An allocation that already exists is
 *      untouched, so its `allocated_at` and any review hanging off it survive.
 *   3. DELETE allocations that are NOT in the new plan and have NO review. A review
 *      that exists is never orphaned and never deleted; a pairing nobody has acted
 *      on is not worth keeping around to confuse a task list.
 *
 * WHAT THIS MEANS FOR A LATE SUBMITTER, stated because it is the case that matters:
 * they enter the ring on the next allocation and are reviewed from then on. Reviews
 * already written about other people's work are unaffected. Their own reviews are
 * newly owed, and the reviewer notification (./notify.ts) is sent only to reviewers
 * who gained work, so nobody is emailed twice about the same task.
 *
 * ONE TRANSACTION. The three statements are all-or-nothing: a partial reconcile
 * would leave a submission with one reviewer where the surface says two.
 */
export async function allocateRound(
  roundId: number,
  actingUserId: number,
): Promise<RoundResult<AllocationOutcome>> {
  const startedAt = Date.now();
  void actingUserId; // recorded by the activity stream at the action layer, not here

  const round = await getRound(roundId);
  if (!round) {
    return { ok: false, code: "round_not_found", error: "That peer-review round does not exist." };
  }

  // The pool: every submission for this assignment, by a user who is still a
  // student. `role` is checked because staff test submissions exist in seeded data
  // and an instructor must not be allocated into a student ring.
  const pool = await db
    .select({ submissionId: submissions.id, studentId: submissions.studentId })
    .from(submissions)
    .innerJoin(users, eq(submissions.studentId, users.id))
    .where(and(eq(submissions.assignmentId, round.assignmentId), eq(users.role, "student")));

  const plan = planAllocations({
    submissions: pool,
    reviewsPerSubmission: round.reviewsPerSubmission,
    // THE SEED IS THE ASSIGNMENT ID, not the round id and not a timestamp. The
    // assignment is the thing a student experiences as "week 2's peer review", and
    // it is stable across every re-run. See ./allocate.ts.
    seed: round.assignmentId,
  });

  const existing = await db
    .select({
      id: peerReviewAllocations.id,
      submissionId: peerReviewAllocations.submissionId,
      reviewerId: peerReviewAllocations.reviewerId,
      reviewId: peerReviews.id,
    })
    .from(peerReviewAllocations)
    .leftJoin(peerReviews, eq(peerReviews.allocationId, peerReviewAllocations.id))
    .where(eq(peerReviewAllocations.roundId, roundId));

  const pairKey = (submissionId: number, reviewerId: number) => `${submissionId}:${reviewerId}`;
  const wanted = new Set(plan.pairs.map((p) => pairKey(p.submissionId, p.reviewerId)));
  const held = new Set(existing.map((a) => pairKey(a.submissionId, a.reviewerId)));

  const staleIds = existing
    .filter((a) => !wanted.has(pairKey(a.submissionId, a.reviewerId)) && a.reviewId == null)
    .map((a) => a.id);

  const toInsert = plan.pairs.filter((p) => !held.has(pairKey(p.submissionId, p.reviewerId)));

  const { inserted, removed } = await db.transaction(async (tx) => {
    let insertedCount = 0;
    if (toInsert.length > 0) {
      const rows = await tx
        .insert(peerReviewAllocations)
        .values(
          toInsert.map((p) => ({
            roundId,
            submissionId: p.submissionId,
            revieweeId: p.revieweeId,
            reviewerId: p.reviewerId,
          })),
        )
        .onConflictDoNothing({
          target: [peerReviewAllocations.submissionId, peerReviewAllocations.reviewerId],
        })
        .returning({ id: peerReviewAllocations.id });
      insertedCount = rows.length;
    }

    let removedCount = 0;
    if (staleIds.length > 0) {
      const rows = await tx
        .delete(peerReviewAllocations)
        .where(inArray(peerReviewAllocations.id, staleIds))
        .returning({ id: peerReviewAllocations.id });
      removedCount = rows.length;
    }

    // `allocated_at` records that allocation has RUN, which is what makes the
    // difference between "not allocated yet" and "allocated, and this is genuinely
    // how few submissions there are" visible on the instructor surface.
    await tx
      .update(peerReviewRounds)
      .set({ allocatedAt: sql`now()` })
      .where(eq(peerReviewRounds.id, roundId));

    return { inserted: insertedCount, removed: removedCount };
  });

  return {
    ok: true,
    roundId,
    plan,
    inserted,
    unchanged: plan.pairs.length - inserted,
    removed,
    newlyAllocatedReviewerIds: [...new Set(toInsert.map((p) => p.reviewerId))],
    durationMs: Date.now() - startedAt,
  };
}

/**
 * THE RELEASE SWITCH. After this, and only after this, a student may read reviews
 * of their own work.
 *
 * Idempotent by a `WHERE released_at IS NULL` on the UPDATE rather than by a read
 * first: two instructors pressing Release simultaneously must not produce two
 * different timestamps, and the second one's UPDATE matching zero rows is the
 * cheapest possible way to say "already released".
 */
export async function releaseRound(
  roundId: number,
  actingUserId: number,
): Promise<RoundResult<{ releasedAt: Date; alreadyReleased: boolean; revealed: number }>> {
  const round = await getRound(roundId);
  if (!round) {
    return { ok: false, code: "round_not_found", error: "That peer-review round does not exist." };
  }

  const updated = await db
    .update(peerReviewRounds)
    .set({ releasedAt: sql`now()`, releasedBy: actingUserId })
    .where(and(eq(peerReviewRounds.id, roundId), sql`${peerReviewRounds.releasedAt} is null`))
    .returning({ releasedAt: peerReviewRounds.releasedAt });

  const releasedAt = updated[0]?.releasedAt ?? round.releasedAt;

  // How many reviews this made visible — the number the confirmation shows, and the
  // number that would be zero if an instructor released a round nobody reviewed.
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(peerReviews)
    .innerJoin(peerReviewAllocations, eq(peerReviews.allocationId, peerReviewAllocations.id))
    .where(and(eq(peerReviewAllocations.roundId, roundId), sql`${peerReviews.flaggedAt} is null`));

  return {
    ok: true,
    // Cannot be null: either the UPDATE set it or the round already had it.
    releasedAt: releasedAt ?? new Date(),
    alreadyReleased: updated.length === 0,
    revealed: counted?.n ?? 0,
  };
}

/**
 * Flag a review as low-effort, withholding it from its reviewee.
 *
 * THE GAMING DEFENCE'S ONE WRITE. Nothing is scored, nothing is deducted — see
 * ./config.ts. This sets a column that ./visibility.ts reads, so a review an
 * instructor considers worthless stops reaching the student it is about, while
 * staying visible to its author and attributed on the instructor's list.
 *
 * Reversible: pass `flagged: false` to unflag. A one-way flag would mean a
 * mis-click permanently withholds a legitimate review.
 */
export async function setReviewFlag(
  input: { reviewId: number; flagged: boolean; note?: string },
  actingUserId: number,
): Promise<RoundResult<{ reviewId: number; flagged: boolean }>> {
  const reviewId = Number(input.reviewId);
  if (!Number.isInteger(reviewId) || reviewId <= 0) {
    return { ok: false, code: "invalid_input", error: "Invalid review id." };
  }

  const rows = await db
    .update(peerReviews)
    .set(
      input.flagged
        ? {
            flaggedAt: sql`now()`,
            flaggedBy: actingUserId,
            instructorNote: input.note?.trim().slice(0, 2000) ?? null,
          }
        : { flaggedAt: null, flaggedBy: null, instructorNote: null },
    )
    .where(eq(peerReviews.id, reviewId))
    .returning({ id: peerReviews.id });

  if (rows.length === 0) {
    return { ok: false, code: "round_not_found", error: "That review does not exist." };
  }
  return { ok: true, reviewId, flagged: input.flagged };
}

/** Rounds that have been allocated, for the reviewer-facing surfaces. */
export async function listAllocatedRoundIds(): Promise<number[]> {
  const rows = await db
    .select({ id: peerReviewRounds.id })
    .from(peerReviewRounds)
    .where(isNotNull(peerReviewRounds.allocatedAt));
  return rows.map((r) => r.id);
}

function clampReviews(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REVIEWS_PER_SUBMISSION;
  return Math.min(MAX_REVIEWS_PER_SUBMISSION, Math.max(1, Math.trunc(value)));
}
