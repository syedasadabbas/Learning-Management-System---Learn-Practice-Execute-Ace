"use client";

// =============================================================================
// EXAM RUNNER — sit the grand quiz.
// Owner: grand-quiz stream.
// -----------------------------------------------------------------------------
// A client component because answering is stateful. It holds the student's
// selections and code, and NO answer key — the payload it receives has none
// (src/lib/grand-quiz/payload.ts strips `isCorrect`, `explanation` and `tests`).
//
// AUTOSAVE IS THE POINT. This is a 120-minute one-attempt exam, so a closed tab,
// a flat battery or a dropped connection must not cost work. Every change is
// POSTed to /api/exams/:attemptId/answer, debounced for the code editors and
// immediate for option choices. Each answer is its own request: one failing save
// therefore loses one answer, not the exam, and the student SEES which one failed.
//
// NOTHING HERE IS A SECURITY CONTROL. The countdown, the disabled Submit button
// and the "saved" indicators are all presentation:
//   * the deadline is enforced from `deadline_at` on the server (I2);
//   * the one-attempt rule is a unique index (I1);
//   * a repeat submit returns the recorded result rather than a second one (I3).
// Editing any of this in devtools changes what one student sees and nothing that
// is scored.
//
// Durations in milliseconds (house rule 5).
// =============================================================================

import * as React from "react";

import { Badge, Button, Card } from "@/components/ui";
import type { ApiResult } from "@/lib/contracts/api";
import type {
  ExamInProgressPayload,
  ExamQuestion,
  ExamResult,
} from "@/lib/grand-quiz";

import { ExamCountdown } from "./ExamCountdown";
import { ExamResults } from "./ExamResults";

export interface ExamRunnerProps {
  exam: ExamInProgressPayload;
  backHref?: string;
}

/** How long after the last keystroke a code answer is saved, in milliseconds. */
const CODE_DEBOUNCE_MS = 1_200;
/** Client-side ceiling on one request, in milliseconds. */
const REQUEST_TIMEOUT_MS = 30_000;

type SaveState = "idle" | "saving" | "saved" | "failed";

