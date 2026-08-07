"use server";

// =============================================================================
// SERVER ACTIONS — instructor-admin stream.
// -----------------------------------------------------------------------------
// WHY ACTIONS AND NOT ROUTES. `ROUTES` in `@/lib/contracts/api` is frozen and
// grants this stream exactly four endpoints. Admin CRUD, penalty issuing and CSV
// export are not among them, and inventing `POST /api/instructor/quizzes` would
// add a path with no entry in `ROUTE_AUTH` — precisely the unguarded-by-omission
// bug that map exists to prevent. Server actions keep those mutations inside the
// frozen contract while still being guarded, because every one of them starts
// with `requireAdminAction()` or `requireStaffAction()`.
//
// EVERY EXPORT HERE IS AN HTTP-REACHABLE ENDPOINT. Next.js compiles each one into
// a callable POST target, so an unguarded export is a public mutation. The first
// statement of every action below is a guard. No exceptions, and any new action
// must follow the same shape.
//
// Actions return a result object instead of throwing across the RSC boundary: a
// thrown error reaches the client as a generic "unexpected response", which tells
// the user nothing about whether their grade saved.
// =============================================================================

import { revalidatePath } from "next/cache";

import type { PenaltyDecision } from "@/lib/contracts/events";
import { evaluatePenalties } from "@/lib/penalties/rules";
import { ForbiddenError, requireAdminAction, requireStaffAction } from "./access";
import {
  accountUpdateSchema,
  assignmentUpsertSchema,
  cohortConfigSchema,
  deadlineSchema,
  deleteQuestion,
  getGradeExportRows,
  issuePenalty,
  penaltyIssueSchema,
  questionUpsertSchema,
  quizUpsertSchema,
  resolvePenalty,
  setWeekDeadline,
  updateAccount,
  updateCohortConfig,
  upsertAssignment,
  upsertQuestion,
  upsertQuiz,
} from "./admin";
import { buildCsv, exportFilename, GRADE_EXPORT_COLUMNS } from "./csv";
import { applyGrade, GradeError, parseGradePayload } from "./grading";
import { persistMissedDeadlinePenalties } from "@/lib/submissions/deadline-penalties";
import { ingestAllAssignments } from "@/lib/submissions/ingest";
import { ABORT_ADVICE } from "@/lib/submissions/types";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** `{ ok: true }` for the actions that return no payload. */
const DONE = { ok: true as const, data: undefined };

function fail(error: string, fieldErrors?: Record<string, string[]>) {
  return { ok: false as const, error, fieldErrors };
}

/**
 * Turn any thrown error into a result. `ForbiddenError` keeps its message so the
 * UI can say "you do not have access" rather than "something went wrong"; every
 * other error is logged and reported generically, because a database error string
 * in the browser is an information leak.
 */
function toFailure(error: unknown) {
  if (error instanceof ForbiddenError) return fail(error.message);
  if (error instanceof GradeError) return fail(error.message);
  console.error("[instructor-admin] action failed", error);
  return fail("The action could not be completed. Please try again.");
}

// ---------------------------------------------------------------------------
// Grading (instructor OR admin)
// ---------------------------------------------------------------------------

/**
 * Save a grade from the grading form.
 *
 * Validated with the frozen `gradeSubmissionSchema` via `parseGradePayload`, so
 * the form and `POST /api/instructor/submissions/:id/grade` cannot disagree about
 * what a legal grade is.
 */
export async function gradeSubmissionAction(
  raw: unknown,
): Promise<
  ActionResult<{
    score: number;
    derivedScore: number;
    overridden: boolean;
    stars: number;
    penaltiesIssued: number;
  }>
