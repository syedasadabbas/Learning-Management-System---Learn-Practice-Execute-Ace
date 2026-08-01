// =============================================================================
// SEED — extra courses so the access-request flow can be tested end to end.
// -----------------------------------------------------------------------------
//   npx tsx scripts/seed-course-access.ts
//
// Owner: courses / access-requests stream.
//
// WHY THIS EXISTS AS A SEPARATE SCRIPT RATHER THAN AN EDIT TO scripts/seed.ts
//
// `scripts/seed.ts` is shared by every stream's e2e suite and is currently
// single-course by design: `loadCourseAndWeeks` in src/components/course/data.ts
// serves the LOWEST-ID course, and several streams' specs assert against exactly
// the four seeded weeks of that course. Adding rows to the shared seeder would
// change the baseline every one of those specs was written against. A separate,
// opt-in script leaves that baseline untouched.
//
// WHY ADDING THESE COURSES IS SAFE FOR THE OTHER STREAMS. Both rows get a HIGHER
// id than the seeded course, so `ORDER BY id ASC LIMIT 1` still returns the
// original one and /weeks, /api/courses, the dashboard and every lock derivation
// see exactly what they saw before. Neither extra course has weeks, lectures,
// quizzes or assignments, so nothing joins to them.
//
// IDEMPOTENT, and it RESETS. Lookup on the course title (the natural key, the
// same strategy scripts/seed.ts:6 uses), and it deletes any existing access
// requests for these two courses. The reset is the point: the e2e spec drives a
// pending -> approved transition, and a request row is one-per-(student,course),
// so without a reset a second run of the suite would start from "already
// approved" and the transition under test would never occur.
//
// It deletes ONLY rows pointing at these two courses. The cohort's own course is
// never requestable, so it can have no rows, and no other stream writes here.
// =============================================================================

import "dotenv/config";
import { asc, eq, inArray } from "drizzle-orm";

import { db } from "../src/db";
import { courses } from "../src/db/schema";
import { courseAccessRequests } from "../src/db/schema.access";

/**
 * Two extra courses, not one: the spec has to exercise BOTH decisions, and a
 * request row cannot be approved and then rejected — `decideRequest` is a
 * compare-and-set scoped to `status = 'pending'`, deliberately, so a settled row
 * stays settled. One course per outcome is the only way to test both in one run.
 */
export const EXTRA_COURSES = [
  {
    title: "Advanced React Patterns",
    description:
      "A second course used to exercise the access-request flow: request, admin approval, then access.",
    durationWeeks: 6,
  },
  {
    title: "Data Engineering Foundations",
    description:
      "A third course used to exercise the decline path: request, admin decline, then a visible refusal.",
    durationWeeks: 8,
  },
] as const;

async function main(): Promise<void> {
  const ids: number[] = [];

  for (const spec of EXTRA_COURSES) {
    const existing = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.title, spec.title))
      .limit(1);

    if (existing[0]) {
      ids.push(existing[0].id);
      console.log(`course "${spec.title}" exists (id ${existing[0].id})`);
      continue;
    }

    const inserted = await db
      .insert(courses)
      .values({
        title: spec.title,
        description: spec.description,
        durationWeeks: spec.durationWeeks,
      })
      .returning({ id: courses.id });

    ids.push(inserted[0].id);
    console.log(`course "${spec.title}" created (id ${inserted[0].id})`);
  }

  const cleared = await db
    .delete(courseAccessRequests)
    .where(inArray(courseAccessRequests.courseId, ids))
    .returning({ id: courseAccessRequests.id });
  console.log(`cleared ${cleared.length} access request(s) for the extra courses`);

  const active = await db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .orderBy(asc(courses.id))
    .limit(1);

  // Printed as a check, not as decoration: if the lowest-id course is ever one of
  // the two above, the whole "the cohort course stays open" property is broken
  // and every other stream's /weeks specs would be serving the wrong course.
  console.log(
    `active (open) course is still id ${active[0]?.id} "${active[0]?.title}" — extra courses: ${ids.join(", ")}`,
  );
  if (ids.includes(active[0]?.id ?? -1)) {
    throw new Error(
      "An extra course became the active course. Aborting: /weeks would now serve the wrong course.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
