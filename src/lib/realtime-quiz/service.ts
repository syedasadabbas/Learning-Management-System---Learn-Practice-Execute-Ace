// =============================================================================
// REALTIME-QUIZ SERVICE — read the check, reveal one answer. Nothing else.
// -----------------------------------------------------------------------------
// Owner: realtime-quiz stream.
//
// This is the whole behaviour of the `realtime` quiz kind, and the list of things
// it deliberately does NOT do is longer than the list of things it does:
//
//   NO attempt row          — attempts are unlimited, so counting them is
//                             meaningless and a row would make them countable.
//   NO answer row           — nothing to audit; this is not assessment.
//   NO progress write       — a lecture check must not mark a week complete.
//   NO scoring event        — `onScoringEvent` is not imported here; a leaderboard
//                             total cannot move because nothing tells it to.
//   NO penalty              — getting an inline check wrong is learning, not an
//                             offence.
//   NO unlock              — passing nothing cannot open week N+1.
//
// That list is not a promise in a comment: `./queries.ts` contains no write
// statement, and `./no-grade-effects.test.ts` fails the build if any module in
// this stream so much as imports the grading, progress, penalty or leaderboard
// machinery. The reason for the belt AND braces is that the failure mode is
// silent — a refactor that wired this into scoring would pass every positive
// test and quietly corrupt grades for a cohort.
//
// Durations, where they appear at all in this stream, are milliseconds.
// =============================================================================

import {
  isRealtimeQuiz,
  toInlineCheck,
  type InlineCheck,
} from "./payload";
import { revealAnswer, type RevealOutcome } from "./reveal";
import {
  selectAnswerKeyContext,
  selectQuestionsAndOptions,
  selectRealtimeQuizzesForWeek,
} from "./queries";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Every realtime check for a week, student-safe.
 *
 * Returns `[]` — never null and never a throw — when the week has none, because
 * the caller is a lecture page that must still render its video and notes. An
 * absent check is the normal case: most weeks have no realtime quiz authored.
 *
 * No `studentId` parameter, and that is the design. There is nothing per-student
 * to look up: no attempt history, no remaining budget, no best score. If a future
 * change needs a student id here, that is the smell that grading crept in.
 */
export async function loadInlineChecksForWeek(weekId: number): Promise<InlineCheck[]> {
  if (!Number.isInteger(weekId) || weekId <= 0) return [];

  const quizRows = await selectRealtimeQuizzesForWeek(weekId);
  // Defence in depth: the WHERE clause already filters on kind, so this only
  // fires if the query is changed. Cheap, and the thing it prevents is serving a
  // graded quiz through the ungraded path.
  const realtimeRows = quizRows.filter(isRealtimeQuiz);

  const checks: InlineCheck[] = [];
  for (const quiz of realtimeRows) {
    const { questions, options } = await selectQuestionsAndOptions(quiz.id);
    const check = toInlineCheck({ quiz, questions, options });
    if (check.questions.length > 0) checks.push(check);
  }
  return checks;
}

/**
 * One realtime check for a week, or null.
 *
 * `pick` is a zero-based index into the week's realtime checks. It exists because
 * a lecture cannot yet address "its" check by foreign key; the caller chooses
 * positionally instead. Out of range yields null rather than the first check —
 * silently showing the wrong lecture's questions would be worse than showing none.
 *
 * The original reason given here — "`quizzes` has no `lecture_id` column (frozen
 * seam)" — is stale: migration 0002 added nullable `quizzes.lecture_id`. This
 * stream simply does not read it yet. Corrected by qa-hardening; see the note in
 * ./queries.ts on `selectRealtimeQuizzesForWeek`.
 */
export async function loadInlineCheckForWeek(
  weekId: number,
  pick = 0,
): Promise<InlineCheck | null> {
  const checks = await loadInlineChecksForWeek(weekId);
  return checks[pick] ?? null;
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

export type CheckAnswerOutcome =
  | RevealOutcome
  | { ok: false; code: "question_not_found"; error: string }
  | { ok: false; code: "not_realtime"; error: string }
  | { ok: false; code: "invalid_input"; error: string };

/**
 * Check one committed answer and return the feedback for it.
 *
 * WHY THIS IS A SERVER ROUND TRIP rather than client-side comparison. Instant
 * client-side feedback needs the answer key in the browser, and a check whose
 * answers sit in the network tab before the student commits is decoration. One
 * round trip per question costs tens of milliseconds on a page the student is
 * already reading, and buys a real barrier. The trade-off is recorded in the
 * stream's hand-off.
 *
 * THE `not_realtime` REFUSAL IS THE SECURITY-RELEVANT PART. Without it this
 * function is an oracle that returns `isCorrect` and the explanation for ANY
 * question id in the database — including the graded practice quizzes and the
 * grand exam. The kind is therefore re-read from the owning quiz row on every
 * call and anything but `realtime` is refused, regardless of what the client sent.
 */
export async function checkInlineAnswer(params: {
  questionId: number;
  selectedOptionId: number;
}): Promise<CheckAnswerOutcome> {
  const { questionId, selectedOptionId } = params;

  if (
    !Number.isInteger(questionId) ||
    questionId <= 0 ||
    !Number.isInteger(selectedOptionId) ||
    selectedOptionId <= 0
  ) {
    return {
      ok: false,
      code: "invalid_input",
      error: "questionId and selectedOptionId must be positive integers.",
    };
  }

  const context = await selectAnswerKeyContext(questionId);
  if (!context) {
    return { ok: false, code: "question_not_found", error: "Question not found." };
  }

  if (!isRealtimeQuiz({ kind: context.quizKind })) {
    return {
      ok: false,
      code: "not_realtime",
      error: "That question belongs to a graded quiz and cannot be checked here.",
    };
  }

  return revealAnswer({
    question: context.question,
    options: context.options,
    selectedOptionId,
  });
}