> {
  try {
    const user = await requireStaffAction();

    // Parsed here so the form gets per-field errors. `applyGrade` (and the
    // submissions stream behind it) re-validates with the same schema — this is a
    // convenience, not the enforcement point.
    const parsed = parseGradePayload(raw);
    if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);

    const result = await applyGrade(parsed.data, user.id);

    revalidatePath("/instructor/grading");
    revalidatePath("/instructor/analytics");
    revalidatePath("/leaderboard");
    return {
      ok: true,
      data: {
        score: result.score,
        derivedScore: result.derivedScore,
        overridden: result.overridden,
        stars: result.stars,
        penaltiesIssued: result.penaltiesIssued,
      },
    };
  } catch (error) {
    return toFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Manual submission sync (instructor OR admin)
// ---------------------------------------------------------------------------

/** What the sync button renders. A flat, already-summarised shape — the client
 *  must not have to know the `SweepReport` type to say what happened. */
export interface SyncSubmissionsSummary {
  assignmentsConsidered: number;
  assignmentsIngested: number;
  assignmentsSkipped: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skippedRows: number;
  missedDeadlinePenalties: number;
  durationMs: number;
  /** One line per assignment that did NO work, with the operator's next step. */
  problems: { assignmentId: number; title: string; reason: string; advice: string }[];
}

/**
 * Run the Google Sheet sweep NOW, on demand, instead of waiting for the cron.
 *
 * WHY AN ACTION AND NOT THE CRON ROUTE. `POST /api/cron/ingest-submissions` is
 * deliberately unreachable from a browser: it accepts only `Authorization: Bearer
 * $CRON_SECRET` and additionally rejects any request carrying a session cookie
 * (see that route's header). Putting `CRON_SECRET` anywhere a button could reach
 * it is precisely the confused-deputy leak that check exists to prevent. This
 * action re-uses the same two domain calls in the same order under a STAFF
 * session guard instead — no secret is involved and no route contract changes.
 *
 * Ingestion is idempotent (`submissions_row_ref_idx`), so pressing the button
 * while the cron happens to be running costs at most a few `duplicate_row_ref_in_db`
 * skips; it cannot double-insert.
 *
 * `triggeredBy: "manual"` so /assignments/ingest-status can still tell a human
 * pressing the button apart from evidence that the scheduler is alive.
 */
export async function syncSubmissionsAction(): Promise<ActionResult<SyncSubmissionsSummary>> {
  try {
    await requireStaffAction();

    const startedAt = Date.now();
    const sweep = await ingestAllAssignments({ triggeredBy: "manual" });

    // Ingestion first, then missed-deadline penalties — same ordering as the cron
    // route, and for the same reason: a student whose response landed in THIS run
    // must not be penalised for not submitting.
    const missedDeadlinePenalties = await persistMissedDeadlinePenalties();

    // Every page that reads submissions, so the instructor sees the new rows on
    // the next paint rather than after a manual reload.
    revalidatePath("/instructor/grading");
    revalidatePath("/instructor");
    revalidatePath("/instructor/analytics");
    revalidatePath("/assignments");
    revalidatePath("/assignments/ingest-status");
    revalidatePath("/dashboard");
    revalidatePath("/leaderboard");

    return {
      ok: true,
      data: {
        assignmentsConsidered: sweep.assignmentsConsidered,
        assignmentsIngested: sweep.assignmentsIngested,
        assignmentsSkipped: sweep.assignmentsSkipped,
        inserted: sweep.totalInserted,
        updated: sweep.totalUpdated,
        unchanged: sweep.totalUnchanged,
        skippedRows: sweep.totalSkippedRows,
        missedDeadlinePenalties,
        durationMs: Date.now() - startedAt,
        // An aborted assignment is the case the instructor actually needs to see:
        // "0 submissions" and "the sheet is published as a web page" look identical
        // from the grading queue, and only one of them is their problem to fix.
        problems: sweep.reports
          .filter((r) => r.aborted !== null)
          .map((r) => ({
            assignmentId: r.assignmentId,
            title: r.assignmentTitle,
            reason: r.aborted as string,
            advice: r.abortDetail ?? ABORT_ADVICE[r.aborted!],
          })),
      },
    };
  } catch (error) {
    return toFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Penalties (instructor OR admin — issuing a warning is a teaching act)
// ---------------------------------------------------------------------------

export async function issuePenaltyAction(
  raw: unknown,
): Promise<ActionResult<{ penaltyId: number }>> {
  try {
    const user = await requireStaffAction();

    const parsed = penaltyIssueSchema.safeParse(raw);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      return fail(
        Object.values(flat.fieldErrors).flat()[0] ?? "Invalid penalty.",
        flat.fieldErrors as Record<string, string[]>,
      );
    }

    const penaltyId = await issuePenalty(parsed.data, user.id);
    revalidatePath("/instructor/students");
    return { ok: true, data: { penaltyId } };
  } catch (error) {
    return toFailure(error);
  }
}

export async function resolvePenaltyAction(penaltyId: number): Promise<ActionResult> {
  try {
    await requireStaffAction();
    if (!Number.isInteger(penaltyId) || penaltyId <= 0) return fail("Invalid penalty id.");
    await resolvePenalty(penaltyId);
    revalidatePath("/instructor/students");
    return DONE;
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Ask the penalties stream what a situation warrants, without writing anything.
 *
 * `evaluatePenalties` is pure and owned by penalties-attendance; this stream
 * presents its suggestions in the penalty form so the instructor issues the same
 * penalty the automated rules would, rather than inventing a parallel policy.
 * Returns [] while that stream is still a stub — the form then just has no
 * pre-filled suggestion.
 */
export async function suggestPenaltiesAction(input: {
  studentId: number;
  daysLate: number;
  quizBestPercent: number | null;
  missedEntirely: boolean;
}): Promise<ActionResult<PenaltyDecision[]>> {
  try {
    await requireStaffAction();
    return { ok: true, data: evaluatePenalties(input) };
  } catch (error) {
    return toFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Admin-only: quiz authoring
// ---------------------------------------------------------------------------

export async function saveQuizAction(raw: unknown): Promise<ActionResult<{ quizId: number }>> {
  try {
    await requireAdminAction();
    const parsed = quizUpsertSchema.safeParse(raw);
    if (!parsed.success) return fail(firstError(parsed.error.flatten()));
    const quizId = await upsertQuiz(parsed.data);
    revalidatePath("/admin/quizzes");
    return { ok: true, data: { quizId } };
  } catch (error) {
    return toFailure(error);
  }
}

export async function saveQuestionAction(
  raw: unknown,
): Promise<ActionResult<{ questionId: number }>> {
  try {
    await requireAdminAction();
    const parsed = questionUpsertSchema.safeParse(raw);
    if (!parsed.success) return fail(firstError(parsed.error.flatten()));
    const questionId = await upsertQuestion(parsed.data);
    revalidatePath("/admin/quizzes");
    return { ok: true, data: { questionId } };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deleteQuestionAction(questionId: number): Promise<ActionResult> {
  try {
    await requireAdminAction();
    if (!Number.isInteger(questionId) || questionId <= 0) return fail("Invalid question id.");
    await deleteQuestion(questionId);
    revalidatePath("/admin/quizzes");
    return DONE;
  } catch (error) {
    return toFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Admin-only: assignments, deadlines, accounts
// ---------------------------------------------------------------------------

export async function saveAssignmentAction(
  raw: unknown,
): Promise<ActionResult<{ assignmentId: number }>> {
  try {
    await requireAdminAction();
    const parsed = assignmentUpsertSchema.safeParse(raw);
    if (!parsed.success) return fail(firstError(parsed.error.flatten()));
    const assignmentId = await upsertAssignment(parsed.data);
    revalidatePath("/admin/assignments");
    return { ok: true, data: { assignmentId } };
  } catch (error) {
    return toFailure(error);
  }
}

export async function setDeadlineAction(raw: unknown): Promise<ActionResult> {
  try {
    await requireAdminAction();
    const parsed = deadlineSchema.safeParse(raw);
    if (!parsed.success) return fail(firstError(parsed.error.flatten()));
    await setWeekDeadline(parsed.data);
    // The student dashboard reads weeks.dueAt; revalidate it so an admin's edit
    // is visible to students without waiting for the cache to age out.
    revalidatePath("/admin/deadlines");
    revalidatePath("/dashboard");
    // /weeks, not /course — course-content ships (app)/weeks/** and no /course
    // segment exists, so the old path revalidated nothing.
    revalidatePath("/weeks");
    return DONE;
  } catch (error) {
    return toFailure(error);
  }
}

export async function updateCohortAction(raw: unknown): Promise<ActionResult> {
  try {
    await requireAdminAction();
    const parsed = cohortConfigSchema.safeParse(raw);
    if (!parsed.success) return fail(firstError(parsed.error.flatten()));
    await updateCohortConfig(parsed.data);
    revalidatePath("/admin/deadlines");
    return DONE;
  } catch (error) {
    return toFailure(error);
  }
}

export async function updateAccountAction(raw: unknown): Promise<ActionResult> {
  try {
    await requireAdminAction();
    const parsed = accountUpdateSchema.safeParse(raw);
    if (!parsed.success) return fail(firstError(parsed.error.flatten()));
    await updateAccount(parsed.data);
    revalidatePath("/admin/students");
    return DONE;
  } catch (error) {
    return toFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Admin-only: report export
// ---------------------------------------------------------------------------

/**
 * Build the grade report as CSV text and hand it back for the browser to save.
 *
 * The text is returned rather than streamed from a route because this stream owns
 * no export route in the frozen map (see the header note). The client component
 * wraps it in a Blob and triggers the download.
 */
export async function exportGradesCsvAction(
  cohortId?: number,
): Promise<ActionResult<{ filename: string; csv: string; rowCount: number }>> {
  try {
    await requireAdminAction();
    const rows = await getGradeExportRows(cohortId);
    // buildCsv re-checks the headers against the credential deny-list, so an
    // export can never carry a password hash even if this projection changes.
    const csv = buildCsv(GRADE_EXPORT_COLUMNS, rows);
    return {
      ok: true,
      data: { filename: exportFilename("grades"), csv, rowCount: rows.length },
    };
  } catch (error) {
    return toFailure(error);
  }
}

function firstError(flat: {
  fieldErrors: Record<string, string[] | undefined>;
  formErrors: string[];
}): string {
  return (
    Object.values(flat.fieldErrors).flat().filter(Boolean)[0] ??
    flat.formErrors[0] ??
    "Invalid input."
  );
}
