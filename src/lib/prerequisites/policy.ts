// =============================================================================
// PREREQUISITE POLICY — the evaluation, as pure functions.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream (feature 8, PHASE 2 of IMPLEMENTATION_ROADMAP.md).
//
// NO DATABASE, NO SESSION, NO `next/*` IMPORT. Everything here is a total
// function over plain data, for the reason `src/lib/courses/policy.ts:6` states:
// a rule that can only be exercised through a page is a rule nobody can prove.
// The negative paths — "an unmet prerequisite refuses", "an override does not
// leak to another student" — are asserted in policy.test.ts without a server.
//
// =============================================================================
// THIS IS NOT A FOURTH GATE. READ THIS BEFORE CHANGING ANYTHING BELOW.
// =============================================================================
//
// Three gating mechanisms already exist in this codebase, and a fourth that could
// disagree with them would be a defect rather than a feature:
//
//   | # | Mechanism            | Question it answers                       | Where it lives |
//   |---|----------------------|-------------------------------------------|----------------|
//   | 1 | Week unlocking       | Has the previous week's quiz been passed?  | shouldUnlockNextWeek -> deriveWeekLockStates -> gateWeek (src/components/course/data.ts:338) |
//   | 2 | Section release      | Has the cohort been given this SUBJECT?    | appConfig.curriculumSections -> getCurriculumSections() (docs/SUBJECT_SECTIONS.md) |
//   | 3 | Course access        | May this student open this COURSE at all?  | decideCourseAccess (src/lib/courses/policy.ts:167) |
//
// PREREQUISITES ARE PART OF (3), NOT A NEW ROW IN THAT TABLE. A prerequisite is a
// REASON the access-request policy refuses — the same kind of fact as
// `requestStatus`, arriving from a different table. Concretely:
//
//   * `evaluatePrerequisites` below produces a verdict.
//   * `decideCourseAccess` consumes `{ satisfied }` and, when a student would
//     otherwise be admitted by an approved request, returns the new denial
//     `prerequisite_unmet` instead. That is a ~6-line change to policy.ts, and it
//     leaves that function the SINGLE authority on course entry. Nothing in this
//     stream ever answers "may this student open this course" on its own.
//   * `canRequestAccess` consumes the same verdict and refuses to FILE a request
//     whose prerequisites are unmet. That is the "auto-refuse" half of the
//     feature: a student is told what they still owe at the moment they ask,
//     instead of joining a queue an admin will decline.
//
// WHY NOT A STANDALONE `gatePrerequisites(studentId, courseId)` CALLED FROM THE
// PAGE. Because the page would then hold two verdicts and have to combine them,
// and the combination is the rule. Every page that forgot the second call, or
// combined them in the other order, would be a hole; the copy that drifts is
// always the one guarding the deeper URL (src/lib/courses/policy.ts:141 records
// exactly this lesson for `decideWeekGate`).
//
// -----------------------------------------------------------------------------
// HOW THIS RELATES TO (1) WEEK UNLOCKING
//
// It does not interact with it at all, and that is deliberate. Week unlocking is
// WITHIN a course; prerequisites are BETWEEN courses. A student refused here
// never reaches `gateWeek`, so nothing here can grant what week unlocking
// refuses; a student allowed here still has to pass every week quiz exactly as
// before. Prerequisites do not unlock a week and passing a quiz does not satisfy
// a prerequisite for a DIFFERENT course.
//
// The one place they touch is `minScore`: the score a prerequisite is measured
// against is the same course-wide percentage the dashboard shows, computed by
// `totalsFrom(getWeekProgress(...))` and NOT recomputed here — see ./gate.ts. A
// second scoring implementation is what the scoring contract forbids.
//
// HOW THIS RELATES TO (2) SECTION RELEASE
//
// Orthogonally, and prerequisites are strictly weaker. docs/SUBJECT_SECTIONS.md:20
// records that "on conflict the section switch wins", and that stays true: an
// override granted here opens a COURSE, never a withheld SUBJECT inside it. An
// admin who overrides a prerequisite and expects the student to see CSS3 will be
// disappointed, correctly, and the admin page says so.
//
// HOW THIS RELATES TO (3) AND ITS COMPATIBILITY RULE — THE IMPORTANT ONE
//
// `src/lib/courses/policy.ts:36` states the rule out loud: the ACTIVE course (the
// lowest id, the one `loadCourseAndWeeks` serves at /weeks) is OPEN to every
// signed-in student, because gating it would have silently revoked the course
// every existing student is on. PREREQUISITES DO NOT WEAKEN THAT RULE. In
// `decideCourseAccess` the `isOpenCourse` branch returns `allowed` BEFORE any
// prerequisite is consulted, so:
//
//   * a prerequisite recorded against the active course has no effect on entry;
//   * no admin data-entry mistake in this stream can lock the cohort out of the
//     course they are studying.
//
// The admin page says this in as many words next to the course selector, because
// a rule that only exists in a comment will be re-discovered as a bug. When the
// explicit active-course marker that `src/components/course/data.ts:123` carries
// a TODO for lands, `isOpenCourse` is still the ONE function that changes — this
// stream added nothing that has to change with it.
//
// -----------------------------------------------------------------------------
// THE COST OF ENFORCING AT READ TIME, STATED RATHER THAN HIDDEN
//
// Because `decideCourseAccess` consults prerequisites on the `approved` branch,
// adding a prerequisite to a course students are ALREADY approved for will refuse
// them until they satisfy it or an admin overrides. That is a real consequence
// and it is the one the roadmap asks for ("Prerequisites | Enforcement | 100%",
// IMPLEMENTATION_ROADMAP.md:714) — a prerequisite enforced only at request time
// is advisory, and the roadmap's own risk table names "broken course chains" as
// the thing to prevent.
//
// It is not the silent mass revocation the compatibility rule above exists to
// prevent, for three reasons: there are ZERO prerequisite rows until an admin
// creates one, so nothing changes for anyone on install; the ACTIVE course can
// never be gated this way; and the admin page shows how many currently-approved
// students each new rule would affect BEFORE it is saved. A refused student is
// also told exactly which prerequisite is unmet, which is the difference between
// this and a bare "locked".
// =============================================================================

