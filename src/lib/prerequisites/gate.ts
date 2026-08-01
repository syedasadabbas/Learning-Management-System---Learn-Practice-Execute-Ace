// =============================================================================
// THE GATE COMPOSITION — facts from the database, verdict from the pure policy.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// This file is the seam between ./store.ts (SQL) and ./policy.ts (rules). It
// decides nothing itself: it gathers facts and hands them to
// `evaluatePrerequisites`, then hands THAT verdict to the courses stream's
// `decideCourseAccess`, which remains the single authority on course entry. The
// full argument for why prerequisites extend that policy instead of forming a
// fourth gate is in ./policy.ts's header.
//
// -----------------------------------------------------------------------------
// SERVER-SIDE, AND BEFORE ANY COURSE CONTENT IS READ.
//
// `src/middleware.ts:24` is explicit that middleware is "defence in depth, not the
// only defence — middleware covers path prefixes, and a page added under an
// unlisted prefix would slip through the matcher". The edge runtime also cannot
// query `course_prerequisites` at all (no `pg`), which is the same limitation the
// PROTECTED table already records for /courses at middleware.ts:72. So the real
// enforcement is here, called from inside the page, and
// /courses/[courseId]/page.tsx calls it BEFORE `listCourseWeeks` — the refusal
// happens with no course content read, which is the property that page's header
// documents at line 10 and which this stream preserves rather than relaxes.
//
// -----------------------------------------------------------------------------
// "LOCKED IS NOT MISSING." A prerequisite refusal renders at HTTP 200 with the
// reason named, exactly as a locked week renders a LockedNotice at 200 while a
// genuinely absent resource 404s. Nothing in this stream calls `notFound()`. The
// courses stream already argued this at /courses/[courseId]/page.tsx:15 ("a 404
// tells both of them the course does not exist, so the honest answer to 'did
// anyone look at my request?' becomes unreachable"), and it is even more true
// here: a 404 in place of "you still need Course B" destroys the only information
// the feature exists to deliver.
//
// -----------------------------------------------------------------------------
// COST: ONE EXTRA ROUND TRIP OF SEQUENTIAL DEPTH, and only on courses that have
// prerequisites. `getRequirements` is issued alone; the access/override/score
// reads then go out CONCURRENTLY because none depends on another. A course with no
// rules — every course until an admin authors one — short-circuits after the first
// read, so the common path costs one query, not four. Depth is the only number
// that matters against Neon (~245 ms per trip, docs/SUBJECT_SECTIONS.md appendix).
// =============================================================================

import { cache } from "react";

import { roleSatisfies } from "@/lib/guard";
import { isOpenCourse } from "@/lib/courses/policy";
import { getWeekProgress } from "@/lib/progress/read-model";
import { totalsFrom } from "@/lib/progress/aggregate";

import {
  evaluatePrerequisites,
  type PrerequisiteEvaluation,
  type PrerequisiteFact,
  type PrerequisiteRequirement,
} from "./policy";
import {
  getLiveOverride,
  getRequirements,
  getRequirementsForCourses,
  listAllApprovedCourseIds,
  listApprovedCourseIds,
  listLiveOverridesForStudent,
} from "./store";

export type { PrerequisiteEvaluation };

/** The verdict for a course with no rules. Allocation-free constant path. */
const UNCONSTRAINED: PrerequisiteEvaluation = Object.freeze({
  satisfied: true,
  unmet: [],
  override: null,
  overridden: false,
  unconstrained: true,
});

/**
 * Evaluate one student against one course's prerequisites.
 *
 * MEMOISED PER REQUEST (React `cache`), for the reason
 * src/components/course/data.ts:29 records for `getWeekList`: the catalog page
 * evaluates every course and the course page evaluates one, and in both cases the
 * page and the component tree below it want the same answer. The memo key is
 * (studentId, courseId, ...) and its lifetime is one request, so no student can
 * observe another's verdict and a freshly granted override is visible on the very
 * next request. It is NOT a cross-request cache: an access decision must never be
 * stale, the same reason `unstable_cache` is refused in the progress read model.
 *
 * @param role the caller's role. Staff are NOT short-circuited here — see below.
 */
