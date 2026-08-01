// =============================================================================
// PERSISTENCE — the only file in this stream that talks to the database.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// SPLIT FOR THE SAME REASON src/lib/courses/store.ts:1 IS: the rules stay
// unit-testable without a database, and every read that could return one
// student's row to another takes the student id and puts it in the WHERE clause.
// `getLiveOverride` is the only student-scoped read here and it takes both ids;
// there is no read-by-override-id on any student-facing path.
//
// PERFORMANCE. docs/SUBJECT_SECTIONS.md's appendix measures a Neon round trip at
// ~245 ms warm and concludes that a page's SEQUENTIAL DEPTH is the only number
// that matters — query complexity is free by comparison. Two consequences are
// visible below:
//
//   * `getRequirements` joins `course_prerequisites` to `courses` for the titles
//     in ONE statement rather than "read the edges, then read the titles". A
//     student-facing gate must not pay a forced serial pair.
//   * ./gate.ts issues the requirement read, the access read and the override
//     read CONCURRENTLY, because none depends on another's result.
//
// The cost of a prerequisite on the course page is therefore ONE extra round
// trip of depth, not one per prerequisite. Stated because the alternative — a
// per-requirement query — is the obvious implementation and it is 1 + n trips.
// =============================================================================

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { courses, users } from "@/db/schema";
import { courseAccessRequests } from "@/db/schema.access";
import {
  coursePrerequisites,
  coursePrerequisiteOverrides,
} from "@/db/schema.prerequisites";

import type { PrerequisiteEdge } from "./graph";
import type { PrerequisiteRequirement } from "./policy";

/**
 * The advisory-lock key that serialises prerequisite writes.
 *
 * An ARBITRARY BUT FIXED 32-bit integer. Postgres advisory locks are a global
 * namespace shared by the whole database, so the number must be stable (or the
 * lock protects nothing) and must not collide with another feature's key (or two
 * unrelated features serialise against each other). Nothing else in this repo
 * takes an advisory lock today — `grep -r pg_advisory` finds only this file — so
 * this is the first entry in that namespace. A future stream adding one should
 * pick a different constant and record it next to this one.
 */
const PREREQUISITE_WRITE_LOCK = 84711230;

// ---------------------------------------------------------------------------
// Reads — the graph
// ---------------------------------------------------------------------------

/**
 * EVERY edge in the graph, two columns only.
 *
 * The whole graph, not the subtree of one course, because cycle detection is a
 * property of the whole graph and `findCycle` cannot be asked about a subtree.
 * This is cheap by design: two integers per rule, and rules are authored by
 * admins at human speed — a course catalogue of a few hundred with a handful of
 * edges each is kilobytes. If it ever is not, the fix is to bound the walk, not
 * to check cycles against a partial graph, which would not be checking them.
 */
export async function listEdges(): Promise<PrerequisiteEdge[]> {
  return db
    .select({
      courseId: coursePrerequisites.courseId,
      prerequisiteCourseId: coursePrerequisites.prerequisiteCourseId,
    })
    .from(coursePrerequisites);
}

export interface RuleRow {
  id: number;
  courseId: number;
  courseTitle: string;
  prerequisiteCourseId: number;
  prerequisiteTitle: string;
  minScore: number | null;
  createdAt: Date;
  createdByName: string | null;
}

/**
 * Every rule with both course titles and its author, for the admin console.
 *
 * ADMIN-ONLY BY CALLER. Nothing here is student-scoped, so the page that calls it
 * must have passed `requireRole("admin")` first — named for the surface it serves
 * so a call from a student page reads as obviously wrong, the same convention
 * `listRequestQueue` (src/lib/courses/store.ts:203) documents.
 *
 * `courses` is joined TWICE under two aliases. Drizzle needs an explicit `.as()`
 * subquery for the second, because the same table object cannot appear twice in
 * one statement without one of the two references being ambiguous.
 */