import { roleSatisfies } from "@/lib/guard";
import type { RouteAuth } from "@/lib/contracts/api";

import {
  describeUnmet,
  OVERRIDE_REASON_MAX,
  OVERRIDE_REFUSAL_MESSAGE,
  PREREQUISITE_REFUSAL_MESSAGE,
  summariseUnmet,
  UNMET_REASON_LABEL,
  UNMET_REASON_TONE,
  UNMET_SNAPSHOT_MAX,
  type OverrideRefusal,
  type PrerequisiteRefusal,
  type UnmetPrerequisite,
  type UnmetReason,
} from "./labels";
import { wouldCreateCycle, type PrerequisiteEdge } from "./graph";

export type { OverrideRefusal, PrerequisiteRefusal, UnmetPrerequisite, UnmetReason };
/** Re-exported, NOT redeclared — see ./labels.ts for why they live there. */
export {
  describeUnmet,
  OVERRIDE_REASON_MAX,
  OVERRIDE_REFUSAL_MESSAGE,
  PREREQUISITE_REFUSAL_MESSAGE,
  summariseUnmet,
  UNMET_REASON_LABEL,
  UNMET_REASON_TONE,
  UNMET_SNAPSHOT_MAX,
};

/**
 * The auth level required to author prerequisite rules and to grant overrides.
 *
 * ADMIN, matching `COURSE_APPROVAL_AUTH` in src/lib/courses/policy.ts:84 exactly,
 * and for the identical reason: a prerequisite decides who may be ON THE ROLL of
 * a course, which downstream changes the leaderboard population and who a
 * deadline applies to. That is an enrolment act, not a grading act. An
 * instructor who wants a rule relaxed asks an admin — the same cost the courses
 * stream already accepted, kept the same rather than quietly widened, because a
 * feature that admits instructors to an enrolment decision the neighbouring
 * feature reserves for admins is a privilege escalation by inconsistency.
 */
export const PREREQUISITE_ADMIN_AUTH: RouteAuth = "admin";

/** May `role` author prerequisite rules or grant overrides? */
export function canManagePrerequisites(role: string | null | undefined): boolean {
  return roleSatisfies(PREREQUISITE_ADMIN_AUTH, role);
}

// ---------------------------------------------------------------------------
// Evaluating one student against one course's prerequisites
// ---------------------------------------------------------------------------

