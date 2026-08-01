// =============================================================================
// PERSISTENCE — the only file in this stream that talks to the database.
// -----------------------------------------------------------------------------
// Owner: courses / access-requests stream.
//
// THE PROPERTY THIS FILE EXISTS TO GUARANTEE: there is NO query here that can
// return one student's request row to another student. Every student-scoped read
// takes `studentId` and puts it in the WHERE clause; none of them takes a
// request id. The only read-by-id is `getRequestById`, which is called
// exclusively from the admin-guarded decision path and is documented as such.
// That is a stronger control than filtering in the caller, because a caller that
// forgets to filter is a bug that compiles.
//
// PERFORMANCE. docs/SUBJECT_SECTIONS.md measures a Neon round trip at ~245 ms
// warm, and the appendix's conclusion is that a page's SEQUENTIAL DEPTH is the
// only number that matters — query complexity is free by comparison. So the
// catalog read below is ONE statement joining courses to the caller's own
// request rows, not "list courses, then list my requests". `listCourseCatalog`
// is the only database call the /courses page makes.
// =============================================================================

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { courses, users, weeks } from "@/db/schema";
import { courseAccessRequests, type AccessRequestStatus } from "@/db/schema.access";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The id of the course the existing /weeks surface serves.
 *
 * MUST stay identical to `loadCourseAndWeeks`'s `ORDER BY id ASC LIMIT 1`
 * (src/components/course/data.ts:160). If these two ever disagree, the catalog
 * would mark one course "open" while /weeks served a different one, and a
 * student would be told they are enrolled in a course they cannot open.
 *
 * Not imported from that file because it exports only the whole course object
 * behind a React `cache()`, and this id is needed in server actions where no
 * request-scoped cache applies. Duplicating a four-word ORDER BY with this note
 * attached is the smaller evil; the real fix is the explicit active-course
 * marker that data.ts:123 already carries a TODO for.
 */
export async function getActiveCourseId(): Promise<number | null> {
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .orderBy(asc(courses.id))
    .limit(1);
  return rows[0]?.id ?? null;
}

