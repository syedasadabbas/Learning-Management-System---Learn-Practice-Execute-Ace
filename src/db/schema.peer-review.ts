// =============================================================================
// PEER REVIEW TABLES — roadmap feature 6 (IMPLEMENTATION_ROADMAP.md:427).
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// WHY A SIBLING MODULE. drizzle.config.ts:9-15 states the rule and
// src/db/schema.access.ts, schema.submissions.ts, schema.queue.ts,
// schema.notifications.ts and schema.badges.ts are the precedents: `schema.ts` is
// the frozen Wave 0 seam, eight streams edited it concurrently today, and a
// stream that needs tables of its own adds a module plus ONE line to that
// config's `schema` array. An unlisted module is worse than a missing one —
// drizzle-kit treats a table it cannot see as a table to DROP.
//
// =============================================================================
// WHAT THIS SCHEMA HAS TO ENFORCE, because the alternative is enforcing it in
// application code that four call sites can each get wrong.
// =============================================================================
//
// 1. A STUDENT MUST NEVER REVIEW THEIR OWN WORK.
//    `peer_review_allocations` carries `reviewee_id` — the author of the
//    submission — DENORMALIZED beside `reviewer_id`, purely so that a CHECK
//    constraint can compare the two. Without the denormalized column the fact
//    lives one join away in `submissions.student_id` and Postgres cannot see it
//    from a row-level CHECK, so "no self-review" would be a property of
//    src/lib/peer-review/allocate.ts and of every future INSERT anyone writes by
//    hand at 02:00 during an incident. The column is redundant on purpose and the
//    redundancy IS the feature. See `noSelfReview` below.
//
// 2. AN ANONYMOUS REVIEW MUST NOT CARRY ITS AUTHOR'S ID ON THE ROW THE REVIEWEE
//    READS. This is the one place the data model differs materially from the
//    roadmap sketch, and it is deliberate. roadmap:433-441 puts `reviewerId`
//    directly on `peer_reviews`. That is the shape in which anonymity leaks: the
//    reviewee-facing read model is a query over `peer_reviews`, `select()` with no
//    projection returns every column, and one careless edit six months from now
//    hands the reviewer's user id to the person they reviewed. Here
//    `peer_reviews` has NO `reviewer_id` and NO `submission_id`; both are reached
//    only through `allocation_id`. A reviewee-facing query therefore CANNOT
//    accidentally include the reviewer — it would have to deliberately join
//    `peer_review_allocations` to get there, which is a visible, reviewable act.
//    Enforced in code by src/lib/peer-review/reviews.ts#getReceivedReviews and
//    asserted on the real response body in reviews.anonymity.test.ts.
//
// 3. ONE REVIEW PER ALLOCATION, AND A SUBMITTED REVIEW IS IMMUTABLE.
//    `allocation_id` is UNIQUE, and there is no `updated_at` column because there
//    is no update path: the row is INSERTed at submit time and never rewritten.
//    "A student must not edit a submitted review" is therefore not a permission
//    check that could be forgotten, it is the absence of a mutation. Drafts do not
//    exist for the same reason — a draft needs an update path, and an update path
//    needs an is-it-still-editable decision at every caller.
//
// 4. THE REVEAL POINT IS A COLUMN, NOT A CLOCK COMPARISON.
//    `peer_review_rounds.released_at` is the instructor's release switch, the same
//    shape as the subject-section release switch that landed on this branch
//    (commit e4c0329). NULL means no student may read any review of their own work
//    yet, whatever the calendar says. A deadline-based reveal was considered and
//    rejected: it fires unattended, so a review consisting of the word "fine"
//    reaches the student before any human has seen it, and the gaming defence in
//    §5 depends on a human having the opportunity to look first.
//
// 5. GAMING IS ANSWERED BY VISIBILITY, NOT BY POINTS. Peer review awards NO
//    marks — see the file header of src/lib/peer-review/config.ts for the full
//    argument and its interaction with the scoring contract. `flagged_at` /
//    `flagged_by` / `instructor_note` exist so an instructor can mark a low-effort
//    review and withhold the round, which is the whole defence and is stated
//    plainly rather than dressed up.
//
// PRIMARY KEYS ARE `serial`, NOT `uuid`, and integer FKs, unlike the roadmap
// sketch (roadmap:433 uses `uuid().defaultRandom()`). Every table in
// src/db/schema.ts is `serial` and every FK in this repository is an `integer`;
// a uuid island would need its own join casts and would be the only table an
// operator cannot reference by a number they can read out loud. Prefer what
// exists (brief: "where it is silent or conflicts with what exists, prefer what
// exists").
//
// Every timestamp is `timestamptz` written by the DATABASE's clock, and every
// duration in this stream is milliseconds (house rules: one clock, metric units).
// =============================================================================

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { assignments, submissions, users } from "./schema";