/** One rule, resolved with the prerequisite course's title for display. */
export interface PrerequisiteRequirement {
  prerequisiteCourseId: number;
  prerequisiteTitle: string;
  /** Null means "access to that course is enough". 0..100 otherwise. */
  minScore: number | null;
}

/**
 * What is TRUE about one student and one prerequisite course. Facts only — no
 * decision, so the same facts can be shown on the admin screen and fed to the
 * gate without either re-deriving the other's answer.
 */
export interface PrerequisiteFact {
  courseId: number;
  /**
   * Does the student have access to that course today? Resolved by ./gate.ts
   * from `decideCourseAccess` itself, NOT re-derived here — "has access" must
   * mean the same thing to a prerequisite as it does to the gate, or a student
   * could satisfy a prerequisite for a course they cannot open.
   */
  hasAccess: boolean;
  /**
   * The student's course-wide percentage, or null when none can be computed.
   *
   * Null is NOT zero, and the distinction is load-bearing. Only the ACTIVE course
   * has weeks, quizzes and a progress aggregate today (`fetchWeekAggregates`
   * resolves exactly one course — src/lib/progress/query.ts:148), so for every
   * other course the honest answer is "unknown". Treating unknown as 0 would make
   * every `minScore` rule on a contentless course permanently unsatisfiable while
   * LOOKING like the student simply had not worked; treating it as 100 would make
   * the rule meaningless. It is reported as `score_unknown` instead.
   */
  scorePercent: number | null;
}

/** An admin's live exception, as the evaluation needs to see it. */
export interface PrerequisiteOverrideView {
  reason: string;
  grantedByName: string | null;
  /** ISO 8601 UTC. */
  grantedAt: string;
}

export interface PrerequisiteEvaluation {
  /**
   * The one field `decideCourseAccess` reads. True when there is nothing unmet
   * OR when a live override covers it.
   */
  satisfied: boolean;
  /**
   * What is unmet ON MERIT — populated even when `overridden` is true.
   *
   * Deliberate: this is what makes the override visible rather than silent
   * (requirement 4). An override that emptied this list would leave the admin
   * console unable to show what was waved through, and the student unable to see
   * that they are in on an exception. `satisfied` is the decision; `unmet` is the
   * truth, and the two are allowed to differ as long as both are shown.
   */
  unmet: UnmetPrerequisite[];
  /** Null unless a live override applies to this (student, course). */
  override: PrerequisiteOverrideView | null;
  /** True when `unmet` is non-empty and an override is what admits them. */
  overridden: boolean;
  /** True when the course has no prerequisites at all — the default state. */
  unconstrained: boolean;
}

/**
 * THE evaluation. Pure, total, and the only place the rule is written.
 *
 * `requirements` are the IMMEDIATE prerequisites of the course being entered, not
 * the transitive closure, and that is on purpose. If A requires B and B requires
 * C, a student with B satisfied has by construction already been through B's own
 * gate to get it — so checking A's immediate edge is sufficient, and walking the
 * closure would refuse a student for a course they legitimately completed before
 * the deeper rule was written. `prerequisiteClosure` exists in ./graph.ts for
 * DISPLAY (the learning path), not for gating.
 *
 * An empty `requirements` array yields `satisfied: true, unconstrained: true`.
 * That is the state of every course until an admin says otherwise, and it is why
 * installing this feature changes nobody's access.
 */
