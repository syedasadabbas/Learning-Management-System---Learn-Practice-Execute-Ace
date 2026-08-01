"use server";

// =============================================================================
// SERVER ACTIONS — author a prerequisite rule, grant or revoke an override.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// WHY ACTIONS AND NOT API ROUTES. `ROUTES` in `@/lib/contracts/api` is frozen and
// lists no prerequisite endpoint. Adding `POST /api/prerequisites` would create a
// path with no `ROUTE_AUTH` entry — the unguarded-by-omission bug that map exists
// to prevent, and the reason its own header calls an unlisted route a defeat of the
// compile-time check. Server actions keep the mutation inside the frozen contract
// while still being guarded. The same call the courses stream made
// (src/lib/courses/actions.ts:8) and the video-ingestion stream before it; making
// the opposite call here would leave two mutation styles for two halves of one
// access decision. NOTE this is a deviation from IMPLEMENTATION_ROADMAP.md, which
// assumes `src/app/api/**` routes for every feature — flagged in the stream report.
//
// EVERY EXPORT HERE IS AN HTTP-REACHABLE POST TARGET once Next.js compiles it. The
// first statement of each is `requirePrerequisiteAdmin()`; no exception, and any
// action added later must open the same way.
//
// NO ACTION TRUSTS A ROLE, AN ID OR A NUMBER FROM THE CLIENT. Course ids, student
// ids and the minimum score are all re-validated server-side, and existence is
// proven by reading the rows rather than inferred from the ids — an id that parses
// is not an id that exists.
//
// Actions return a typed result rather than throwing across the RSC boundary: a
// thrown error reaches the browser as a generic "unexpected response", which tells
// an admin nothing about whether the rule they just wrote is in force.
// =============================================================================

import { revalidatePath } from "next/cache";

import { PrerequisiteForbiddenError, requirePrerequisiteAdmin } from "./access";
import { wouldCreateCycle } from "./graph";
import {
  canGrantOverride,
  evaluatePrerequisites,
  // NOTE: `normaliseMinScore` is NOT imported here. `validateNewPrerequisite`
  // calls it internally and returns the normalised value on its `ok` branch, so
  // normalising again in this file would be a second place the raw form value is
  // interpreted — and the two could disagree about whether "" means 0 or null.
  normaliseOverrideReason,
  OVERRIDE_REFUSAL_MESSAGE,
  PREREQUISITE_REFUSAL_MESSAGE,
  summariseUnmet,
  validateNewPrerequisite,
} from "./policy";
import { buildFacts } from "./gate";
import {
  countApprovedStudents,
  deletePrerequisite,
  existingCourseIds,
  getLiveOverride,
  getRequirements,
  grantOverride,
  insertPrerequisite,
  listApprovedCourseIds,
  listEdges,
  revokeOverride,
  getStudentSummary,
} from "./store";
import { getActiveCourseId } from "@/lib/courses/store";
import { getWeekProgress } from "@/lib/progress/read-model";
import { totalsFrom } from "@/lib/progress/aggregate";

export type PrerequisiteActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function fail(error: string): PrerequisiteActionResult {
  return { ok: false, error };
}

function toFailure(error: unknown): PrerequisiteActionResult {
  if (error instanceof PrerequisiteForbiddenError) return fail(error.message);
  // A database error string in the browser is an information leak.
  console.error("[prerequisites] action failed", error);
  return fail("The change could not be saved. Please try again.");
}

function validId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Revalidate every surface a prerequisite change alters.
 *
 * `/courses` is where a student reads whether they may request a course and
 * `/courses/:id` is the gate itself, so BOTH must be re-rendered — without them a
 * newly authored rule would appear to do nothing until the route cache aged out,
 * and "the rule is saved but the student still got in" is indistinguishable from
 * "the gate is broken". Same argument src/lib/courses/actions.ts:72 makes for an
 * approval.
 */