/**
 * A rubric: the named criteria a reviewer scores against.
 *
 * roadmap:443-450 calls this `grading_rubrics` and that name is kept, including
 * the deviation it implies: it is not prefixed `peer_review_`, because a rubric is
 * not inherently a peer-review artefact and the instructor grading queue
 * (src/lib/instructor/queue.ts) could read the same rows later. Nothing in this
 * stream writes to `submissions`, so sharing the table is a possibility, not a
 * coupling.
 *
 * NOT UNIQUE PER ASSIGNMENT. A rubric is versioned by adding a row, never by
 * rewriting `criteria`: an in-place edit would silently redefine what the scores
 * already stored in `peer_reviews.rubric_scores` meant, and there is no way to
 * detect that after the fact. The round names the rubric it was opened with.
 */
export const gradingRubrics = pgTable(
  "grading_rubrics",
  {
    id: serial("id").primaryKey(),

    /**
     * The assignment this rubric was written for. Nullable so a reusable
     * "general web-development rubric" can exist without being pinned to one
     * week; `onDelete: "cascade"` for the pinned case, because a rubric for a
     * deleted assignment is unreachable.
     */
    assignmentId: integer("assignment_id").references(() => assignments.id, {
      onDelete: "cascade",
    }),

    name: varchar("name", { length: 255 }).notNull(),

    /**
     * `RubricCriterion[]` — see src/lib/peer-review/rubric.ts, which owns the
     * shape and validates it on the way in and on the way out.
     *
     * jsonb rather than a `grading_rubric_criteria` child table. The criteria are
     * read as a whole, always, by both the form and the read model; a child table
     * would add a join to every query and an ordering column to keep in step, to
     * buy referential integrity over three to five rows that are written once.
     * The cost is stated: jsonb accepts anything, so `parseRubricCriteria` treats
     * a stored blob as untrusted input rather than as a type.
     */
    criteria: jsonb("criteria").notNull(),

    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    assignmentIdx: index("grading_rubrics_assignment_idx").on(t.assignmentId),
  }),
);

/**
 * One peer-review round: "assignment A is being peer reviewed, under rubric R,
 * K reviews per submission, reviews due at D, released at (or not yet)".
 *
 * NOT IN THE ROADMAP SKETCH, which has only the two tables above and below. It is
 * added because three of the four questions this feature has to answer are
 * questions about a round and have nowhere else to live:
 *   - "how many reviews does each submission get?"  -> `reviews_per_submission`
 *   - "has allocation already run?"                 -> `allocated_at`
 *   - "may a student see reviews of their work?"    -> `released_at`
 * Putting `visibility` on each review (roadmap:439) answers none of them: it says
 * how a review is attributed, not whether it has been revealed.
 */