export async function listRules(): Promise<RuleRow[]> {
  const prereq = db.select({ id: courses.id, title: courses.title }).from(courses).as("prereq");
  const author = db.select({ id: users.id, name: users.name }).from(users).as("author");

  const rows = await db
    .select({
      id: coursePrerequisites.id,
      courseId: coursePrerequisites.courseId,
      courseTitle: courses.title,
      prerequisiteCourseId: coursePrerequisites.prerequisiteCourseId,
      prerequisiteTitle: prereq.title,
      minScore: coursePrerequisites.minScore,
      createdAt: coursePrerequisites.createdAt,
      createdByName: author.name,
    })
    .from(coursePrerequisites)
    .innerJoin(courses, eq(courses.id, coursePrerequisites.courseId))
    .innerJoin(prereq, eq(prereq.id, coursePrerequisites.prerequisiteCourseId))
    .leftJoin(author, eq(author.id, coursePrerequisites.createdBy))
    .orderBy(asc(coursePrerequisites.courseId), asc(coursePrerequisites.prerequisiteCourseId));

  return rows;
}

/**
 * The IMMEDIATE prerequisites of one course, with titles, in one statement.
 *
 * Immediate and not transitive — see `evaluatePrerequisites`'s docstring for why
 * the closure is for display and not for gating.
 *
 * Returns `[]` for a bad id rather than issuing a query that cannot match, and
 * `[]` is also the answer for a course with no rules, which is every course until
 * an admin says otherwise. Those two cases are indistinguishable here and that is
 * fine: `decideCourseAccess` has already established whether the course exists.
 */
export async function getRequirements(courseId: number): Promise<PrerequisiteRequirement[]> {
  if (!Number.isInteger(courseId) || courseId <= 0) return [];
  return db
    .select({
      prerequisiteCourseId: coursePrerequisites.prerequisiteCourseId,
      prerequisiteTitle: courses.title,
      minScore: coursePrerequisites.minScore,
    })
    .from(coursePrerequisites)
    .innerJoin(courses, eq(courses.id, coursePrerequisites.prerequisiteCourseId))
    .where(eq(coursePrerequisites.courseId, courseId))
    .orderBy(asc(coursePrerequisites.prerequisiteCourseId));
}

/**
 * The immediate requirements of MANY courses, in ONE statement.
 *
 * The catalog's read. Calling `getRequirements` once per course would be 1 + n
 * round trips and the catalog lists every course in the database; against Neon
 * that is n x ~245 ms of pure latency for a page whose whole point is a list. One
 * statement plus a group-by in JavaScript is depth 1 whatever n is — the
 * conclusion docs/SUBJECT_SECTIONS.md's appendix reaches, applied.
 *
 * Courses with no rules are simply absent from the returned map; the caller treats
 * a missing entry as "unconstrained", which is the same answer an empty array
 * gives and avoids materialising a row per course.
 */