function revalidate(courseId?: number): void {
  revalidatePath("/admin/prerequisites");
  revalidatePath("/courses");
  if (courseId != null) revalidatePath(`/courses/${courseId}`);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Record "courseId requires prerequisiteCourseId", optionally at a minimum score.
 *
 * FOUR LAYERS BETWEEN THE CLICK AND THE ROW, and the client can skip none:
 *   1. `requirePrerequisiteAdmin` — the role;
 *   2. `existingCourseIds` — both courses proven to exist by a read;
 *   3. `validateNewPrerequisite` — self-reference, score range, duplicate, cycle,
 *      against the edges as they are right now;
 *   4. `insertPrerequisite` — re-reads the edges under a Postgres advisory lock and
 *      re-checks the cycle inside the transaction, which is what makes (3) binding
 *      rather than advisory. See that function's header for the two-admin race it
 *      closes.
 *
 * On success the message states how many students are already approved for the
 * course, because a rule added to a course with live enrolments will refuse those
 * students until they satisfy it or an admin overrides. That consequence is real
 * (policy.ts's header states it in full) and telling the admin AFTER the fact is
 * the earliest honest moment — the number is also shown next to the course in the
 * console BEFORE they save.
 */
export async function addPrerequisiteAction(
  courseId: unknown,
  prerequisiteCourseId: unknown,
  minScore?: unknown,
): Promise<PrerequisiteActionResult> {
  try {
    const user = await requirePrerequisiteAdmin();

    const id = validId(courseId);
    const prereqId = validId(prerequisiteCourseId);
    if (!id || !prereqId) return fail(PREREQUISITE_REFUSAL_MESSAGE.invalid_course);

    // Concurrent: neither read depends on the other's result. At ~245 ms per Neon
    // round trip a serial chain here would cost half a second before the first
    // check ran.
    const [existing, edges] = await Promise.all([
      existingCourseIds([id, prereqId]),
      listEdges(),
    ]);

    const validated = validateNewPrerequisite({
      courseId: id,
      prerequisiteCourseId: prereqId,
      minScore,
      courseExists: existing.has(id),
      prerequisiteExists: existing.has(prereqId),
      existingEdges: edges,
    });
    if (!validated.ok) return fail(PREREQUISITE_REFUSAL_MESSAGE[validated.refusal]);

    const outcome = await insertPrerequisite({
      courseId: id,
      prerequisiteCourseId: prereqId,
      minScore: validated.minScore,
      createdBy: user.id,
      // The cycle rule is passed in rather than reimplemented inside the
      // transaction, so there is exactly ONE cycle rule in the codebase and the
      // pre-check and the in-transaction check cannot drift apart.
      wouldCycle: (fresh) =>
        wouldCreateCycle(fresh, { courseId: id, prerequisiteCourseId: prereqId }),
    });
    if (!outcome.ok) return fail(PREREQUISITE_REFUSAL_MESSAGE[outcome.refusal]);

    const affected = await countApprovedStudents(id);
    revalidate(id);
    return {
      ok: true,
      message:
        affected === 0
          ? "Prerequisite saved."
          : `Prerequisite saved. ${affected} student${affected === 1 ? "" : "s"} already approved for this course must now satisfy it or be granted an override.`,
    };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Remove one rule.
 *
 * Deleting a rule can only WIDEN access, so there is no cycle or consistency check
 * to make — a subgraph of a DAG is a DAG. Stated because its absence next to the
 * elaborate insert path otherwise reads as an omission.
 */
export async function removePrerequisiteAction(
  ruleId: unknown,
): Promise<PrerequisiteActionResult> {
  try {
    await requirePrerequisiteAdmin();
    const id = validId(ruleId);
    if (!id) return fail("That prerequisite no longer exists.");

    const removed = await deletePrerequisite(id);
    // Not an error the admin caused: another admin cleared it first. Reporting
    // "removed" for a row that was already gone would tell them they did something
    // they did not.
    if (!removed) return fail("That prerequisite no longer exists. Reload the page.");

    revalidate();
    return { ok: true, message: "Prerequisite removed." };
  } catch (error) {
    return toFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Overrides — REQUIREMENT 4: an admin may admit a student despite an unmet
// prerequisite, and the exception must be visible rather than silent.
// ---------------------------------------------------------------------------

/**
 * Grant one student an exception to one course's prerequisites.
 *
 * THE OVERRIDE IS EVALUATED, NOT ASSERTED. The action recomputes the student's
 * unmet prerequisites server-side and refuses with `nothing_unmet` if there are
 * none. An override row that overrides nothing would appear on the console as an
 * exception that was granted, so an auditor would believe a student was waved
 * through a rule they actually satisfied — a false audit record is worse than none.
 *
 * WHAT MAKES IT VISIBLE, all four of these together:
 *   * `reason` is NOT NULL in the schema and is refused when blank here;
 *   * `unmetAtGrant` snapshots what was waved through, so the record survives a
 *     later change to the rules;
 *   * `granted_by` / `granted_at` name the admin and the moment;
 *   * the student's own course page says they are in on an override and quotes the
 *     reason — a student who thinks they met a prerequisite they did not is a
 *     student who will be surprised by the next course.
 *
 * The evaluation deliberately does NOT go through `evaluateCoursePrerequisites`:
 * that function folds an existing override into `satisfied`, and here the question
 * is what is unmet ON MERIT. Reusing it would make the check self-fulfilling for
 * the second grant.
 */
export async function grantPrerequisiteOverrideAction(
  studentId: unknown,
  courseId: unknown,
  reason: unknown,
): Promise<PrerequisiteActionResult> {
  try {
    const user = await requirePrerequisiteAdmin();

    const sid = validId(studentId);
    const cid = validId(courseId);
    if (!sid) return fail(OVERRIDE_REFUSAL_MESSAGE.invalid_student);
    if (!cid) return fail(OVERRIDE_REFUSAL_MESSAGE.invalid_course);

    const normalisedReason = normaliseOverrideReason(reason);

    const [student, courseSet, requirements, live, activeCourseId] = await Promise.all([
      getStudentSummary(sid),
      existingCourseIds([cid]),
      getRequirements(cid),
      getLiveOverride(sid, cid),
      getActiveCourseId(),
    ]);

    // Facts are gathered only after the requirements are known, because the set of
    // prerequisite courses to ask about IS the requirements. One forced serial pair
    // and no more.
    const prerequisiteIds = requirements.map((r) => r.prerequisiteCourseId);
    const needsScore =
      requirements.some((r) => r.minScore != null) &&
      activeCourseId != null &&
      prerequisiteIds.includes(activeCourseId);
    const [approvedIds, weeks] = await Promise.all([
      listApprovedCourseIds(sid, prerequisiteIds),
      needsScore ? getWeekProgress(sid) : Promise.resolve([]),
    ]);

    const onMerit = evaluatePrerequisites({
      requirements,
      facts: buildFacts({
        prerequisiteIds,
        approvedIds,
        activeCourseId,
        activeCoursePercent: weeks.length > 0 ? totalsFrom(weeks).percent : null,
        // The STUDENT's role, not the admin's. Passing the granting admin's role
        // here would make every prerequisite look satisfied (staff satisfy all of
        // them) and every override look like it granted nothing.
        role: student?.role ?? "student",
      }),
      override: null,
    });

    const eligibility = canGrantOverride({
      granterRole: user.role,
      studentExists: student !== null,
      courseExists: courseSet.has(cid),
      hasLiveOverride: live !== null,
      unmetCount: onMerit.unmet.length,
      reason: normalisedReason,
    });
    if (!eligibility.canGrant) return fail(OVERRIDE_REFUSAL_MESSAGE[eligibility.refusal]);

    const written = await grantOverride({
      studentId: sid,
      courseId: cid,
      reason: normalisedReason!,
      unmetAtGrant: summariseUnmet(onMerit.unmet),
      grantedBy: user.id,
    });
    // The partial unique index refused it: another admin granted a live override in
    // the window since the read above. Do NOT report success — the reason on file
    // is not this admin's.
    if (!written) return fail(OVERRIDE_REFUSAL_MESSAGE.already_granted);

    revalidate(cid);
    return { ok: true, message: "Override granted. It is listed on this page and shown to the student." };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Revoke a live override. The row is stamped, never deleted — the record of who
 * granted an exception and why must survive its withdrawal.
 */
export async function revokePrerequisiteOverrideAction(
  overrideId: unknown,
): Promise<PrerequisiteActionResult> {
  try {
    const user = await requirePrerequisiteAdmin();
    const id = validId(overrideId);
    if (!id) return fail(OVERRIDE_REFUSAL_MESSAGE.nothing_to_revoke);

    const revoked = await revokeOverride({ overrideId: id, revokedBy: user.id });
    // The compare-and-set matched nothing: already revoked by someone else. Saying
    // so beats reporting success and leaving the audit trail naming the wrong admin.
    if (!revoked) return fail(OVERRIDE_REFUSAL_MESSAGE.nothing_to_revoke);

    revalidate();
    return {
      ok: true,
      message: "Override revoked. The student must now satisfy the prerequisite.",
    };
  } catch (error) {
    return toFailure(error);
  }
}
