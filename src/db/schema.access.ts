// =============================================================================
// COURSE ACCESS REQUESTS — schema module for the multi-course access stream.
// -----------------------------------------------------------------------------
// Owner: courses / access-requests stream.
//
// WHY THIS IS A SEPARATE FILE AND NOT AN APPEND TO src/db/schema.ts
//
// `src/db/schema.ts` is the frozen seam every stream compiles against, and it is
// being edited concurrently by other streams in this wave. A separate module
// that IMPORTS from it (one direction only — schema.ts does not import this
// file, so there is no cycle) adds the table without touching the hot file at
// all. `drizzle.config.ts` lists both paths, so `npm run db:generate` sees this
// table exactly as if it had been declared inline.
//
// The one thing this costs: `db.query.courseAccessRequests` is not available,
// because `src/db/index.ts` passes only `./schema` to `drizzle()`. Nothing here
// needs the relational query API — every read in `src/lib/courses/store.ts` uses
// the select builder, which takes the table object directly.
//
// -----------------------------------------------------------------------------
// WHY `courses` IS REUSED AND NO NEW COURSES TABLE WAS INTRODUCED
//
// A `courses` table already exists (src/db/schema.ts:128) with `weeks.course_id`
// as a NOT NULL foreign key to it (schema.ts:140). The schema has therefore been
// multi-course from Wave 0. What was missing was not a table — it was
//
//   (a) a way for the app to serve any course other than the first, and
//   (b) any per-course notion of enrolment at all.
//
// On (a): the app is implicitly single-course because `loadCourseAndWeeks` in
// `src/components/course/data.ts:156-177` selects `FROM courses ORDER BY id ASC
// LIMIT 1`. That file carries a standing TODO(shared-contracts) at line 123
// saying an explicit "active course" marker is needed if a second course is ever
// seeded. This stream does NOT own that file and has not changed it, so the
// lowest-id course remains THE course the existing /weeks surface serves.
//
// On (b): `users.cohort_id` is the only membership column in the schema, and a
// cohort is not a course — `cohorts` has no `course_id` and 50-80 students in one
// cohort could legitimately sit two courses. Reusing `cohorts` as the unit of
// course access would have overloaded a column the leaderboard, penalties and
// progress streams already read for a different meaning.
//
// So: one new table, holding the request AND its outcome.
// =============================================================================

import {
  pgTable,
  pgEnum,
  serial,
  integer,
  varchar,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

import { courses, users } from "./schema";

/**
 * The lifecycle of one student's bid for one course.
 *
 * Three states and no more. There is deliberately no "withdrawn" or "expired":
 * an admin decision is the only thing that moves a row off `pending`, so every
 * non-pending row has an accountable `decided_by`, and a student cannot clear
 * their own rejection by cancelling and re-filing under a fresh row (the unique
 * index below makes a second row impossible in the first place).
 *
 * Named `access_request_status` rather than `request_status` so it cannot
 * collide with a status enum another stream adds for a different kind of
 * request in the same database.
 */
export const accessRequestStatus = pgEnum("access_request_status", [
  "pending",
  "approved",
  "rejected",
]);

/**
 * ONE ROW PER (student, course) — the request and the enrolment are the same row.
 *
 * The obvious alternative was two tables: `course_access_requests` for the
 * workflow and `course_enrollments` for the resulting grant. That was rejected
 * because it creates two sources of truth for "may this student read this
 * course", and the failure mode is the dangerous direction: an approved request
 * whose matching enrolment row was never written (or was deleted) reads as
 * enrolled on the admin screen and as not-enrolled at the gate, or vice versa.
 * Enrolment here is DERIVED — `status = 'approved'` is the grant, and it is the
 * only thing `decideCourseAccess` in src/lib/courses/policy.ts consults. Same
 * reasoning as `src/lib/progress/unlock.ts`, which refuses to store a mirror of
 * a computed fact.
 *
 * Re-applying after a rejection UPDATEs this row back to `pending` rather than
 * inserting a second one. That is enforced by `studentCourseIdx`, not by
 * convention: without the unique index, two concurrent Request clicks — a
 * double-submit is one impatient student, not an exotic race — would leave two
 * pending rows, and approving one of them would leave the other pending forever
 * on the admin queue.
 *
 * A rejected row is KEPT, never deleted, for the same reason a rejected video is
 * kept in `topic_videos`: the decision, its author and its date are the audit
 * record, and deleting the row would erase the only evidence that an admin ever
 * looked at it.
 */
export const courseAccessRequests = pgTable(
  "course_access_requests",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    status: accessRequestStatus("status").notNull().default("pending"),
    /**
     * The student's own note ("I finished the HTML track elsewhere"). Optional,
     * and length-capped at the column rather than only in the form: the server
     * action is an HTTP POST target that a form validator does not protect.
     */
    message: varchar("message", { length: 500 }),
    /** The admin's reason, shown back to the student on a rejection. */
    decisionNote: varchar("decision_note", { length: 500 }),
    /**
     * Who decided, and when. `set null` on user deletion rather than cascade —
     * removing a departed admin's account must not silently delete the access
     * grants they issued, which would revoke live students mid-course.
     */
    decidedBy: integer("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** See the note above — this index IS the "one request per course" rule. */
    studentCourseIdx: uniqueIndex("course_access_requests_student_course_idx").on(
      t.studentId,
      t.courseId,
    ),
    /**
     * The admin queue reads `WHERE status = 'pending' ORDER BY created_at`, and
     * the student's catalog reads every row for one student. Two indexes because
     * the two access patterns share no leading column.
     */
    queueIdx: index("course_access_requests_status_idx").on(t.status, t.createdAt),
    studentIdx: index("course_access_requests_student_idx").on(t.studentId),
  }),
);

export type CourseAccessRequest = typeof courseAccessRequests.$inferSelect;
export type NewCourseAccessRequest = typeof courseAccessRequests.$inferInsert;

/** The enum as a value, for exhaustive switches. Mirrors the pgEnum above. */
export const ACCESS_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];