export function evaluatePrerequisites(input: {
  requirements: readonly PrerequisiteRequirement[];
  /** Facts for the prerequisite courses. A missing fact is treated as no access. */
  facts: readonly PrerequisiteFact[];
  override: PrerequisiteOverrideView | null;
}): PrerequisiteEvaluation {
  const { requirements, facts, override } = input;

  if (requirements.length === 0) {
    // No rule, nothing to override. `override` is ignored rather than reported,
    // so a stale override on a course whose prerequisites were later removed does
    // not render as "admitted by exception" when they are admitted on merit.
    return { satisfied: true, unmet: [], override: null, overridden: false, unconstrained: true };
  }

  const factById = new Map(facts.map((f) => [f.courseId, f]));
  const unmet: UnmetPrerequisite[] = [];

  for (const req of requirements) {
    const fact = factById.get(req.prerequisiteCourseId);

    // A MISSING FACT IS NO ACCESS, not a pass. This is the fail-closed direction
    // and it matters: a caller that forgot to fetch a fact, or a course row
    // deleted between the two reads, must not read as "prerequisite satisfied".
    if (!fact || !fact.hasAccess) {
      unmet.push({
        courseId: req.prerequisiteCourseId,
        title: req.prerequisiteTitle,
        reason: "no_access",
        minScore: req.minScore,
        actualPercent: fact?.scorePercent ?? null,
      });
      continue;
    }

    if (req.minScore == null) continue; // access was the whole requirement

    if (fact.scorePercent == null) {
      // See PrerequisiteFact.scorePercent — a threshold on a course that cannot
      // be scored is a MISCONFIGURATION. Reported as its own reason so an admin
      // can fix the rule, rather than silently passing (which would make the
      // threshold a lie) or silently failing (which would make it a permanent
      // lockout the student cannot act on).
      unmet.push({
        courseId: req.prerequisiteCourseId,
        title: req.prerequisiteTitle,
        reason: "score_unknown",
        minScore: req.minScore,
        actualPercent: null,
      });
      continue;
    }

    if (fact.scorePercent < req.minScore) {
      unmet.push({
        courseId: req.prerequisiteCourseId,
        title: req.prerequisiteTitle,
        reason: "score_below",
        minScore: req.minScore,
        actualPercent: fact.scorePercent,
      });
    }
  }

  if (unmet.length === 0) {
    return { satisfied: true, unmet: [], override: null, overridden: false, unconstrained: false };
  }

  // The override admits them, and the unmet list is KEPT so both the student and
  // the admin console can see what it covered. See PrerequisiteEvaluation.unmet.
  if (override) {
    return { satisfied: true, unmet, override, overridden: true, unconstrained: false };
  }

  return { satisfied: false, unmet, override: null, overridden: false, unconstrained: false };
}

// ---------------------------------------------------------------------------
// Authoring a rule
// ---------------------------------------------------------------------------

export type NewPrerequisiteResult =
  | { ok: true; edge: PrerequisiteEdge; minScore: number | null }
  | { ok: false; refusal: PrerequisiteRefusal };

/**
 * Normalise and validate a proposed rule against the CURRENT edge set.
 *
 * ORDER IS DELIBERATE — cheapest and most specific first, so an admin who typed
 * one bad field is told about that field rather than about the graph:
 *
 *   1. ids must be real positive integers, and both courses must exist (the
 *      caller proves existence by reading the rows; it is never inferred here);
 *   2. self-reference, which the `course_prerequisites_no_self` database CHECK
 *      also forbids — this branch exists so the admin gets a sentence instead of
 *      a constraint-violation stack trace;
 *   3. the score, before the graph walk, because a bad number is a typo and a
 *      cycle is a design mistake;
 *   4. duplicate, which the unique index also forbids, same reasoning as (2);
 *   5. cycle, last, because it is the only check that costs a traversal.
 *
 * THIS FUNCTION ALONE DOES NOT PREVENT CYCLES. It decides against a SNAPSHOT.
 * `insertPrerequisite` in ./store.ts re-runs it inside a transaction holding a
 * Postgres advisory lock, which is what makes the check-then-insert atomic. See
 * that function; the split is the same one `decideRequest`
 * (src/lib/courses/store.ts:346) makes with its compare-and-set, for the same
 * reason: a decision made a round trip before the write can be stale by the time
 * the write happens.
 */
export function validateNewPrerequisite(input: {
  courseId: number;
  prerequisiteCourseId: number;
  /** Raw from the form: string, number, null or undefined. */
  minScore: unknown;
  /** Proven by the caller having read both rows. Never inferred from the ids. */
  courseExists: boolean;
  prerequisiteExists: boolean;
  existingEdges: readonly PrerequisiteEdge[];
}): NewPrerequisiteResult {
  const { courseId, prerequisiteCourseId } = input;

  if (!isPositiveInt(courseId) || !isPositiveInt(prerequisiteCourseId)) {
    return { ok: false, refusal: "invalid_course" };
  }
  if (!input.courseExists || !input.prerequisiteExists) {
    return { ok: false, refusal: "invalid_course" };
  }
  if (courseId === prerequisiteCourseId) {
    return { ok: false, refusal: "self_reference" };
  }

  const minScore = normaliseMinScore(input.minScore);
  if (minScore === "invalid") {
    return { ok: false, refusal: "invalid_min_score" };
  }

  const duplicate = input.existingEdges.some(
    (e) => e.courseId === courseId && e.prerequisiteCourseId === prerequisiteCourseId,
  );
  if (duplicate) return { ok: false, refusal: "duplicate" };

  if (wouldCreateCycle(input.existingEdges, { courseId, prerequisiteCourseId })) {
    return { ok: false, refusal: "cycle" };
  }

  return { ok: true, edge: { courseId, prerequisiteCourseId }, minScore };
}

