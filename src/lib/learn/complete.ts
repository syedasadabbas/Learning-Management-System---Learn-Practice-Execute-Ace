// =============================================================================
// STEP COMPLETION — the one write this stream performs.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// IDEMPOTENCE IS DELEGATED TO THE UNIQUE INDEX, NOT TO A READ-THEN-WRITE.
//
// `learning_progress_student_step_idx` is unique on (student_id, step_id) and the
// schema comment states its purpose: "Completing a step twice is a no-op, not a
// second row." The tempting implementation is `select ... if (!found) insert`,
// and it is wrong for a reason this app has already been bitten by elsewhere: two
// requests can both pass the SELECT before either INSERTs. A double-click on
// "Mark complete", or the autocomplete firing while the student also clicks, is
// exactly that race. `onConflictDoNothing()` pushes the decision into the index,
// where it is atomic.
//
// `.returning()` is what makes the outcome observable: an empty array means the
// row already existed, so the caller can report `created: false` honestly instead
// of claiming a first completion every time.
//
// NEVER THROWS AT THE CALLER. Every failure is a discriminated value, following
// the same rule the execution stream adopted. A student losing a step of progress
// to an unhandled rejection is a small loss; a 500 in the middle of a module is a
// worse one.
// =============================================================================

import { db } from "@/db";
import { learningProgress } from "@/db/schema";

import { evaluateCheck, parseCheck, parseStepKind } from "./expectation";
import { completedCountForModule, findPublishedStep } from "./query";
import { moduleProgress, progressAnnouncement } from "./progress";
import type { CheckOutcome } from "./expectation";
import type { ModuleProgress } from "./progress";

export interface CompleteStepInput {
  studentId: number;
  stepId: number;
  /**
   * For a `check` step: the index of the option the student picked.
   *
   * Grading happens here rather than in the browser so the answer key never has
   * to be shipped. Answering WRONGLY still completes the step: these tracks carry
   * no marks (see types.ts), the explanation is the teaching, and locking a
   * student out of the next step for a wrong self-check would only encourage
   * guessing until it opens.
   */
  answerIndex?: number;
}

export type CompleteStepResult =
  | {
      ok: true;
      /** False when the step was already complete — the idempotent path. */
      created: boolean;
      stepId: number;
      moduleId: number;
      progress: ModuleProgress;
      /** The sentence the client announces in its live region. */
      announcement: string;
      /** Present only for a `check` step that was answered. */
      check: CheckOutcome | null;
    }
  | {
      ok: false;
      reason: "not_found" | "invalid_step" | "write_failed";
      message: string;
    };

/**
 * Record that `studentId` finished `stepId`, and grade an inline check if one was
 * answered. Safe to call repeatedly with the same arguments.
 */
export async function completeStep(input: CompleteStepInput): Promise<CompleteStepResult> {
  const { studentId, stepId, answerIndex } = input;

  if (!Number.isInteger(studentId) || studentId <= 0) {
    return { ok: false, reason: "invalid_step", message: "Not a valid student." };
  }
  if (!Number.isInteger(stepId) || stepId <= 0) {
    return { ok: false, reason: "invalid_step", message: "Not a valid step id." };
  }

  try {
    // Unpublished modules are invisible here too, not only in the page queries.
    const step = await findPublishedStep(stepId);
    if (!step) {
      return { ok: false, reason: "not_found", message: "That step does not exist." };
    }

    let check: CheckOutcome | null = null;
    if (parseStepKind(step.kind) === "check" && answerIndex !== undefined) {
      const parsed = parseCheck(step.expectation);
      // A malformed check grades as nothing rather than as wrong: the content is
      // at fault, not the student.
      if (parsed) check = evaluateCheck(parsed, answerIndex);
    }

    const inserted = await db
      .insert(learningProgress)
      .values({ studentId, stepId })
      .onConflictDoNothing({
        target: [learningProgress.studentId, learningProgress.stepId],
      })
      .returning({ id: learningProgress.id });

    const completedSteps = await completedCountForModule(studentId, step.moduleId);
    const progress = moduleProgress({ stepCount: step.stepCount, completedSteps });

    return {
      ok: true,
      created: inserted.length > 0,
      stepId: step.stepId,
      moduleId: step.moduleId,
      progress,
      announcement: progressAnnouncement(progress),
      check,
    };
  } catch (err) {
    console.error("[learn] completeStep failed", { studentId, stepId, err });
    return {
      ok: false,
      reason: "write_failed",
      message: "Could not save that step. Your earlier steps are unaffected.",
    };
  }
}