export function ExamRunner({ exam, backHref }: ExamRunnerProps) {
  const attemptId = exam.attempt.id;

  const [selected, setSelected] = React.useState<Map<number, number>>(
    () =>
      new Map(
        exam.saved
          .filter((answer) => answer.selectedOptionId != null)
          .map((answer) => [answer.questionId, answer.selectedOptionId as number]),
      ),
  );
  const [code, setCode] = React.useState<Map<number, string>>(
    () =>
      new Map(
        exam.saved
          .filter((answer) => answer.codeAnswer != null)
          .map((answer) => [answer.questionId, answer.codeAnswer as string]),
      ),
  );
  const [saveState, setSaveState] = React.useState<Map<number, SaveState>>(new Map());
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ExamResult | null>(null);

  const timersRef = React.useRef<Map<number, number>>(new Map());
  const submittedRef = React.useRef(false);

  // Clear any pending debounce on unmount so a save cannot fire against a
  // component that no longer exists.
  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const markSaveState = React.useCallback((questionId: number, state: SaveState) => {
    setSaveState((prev) => new Map(prev).set(questionId, state));
  }, []);

  /**
   * Persist one answer.
   *
   * A refusal (409 `attempt_terminal` / `attempt_expired`) is shown as an error
   * rather than retried: the exam is over, and a retry loop against a closed
   * attempt would spin for as long as the tab stayed open.
   */
  const saveAnswer = React.useCallback(
    async (
      questionId: number,
      body: { selectedOptionId?: number | null; codeAnswer?: string | null },
    ): Promise<void> => {
      markSaveState(questionId, "saving");
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(`/api/exams/${attemptId}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ questionId, ...body }),
        });
        const payload: ApiResult<unknown> = await response.json();
        if (!payload.ok) {
          markSaveState(questionId, "failed");
          setError(payload.error);
          return;
        }
        markSaveState(questionId, "saved");
        setError(null);
      } catch {
        markSaveState(questionId, "failed");
        setError(
          "That answer could not be saved. Check your connection — your other answers are safe.",
        );
      } finally {
        window.clearTimeout(timer);
      }
    },
    [attemptId, markSaveState],
  );

  function chooseOption(questionId: number, optionId: number): void {
    setSelected((prev) => new Map(prev).set(questionId, optionId));
    // Immediate: a click is a deliberate, final act and there is nothing to
    // debounce. It is also the answer most likely to be the last one before the
    // timer runs out.
    void saveAnswer(questionId, { selectedOptionId: optionId });
  }

  function writeCode(questionId: number, value: string): void {
    setCode((prev) => new Map(prev).set(questionId, value));
    markSaveState(questionId, "idle");

    const timers = timersRef.current;
    const existing = timers.get(questionId);
    if (existing) window.clearTimeout(existing);
    // Debounced: saving on every keystroke would be hundreds of requests per
    // question. 1.2 s is short enough that a crash loses at most one sentence.
    timers.set(
      questionId,
      window.setTimeout(() => {
        timers.delete(questionId);
        void saveAnswer(questionId, { codeAnswer: value });
      }, CODE_DEBOUNCE_MS),
    );
  }

  /**
   * Submit the exam.
   *
   * `auto` is true when the countdown reached zero (expiry trigger 1). Guarded by
   * a ref so a re-render or a second click cannot fire twice — though the server
   * would replay the same result if it did (I3).
   *
   * Pending debounced code saves are FLUSHED first. Without that, a student typing
   * at 119:58 and hitting Submit would lose their last edit to a timer that never
   * fired.
   */
  const submit = React.useCallback(
    async (auto: boolean): Promise<void> => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      setError(null);

      const timers = timersRef.current;
      const pending: Promise<void>[] = [];
      for (const [questionId, timer] of timers.entries()) {
        window.clearTimeout(timer);
        const value = code.get(questionId);
        if (value !== undefined) pending.push(saveAnswer(questionId, { codeAnswer: value }));
      }
      timers.clear();
      // Failures here are already surfaced by saveAnswer; the submit proceeds
      // regardless, because a saved-but-unconfirmed answer beats no submission.
      await Promise.allSettled(pending);

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(`/api/exams/${attemptId}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ autoSubmitted: auto }),
        });
        const payload: ApiResult<ExamResult> = await response.json();
        if (!payload.ok) {
          setError(payload.error);
          // Allow a retry: a network 500 must not leave the student with no way to
          // submit. The server is idempotent, so a retry cannot double-score.
          submittedRef.current = false;
          return;
        }
        setResult(payload.data);
      } catch {
        setError(
          "Your exam could not be submitted. Retry — your saved answers are on the server, " +
            "and the timer will submit for you if you run out of time.",
        );
        submittedRef.current = false;
      } finally {
        window.clearTimeout(timer);
        setSubmitting(false);
      }
    },
    [attemptId, code, saveAnswer],
  );

  const onExpire = React.useCallback(() => {
    void submit(true);
  }, [submit]);

  if (result) {
    // No `questions` prop. `ExamResult` carries one entry per question (I4), each
    // with its own `questionText` and `selectedOptionText`, so the per-question
    // outcome rendering that I6 requires is fully driven by the result itself —
    // and renders identically on a cold page load, where no in-progress payload
    // exists to pass alongside it.
    return <ExamResults result={result} {...(backHref ? { backHref } : {})} />;
  }

  const answeredCount = countAnswered(exam.questions, selected, code);

  return (
    <div className="space-y-4" data-testid="exam-runner" data-attempt-id={attemptId}>
      <Card
        title={exam.quiz.title}
        subtitle={`${exam.questions.length} questions · ${exam.quiz.totalPoints} marks · pass mark ${exam.quiz.passingScore}%`}
        action={<ExamCountdown seed={exam.attempt.countdown} onExpire={onExpire} />}
        data-testid="exam-header"
      >
        <p className="text-sm text-ink-muted" data-testid="exam-answered-count">
          Answered {answeredCount} of {exam.questions.length}. Every answer is saved as you
          go.
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          This is your only attempt. Unanswered questions are recorded with no mark — they
          never subtract.
        </p>
      </Card>

      <ol className="space-y-3">
        {exam.questions.map((question, index) => (
          <li key={question.id}>
            <QuestionCard
              question={question}
              index={index}
              selectedOptionId={selected.get(question.id) ?? null}
              code={code.get(question.id) ?? ""}
              saveState={saveState.get(question.id) ?? "idle"}
              onChooseOption={chooseOption}
              onWriteCode={writeCode}
            />
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="text-sm text-red-700" data-testid="exam-error">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          loading={submitting}
          data-testid="submit-exam"
          onClick={() => void submit(false)}
        >
          Submit exam
        </Button>
        <span className="text-sm text-ink-muted">
          {answeredCount < exam.questions.length
            ? `${exam.questions.length - answeredCount} unanswered — they will be recorded with no mark.`
            : "All questions answered."}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One question
// ---------------------------------------------------------------------------

function QuestionCard({
  question,
  index,
  selectedOptionId,
  code,
  saveState,
  onChooseOption,
  onWriteCode,
}: {
  question: ExamQuestion;
  index: number;
  selectedOptionId: number | null;
  code: string;
  saveState: SaveState;
  onChooseOption: (questionId: number, optionId: number) => void;
  onWriteCode: (questionId: number, value: string) => void;
}) {
  const isCodeWrite = question.type === "code_write";

  return (
    <Card
      data-testid={`exam-question-${question.id}`}
      action={
        <span className="flex items-center gap-2">
          <Badge tone="neutral" size="sm">
            {question.points} {question.points === 1 ? "mark" : "marks"}
          </Badge>
          <SaveIndicator state={saveState} />
        </span>
      }
    >
      <fieldset>
        <legend className="font-medium">
          {index + 1}. {question.questionText}
        </legend>

        {/*
          `starterCode` is the skeleton for a code_write item and the BROKEN program
          for a code_fix item. Rendered read-only for code_fix: the student answers
          that type by choosing the correct fix, so an editable box would invite
          work that is never marked.
        */}
        {question.starterCode && (
          <pre
            className="mt-3 overflow-x-auto rounded border border-line bg-surface p-3 text-xs"
            data-testid={`exam-starter-${question.id}`}
          >
            <code>{question.starterCode}</code>
          </pre>
        )}

        {isCodeWrite ? (
          <div className="mt-3">
            <label className="text-sm text-ink-muted" htmlFor={`code-${question.id}`}>
              Your {question.language ?? "code"} answer
            </label>
            <textarea
              id={`code-${question.id}`}
              className="mt-1 h-48 w-full rounded border border-line bg-panel p-2 font-mono text-xs"
              spellCheck={false}
              value={code}
              onChange={(event) => onWriteCode(question.id, event.target.value)}
              data-testid={`exam-code-${question.id}`}
            />
            <p className="mt-1 text-xs text-ink-muted">
              Graded by running hidden tests. If the runner is unavailable, an instructor
              marks it by hand — it is never marked wrong for that.
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {question.options.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-start gap-2 rounded border border-line p-2 hover:bg-surface"
              >
                <input
                  type="radio"
                  name={`exam-question-${question.id}`}
                  value={option.id}
                  checked={selectedOptionId === option.id}
                  onChange={() => onChooseOption(question.id, option.id)}
                  className="mt-1"
                />
                <span className="text-sm">{option.optionText}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </Card>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  if (state === "saving") {
    return (
      <Badge tone="neutral" size="sm" data-testid="save-state-saving">
        Saving…
      </Badge>
    );
  }
  if (state === "saved") {
    return (
      <Badge tone="success" size="sm" data-testid="save-state-saved">
        Saved
      </Badge>
    );
  }
  return (
    <Badge tone="danger" size="sm" data-testid="save-state-failed">
      Not saved
    </Badge>
  );
}

/**
 * How many questions carry an answer.
 *
 * Whitespace-only code does not count, matching the server's own rule
 * (`normaliseCode` in src/lib/grand-quiz/grading.ts) so the counter the student
 * watches agrees with the `unansweredCount` they are shown afterwards.
 */
function countAnswered(
  questions: readonly ExamQuestion[],
  selected: ReadonlyMap<number, number>,
  code: ReadonlyMap<number, string>,
): number {
  let count = 0;
  for (const question of questions) {
    if (question.type === "code_write") {
      if ((code.get(question.id) ?? "").trim().length > 0) count += 1;
    } else if (selected.has(question.id)) {
      count += 1;
    }
  }
  return count;
}
