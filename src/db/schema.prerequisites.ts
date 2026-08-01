// =============================================================================
// COURSE PREREQUISITES — schema module for the prerequisites stream (feature 8).
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// WHY THIS IS A SEPARATE FILE AND NOT AN APPEND TO src/db/schema.ts
//
// Exactly the reason src/db/schema.access.ts:6 gives, and it is not theoretical
// here: eight agents are editing this tree concurrently and two conflicting
// migrations were generated today. A sibling module that IMPORTS from schema.ts
// (one direction only — schema.ts does not import this file, so there is no
// cycle) declares the tables without touching the hot file, and one line in
// `drizzle.config.ts`'s schema ARRAY makes drizzle-kit see them exactly as if
// they had been declared inline.
//
// -----------------------------------------------------------------------------
// WHERE THIS SITS AMONG THE THREE GATES THAT ALREADY EXIST
//
// This stream adds NO fourth gate. The full argument is in
// src/lib/prerequisites/policy.ts's header; the one-line version is that a
// prerequisite is a REASON `src/lib/courses/policy.ts` refuses or admits, not a
// second authority that can disagree with it. `decideCourseAccess` remains the
// only function that answers "may this student open this course".
//
// -----------------------------------------------------------------------------
// TWO TABLES, AND WHY THE SECOND ONE EXISTS
//
// `course_prerequisites` is the RULE (course A needs course B, optionally at a
// minimum score). `course_prerequisite_overrides` is the EXCEPTION an admin
// grants to one student.
//
// The exception could not be folded into `course_access_requests.status`: that
// column already means "an admin approved this request", and approval happens
// BEFORE a prerequisite may exist — an admin can add a prerequisite to a course
// students are already approved for. If approval doubled as the override, then
// every pre-existing approval would silently become an override the moment a
// prerequisite landed, and the admin console could not distinguish "met the
// prerequisite" from "was let through anyway". Requirement 4 of this feature is
// that the override is VISIBLE rather than silent, and a boolean folded into
// somebody else's status column is the definition of silent.
// =============================================================================

import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { courses, users } from "./schema";

/**
 * ONE EDGE OF THE PREREQUISITE GRAPH: `course_id` requires
 * `prerequisite_course_id`.
 *
 * DIRECTION, stated because every reader gets it wrong once: the row means "to
 * take `course_id` you must first have done `prerequisite_course_id`". Traversal
 * therefore follows `course_id -> prerequisite_course_id` when asking "what do I
 * still owe", and the REVERSE direction when asking "what does removing this
 * unblock".
 *
 * ---------------------------------------------------------------------------
 * CYCLES ARE PREVENTED, NOT MERELY REPORTED. Three layers, deliberately
 * overlapping, because "the UI would not let you do that" is not a constraint:
 *
 *   1. `no_self_prerequisite` below is a DATABASE CHECK. A course requiring
 *      itself is the degenerate 1-cycle and it is unrepresentable — no code
 *      path, no migration backfill, and no hand-written `INSERT` can create it.
 *
 *   2. Longer cycles (A->B->A) cannot be expressed as a single-row constraint,
 *      so they are prevented in `insertPrerequisite`
 *      (src/lib/prerequisites/store.ts), which takes a Postgres ADVISORY LOCK,
 *      re-reads every edge inside the same transaction, and refuses the insert
 *      if `wouldCreateCycle` says yes. The lock is what makes it prevention
 *      rather than a race: two admins adding A->B and B->A in the same instant
 *      would otherwise both pass a check made before either wrote.
 *
 *   3. `findCycle` runs on the admin page as a tripwire, and every traversal in
 *      `src/lib/prerequisites/graph.ts` carries a visited set, so even a cycle
 *      that arrived by some route nobody anticipated (a restored dump, a manual
 *      `INSERT` by a DBA) is reported to an admin and cannot hang a student's
 *      page in an infinite walk.
 *
 * All three are unit-tested in src/lib/prerequisites/graph.test.ts.
 * ---------------------------------------------------------------------------
 *
 * `min_score` is NULLABLE and null means "access to the prerequisite course is
 * enough". A number means "and at or above this percentage". It is capped 0..100
 * at the database rather than only in the form, for the same reason
 * `course_access_requests.message` is length-capped there: a server action is a
 * plain HTTP POST target and no client-side attribute protects it.
 */
