// =============================================================================
// PURE PRESENTATION CONSTANTS for prerequisites. NO IMPORTS, deliberately.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// WHY THIS IS SEPARATE FROM policy.ts, WHICH LOOKS LIKE ITS HOME
//
// `policy.ts` imports `roleSatisfies` from `@/lib/guard`, which imports
// `@/lib/auth`, which pulls in `pg` (TCP sockets) and `bcryptjs`. A "use client"
// component importing anything from policy.ts therefore drags a database driver
// into the browser bundle and breaks `next build`. That is not hypothetical: the
// video-ingestion stream hit it (recorded at src/components/videos/ReviewQueue.tsx:41)
// and the courses stream created src/lib/courses/labels.ts for exactly this, with
// a zero-import rule that makes the hazard impossible rather than merely
// documented. Same rule here.
//
// Values are duplicated NOWHERE: policy.ts re-exports from this file.
// =============================================================================

/**
 * Maximum length of an admin's override reason.
 *
 * Mirrors `varchar(500)` on `course_prerequisite_overrides.reason` in
 * src/db/schema.prerequisites.ts. The form sets `maxLength` from this AND the
 * server action truncates to it — a form attribute is presentation, and the
 * action is a plain HTTP POST target that no client-side attribute protects.
 */
export const OVERRIDE_REASON_MAX = 500;

/** Length of the audit snapshot column, same table. */
export const UNMET_SNAPSHOT_MAX = 1000;

/**
 * The reason a single prerequisite is not satisfied.
 *
 * THREE reasons and not one generic "locked", because they call for three
 * different actions from the student: enrol in the other course, raise a score in
 * a course they are already in, or tell an admin the rule is unsatisfiable. A
 * single "prerequisite not met" would send all three to the same dead end, which
 * is the failure mode this whole feature exists to remove.
 */
export type UnmetReason =
  /** The student has no access to the prerequisite course at all. */
  | "no_access"
  /** They have access, but their score is below `minScore`. */
  | "score_below"
  /**
   * They have access and a `minScore` is required, but no score can be computed
   * for that course. See policy.ts — this is a MISCONFIGURATION, surfaced rather
   * than silently treated as pass or fail.
   */
  | "score_unknown";

/** Short label for a prerequisite's state, so every surface agrees. */
export const UNMET_REASON_LABEL: Record<UnmetReason, string> = {
  no_access: "Not enrolled",
  score_below: "Score too low",
  score_unknown: "Not gradable yet",
};

export const UNMET_REASON_TONE: Record<UnmetReason, "warning" | "neutral"> = {
  no_access: "warning",
  score_below: "warning",
  // Neutral, not warning: nothing the STUDENT did causes this one.
  score_unknown: "neutral",
};

/**
 * One prerequisite the student does not satisfy, with the reason and the gap.
 *
 * DEFINED HERE RATHER THAN IN policy.ts, even though policy.ts is where it is
 * produced, because `PrerequisiteNotice` renders it and that component sits in a
 * page tree — a type import is erased, but `describeUnmet` below is a VALUE and
 * importing it from policy.ts would drag `@/lib/guard` -> `@/lib/auth` -> `pg`
 * into whatever bundle the notice lands in. Keeping the shape next to the function
 * that formats it means neither the type nor the formatter ever needs the policy
 * module. policy.ts re-exports both; it keeps no copy.
 */
export interface UnmetPrerequisite {
  courseId: number;
  title: string;
  reason: UnmetReason;
  /** The threshold that was required, when the reason involves one. */
  minScore: number | null;
  /** What the student actually has, when it is known. */
  actualPercent: number | null;
}

/**
 * A student-facing sentence naming ONE unmet prerequisite.
 *
 * Requirement 5 of feature 8 is that the student is told WHY: "Locked" with no
 * reason is the failure mode the feature exists to remove, and it is the failure
 * mode docs/SUBJECT_SECTIONS.md:101 already warns about for section refusals ("A
 * section refusal never says 'Locked until you pass the Week N quiz'", because that
 * message would send a student to spend one of their three attempts for nothing).
 * Every sentence here names the course and, where relevant, the number.
 */
export function describeUnmet(unmet: UnmetPrerequisite): string {
  switch (unmet.reason) {
    case "no_access":
      return unmet.minScore == null
        ? `Complete “${unmet.title}” first.`
        : `Complete “${unmet.title}” first, scoring at least ${unmet.minScore}%.`;
    case "score_below":
      return `Your score in “${unmet.title}” is ${formatPercent(unmet.actualPercent)}; ${unmet.minScore}% is required.`;
    case "score_unknown":
      return `“${unmet.title}” requires at least ${unmet.minScore}%, but no score can be calculated for it yet. Ask an admin — this rule cannot currently be met.`;
  }
}

/** One line summarising every unmet prerequisite. Used for the audit snapshot. */
export function summariseUnmet(unmet: readonly UnmetPrerequisite[]): string {
  if (unmet.length === 0) return "nothing unmet at grant time";
  return unmet
    .map((u) => {
      const score = u.minScore == null ? "" : ` (min ${u.minScore}%)`;
      return `${u.title}${score}: ${u.reason}`;
    })
    .join("; ")
    .slice(0, UNMET_SNAPSHOT_MAX);
}

function formatPercent(value: number | null): string {
  if (value == null) return "unknown";
  // One decimal place, matching `overallPercent` in src/lib/progress/score.ts:152
  // so the number a student reads here is character-for-character the number on
  // their dashboard. A prerequisite message that rounds differently from the
  // dashboard reads as a second, disagreeing score.
  return `${Math.round(value * 10) / 10}%`;
}

/** Why an attempt to add a prerequisite rule was refused. */
export type PrerequisiteRefusal =
  | "invalid_course"
  | "self_reference"
  | "duplicate"
  | "cycle"
  | "invalid_min_score";

export const PREREQUISITE_REFUSAL_MESSAGE: Record<PrerequisiteRefusal, string> = {
  invalid_course: "One of those courses does not exist.",
  self_reference: "A course cannot be its own prerequisite.",
  duplicate: "That prerequisite is already recorded. Remove it first to change the minimum score.",
  cycle:
    "That would create a circular requirement — the prerequisite course already depends on this one, so neither could ever be taken.",
  invalid_min_score: "The minimum score must be a whole number between 0 and 100, or left blank.",
};

/** Why an attempt to grant or revoke an override was refused. */
export type OverrideRefusal =
  | "not_authorized"
  | "invalid_course"
  | "invalid_student"
  | "reason_required"
  | "already_granted"
  | "nothing_to_revoke"
  | "nothing_unmet";

export const OVERRIDE_REFUSAL_MESSAGE: Record<OverrideRefusal, string> = {
  not_authorized: "You do not have access to prerequisite overrides.",
  invalid_course: "That course does not exist.",
  invalid_student: "That student does not exist.",
  reason_required: "An override must state a reason. It is shown to the student and kept as the record.",
  already_granted: "That student already has a live override for this course.",
  nothing_to_revoke: "There is no live override to revoke.",
  nothing_unmet:
    "That student already meets this course's prerequisites, so an override would grant nothing.",
};
