// =============================================================================
// ACTION METADATA — how each audited act is described, grouped and prioritised.
// Owner: activity-logs stream.
// -----------------------------------------------------------------------------
// The enum itself lives in src/db/schema.activity.ts, because widening a Postgres
// enum is a migration and the migration file is the honest place for it. This file
// is the presentation and policy layer over it: a human label, a category for the
// admin filter, and a `significance` that decides how the row is treated when the
// database write fails (see src/lib/activity/record.ts).
//
// `Record<ActivityActionName, …>` on every map below is the point of the file: add
// a value to the enum and TypeScript refuses to compile until it has a label, a
// category and a stated significance. The alternative — a lookup with a fallback —
// is how an action ends up in production labelled "unknown" and treated as
// unimportant.
// =============================================================================

import { ACTIVITY_ACTIONS, type ActivityActionName } from "@/db/schema.activity";

export type { ActivityActionName };
export { ACTIVITY_ACTIONS };

/**
 * Filter groups for the admin surface. An admin investigating an incident thinks
 * in these terms ("show me the identity events"), not in enum values.
 */
export const ACTIVITY_CATEGORIES = [
  "identity",
  "assessment",
  "coursework",
  "administration",
  "audit",
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

/**
 * How much the completeness of this record matters.
 *
 *   "critical" — the record is part of the act. If it cannot be written, the act
 *                must not be treated as having happened. Every value here is one
 *                where an auditor's question is "who did this and when", and an
 *                unrecorded instance is indistinguishable from one that never
 *                occurred. src/lib/activity/record.ts fails these closed.
 *   "routine"  — worth having in aggregate, but a single missing row does not
 *                undermine anything. Volume events, mostly. These may be recorded
 *                detached, with the loss mode stated at the call site.
 *
 * There is no third level. Two is enough to force the question to be answered
 * per action, which is the requirement; a five-point scale would let a call site
 * pick the middle and not decide.
 */
export type ActivitySignificance = "critical" | "routine";

export interface ActionMeta {
  label: string;
  category: ActivityCategory;
  significance: ActivitySignificance;
}

export const ACTION_META: Record<ActivityActionName, ActionMeta> = {
  // --- identity -------------------------------------------------------------
  // Sign-in events are critical: "was this account accessed, and from where" is
  // the first question in every account-compromise investigation, and a gap in
  // the sequence is the answer being lost.
  login: { label: "Signed in", category: "identity", significance: "critical" },
  login_failed: {
    label: "Sign-in failed",
    category: "identity",
    significance: "critical",
  },
  logout: { label: "Signed out", category: "identity", significance: "routine" },
  password_change: {
    label: "Password changed",
    category: "identity",
    significance: "critical",
  },
  password_reset_request: {
    label: "Password reset requested",
    category: "identity",
    significance: "critical",
  },
  password_reset_confirm: {
    label: "Password reset completed",
    category: "identity",
    significance: "critical",
  },
  profile_update: {
    label: "Profile updated",
    category: "identity",
    significance: "routine",
  },

  // --- assessment -----------------------------------------------------------
  // A quiz or exam submission decides a grade and an unlock. If the audit row is
  // missing, a later dispute about "I submitted before the deadline" has nothing
  // to consult but the attempt row the student is disputing.
  quiz_submit: {
    label: "Quiz submitted",
    category: "assessment",
    significance: "critical",
  },
  exam_start: { label: "Exam started", category: "assessment", significance: "critical" },
  exam_submit: {
    label: "Exam submitted",
    category: "assessment",
    significance: "critical",
  },
  // Practice, not assessment of record. High volume, no consequence to a gap.
  problem_attempt: {
    label: "Problem attempted",
    category: "assessment",
    significance: "routine",
  },
  learn_step_complete: {
    label: "Learning step completed",
    category: "assessment",
    significance: "routine",
  },
  // The highest-volume action in the enum by a wide margin — a live editor can
  // fire it per keystroke-batch. Routine, and the reason `record.ts` has a
  // detached path at all.
  code_execute: {
    label: "Code executed",
    category: "assessment",
    significance: "routine",
  },

  // --- coursework -----------------------------------------------------------
  submission_ingest: {
    label: "Submissions ingested",
    category: "coursework",
    significance: "routine",
  },
  // A grade change is the act students appeal. Critical.
  submission_graded: {
    label: "Submission graded",
    category: "coursework",
    significance: "critical",
  },

  // --- administration -------------------------------------------------------
  // Every one of these is a staff act with a consequence for a student, which is
  // the class of event an institutional audit exists to examine. All critical.
  role_change: {
    label: "Role changed",
    category: "administration",
    significance: "critical",
  },
  cohort_change: {
    label: "Cohort changed",
    category: "administration",
    significance: "critical",
  },
  course_access_decision: {
    label: "Course access decided",
    category: "administration",
    significance: "critical",
  },
  video_decision: {
    label: "Video approved or rejected",
    category: "administration",
    significance: "critical",
  },
  deadline_change: {
    label: "Deadline changed",
    category: "administration",
    significance: "critical",
  },
  quiz_authored: {
    label: "Quiz created or edited",
    category: "administration",
    significance: "critical",
  },
  penalty_issued: {
    label: "Penalty issued",
    category: "administration",
    significance: "critical",
  },
  attendance_recorded: {
    label: "Attendance recorded",
    category: "administration",
    significance: "routine",
  },
  report_export: {
    label: "Report exported",
    category: "administration",
    significance: "critical",
  },
  jobs_requeued: {
    label: "Jobs requeued",
    category: "administration",
    significance: "critical",
  },

  // --- the trail auditing itself -------------------------------------------
  // Bulk-reading an audit log is data egress and is itself auditable; refusing to
  // record an export means refusing to perform it (see the export route).
  activity_export: {
    label: "Activity log exported",
    category: "audit",
    significance: "critical",
  },
  activity_export_denied: {
    label: "Activity log export refused",
    category: "audit",
    significance: "critical",
  },
  // Deleting from an audit trail must never be the untraceable operation.
  activity_pruned: {
    label: "Activity log pruned",
    category: "audit",
    significance: "critical",
  },
};

/** Human label, guaranteed present for every enum value by the Record type. */
export function actionLabel(action: ActivityActionName): string {
  return ACTION_META[action].label;
}

export function actionCategory(action: ActivityActionName): ActivityCategory {
  return ACTION_META[action].category;
}

export function actionSignificance(action: ActivityActionName): ActivitySignificance {
  return ACTION_META[action].significance;
}

/** Actions in a category, in enum order. Drives the admin filter chips. */
export function actionsInCategory(category: ActivityCategory): ActivityActionName[] {
  return ACTIVITY_ACTIONS.filter((a) => ACTION_META[a].category === category);
}

/**
 * Is `value` one of the enum's action names?
 *
 * The runtime gate for a query-string filter. An unrecognised `?action=` must be
 * rejected rather than ignored: silently dropping the filter shows the admin a
 * full unfiltered table and lets them conclude the events they searched for do
 * not exist. Same argument as `parseStatuses` in
 * src/app/api/admin/jobs/route.ts:37-50.
 */
export function isActivityAction(value: unknown): value is ActivityActionName {
  return typeof value === "string" && (ACTIVITY_ACTIONS as readonly string[]).includes(value);
}

export function isActivityCategory(value: unknown): value is ActivityCategory {
  return typeof value === "string" && (ACTIVITY_CATEGORIES as readonly string[]).includes(value);
}