export const evaluateCoursePrerequisites = cache(async function evaluateCoursePrerequisites(
  studentId: number,
  courseId: number,
  activeCourseId: number | null,
  role: string | null | undefined,
): Promise<PrerequisiteEvaluation> {
  if (!Number.isInteger(courseId) || courseId <= 0) return UNCONSTRAINED;

  // THE OPEN COURSE IS NEVER PREREQUISITE-GATED. `decideCourseAccess` returns
  // `allowed` on its `isOpenCourse` branch before it looks at the verdict, so
  // this early return changes no decision — it exists so the page does not pay
  // three round trips to compute a verdict that cannot matter, and so the
  // compatibility rule at src/lib/courses/policy.ts:36 is visible in this file
  // too. Gating the active course would silently revoke the course every existing
  // student is on, which is the exact mistake that rule was written to prevent.
  if (isOpenCourse(courseId, activeCourseId)) return UNCONSTRAINED;

  const requirements = await getRequirements(courseId);
  // The common path, and the reason installing this feature changes nobody's
  // access: no rule, one query, no verdict to combine.
  if (requirements.length === 0) return UNCONSTRAINED;

  const prerequisiteIds = requirements.map((r) => r.prerequisiteCourseId);
  const needsScore = requirements.some((r) => r.minScore != null);
  // The score aggregate resolves exactly ONE course (src/lib/progress/query.ts:148
  // picks the active course), so it is worth fetching only when the active course
  // is itself one of the prerequisites AND some rule states a threshold.
  const scoreIsRelevant =
    needsScore && activeCourseId != null && prerequisiteIds.includes(activeCourseId);

  // Concurrent: none of the three depends on another's result.
  const [approvedIds, override, activeCoursePercent] = await Promise.all([
    listApprovedCourseIds(studentId, prerequisiteIds),
    getLiveOverride(studentId, courseId),
    scoreIsRelevant ? activeCourseScore(studentId) : Promise.resolve(null),
  ]);

  const facts = buildFacts({
    prerequisiteIds,
    approvedIds,
    activeCourseId,
    activeCoursePercent,
    role,
  });

  return evaluatePrerequisites({
    requirements,
    facts,
    override: override
      ? {
          reason: override.reason,
          grantedByName: override.grantedByName,
          grantedAt: override.grantedAt.toISOString(),
        }
      : null,
  });
});

/**
 * Turn access rows into `PrerequisiteFact`s.
 *
 * Exported and pure so the fact-construction rule — especially the staff branch —
 * is unit-testable without a database. It is separated from the query for the same
 * reason `decideWeekGate` is separated from `gateWeek`
 * (src/components/course/data.ts:352).
 *
 * ---------------------------------------------------------------------------
 * "HAS ACCESS" MEANS THE SAME THING HERE AS IT DOES AT THE GATE, MINUS ONE TERM.
 *
 * It is `isOpenCourse(...) || approved request || staff`, which is
 * `decideCourseAccess` with its own prerequisite term removed. The removal is the
 * DELIBERATE STOP CONDITION, not an oversight:
 *
 *   * Recursing would be unbounded. Asking `decideCourseAccess` about the
 *     prerequisite course would consult THAT course's prerequisites, and so on. A
 *     cycle is prevented at write time, but a legitimate 40-deep chain would issue
 *     40 sequential round trips on a student's page — 10 seconds against Neon.
 *
 *   * It would also be WRONG, not merely slow. A student holding an approved
 *     enrolment in B satisfies "did B" whether or not a rule added to B LAST WEEK
 *     is still met. Re-litigating a completed course's entry conditions every time
 *     it is cited as a prerequisite would retroactively invalidate work already
 *     done. This is the same argument `evaluatePrerequisites` makes for checking
 *     immediate requirements rather than the transitive closure.
 *
 * STAFF SATISFY EVERY PREREQUISITE, because `roleSatisfies("instructor", role)` is
 * ["instructor","admin"] and `decideCourseAccess` admits staff to every course on
 * its own staff branch — so anything else would be a contradiction between the two
 * files. Note the LIMIT, stated rather than implied: this admits staff to the
 * COURSE. `gateWeek` still applies its section and progression locks to staff
 * exactly as docs/SUBJECT_SECTIONS.md:109 describes, and nothing here touches that.
 */
export function buildFacts(input: {
  prerequisiteIds: readonly number[];
  approvedIds: readonly number[];
  activeCourseId: number | null;
  /** The student's percentage in the active course, or null when not fetched. */
  activeCoursePercent: number | null;
  role: string | null | undefined;
}): PrerequisiteFact[] {
  const approved = new Set(input.approvedIds);
  const isStaff = roleSatisfies("instructor", input.role);

  return input.prerequisiteIds.map((courseId) => ({
    courseId,
    hasAccess:
      isStaff || isOpenCourse(courseId, input.activeCourseId) || approved.has(courseId),
    // Only the active course has weeks, quizzes and a progress aggregate today.
    // Every other course is honestly `null` — see PrerequisiteFact.scorePercent
    // for why null must not be coerced to 0.
    scorePercent:
      input.activeCourseId != null && courseId === input.activeCourseId
        ? input.activeCoursePercent
        : null,
  }));
}

