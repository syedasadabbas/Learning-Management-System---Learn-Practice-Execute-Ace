// =============================================================================
// PENALTY PERSISTENCE — owned by the `penalties-attendance` stream.
// -----------------------------------------------------------------------------
// The rules in ./rules.ts decide; this module writes. Nothing here re-implements
// a rule, and nothing in ./rules.ts imports a database.
//
// NO HTTP ROUTES: the frozen `ROUTES` map in src/lib/contracts/api.ts contains no
// penalty endpoints, and a feature stream must not add one. These are server
// functions instead, callable directly from server components, server actions,
// and the instructor-admin stream. See the report note about the `ROUTES`
// additions this stream would need to expose them over HTTP.
//
// AUTHORIZATION is the caller's responsibility: every mutating function here
// takes the acting instructor's id explicitly so a page/action must have already
// gone through `requireRole("instructor")` to obtain it.
// =============================================================================

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { penalties, type Penalty } from "@/db/schema";
import type { PenaltyDecision, PenaltyRuleInput } from "@/lib/contracts/events";
import { notifyPenaltyIssued } from "@/lib/notifications";

import { dedupeAgainstExisting, escalationFor, type EscalationState } from "./accumulation";
import { evaluatePenaltiesWithGrace } from "./rules";
import { appConfig } from "@/lib/config/app.config";

export type IssuePenaltiesInput = {
  studentId: number;
  decisions: readonly PenaltyDecision[];
  /** Instructor/admin user id, or null when the system issued it automatically. */
  issuedBy?: number | null;
  /**
   * Skip a decision whose `type` the student already holds unresolved. On by
   * default: re-ingesting the same Google Sheet row must not stack penalties.
   */
  dedupe?: boolean;
};

/**
 * Persist penalty decisions for a student.
 *
 * Returns the rows actually inserted — an empty array when every decision was
 * already held unresolved, which callers can treat as "nothing new happened".
 */
export async function issuePenalties(input: IssuePenaltiesInput): Promise<Penalty[]> {
  const { studentId, issuedBy = null, dedupe = true } = input;
  if (input.decisions.length === 0) return [];

  let toIssue = [...input.decisions];
  if (dedupe) {
    const existing = await listPenalties(studentId, { includeResolved: false });
    toIssue = dedupeAgainstExisting(toIssue, existing);
  }
  if (toIssue.length === 0) return [];

  const inserted = await db
    .insert(penalties)
    .values(
      toIssue.map((d) => ({
        studentId,
        type: d.type,
        severity: d.severity,
        description: d.description,
        penaltyPoints: d.penaltyPoints,
        issuedBy,
      })),
    )
    .returning();

  // Tell the student, once per penalty row.
  //
  // AFTER the insert and outside any transaction of the caller's, so a rollback
  // cannot leave a job pointing at a penalty that does not exist. The key is
  // scoped to `penalties.id`, which is insert-once, so a retry of this function
  // cannot mail twice — and `dedupe` above means a repeated evaluation does not
  // create a second row to notify about in the first place.
  //
  // notifyPenaltyIssued returns a NotifyResult and swallows its own errors, so a
  // mail problem cannot prevent a penalty being recorded. A penalty the student
  // was never told about is bad; a penalty that failed to apply is worse.
  //
  // COVERAGE IS PARTIAL AND THIS IS THE HONEST PLACE TO SAY SO. There are five
  // places a penalty row is written and this is one of them. The other four
  // insert inside their own transactions, three of them without `.returning()`,
  // so they have no row id to key a notification on:
  //   src/lib/quizzes/service.ts (quiz-failure penalties, inside the attempt tx)
  //   src/lib/submissions/grade.ts
  //   src/lib/submissions/deadline-penalties.ts
  //   src/lib/instructor/admin.ts (a manually issued penalty)
  // TODO(penalties): widen those four to return their inserted rows and notify
  // from the same post-commit position. Until then an automatic penalty from
  // those paths is silent, which is a gap in the FEATURE, not a bug in this call.
  for (const row of inserted) {
    await notifyPenaltyIssued({
      studentId,
      penaltyId: row.id,
      type: row.type,
      severity: row.severity,
      description: row.description,
      penaltyPoints: row.penaltyPoints,
    });
  }

  return inserted;
}

/**
 * Evaluate the rules for a student and persist whatever they warrant, in one
 * call. This is the convenience seam for `quizzes` / `submissions`, which may
 * also call `evaluatePenalties` themselves and persist via `issuePenalties`.
 *
 * @param gracePeriodDays the student's cohort `gracePeriodDays`. Defaults to the
 *   app-config value because `PenaltyRuleInput` (frozen) carries no cohort.
 */
export async function evaluateAndIssue(
  ruleInput: PenaltyRuleInput,
  options: { gracePeriodDays?: number; issuedBy?: number | null } = {},
): Promise<Penalty[]> {
  const grace = options.gracePeriodDays ?? appConfig.schedule.gracePeriodDays;
  const decisions = evaluatePenaltiesWithGrace(ruleInput, grace);
  return issuePenalties({
    studentId: ruleInput.studentId,
    decisions,
    issuedBy: options.issuedBy ?? null,
  });
}

/**
 * A student's penalties, newest first.
 *
 * `includeResolved` defaults to false: the student-facing notices list and every
 * accumulation count care only about what still stands against them.
 */
export async function listPenalties(
  studentId: number,
  options: { includeResolved?: boolean } = {},
): Promise<Penalty[]> {
  const includeResolved = options.includeResolved ?? false;
  const where = includeResolved
    ? eq(penalties.studentId, studentId)
    : and(eq(penalties.studentId, studentId), eq(penalties.resolved, false));

  return db.select().from(penalties).where(where).orderBy(desc(penalties.issuedAt));
}

/**
 * Clear a penalty (instructor action).
 *
 * Sets `resolved` and stamps `resolvedAt`. A resolved penalty stops counting
 * against the student everywhere — `listPenalties` hides it by default and
 * `escalationFor` filters it out — so this is the whole of "clearing" a penalty.
 *
 * Idempotent: resolving an already-resolved penalty is a no-op that returns the
 * existing row, so a double-clicked button cannot rewrite `resolvedAt`.
 */
export async function resolvePenalty(
  penaltyId: number,
  resolvedByInstructorId: number,
): Promise<Penalty | null> {
  void resolvedByInstructorId; // audit hook: schema has no resolvedBy column (see report)

  const rows = await db
    .update(penalties)
    .set({ resolved: true, resolvedAt: new Date() })
    .where(and(eq(penalties.id, penaltyId), eq(penalties.resolved, false)))
    .returning();

  if (rows.length > 0) return rows[0];

  const existing = await db.select().from(penalties).where(eq(penalties.id, penaltyId));
  return existing[0] ?? null;
}

/**
 * Re-open a penalty cleared by mistake. Clears `resolvedAt` so the row is
 * indistinguishable from one that was never resolved.
 */
export async function reopenPenalty(penaltyId: number): Promise<Penalty | null> {
  const rows = await db
    .update(penalties)
    .set({ resolved: false, resolvedAt: null })
    .where(eq(penalties.id, penaltyId))
    .returning();
  return rows[0] ?? null;
}

export type PenaltySummary = {
  studentId: number;
  active: Penalty[];
  escalation: EscalationState;
};

/** Everything the notices page and the instructor student-detail view need. */
export async function penaltySummary(studentId: number): Promise<PenaltySummary> {
  const active = await listPenalties(studentId, { includeResolved: false });
  return { studentId, active, escalation: escalationFor(active) };
}
