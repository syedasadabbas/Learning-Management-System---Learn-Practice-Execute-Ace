// =============================================================================
// SEED — a prerequisite chain so the gate can be tested end to end.
// -----------------------------------------------------------------------------
//   npx tsx scripts/seed-prerequisites.ts
//
// Owner: prerequisites stream (feature 8).
//
// PRECONDITION: `npx tsx scripts/seed-course-access.ts` must have run first. This
// script requires the two extra courses that one creates, because the shared seed
// (scripts/seed.ts) is single-course and a prerequisite needs two courses to exist.
// It refuses by name rather than creating them itself: courses are that script's
// fixture, and two scripts creating the same rows by title is how they drift.
//
// WHY THIS IS A SEPARATE SCRIPT RATHER THAN AN EDIT TO scripts/seed.ts
//
// Exactly the reason scripts/seed-course-access.ts:8 gives. `seed.ts` is shared by
// every stream's e2e suite; adding a prerequisite there would change the baseline
// those suites were written against — and a prerequisite is a GATE, so the change
// would show up as other streams' students being refused a course.
//
// WHAT IT CREATES, and why this shape:
//
//   "Data Engineering Foundations"  requires  "Advanced React Patterns"
//
// Both are extra (non-active) courses, and the demo student has an approved request
// for NEITHER by default. That gives the spec the two states it needs:
//   * the requirement is unmet -> the Request button is withheld and the reason is
//     named on /courses, and a direct GET of /courses/<id> is refused at 200;
//   * an admin grants an override -> the same URL renders the course WITH a visible
//     "admitted by override" notice.
//
// IT DOES NOT PUT A PREREQUISITE ON THE ACTIVE COURSE, and must never be changed to.
// The active course is open to every signed-in student by design
// (src/lib/courses/policy.ts:36) and a rule against it is inert — a spec asserting a
// refusal there would be asserting a bug.
//
// IDEMPOTENT, and it RESETS. Rules and overrides for these courses are deleted
// first: the spec drives an unmet -> overridden transition, and an override is
// one-per-(student, course) while live, so without a reset a second run of the suite
// would start from "already overridden" and the transition under test would never
// occur. Same reasoning, same shape, as seed-course-access.ts.
//
// TOUCHES ONLY `course_prerequisites` and `course_prerequisite_overrides`, and only
// rows pointing at the two extra courses. It writes no access requests, takes no
// quiz, and does not touch the cohort's own course — so no other stream's week,
// lock, progress or enrolment assertions are affected.
// =============================================================================

import "dotenv/config";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "../src/db";
import { courses, users } from "../src/db/schema";
import {
  coursePrerequisites,
  coursePrerequisiteOverrides,
} from "../src/db/schema.prerequisites";

/** Titles must match scripts/seed-course-access.ts EXTRA_COURSES. */
const PREREQUISITE_TITLE = "Advanced React Patterns";
const GATED_TITLE = "Data Engineering Foundations";

async function courseIdByTitle(title: string): Promise<number | null> {
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.title, title))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function main(): Promise<void> {
  const [prerequisiteId, gatedId] = await Promise.all([
    courseIdByTitle(PREREQUISITE_TITLE),
    courseIdByTitle(GATED_TITLE),
  ]);

  if (prerequisiteId == null || gatedId == null) {
    throw new Error(
      "The extra courses are missing. Run `npx tsx scripts/seed-course-access.ts` first.",
    );
  }

  // The check that protects every other stream. If either extra course had become
  // the lowest-id course, it would be the ACTIVE course — open to everyone — and a
  // prerequisite on it would be inert, so the spec would assert a refusal that can
  // never happen.
  const active = await db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .orderBy(asc(courses.id))
    .limit(1);
  if (active[0] && (active[0].id === gatedId || active[0].id === prerequisiteId)) {
    throw new Error(
      `Aborting: "${active[0].title}" is the ACTIVE course, which is open to every student by design. A prerequisite on it would not gate anything.`,
    );
  }

  const clearedRules = await db
    .delete(coursePrerequisites)
    .where(inArray(coursePrerequisites.courseId, [gatedId, prerequisiteId]))
    .returning({ id: coursePrerequisites.id });

  const clearedOverrides = await db
    .delete(coursePrerequisiteOverrides)
    .where(inArray(coursePrerequisiteOverrides.courseId, [gatedId, prerequisiteId]))
    .returning({ id: coursePrerequisiteOverrides.id });

  // Deleted rather than revoked, unlike the application path. This is a test
  // fixture reset, not an audit event: a revoked row would leave the "Revoked"
  // section of the admin console growing by one on every suite run, and the spec
  // asserting a count there would drift.
  console.log(
    `cleared ${clearedRules.length} rule(s) and ${clearedOverrides.length} override(s)`,
  );

  const admin = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);

  await db.insert(coursePrerequisites).values({
    courseId: gatedId,
    prerequisiteCourseId: prerequisiteId,
    // NULL, not a number: enrolment in the prerequisite is the requirement. A
    // minScore here would be unsatisfiable for these courses — neither has weeks or
    // quizzes, so no score can be computed for them, and the evaluation would
    // correctly report `score_unknown`, which is a misconfiguration and not the
    // state a happy-path spec should be built on.
    minScore: null,
    createdBy: admin[0]?.id ?? null,
  });

  console.log(
    `"${GATED_TITLE}" (id ${gatedId}) now requires "${PREREQUISITE_TITLE}" (id ${prerequisiteId})`,
  );

  const check = await db
    .select({ id: coursePrerequisites.id })
    .from(coursePrerequisites)
    .where(
      and(
        eq(coursePrerequisites.courseId, gatedId),
        eq(coursePrerequisites.prerequisiteCourseId, prerequisiteId),
      ),
    );
  if (check.length !== 1) {
    throw new Error(`expected exactly one rule, found ${check.length}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