/**
 * The student's course-wide percentage in the ACTIVE course.
 *
 * Reuses `getWeekProgress` + `totalsFrom` rather than computing anything: that
 * pair is what the dashboard shows (src/lib/progress/dashboard.ts:235), and a
 * second implementation would let a prerequisite message disagree with the number
 * on the student's own dashboard about whether they passed. `getWeekProgress` is
 * itself memoised per request, so a page that already rendered the dashboard pays
 * nothing for this call.
 *
 * Returns null for a student with no weeks resolved, which `evaluatePrerequisites`
 * reports as `score_unknown` rather than as a 0% failure.
 */
async function activeCourseScore(studentId: number): Promise<number | null> {
  const weeks = await getWeekProgress(studentId);
  if (weeks.length === 0) return null;
  return totalsFrom(weeks).percent;
}

/**
 * Evaluate MANY courses at once — the catalog's entry point.
 *
 * THREE ROUND TRIPS OF DEPTH 1, whatever the size of the catalog. Calling
 * `evaluateCoursePrerequisites` in a loop would be up to 4n statements at depth 2,
 * and the /courses page's own header (src/app/(app)/courses/page.tsx:18) makes a
 * point of doing the whole page in one trip — adding an n-query fan-out to it
 * would undo the thing that page was measured into. The three reads have no data
 * dependency on each other, so they are issued concurrently; the score read is a
 * fourth only when some rule actually states a threshold on the active course.
 *
 * Courses absent from the returned map are UNCONSTRAINED. The caller must treat a
 * missing entry as "satisfied", which is the fail-OPEN direction and is correct
 * here for one specific reason: this function is used to decide what to SHOW and
 * whether to offer the Request button, while the actual gate on
 * /courses/[courseId] calls `evaluateCoursePrerequisites` for the single course
 * and fails closed. A missing entry here can only ever show a student a button
 * that the server action then refuses.
 */
export async function evaluateCatalogPrerequisites(
  studentId: number,
  courseIds: readonly number[],
  activeCourseId: number | null,
  role: string | null | undefined,
): Promise<Map<number, PrerequisiteEvaluation>> {
  const out = new Map<number, PrerequisiteEvaluation>();
  // The open course is never prerequisite-gated (see the note in
  // `evaluateCoursePrerequisites`), so it is excluded from the requirement read
  // rather than evaluated and discarded.
  const gated = courseIds.filter((id) => !isOpenCourse(id, activeCourseId));
  if (gated.length === 0) return out;

  const requirementsByCourse = await getRequirementsForCourses(gated);
  if (requirementsByCourse.size === 0) return out;

  const needsActiveScore =
    activeCourseId != null &&
    [...requirementsByCourse.values()].some((reqs) =>
      reqs.some((r) => r.minScore != null && r.prerequisiteCourseId === activeCourseId),
    );

  const [approvedIds, overrides, activeCoursePercent] = await Promise.all([
    listAllApprovedCourseIds(studentId),
    listLiveOverridesForStudent(studentId),
    needsActiveScore ? activeCourseScore(studentId) : Promise.resolve(null),
  ]);

  for (const [courseId, requirements] of requirementsByCourse) {
    const override = overrides.get(courseId);
    out.set(
      courseId,
      evaluatePrerequisites({
        requirements,
        facts: buildFacts({
          prerequisiteIds: requirements.map((r) => r.prerequisiteCourseId),
          approvedIds,
          activeCourseId,
          activeCoursePercent,
          role,
        }),
        override: override
          ? {
              reason: override.reason,
              grantedByName: override.grantedByName,
              grantedAt: override.grantedAt.toISOString(),
            }
          : null,
      }),
    );
  }

  return out;
}

/**
 * The requirements of one course, for DISPLAY on a page that is not gating.
 *
 * Thin re-export so a page never has to import ./store directly and accidentally
 * pick up a write function. Requirements are catalog copy — "this course needs
 * that one" — by the same argument `listCourseCatalog`
 * (src/lib/courses/store.ts:78) makes for listing courses a student cannot open:
 * a requirement you cannot see is a requirement you cannot work towards.
 */
export async function describeRequirements(
  courseId: number,
): Promise<PrerequisiteRequirement[]> {
  return getRequirements(courseId);
}