export async function getRequirementsForCourses(
  courseIds: readonly number[],
): Promise<Map<number, PrerequisiteRequirement[]>> {
  const wanted = courseIds.filter((id) => Number.isInteger(id) && id > 0);
  const out = new Map<number, PrerequisiteRequirement[]>();
  if (wanted.length === 0) return out;

  const rows = await db
    .select({
      courseId: coursePrerequisites.courseId,
      prerequisiteCourseId: coursePrerequisites.prerequisiteCourseId,
      prerequisiteTitle: courses.title,
      minScore: coursePrerequisites.minScore,
    })
    .from(coursePrerequisites)
    .innerJoin(courses, eq(courses.id, coursePrerequisites.prerequisiteCourseId))
    .where(inArray(coursePrerequisites.courseId, wanted))
    .orderBy(asc(coursePrerequisites.courseId), asc(coursePrerequisites.prerequisiteCourseId));

  for (const row of rows) {
    const list = out.get(row.courseId);
    const entry: PrerequisiteRequirement = {
      prerequisiteCourseId: row.prerequisiteCourseId,
      prerequisiteTitle: row.prerequisiteTitle,
      minScore: row.minScore,
    };
    if (list) list.push(entry);
    else out.set(row.courseId, [entry]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reads — access facts
// ---------------------------------------------------------------------------

/**
 * Which of `courseIds` this student holds an APPROVED request for.
 *
 * `status = 'approved'` IS the enrolment record — there is no second table, by
 * the explicit design recorded at src/db/schema.access.ts:79. This function
 * therefore reads the courses stream's table rather than mirroring it, and it is
 * the ONLY place this stream touches it. Mirroring "who is enrolled" into a table
 * of my own would create the two-sources-of-truth failure that schema decision
 * exists to avoid, in the dangerous direction: a prerequisite satisfied by a
 * stale mirror row is a student admitted to a course they were never approved for.
 *
 * Takes the student id and filters on it. There is no shape of call that returns
 * another student's approvals.
 */
export async function listApprovedCourseIds(
  studentId: number,
  courseIds: readonly number[],
): Promise<number[]> {
  if (!Number.isInteger(studentId) || studentId <= 0) return [];
  if (courseIds.length === 0) return [];
  const rows = await db
    .select({ courseId: courseAccessRequests.courseId })
    .from(courseAccessRequests)
    .where(
      and(
        eq(courseAccessRequests.studentId, studentId),
        eq(courseAccessRequests.status, "approved"),
        inArray(courseAccessRequests.courseId, [...courseIds]),
      ),
    );
  return rows.map((r) => r.courseId);
}

/**
 * How many students are currently APPROVED for a course.
 *
 * Shown on the admin page next to a proposed rule, because the honest cost of
 * enforcing prerequisites at read time (see policy.ts's header) is that a new
 * rule can refuse students who already have access. An admin about to add one is
 * told how many people that is BEFORE they save. A consequence disclosed after
 * the fact is a post-mortem, not a control.
 */
export async function countApprovedStudents(courseId: number): Promise<number> {
  if (!Number.isInteger(courseId) || courseId <= 0) return 0;
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(courseAccessRequests)
    .where(
      and(
        eq(courseAccessRequests.courseId, courseId),
        eq(courseAccessRequests.status, "approved"),
      ),
    );
  return rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Reads — overrides
// ---------------------------------------------------------------------------

export interface LiveOverrideRow {
  id: number;
  reason: string;
  grantedAt: Date;
  grantedByName: string | null;
}

/**
 * The LIVE override for one (student, course), or null.
 *
 * `revoked_at IS NULL` is the liveness test, matching the partial unique index in
 * src/db/schema.prerequisites.ts — so this can return at most one row by
 * construction rather than by the `limit(1)` below, which is belt to that brace.
 *
 * Takes both ids and filters on both: it cannot be called in a way that returns
 * another student's override. Same property `getOwnRequest`
 * (src/lib/courses/store.ts:152) is built to have.
 */
export async function getLiveOverride(
  studentId: number,
  courseId: number,
): Promise<LiveOverrideRow | null> {
  if (!Number.isInteger(studentId) || studentId <= 0) return null;
  if (!Number.isInteger(courseId) || courseId <= 0) return null;

  const granter = db.select({ id: users.id, name: users.name }).from(users).as("granter");

  const rows = await db
    .select({
      id: coursePrerequisiteOverrides.id,
      reason: coursePrerequisiteOverrides.reason,
      grantedAt: coursePrerequisiteOverrides.grantedAt,
      grantedByName: granter.name,
    })
    .from(coursePrerequisiteOverrides)
    .leftJoin(granter, eq(granter.id, coursePrerequisiteOverrides.grantedBy))
    .where(
      and(
        eq(coursePrerequisiteOverrides.studentId, studentId),
        eq(coursePrerequisiteOverrides.courseId, courseId),
        isNull(coursePrerequisiteOverrides.revokedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Every LIVE override this student holds, keyed by course id.
 *
 * The catalog's read, for the same 1-vs-n reason `getRequirementsForCourses`
 * exists. Student-scoped: the id is in the WHERE clause, so there is no call shape
 * that returns another student's overrides.
 */
export async function listLiveOverridesForStudent(
  studentId: number,
): Promise<Map<number, LiveOverrideRow>> {
  const out = new Map<number, LiveOverrideRow>();
  if (!Number.isInteger(studentId) || studentId <= 0) return out;

  const granter = db.select({ id: users.id, name: users.name }).from(users).as("granter");

  const rows = await db
    .select({
      id: coursePrerequisiteOverrides.id,
      courseId: coursePrerequisiteOverrides.courseId,
      reason: coursePrerequisiteOverrides.reason,
      grantedAt: coursePrerequisiteOverrides.grantedAt,
      grantedByName: granter.name,
    })
    .from(coursePrerequisiteOverrides)
    .leftJoin(granter, eq(granter.id, coursePrerequisiteOverrides.grantedBy))
    .where(
      and(
        eq(coursePrerequisiteOverrides.studentId, studentId),
        isNull(coursePrerequisiteOverrides.revokedAt),
      ),
    );

  for (const row of rows) {
    out.set(row.courseId, {
      id: row.id,
      reason: row.reason,
      grantedAt: row.grantedAt,
      grantedByName: row.grantedByName,
    });
  }
  return out;
}

/**
 * EVERY course this student holds an approved request for.
 *
 * The unbounded sibling of `listApprovedCourseIds`, for the catalog: the caller
 * needs the whole set anyway, so passing a list of ids would only make the
 * statement longer. Student-scoped, same as its sibling.
 */
export async function listAllApprovedCourseIds(studentId: number): Promise<number[]> {
  if (!Number.isInteger(studentId) || studentId <= 0) return [];
  const rows = await db
    .select({ courseId: courseAccessRequests.courseId })
    .from(courseAccessRequests)
    .where(
      and(
        eq(courseAccessRequests.studentId, studentId),
        eq(courseAccessRequests.status, "approved"),
      ),
    );
  return rows.map((r) => r.courseId);
}

export interface OverrideAuditRow {
  id: number;
  studentId: number;
  studentName: string;
  studentEmail: string;
  courseId: number;
  courseTitle: string;
  reason: string;
  unmetAtGrant: string | null;
  grantedAt: Date;
  grantedByName: string | null;
  revokedAt: Date | null;
  revokedByName: string | null;
}

/**
 * Every override, live and revoked, for the admin console.
 *
 * ADMIN-ONLY BY CALLER — this is the one read in the file that crosses students,
 * and nothing in it is student-scoped.
 *
 * THIS QUERY IS THE "VISIBLE, NOT SILENT" REQUIREMENT. Live overrides sort first
 * (`revoked_at IS NULL` sorts to 0) so the exceptions currently in force are at
 * the top and the history below them cannot push them off the screen — the same
 * ordering rationale `listRequestQueue` (src/lib/courses/store.ts:200) gives for
 * pending requests.
 */
export async function listOverrides(): Promise<OverrideAuditRow[]> {
  const granter = db.select({ id: users.id, name: users.name }).from(users).as("granter");
  const revoker = db.select({ id: users.id, name: users.name }).from(users).as("revoker");

  const rows = await db
    .select({
      id: coursePrerequisiteOverrides.id,
      studentId: coursePrerequisiteOverrides.studentId,
      studentName: users.name,
      studentEmail: users.email,
      courseId: coursePrerequisiteOverrides.courseId,
      courseTitle: courses.title,
      reason: coursePrerequisiteOverrides.reason,
      unmetAtGrant: coursePrerequisiteOverrides.unmetAtGrant,
      grantedAt: coursePrerequisiteOverrides.grantedAt,
      grantedByName: granter.name,
      revokedAt: coursePrerequisiteOverrides.revokedAt,
      revokedByName: revoker.name,
    })
    .from(coursePrerequisiteOverrides)
    .innerJoin(users, eq(users.id, coursePrerequisiteOverrides.studentId))
    .innerJoin(courses, eq(courses.id, coursePrerequisiteOverrides.courseId))
    .leftJoin(granter, eq(granter.id, coursePrerequisiteOverrides.grantedBy))
    .leftJoin(revoker, eq(revoker.id, coursePrerequisiteOverrides.revokedBy))
    .orderBy(
      sql`CASE WHEN ${coursePrerequisiteOverrides.revokedAt} IS NULL THEN 0 ELSE 1 END`,
      desc(coursePrerequisiteOverrides.grantedAt),
      desc(coursePrerequisiteOverrides.id),
    );

  return rows;
}

// ---------------------------------------------------------------------------
// Reads — existence
// ---------------------------------------------------------------------------

export interface CourseNameRow {
  id: number;
  title: string;
}

/** Every course, id and title only, for the admin selectors. ADMIN-ONLY BY CALLER. */
export async function listCourseNames(): Promise<CourseNameRow[]> {
  return db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .orderBy(asc(courses.id));
}

/**
 * Which of `ids` exist in `courses`.
 *
 * Returned as a Set of the ones that DO, so a caller can prove existence rather
 * than infer it. `validateNewPrerequisite` takes `courseExists` /
 * `prerequisiteExists` booleans and never derives them from the ids — an id that
 * parses is not an id that exists.
 */
export async function existingCourseIds(ids: readonly number[]): Promise<Set<number>> {
  const wanted = ids.filter((id) => Number.isInteger(id) && id > 0);
  if (wanted.length === 0) return new Set();
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(inArray(courses.id, wanted));
  return new Set(rows.map((r) => r.id));
}

/** Does this user id exist, and is it a student? ADMIN-ONLY BY CALLER. */
export async function getStudentSummary(
  studentId: number,
): Promise<{ id: number; name: string; email: string; role: string } | null> {
  if (!Number.isInteger(studentId) || studentId <= 0) return null;
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, studentId))
    .limit(1);
  return rows[0] ?? null;
}

/** Students only, for the override form's picker. ADMIN-ONLY BY CALLER. */
export async function listStudents(): Promise<
  Array<{ id: number; name: string; email: string }>
> {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.role, "student"))
    .orderBy(asc(users.name));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type InsertRuleOutcome =
  | { ok: true; id: number }
  | { ok: false; refusal: "cycle" | "duplicate" };

/**
 * Insert one rule, ATOMICALLY with the cycle check.
 *
 * ===========================================================================
 * THIS FUNCTION IS WHY CYCLES ARE PREVENTED RATHER THAN MERELY DETECTED.
 * ===========================================================================
 *
 * `validateNewPrerequisite` in ./policy.ts already refused the obvious cases, but
 * it decided against a SNAPSHOT of the edges read a round trip earlier — ~245 ms
 * of window (docs/SUBJECT_SECTIONS.md appendix). Two admins adding "A requires B"
 * and "B requires A" inside that window would BOTH pass, because neither snapshot
 * contained the other's row, and the database has no constraint that can see a
 * two-row cycle. The result is a pair of courses neither of which can ever be
 * entered, created by two people each of whom was told their edit was fine.
 *
 * So the write takes `pg_advisory_xact_lock` FIRST, then re-reads every edge
 * INSIDE the same transaction, then re-checks, then inserts. The lock is held
 * until the transaction commits, so the second admin's transaction waits, reads
 * the first admin's row, and is refused. This is the same reasoning
 * `decideRequest` (src/lib/courses/store.ts:346) applies with its compare-and-set
 * `WHERE status = 'pending'`; a check-then-act needs the act scoped to the state
 * the check was made against, and where no single row carries that state, a lock
 * is the way to scope it.
 *
 * WHY AN ADVISORY LOCK AND NOT `SERIALIZABLE`. The conflicting pair writes two
 * DIFFERENT rows and reads a table neither modifies in a way Postgres tracks as a
 * predicate conflict here; raising the isolation level would also force every
 * caller to handle serialisation failures with a retry loop. An advisory lock over
 * one short critical section, taken by the only writer of this table, is the
 * smaller and more legible mechanism. The cost: prerequisite writes are globally
 * serialised. They are authored by admins at human speed, so that cost is zero.
 *
 * The unique index still catches duplicates — the `23505` branch below — because a
 * duplicate is also possible in the same window and a constraint violation
 * reaching an admin as a raw error is a defect in its own right.
 */
export async function insertPrerequisite(input: {
  courseId: number;
  prerequisiteCourseId: number;
  minScore: number | null;
  createdBy: number;
  /** Re-checked inside the transaction. Injected so the tx body stays pure-ish. */
  wouldCycle: (edges: readonly PrerequisiteEdge[]) => boolean;
}): Promise<InsertRuleOutcome> {
  return db.transaction(async (tx) => {
    // Held until COMMIT. Every writer of this table takes the same key, so the
    // read-check-insert below is atomic with respect to other prerequisite edits.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PREREQUISITE_WRITE_LOCK})`);

    const edges = await tx
      .select({
        courseId: coursePrerequisites.courseId,
        prerequisiteCourseId: coursePrerequisites.prerequisiteCourseId,
      })
      .from(coursePrerequisites);

    if (
      edges.some(
        (e) =>
          e.courseId === input.courseId &&
          e.prerequisiteCourseId === input.prerequisiteCourseId,
      )
    ) {
      return { ok: false, refusal: "duplicate" } as const;
    }

    if (input.wouldCycle(edges)) {
      return { ok: false, refusal: "cycle" } as const;
    }

    const inserted = await tx
      .insert(coursePrerequisites)
      .values({
        courseId: input.courseId,
        prerequisiteCourseId: input.prerequisiteCourseId,
        minScore: input.minScore,
        createdBy: input.createdBy,
      })
      .returning({ id: coursePrerequisites.id });

    return { ok: true, id: inserted[0].id } as const;
  });
}

/**
 * Remove one rule by id.
 *
 * Returns false when nothing matched — two admins clearing the same rule is a
 * race with no consequence, but reporting "removed" for a row that was already
 * gone would tell the second admin they did something they did not.
 *
 * DELETED, not soft-deleted, unlike an override. The asymmetry is deliberate: an
 * override is a decision ABOUT A PERSON and its author is the audit record
 * (src/db/schema.access.ts:99 makes the same argument for a rejected request),
 * whereas a rule is CURRICULUM CONFIGURATION whose history is the git log of the
 * admin console's use, not a table. Keeping tombstoned rules would also mean every
 * read of the graph has to filter them, and a forgotten filter in a cycle check is
 * a cycle check that passes against rules that no longer apply.
 */
export async function deletePrerequisite(id: number): Promise<boolean> {
  if (!Number.isInteger(id) || id <= 0) return false;
  const deleted = await db
    .delete(coursePrerequisites)
    .where(eq(coursePrerequisites.id, id))
    .returning({ id: coursePrerequisites.id });
  return deleted.length > 0;
}

/**
 * Record an override.
 *
 * `unmetAtGrant` is the snapshot of what was actually unmet at this instant. It is
 * written once and never read by the gate — see the column's docstring in
 * src/db/schema.prerequisites.ts.
 *
 * Returns false on a unique-index violation, which means another admin granted a
 * live override for the same (student, course) in the window since
 * `canGrantOverride` was evaluated. Reporting that truthfully matters: the
 * override on file is not this admin's, and their stated reason is not the one
 * recorded.
 */
export async function grantOverride(input: {
  studentId: number;
  courseId: number;
  reason: string;
  unmetAtGrant: string;
  grantedBy: number;
}): Promise<boolean> {
  try {
    const inserted = await db
      .insert(coursePrerequisiteOverrides)
      .values({
        studentId: input.studentId,
        courseId: input.courseId,
        reason: input.reason,
        unmetAtGrant: input.unmetAtGrant,
        grantedBy: input.grantedBy,
      })
      .returning({ id: coursePrerequisiteOverrides.id });
    return inserted.length > 0;
  } catch (error) {
    // 23505 = unique_violation, i.e. the partial index caught a concurrent grant.
    // Any other error is a real fault and must not be swallowed into "false",
    // which the caller would report to an admin as a routine refusal.
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/**
 * Revoke a live override. The row is KEPT and stamped, never deleted.
 *
 * `WHERE revoked_at IS NULL` is a COMPARE-AND-SET, not a redundant filter: two
 * admins revoking the same override would otherwise both succeed and the second
 * would overwrite the first's name and timestamp, leaving the audit trail naming
 * the wrong person. Returns false for the loser so it is told.
 */
export async function revokeOverride(input: {
  overrideId: number;
  revokedBy: number;
}): Promise<boolean> {
  if (!Number.isInteger(input.overrideId) || input.overrideId <= 0) return false;
  const updated = await db
    .update(coursePrerequisiteOverrides)
    .set({ revokedAt: new Date(), revokedBy: input.revokedBy })
    .where(
      and(
        eq(coursePrerequisiteOverrides.id, input.overrideId),
        isNull(coursePrerequisiteOverrides.revokedAt),
      ),
    )
    .returning({ id: coursePrerequisiteOverrides.id });
  return updated.length > 0;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}
