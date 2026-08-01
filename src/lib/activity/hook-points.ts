// =============================================================================
// WHERE THE AUDIT TRAIL IS WRITTEN FROM — the wiring plan, as checkable data.
// Owner: activity-logs stream.
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS INSTEAD OF A PARAGRAPH IN A README.
//
// The roadmap's integration plan for this feature is three bullets: "add to auth
// handlers", "add to middleware", "hook into all API endpoints that modify data".
// Taken literally the third one is 40-odd files, most of them owned by other
// streams. This stream owns src/lib/activity/**, its admin page and its own API
// routes; it does not own src/lib/auth.ts, the quiz submit handler, or the
// grading handler, and editing them here would be eight agents editing the same
// files in one wave — which is the failure mode this repository's file-ownership
// rule exists to prevent.
//
// So the wiring plan is expressed as DATA, keyed on the frozen route map in
// src/lib/contracts/api.ts, and asserted in hook-points.test.ts against `ROUTES`
// itself. Three things follow that a prose TODO cannot give:
//
//   1. a route that is renamed or removed breaks this file's test, so the plan
//      cannot quietly describe a codebase that no longer exists;
//   2. the owning stream gets an exact instruction — route, action, entity type,
//      and whether it is in-transaction — rather than "log something here";
//   3. `unwiredActions()` reports honestly, at runtime and in the admin UI, which
//      parts of the vocabulary have no call site yet. An audit trail whose
//      coverage is unknown is worse than one whose coverage is known to be
//      partial: the first invites false confidence in a gap.
//
// COVERAGE CLAIM, STATED PLAINLY: in this commit the only actions with live call
// sites are `activity_export`, `activity_export_denied` and `activity_pruned` —
// this feature auditing itself. Everything else is declared vocabulary plus the
// instruction below. The admin page says so on screen rather than implying the
// table is complete.
// =============================================================================

import { ROUTES, type RouteKey } from "@/lib/contracts/api";

import { ACTIVITY_ACTIONS, type ActivityActionName } from "./actions";

export interface HookPoint {
  /** A key of the frozen route map. Asserted to exist in hook-points.test.ts. */
  route: RouteKey;
  action: ActivityActionName;
  /** `activity_logs.entity_type` the call site should pass. */
  entityType: string;
  /**
   * MUST the row be written with the same transaction client as the act?
   *
   * true  — the act already runs inside `db.transaction()`, so passing that `tx`
   *         into `recordActivity` makes the audit row atomic with it for free.
   *         This is the strong form: no act without its record, no record without
   *         its act.
   * false — the act is not transactional (an external side effect, or a single
   *         statement), so the row is written before or immediately after it and
   *         the ordering argument is in the note.
   */
  inTransaction: boolean;
  /** What the call site should put in `details`, using safe key names only. */
  details: readonly string[];
  /** Anything the implementer needs to know that the row above does not say. */
  note?: string;
}

/**
 * The plan. One entry per route that performs an auditable act.
 *
 * NOT every route in `ROUTES`: a GET that reads a lecture is not an audit event,
 * and logging reads would turn this table into a web-server access log — a
 * different artefact, orders of magnitude larger, that answers a different
 * question. The exception is bulk egress (`report_export`, `activity_export`),
 * where the read IS the act.
 */