export interface CatalogRow {
  id: number;
  title: string;
  description: string | null;
  durationWeeks: number;
  weekCount: number;
  /** The CALLING student's own request, or null. Never anyone else's. */
  requestStatus: AccessRequestStatus | null;
  requestedAt: Date | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

/**
 * Every course, each annotated with the CALLING student's own request state.
 *
 * LEFT JOIN on `(course_id, student_id)`, not a second query: the join predicate
 * carries the student id, so a row for another student is not filtered out
 * afterwards — it is never selected. There is no ordering of the results or
 * post-processing step that a future edit could drop and thereby leak a row.
 *
 * Courses are listed even when the student has no access, deliberately. A
 * catalog that hides what you cannot have gives you nothing to request, which is
 * the same argument `GET /api/courses` makes at its line 5 for returning locked
 * weeks. Course TITLES and descriptions are catalog copy, not course content;
 * the content itself is withheld by the gate on /courses/[courseId].
 */
export async function listCourseCatalog(studentId: number): Promise<CatalogRow[]> {
  const rows = await db
    .select({
      id: courses.id,
      title: courses.title,
      description: courses.description,
      durationWeeks: courses.durationWeeks,
      weekCount: sql<number>`(
        SELECT count(*)::int FROM weeks w WHERE w.course_id = ${courses.id}
      )`,
      requestStatus: courseAccessRequests.status,
      requestedAt: courseAccessRequests.createdAt,
      decidedAt: courseAccessRequests.decidedAt,
      decisionNote: courseAccessRequests.decisionNote,
    })
    .from(courses)
    .leftJoin(
      courseAccessRequests,
      and(
        eq(courseAccessRequests.courseId, courses.id),
        eq(courseAccessRequests.studentId, studentId),
      ),
    )
    .orderBy(asc(courses.id));

  return rows.map((r) => ({
    ...r,
    requestStatus: (r.requestStatus as AccessRequestStatus | null) ?? null,
  }));
}

export interface CourseRow {
  id: number;
  title: string;
  description: string | null;
  durationWeeks: number;
}

/** One course by id, or null. Existence only — never an access decision. */
export async function getCourse(courseId: number): Promise<CourseRow | null> {
  if (!Number.isInteger(courseId) || courseId <= 0) return null;
  const rows = await db
    .select({
      id: courses.id,
      title: courses.title,
      description: courses.description,
      durationWeeks: courses.durationWeeks,
    })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  return rows[0] ?? null;
}

export interface OwnRequest {
  id: number;
  status: AccessRequestStatus;
  message: string | null;
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

/**
 * The CALLER's own request for one course.
 *
 * Takes both ids and filters on both. It cannot be called in a way that returns
 * someone else's row, which is why the gate on /courses/[courseId] uses this
 * rather than a read-by-request-id.
 */
export async function getOwnRequest(
  studentId: number,
  courseId: number,
): Promise<OwnRequest | null> {
  const rows = await db
    .select({
      id: courseAccessRequests.id,
      status: courseAccessRequests.status,
      message: courseAccessRequests.message,
      decisionNote: courseAccessRequests.decisionNote,
      createdAt: courseAccessRequests.createdAt,
      decidedAt: courseAccessRequests.decidedAt,
    })
    .from(courseAccessRequests)
    .where(
      and(
        eq(courseAccessRequests.studentId, studentId),
        eq(courseAccessRequests.courseId, courseId),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? { ...row, status: row.status as AccessRequestStatus } : null;
}

export interface QueueRow {
  id: number;
  studentId: number;
  studentName: string;
  studentEmail: string;
  courseId: number;
  courseTitle: string;
  status: AccessRequestStatus;
  message: string | null;
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  deciderName: string | null;
}

/**
 * The admin queue. ADMIN-ONLY BY CALLER — this is the one read that crosses
 * students, and nothing in it is student-scoped, so the page that calls it must
 * have passed `requireRole("admin")` first. Named for the surface it serves so
 * that a call from a student page reads as obviously wrong.
 *
 * Pending first (`status = 'pending'` sorts to 0), then newest decision first,
 * so the queue an admin has to work is always at the top and the audit trail
 * below it does not push it off the screen.
 */
export async function listRequestQueue(): Promise<QueueRow[]> {
  const decider = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .as("decider");

  const rows = await db
    .select({
      id: courseAccessRequests.id,
      studentId: courseAccessRequests.studentId,
      studentName: users.name,
      studentEmail: users.email,
      courseId: courseAccessRequests.courseId,
      courseTitle: courses.title,
      status: courseAccessRequests.status,
      message: courseAccessRequests.message,
      decisionNote: courseAccessRequests.decisionNote,
      createdAt: courseAccessRequests.createdAt,
      decidedAt: courseAccessRequests.decidedAt,
      deciderName: decider.name,
    })
    .from(courseAccessRequests)
    .innerJoin(users, eq(users.id, courseAccessRequests.studentId))
    .innerJoin(courses, eq(courses.id, courseAccessRequests.courseId))
    .leftJoin(decider, eq(decider.id, courseAccessRequests.decidedBy))
    .orderBy(
      sql`CASE WHEN ${courseAccessRequests.status} = 'pending' THEN 0 ELSE 1 END`,
      asc(courseAccessRequests.createdAt),
      desc(courseAccessRequests.id),
    );

  return rows.map((r) => ({ ...r, status: r.status as AccessRequestStatus }));
}

export interface StatusCounts {
  pending: number;
  approved: number;
  rejected: number;
}

export async function countRequestsByStatus(): Promise<StatusCounts> {
  const rows = await db
    .select({ status: courseAccessRequests.status, count: sql<number>`count(*)::int` })
    .from(courseAccessRequests)
    .groupBy(courseAccessRequests.status);

  const counts: StatusCounts = { pending: 0, approved: 0, rejected: 0 };
  for (const row of rows) counts[row.status as AccessRequestStatus] = row.count;
  return counts;
}

/**
 * One request with its owner, for the DECISION path only.
 *
 * The only read-by-id in this file, and the only one that can return a row the
 * caller does not own. Both callers (`approveCourseAccessAction`,
 * `rejectCourseAccessAction`) call `requireCourseApprover()` BEFORE this and
 * `canDecideRequest()` immediately after — the decision needs the requester's id
 * to enforce the self-approval rule, so it cannot be made before the row is
 * read.
 */
export async function getRequestById(
  requestId: number,
): Promise<{ id: number; studentId: number; courseId: number; status: AccessRequestStatus } | null> {
  if (!Number.isInteger(requestId) || requestId <= 0) return null;
  const rows = await db
    .select({
      id: courseAccessRequests.id,
      studentId: courseAccessRequests.studentId,
      courseId: courseAccessRequests.courseId,
      status: courseAccessRequests.status,
    })
    .from(courseAccessRequests)
    .where(eq(courseAccessRequests.id, requestId))
    .limit(1);

  const row = rows[0];
  return row ? { ...row, status: row.status as AccessRequestStatus } : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * File or re-file a request. UPSERT on the unique `(student_id, course_id)`.
 *
 * THE UPSERT IS THE CONCURRENCY CONTROL, not a convenience. Two clicks of the
 * Request button — one impatient student, not an exotic race — would otherwise
 * insert two pending rows for the same course, and approving one would leave the
 * other pending on the admin queue forever with no way to clear it.
 *
 * `WHERE status <> 'approved'` on the conflict branch is the important part: a
 * student who already has access must not be able to reset their own row to
 * `pending` and thereby revoke themselves, and — more to the point — a re-file
 * must never be able to CLEAR an existing decision stamp on an approved row.
 * The reset of `decided_by`/`decided_at`/`decision_note` is correct for a
 * re-application after a rejection (the old decision no longer describes the
 * row) and wrong for anything else, so it is fenced to exactly that case.
 *
 * Returns false when the conflict branch matched nothing — i.e. the row was
 * already approved — so the caller reports "you already have access" rather than
 * claiming a request was filed.
 */
export async function upsertRequest(input: {
  studentId: number;
  courseId: number;
  message: string | null;
}): Promise<boolean> {
  const now = new Date();
  const inserted = await db
    .insert(courseAccessRequests)
    .values({
      studentId: input.studentId,
      courseId: input.courseId,
      message: input.message,
      // Explicit rather than relying on the column default: the one fact a
      // reader of this file must not have to look up is what state a new request
      // lands in. There is no code path in this stream that inserts `approved`.
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [courseAccessRequests.studentId, courseAccessRequests.courseId],
      set: {
        status: "pending",
        message: input.message,
        decisionNote: null,
        decidedBy: null,
        decidedAt: null,
        updatedAt: now,
      },
      setWhere: sql`${courseAccessRequests.status} <> 'approved'`,
    })
    .returning({ id: courseAccessRequests.id });

  return inserted.length > 0;
}

/**
 * Record a decision.
 *
 * `WHERE status = 'pending'` is a COMPARE-AND-SET, not a redundant filter. The
 * `canDecideRequest` check in the action read the status a round trip earlier
 * (~245 ms of window), so two admins clearing the same queue can both pass it.
 * Scoping the UPDATE to the state the decision was made against means the second
 * one changes zero rows and is told so, instead of silently overwriting the
 * first admin's decision and leaving `decided_by` naming the wrong person.
 *
 * The stamp is written for BOTH outcomes: who REFUSED a student is as much a
 * record as who admitted them.
 */
export async function decideRequest(input: {
  requestId: number;
  status: Extract<AccessRequestStatus, "approved" | "rejected">;
  deciderId: number;
  note: string | null;
}): Promise<boolean> {
  const updated = await db
    .update(courseAccessRequests)
    .set({
      status: input.status,
      decidedBy: input.deciderId,
      decidedAt: new Date(),
      decisionNote: input.note,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(courseAccessRequests.id, input.requestId),
        eq(courseAccessRequests.status, "pending"),
      ),
    )
    .returning({ id: courseAccessRequests.id });

  return updated.length > 0;
}

export interface CourseWeekRow {
  id: number;
  weekNumber: number;
  title: string;
  description: string | null;
}

/**
 * The week outline of one course.
 *
 * A SEPARATE read from `loadCourseAndWeeks` in src/components/course/data.ts
 * because that one is hard-wired to the lowest-id course (`ORDER BY id ASC LIMIT
 * 1`) and cannot answer "the weeks of course 2". This returns TITLES ONLY — no
 * lecture rows, no content, no resources — so it is an outline of what a course
 * covers, not the course. The gated page calls it only after
 * `decideCourseAccess` has allowed the caller; it carries no gate of its own,
 * which is why it is named for the data and not for a permission.
 */
export async function listCourseWeeks(courseId: number): Promise<CourseWeekRow[]> {
  if (!Number.isInteger(courseId) || courseId <= 0) return [];
  return db
    .select({
      id: weeks.id,
      weekNumber: weeks.weekNumber,
      title: weeks.title,
      description: weeks.description,
    })
    .from(weeks)
    .where(eq(weeks.courseId, courseId))
    .orderBy(asc(weeks.weekNumber));
}