export const peerReviewRounds = pgTable(
  "peer_review_rounds",
  {
    id: serial("id").primaryKey(),

    /**
     * UNIQUE. One round per assignment, which is what makes
     * `INSERT ... ON CONFLICT (assignment_id)` the open-or-fetch operation in
     * src/lib/peer-review/rounds.ts#openRound rather than a read-then-write race
     * between two instructors pressing "Open peer review" at the same moment.
     *
     * A second round over the same assignment (a re-review after resubmission) is
     * deliberately not modelled. It would double every authorization question —
     * "assigned in which round?" — for a workflow nobody has asked for.
     */
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),

    /**
     * `onDelete: "restrict"`, uniquely in this repository, and on purpose: the
     * integers in `peer_reviews.rubric_scores` are meaningless without the
     * criteria they were scored against, so a rubric that a round points at must
     * not be deletable. The alternative (`set null`) turns stored scores into
     * numbers nobody can interpret, silently.
     */
    rubricId: integer("rubric_id")
      .notNull()
      .references(() => gradingRubrics.id, { onDelete: "restrict" }),

    /**
     * K — how many peers review each submission. Stored per round rather than
     * read from a constant at display time, because the allocator may DEGRADE it
     * for a small cohort (see planAllocations) and the surface has to be able to
     * say "2 reviews each" truthfully for a round that was allocated when the
     * cohort was three students.
     */
    reviewsPerSubmission: integer("reviews_per_submission").notNull().default(2),

    /** When reviewers should be done. Advisory: nothing is auto-penalised. */
    reviewDueAt: timestamp("review_due_at", { withTimezone: true }).notNull(),

    /**
     * Set the first time allocation runs. Its presence is what makes re-running
     * allocation a RECONCILE (add newly-submitted students, never re-pair the ones
     * already reviewing) rather than a reshuffle — see
     * src/lib/peer-review/rounds.ts#allocateRound.
     */
    allocatedAt: timestamp("allocated_at", { withTimezone: true }),

    /**
     * THE REVEAL POINT. NULL = no student may read any review of their own
     * submission. Set by an instructor. See §4 of the file header for why this is
     * not a comparison against `review_due_at`.
     */
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: integer("released_by").references(() => users.id, { onDelete: "set null" }),

    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    assignmentIdx: uniqueIndex("peer_review_rounds_assignment_idx").on(t.assignmentId),
  }),
);

/**
 * "Reviewer X has been asked to review submission S, whose author is Y."
 *
 * THE AUTHORIZATION SUBJECT. Every read and every write in this stream is
 * authorized by the existence of one of these rows, which is why it is a table and
 * not a derived pairing computed on demand: a rule recomputed per request can
 * disagree with itself between the render and the submit (a late submission
 * arriving in between changes the cohort), and the student would be told their
 * review was not theirs to write after they had written it.
 */