export const HOOK_POINTS: readonly HookPoint[] = [
  // --- identity: src/lib/auth.ts and the account routes --------------------
  {
    route: "POST /api/auth/login",
    action: "login",
    entityType: "user",
    inTransaction: false,
    details: ["role"],
    note:
      "Auth.js owns the credential check; the hook belongs in the authorize() " +
      "callback in src/lib/auth.ts, after the bcrypt comparison succeeds. Write " +
      "the row BEFORE issuing the session token: a session that exists with no " +
      "login row is the gap an intruder benefits from, whereas a logged login " +
      "whose token issuance then failed is merely a failed sign-in that is " +
      "recorded. See recordActivity's header for the general form of this argument.",
  },
  {
    route: "POST /api/auth/login",
    action: "login_failed",
    entityType: "user",
    inTransaction: false,
    details: ["role"],
    note:
      "actorId is NULL when the address matches no user — which is why " +
      "activity_logs.actor_id is nullable. Do NOT record the attempted address: " +
      "the whole point of `login_failed` is that it may be a stranger, and " +
      "storing unknown strangers' typed addresses builds a list of non-users. " +
      "errorCode carries `invalid_credentials` / `unknown_user` instead.",
  },
  {
    route: "POST /api/auth/logout",
    action: "logout",
    entityType: "user",
    inTransaction: false,
    details: [],
  },
  {
    route: "POST /api/account/password",
    action: "password_change",
    entityType: "user",
    inTransaction: true,
    details: [],
    note: "The password UPDATE and this row in one transaction. No details at all — there is nothing safe to say about a password beyond that it changed.",
  },
  {
    route: "POST /api/account/reset-request",
    action: "password_reset_request",
    entityType: "user",
    inTransaction: false,
    details: [],
    note:
      "ROUTE_AUTH 'public'. The route deliberately returns one identical response " +
      "for known and unknown addresses (src/lib/contracts/api.ts:176-179); this " +
      "row must not undo that by existing only for known ones — record it either " +
      "way, with a null actorId when unknown.",
  },
  {
    route: "POST /api/account/reset-confirm",
    action: "password_reset_confirm",
    entityType: "user",
    inTransaction: true,
    details: [],
  },
  {
    route: "PATCH /api/account/profile",
    action: "profile_update",
    entityType: "user",
    inTransaction: true,
    details: ["changedFields"],
    note:
      "`changedFields` must be a COUNT, not a list of values — 'bio' and 'name' " +
      "are content and identity. isForbiddenDetailKey drops 'bio' anyway.",
  },

  // --- assessment ----------------------------------------------------------
  {
    route: "POST /api/quizzes/:quizId/submit",
    action: "quiz_submit",
    entityType: "quiz",
    inTransaction: true,
    details: ["weekId", "attemptNumber", "scorePercent", "passed"],
    note:
      "This handler already runs in a transaction (the reason src/db/index.ts " +
      "chose node-postgres over neon-http, per its header at lines 11-16). Pass " +
      "that tx in and the audit row commits with the attempt, the answers, the " +
      "progress row and the unlock — or none of them do.",
  },
  {
    route: "POST /api/exams/:weekId/start",
    action: "exam_start",
    entityType: "exam_attempt",
    inTransaction: true,
    details: ["weekId", "deadlineMs"],
    note:
      "The one-attempt rule is a unique index (invariant I1 in " +
      "docs/GRAND_QUIZ_INVARIANTS.md). Recording the start inside the same " +
      "transaction means a duplicate start attempt leaves no misleading audit row.",
  },
  {
    route: "POST /api/exams/:attemptId/submit",
    action: "exam_submit",
    entityType: "exam_attempt",
    inTransaction: true,
    details: ["weekId", "scorePercent", "autoSubmitted"],
    note:
      "Submit is idempotent and reachable from three triggers (client " +
      "auto-submitter, lazy finalize-on-read, cron sweep — invariant I3). Pass a " +
      "dedupeKey of `exam_submit:<attemptId>` so three triggers cannot produce " +
      "three rows claiming three submissions.",
  },
  {
    route: "POST /api/problems/:slug/attempt",
    action: "problem_attempt",
    entityType: "problem",
    inTransaction: false,
    details: ["passed", "durationMs"],
  },
  {
    route: "POST /api/learn/steps/:stepId/complete",
    action: "learn_step_complete",
    entityType: "learn_step",
    inTransaction: false,
    details: [],
  },
  {
    route: "POST /api/execute",
    action: "code_execute",
    entityType: "execution",
    inTransaction: false,
    details: ["language", "durationMs", "timedOut"],
    note:
      "HIGHEST-VOLUME ACTION IN THE ENUM and the one whose row is worth least. " +
      "Use recordActivityDetached, and NEVER record the submitted source — it is " +
      "content, and sanitiseDetails drops a `source` key on the `content`/`body` " +
      "rules regardless.",
  },

  // --- coursework ----------------------------------------------------------
  {
    route: "POST /api/assignments/:assignmentId/ingest",
    action: "submission_ingest",
    entityType: "assignment",
    inTransaction: false,
    details: ["rowsSeen", "rowsInserted", "rowsSkipped"],
    note: "One row per ingest RUN. The per-submission record is submission_ingest_runs.",
  },
  {
    route: "POST /api/cron/ingest-submissions",
    action: "submission_ingest",
    entityType: "assignment",
    inTransaction: false,
    details: ["rowsSeen", "rowsInserted", "assignmentCount"],
    note: "actorId is NULL — a cron run has no user. The row proves the sweep ran.",
  },
  {
    route: "POST /api/instructor/submissions/:id/grade",
    action: "submission_graded",
    entityType: "submission",
    inTransaction: true,
    details: ["stars", "scoreAwarded", "previousStars"],
    note:
      "`previousStars` is the field that makes this row useful in an appeal: it " +
      "records that a grade CHANGED and from what. The written feedback is " +
      "content and is not recorded (sanitiseDetails drops `feedback`).",
  },

  // --- administration: staff acts with consequences ------------------------
  {
    route: "GET  /api/instructor/students",
    action: "role_change",
    entityType: "user",
    inTransaction: true,
    details: ["fromRole", "toRole"],
    note:
      "PLACEHOLDER ROUTE. Role and cohort edits are performed by server actions " +
      "behind /admin/students, not by a listed API route, so there is no accurate " +
      "RouteKey to name. The hook belongs in the server action that writes " +
      "users.role, in the same transaction. Listed here so the action is not " +
      "forgotten; the route field is the nearest surface and is deliberately " +
      "flagged rather than invented.",
  },
  {
    route: "GET  /api/instructor/analytics",
    action: "report_export",
    entityType: "report",
    inTransaction: false,
    details: ["reportKind", "rowCount"],
    note:
      "PLACEHOLDER ROUTE, same caveat as above: the CSV exports live behind " +
      "/admin/reports as server actions. Bulk egress of cohort data is the act — " +
      "record it BEFORE returning the bytes, for the reason argued in " +
      "src/app/api/admin/activity/export/route.ts.",
  },
  {
    route: "POST /api/admin/jobs",
    action: "jobs_requeued",
    entityType: "job",
    inTransaction: false,
    details: ["requeued", "kind"],
    note:
      "Requeuing dead jobs can re-send email to the whole cohort (see that " +
      "route's own header). Whoever did it should be on the record.",
  },
];