export const coursePrerequisites = pgTable(
  "course_prerequisites",
  {
    id: serial("id").primaryKey(),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    prerequisiteCourseId: integer("prerequisite_course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    /** 0..100, or null for "having the course is enough". See the note above. */
    minScore: integer("min_score"),
    /**
     * Who added the rule. `set null` on user deletion, not cascade: deleting a
     * departed admin's account must not silently delete the curriculum rules
     * they authored — that would open courses nobody decided to open. Same call
     * `course_access_requests.decided_by` makes at schema.access.ts:128.
     */
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * One edge per pair. Without this, "A requires B" could be stored twice with
     * different `min_score` values and the evaluation would depend on row order
     * — two rules, one of which is invisible.
     */
    edgeIdx: uniqueIndex("course_prerequisites_edge_idx").on(t.courseId, t.prerequisiteCourseId),
    /** The hot read: "what does course X require", once per gated course page. */
    courseIdx: index("course_prerequisites_course_idx").on(t.courseId),
    /** Layer 1 of the cycle defence — see the docstring. */
    noSelfPrerequisite: check(
      "course_prerequisites_no_self",
      sql`${t.courseId} <> ${t.prerequisiteCourseId}`,
    ),
    /** A negative or >100 threshold is unsatisfiable or always satisfied. */
    minScoreRange: check(
      "course_prerequisites_min_score_range",
      sql`${t.minScore} IS NULL OR (${t.minScore} >= 0 AND ${t.minScore} <= 100)`,
    ),
  }),
);

/**
 * AN ADMIN'S EXPLICIT EXCEPTION for one student and one course.
 *
 * `reason` is NOT NULL, and that is the whole feature. An override with no
 * stated reason is indistinguishable from a bug in the gate six months later,
 * and requirement 4 of this feature is that the override is visible rather than
 * silent. The admin console lists every active override with its reason, its
 * author and its date, and the STUDENT is told on the course page that they are
 * in on an override rather than on merit — a student who believes they satisfied
 * a prerequisite they did not is a student who will be surprised by the next
 * course.
 *
 * `unmet_at_grant` snapshots what was actually unmet at the moment of the grant,
 * as human-readable text. It is a RECORD, never re-evaluated and never consulted
 * by the gate: the live evaluation is always recomputed from the current rules.
 * It exists so an auditor can answer "what did this admin actually wave through"
 * after the prerequisite rules have since changed, which the live evaluation can
 * no longer answer.
 *
 * REVOKED ROWS ARE KEPT, never deleted — the same rule
 * `course_access_requests` follows for a rejection (schema.access.ts:99). The
 * PARTIAL unique index below means at most one LIVE override per (student,
 * course) while the history of granted-then-revoked overrides survives intact.
 */
export const coursePrerequisiteOverrides = pgTable(
  "course_prerequisite_overrides",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    /** Required. See the docstring — an unexplained override is a silent one. */
    reason: varchar("reason", { length: 500 }).notNull(),
    /** Text snapshot of the unmet prerequisites at grant time. Audit only. */
    unmetAtGrant: varchar("unmet_at_grant", { length: 1000 }),
    grantedBy: integer("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null while the override is live. Set, never deleted, on revocation. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => ({
    /**
     * PARTIAL unique index: at most one LIVE override per (student, course).
     * A plain unique index would make a revoked row block ever granting another
     * one, so the only way to re-grant would be to delete the audit record.
     */
    liveIdx: uniqueIndex("course_prerequisite_overrides_live_idx")
      .on(t.studentId, t.courseId)
      .where(sql`revoked_at IS NULL`),
    /** The gate's read: one student, one course. */
    studentCourseIdx: index("course_prerequisite_overrides_student_course_idx").on(
      t.studentId,
      t.courseId,
    ),
    /** The admin console's read: every live override, newest first. */
    grantedAtIdx: index("course_prerequisite_overrides_granted_at_idx").on(t.grantedAt),
  }),
);

export type CoursePrerequisite = typeof coursePrerequisites.$inferSelect;
export type NewCoursePrerequisite = typeof coursePrerequisites.$inferInsert;
export type CoursePrerequisiteOverride = typeof coursePrerequisiteOverrides.$inferSelect;
export type NewCoursePrerequisiteOverride = typeof coursePrerequisiteOverrides.$inferInsert;