export const peerReviewAllocations = pgTable(
  "peer_review_allocations",
  {
    id: serial("id").primaryKey(),

    roundId: integer("round_id")
      .notNull()
      .references(() => peerReviewRounds.id, { onDelete: "cascade" }),

    submissionId: integer("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),

    /**
     * The AUTHOR of `submission_id`, denormalized. See §1 of the file header: this
     * column exists so `noSelfReview` below can be a database CHECK instead of a
     * convention. It is written from `submissions.student_id` by the allocator and
     * is never the source of truth for anything else.
     */
    revieweeId: integer("reviewee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    reviewerId: integer("reviewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    allocatedAt: timestamp("allocated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * THE IDEMPOTENCY ARBITER for allocation. `ON CONFLICT DO NOTHING` needs a
     * single unique constraint to name, and this one also states the product rule:
     * one reviewer reviews one submission at most once. Re-running allocation is
     * therefore safe by construction rather than by the allocator being careful.
     */
    pairIdx: uniqueIndex("peer_review_allocations_pair_idx").on(t.submissionId, t.reviewerId),
    /** Serves "what do I have to review?" — the reviewer's own task list. */
    reviewerIdx: index("peer_review_allocations_reviewer_idx").on(t.reviewerId, t.roundId),
    /** Serves "who is reviewing my work?" for the instructor overview. */
    roundIdx: index("peer_review_allocations_round_idx").on(t.roundId),
    /**
     * NO SELF-REVIEW, ENFORCED BY POSTGRES. The single most important line in
     * this file. Every other guarantee in this stream is enforced by application
     * code that a future edit can bypass; this one cannot be bypassed by any
     * INSERT from any client, including a hand-written one.
     */
    noSelfReview: check(
      "peer_review_allocations_no_self_review",
      sql`${t.reviewerId} <> ${t.revieweeId}`,
    ),
  }),
);

/**
 * A SUBMITTED review. Insert-once, never updated. See §2 and §3 of the header for
 * why this row deliberately does not know who wrote it or what it is about.
 */
export const peerReviews = pgTable(
  "peer_reviews",
  {
    id: serial("id").primaryKey(),

    /**
     * UNIQUE — one review per allocation. This is simultaneously the "you may
     * only review what you were assigned" link (there is no way to write a review
     * without an allocation row) and the "one review, not a thread" rule.
     */
    allocationId: integer("allocation_id")
      .notNull()
      .references(() => peerReviewAllocations.id, { onDelete: "cascade" }),

    /** The written feedback. Length floor enforced in src/lib/peer-review/validate.ts. */
    content: text("content").notNull(),

    /**
     * `Record<criterionKey, number>` — see src/lib/peer-review/rubric.ts.
     * roadmap:437 shows `{ criterion_1: 8, criterion_2: 9 }`; the keys here are
     * the rubric's own criterion keys rather than positional names, so a rubric
     * whose criteria are reordered does not silently reinterpret stored scores.
     */
    rubricScores: jsonb("rubric_scores").notNull(),

    /**
     * Sum of the rubric scores at submit time, denormalized for listing.
     *
     * ADVISORY ONLY. It is not a grade, it never reaches `submissions.score`, and
     * nothing in src/lib/contracts/scoring.ts reads it. See
     * src/lib/peer-review/config.ts for the argument.
     */
    totalScore: integer("total_score"),

    /**
     * 'anonymous' or 'named', per roadmap:439, defaulting to anonymous
     * (roadmap:758 — "Anonymous reviews by default" is the roadmap's own stated
     * mitigation for bias in peer grading).
     *
     * varchar, not a pgEnum, matching `submission_ingest_runs.triggered_by`: an
     * enum here would be a label in the shared enum namespace for a two-valued
     * display flag, and an unrecognised value must render verbatim rather than
     * crash a page.
     *
     * READ THIS BEFORE TRUSTING IT: this column records the reviewer's declared
     * INTENT and is NOT the enforcement. Enforcement is the absence of a
     * `reviewer_id` column plus the projections in
     * src/lib/peer-review/reviews.ts. Today nothing sets it to 'named' — the
     * reviewee-facing read model never returns an identity whatever this says —
     * so it is stored for a future "waive my anonymity" affordance and is inert.
     */
    visibility: varchar("visibility", { length: 20 }).notNull().default("anonymous"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),

    /**
     * GAMING DEFENCE, the visible half. An instructor who reads a review of the
     * form "good job" flags it; a flagged review is excluded from what the
     * reviewee is shown (src/lib/peer-review/visibility.ts) and is listed for the
     * instructor with its reviewer's name attached. There is no automatic sanction
     * because there are no points to take away — see config.ts.
     */
    flaggedAt: timestamp("flagged_at", { withTimezone: true }),
    flaggedBy: integer("flagged_by").references(() => users.id, { onDelete: "set null" }),
    /** Why it was flagged. Instructor-facing only; never returned to a student. */
    instructorNote: text("instructor_note"),
  },
  (t) => ({
    allocationIdx: uniqueIndex("peer_reviews_allocation_idx").on(t.allocationId),
    /** Serves the instructor's "which reviews still need looking at?" filter. */
    flaggedIdx: index("peer_reviews_flagged_idx").on(t.flaggedAt),
  }),
);

export type GradingRubric = typeof gradingRubrics.$inferSelect;
export type NewGradingRubric = typeof gradingRubrics.$inferInsert;
export type PeerReviewRound = typeof peerReviewRounds.$inferSelect;
export type NewPeerReviewRound = typeof peerReviewRounds.$inferInsert;
export type PeerReviewAllocation = typeof peerReviewAllocations.$inferSelect;
export type NewPeerReviewAllocation = typeof peerReviewAllocations.$inferInsert;
export type PeerReview = typeof peerReviews.$inferSelect;
export type NewPeerReview = typeof peerReviews.$inferInsert;