/**
 * Actions that appear nowhere in `HOOK_POINTS` and are therefore emitted only by
 * this stream's own code, if at all.
 *
 * Used by the admin page to state coverage on screen. A feature that quietly
 * claims 100% coverage while several of its enum values have no call site is the
 * failure this function exists to prevent.
 */
export function unwiredActions(): ActivityActionName[] {
  const wired = new Set(HOOK_POINTS.map((h) => h.action));
  // Emitted by this stream's own routes; not "unwired" even though no HOOK_POINT
  // names them, because the call sites are in files this stream owns.
  const selfWired: readonly ActivityActionName[] = [
    "activity_export",
    "activity_export_denied",
    "activity_pruned",
  ];
  return ACTIVITY_ACTIONS.filter((a) => !wired.has(a) && !selfWired.includes(a));
}

/** Hook points for one route, for a stream owner reading their own file. */
export function hookPointsForRoute(route: RouteKey): HookPoint[] {
  return HOOK_POINTS.filter((h) => h.route === route);
}

/** Every route named by the plan, deduplicated. Asserted against ROUTES. */
export function hookedRoutes(): RouteKey[] {
  return [...new Set(HOOK_POINTS.map((h) => h.route))].filter(
    (r): r is RouteKey => r in ROUTES,
  );
}