/**
 * Blank -> null ("access is enough"); 0..100 integer -> that number; anything
 * else -> "invalid".
 *
 * REJECTS rather than clamps, unlike `normaliseRequestMessage`
 * (src/lib/courses/policy.ts:268) which truncates. The difference is what the
 * value means: truncating a student's free-text note loses a tail nobody depends
 * on, whereas clamping a mistyped "1000" to 100 would silently install the
 * strictest possible rule on a course an admin thought they had barely
 * constrained. A wrong threshold is an access decision; a shortened sentence is
 * not.
 */
export function normaliseMinScore(raw: unknown): number | null | "invalid" {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    // Number("") is 0 and Number(" 5 ") is 5; the explicit pattern refuses
    // "5px", "1e2" and "+5" rather than coercing them to something plausible.
    if (!/^\d{1,3}$/.test(trimmed)) return "invalid";
    const n = Number(trimmed);
    return n >= 0 && n <= 100 ? n : "invalid";
  }
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0 || raw > 100) return "invalid";
    return raw;
  }
  return "invalid";
}

/**
 * Normalise an admin's override reason.
 *
 * Returns null for blank, which the caller turns into the `reason_required`
 * refusal — the column is NOT NULL precisely so an unexplained override cannot
 * be stored. Truncates rather than rejecting an over-long reason, matching
 * `normaliseRequestMessage`: losing the tail of a justification is better than
 * throwing away an override an admin meant to grant.
 */
export function normaliseOverrideReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, OVERRIDE_REASON_MAX);
}

// ---------------------------------------------------------------------------
// Granting an override
// ---------------------------------------------------------------------------

export type OverrideEligibility =
  | { canGrant: true }
  | { canGrant: false; refusal: OverrideRefusal };

/**
 * May this admin grant an override for this (student, course)?
 *
 * FOUR REFUSALS, in security order — the role check is first so an admin-only
 * action probed by a student reveals nothing about whether the student or the
 * course exists, the same ordering `canDecideRequest`
 * (src/lib/courses/policy.ts:311) uses and for the same reason.
 *
 * `nothing_unmet` refuses an override that would grant nothing. That is not
 * pedantry: a no-op override row would appear on the admin console as an
 * exception that was granted, so an auditor reading the console would believe a
 * student was waved through a rule they actually satisfied. An override record
 * that does not correspond to an override is worse than no record.
 *
 * THERE IS NO SELF-OVERRIDE CHECK, and its absence is deliberate rather than an
 * oversight. `canDecideRequest` refuses `self_approval` because a request row can
 * belong to the admin deciding it. An override is granted TO a named student BY
 * an admin, and staff are admitted to every course by `decideCourseAccess`'s
 * staff branch before prerequisites are consulted at all — so an admin granting
 * themselves one is a row that changes nothing. Should staff ever become
 * prerequisite-gated, this is the function that needs the fourth check.
 */
export function canGrantOverride(input: {
  granterRole: string | null | undefined;
  studentExists: boolean;
  courseExists: boolean;
  hasLiveOverride: boolean;
  /** From `evaluatePrerequisites(...).unmet.length` computed WITHOUT the override. */
  unmetCount: number;
  reason: string | null;
}): OverrideEligibility {
  if (!canManagePrerequisites(input.granterRole)) {
    return { canGrant: false, refusal: "not_authorized" };
  }
  if (!input.studentExists) return { canGrant: false, refusal: "invalid_student" };
  if (!input.courseExists) return { canGrant: false, refusal: "invalid_course" };
  if (!input.reason) return { canGrant: false, refusal: "reason_required" };
  if (input.hasLiveOverride) return { canGrant: false, refusal: "already_granted" };
  if (input.unmetCount === 0) return { canGrant: false, refusal: "nothing_unmet" };
  return { canGrant: true };
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
