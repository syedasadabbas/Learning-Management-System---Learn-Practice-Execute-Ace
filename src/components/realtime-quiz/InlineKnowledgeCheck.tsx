"use client";

// =============================================================================
// INLINE KNOWLEDGE CHECK — an ungraded check that lives INSIDE a lecture.
// -----------------------------------------------------------------------------
// Owner: realtime-quiz stream.
//
// WHY IT LOOKS LIKE THIS
//
// 1. NO PAGE FRAME. A <section>, not a <main>; a Card heading (<h3>, matching
//    every other Card in the app), not an <h1>. It is dropped into the middle of
//    a lecture page that already owns those, and duplicating either breaks the
//    document outline for screen-reader users.
//
// 2. SAFE TO MOUNT MORE THAN ONCE ON ONE PAGE. Every id and every radio-group
//    `name` is derived from `React.useId()`, so two checks on one lecture cannot
//    share a group — which would otherwise let selecting an answer in the second
//    check silently clear the first. There is no module-level state here at all.
//
// 3. NATIVE RADIOS, NOT DIVS. Arrow-key traversal, roving focus, group semantics
//    and the announced "2 of 4" position all come free and correct from
//    <input type="radio"> + <fieldset>/<legend>. A hand-rolled listbox would have
//    to re-implement them, and usually re-implements them wrong.
//
// 4. AN EXPLICIT "Check answer" BUTTON, not check-on-select. Arrow keys MOVE the
//    selection in a radio group, so auto-checking would fire feedback for every
//    option a keyboard user passes over on the way to the one they wanted —
//    turning navigation into three wrong answers. The button is the accessible
//    choice, not a conservative one.
//
// 5. FEEDBACK IS NEVER COLOUR-ONLY. Each outcome carries the words "Correct" or
//    "Not quite", the correct option is labelled "(correct answer)" in text, and
//    the student's pick is labelled "(your answer)". The Badge tone and the ✓ / ✗
//    glyph are decoration on top — the glyph is aria-hidden so it is not read as
//    "check mark" mid-sentence.
//
// 6. THE LIVE REGION IS RENDERED EMPTY FROM THE START. A role="status" element
//    inserted at the same moment as its text is frequently not announced; the
//    container must already exist for the update to count as a live change.
//
// 7. NO MARKS ANYWHERE. There is no score, no counter, no attempt budget and no
//    "you passed" state in this component, because the realtime kind has none.
//    Answering is unlimited by construction: nothing counts the tries, so nothing
//    can run out. See src/lib/realtime-quiz/service.ts for the full prohibition
//    list and the tests that enforce it.
//
// The answer key never reaches this component ahead of time: `InlineCheck` has no
// `isCorrect` and no `explanation` (src/lib/realtime-quiz/payload.ts). Feedback
// arrives from `onCheckAnswer` only after the student commits — one server round
// trip, tens of milliseconds, on a page they are already reading.
//
// Colours come from the design tokens in globals.css via the ui primitives; no
// hex literal appears in this file.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, cn } from "@/components/ui";
import type { InlineCheck, InlineQuestion } from "@/lib/realtime-quiz";
import type { CheckAnswerOutcome } from "@/lib/realtime-quiz";

/** What the component knows about one question's local state. */
interface QuestionState {
  selectedOptionId: number | null;
  /** Populated only after a successful check. Null before, and after a reset. */
  result: { isCorrect: boolean; correctOptionId: number; explanation: string | null } | null;
  /** A refusal or transport failure, in words the student can act on. */
  error: string | null;
  pending: boolean;
}

const EMPTY_STATE: QuestionState = {
  selectedOptionId: null,
  result: null,
  error: null,
  pending: false,
};

export interface InlineKnowledgeCheckProps {
  check: InlineCheck;
  /**
   * Commits one answer and returns the feedback for it.
   *
   * Injected rather than imported so this component stays a pure client
   * component: the server action is passed in by
   * `./RealtimeCheckPanel.tsx`, and the unit tests pass a fake. Importing the
   * action here would put a server module in the browser graph and make the
   * component untestable without a database.
   */
  onCheckAnswer: (input: {
    questionId: number;
    selectedOptionId: number;
  }) => Promise<CheckAnswerOutcome>;
  /** Overrides the quiz title as the section heading. */
  heading?: string;
  className?: string;
}

export function InlineKnowledgeCheck({
  check,
  onCheckAnswer,
  heading,
  className,
}: InlineKnowledgeCheckProps) {
  // One id namespace per mounted instance — see note 2 in the header comment.
  const uid = React.useId();
  const headingId = `${uid}-heading`;

  const [states, setStates] = React.useState<Record<number, QuestionState>>({});

  const stateFor = (questionId: number): QuestionState => states[questionId] ?? EMPTY_STATE;

  const patch = React.useCallback((questionId: number, next: Partial<QuestionState>) => {
    setStates((prev) => ({
      ...prev,
      [questionId]: { ...(prev[questionId] ?? EMPTY_STATE), ...next },
    }));
  }, []);

  function handleSelect(questionId: number, optionId: number): void {
    // Changing the selection clears the previous verdict: leaving "Not quite"
    // beside a freshly picked option would attribute the old outcome to the new
    // answer.
    patch(questionId, { selectedOptionId: optionId, result: null, error: null });
  }

  /**
   * Back to an unanswered question. This is what "unlimited attempts" means in
   * practice — there is no counter to increment and nothing to exhaust, so the
   * reset is total and always available.
   */
  function handleReset(questionId: number): void {
    patch(questionId, { selectedOptionId: null, result: null, error: null });
  }

  async function handleCheck(questionId: number): Promise<void> {
    const current = stateFor(questionId);
    if (current.selectedOptionId == null || current.pending) return;

    patch(questionId, { pending: true, error: null });
    try {
      const outcome = await onCheckAnswer({
        questionId,
        selectedOptionId: current.selectedOptionId,
      });
      if (outcome.ok) {
        patch(questionId, {
          pending: false,
          result: {
            isCorrect: outcome.reveal.isCorrect,
            correctOptionId: outcome.reveal.correctOptionId,
            explanation: outcome.reveal.explanation,
          },
        });
      } else {
        patch(questionId, { pending: false, result: null, error: outcome.error });
      }
    } catch {
      // The action can reject on a dropped connection or an expired session. The
      // student is mid-lecture: degrade to a retryable message, never to a
      // thrown client error over the page they were reading.
      patch(questionId, {
        pending: false,
        result: null,
        error: "Could not check that answer just now. Please try again.",
      });
    }
  }

  // Nothing authored, nothing to render. Returning null rather than an empty
  // panel keeps the lecture page free of a heading with no content under it.
  if (check.questions.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="realtime-check"
      data-quiz-id={check.quizId}
      className={className}
    >
      <Card
        title={<span id={headingId}>{heading ?? check.title}</span>}
        subtitle="Check your understanding. Unlimited tries, and nothing here counts towards your marks."
        action={
          <Badge tone="neutral" data-testid="realtime-ungraded-badge">
            Not graded
          </Badge>
        }
      >
        <ol className="flex list-none flex-col gap-6 p-0">
          {check.questions.map((question, index) => (
            <li key={question.id}>
              <QuestionBlock
                uid={uid}
                question={question}
                position={index + 1}
                total={check.questions.length}
                state={stateFor(question.id)}
                onSelect={handleSelect}
                onCheck={handleCheck}
                onReset={handleReset}
              />
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// One question
// ---------------------------------------------------------------------------

function QuestionBlock({
  uid,
  question,
  position,
  total,
  state,
  onSelect,
  onCheck,
  onReset,
}: {
  uid: string;
  question: InlineQuestion;
  position: number;
  total: number;
  state: QuestionState;
  onSelect: (questionId: number, optionId: number) => void;
  onCheck: (questionId: number) => void;
  onReset: (questionId: number) => void;
}) {
  const groupName = `${uid}-q${question.id}`;
  const statusId = `${groupName}-status`;
  const { result, error, pending, selectedOptionId } = state;

  return (
    <div data-testid="realtime-question" data-question-id={question.id}>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-sm font-medium text-ink">
          <span className="text-ink-muted">
            Question {position} of {total}
          </span>
          <span className="mt-1 block text-base">{question.questionText}</span>
        </legend>

        <div className="flex flex-col gap-2">
          {question.options.map((option) => {
            const optionId = `${groupName}-o${option.id}`;
            const isChosen = selectedOptionId === option.id;
            const isKey = result != null && result.correctOptionId === option.id;
            // Text labels, not colour, carry the meaning. See header note 5.
            const showKeyLabel = isKey;
            const showChoiceLabel = result != null && isChosen;

            return (
              <label
                key={option.id}
                htmlFor={optionId}
                data-testid="realtime-option"
                data-option-id={option.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm",
                  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand",
                  isKey ? "border-brand bg-brand/5" : "border-line bg-panel",
                )}
              >
                <input
                  id={optionId}
                  type="radio"
                  name={groupName}
                  value={String(option.id)}
                  checked={isChosen}
                  disabled={pending}
                  onChange={() => onSelect(question.id, option.id)}
                  className="mt-0.5 accent-brand"
                />
                <span className="text-ink">
                  {option.optionText}
                  {showChoiceLabel && (
                    <span className="ml-2 text-xs text-ink-muted">(your answer)</span>
                  )}
                  {showKeyLabel && (
                    <span className="ml-2 text-xs font-medium text-brand">
                      (correct answer)
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          loading={pending}
          disabled={selectedOptionId == null}
          aria-describedby={statusId}
          data-testid="realtime-check-answer"
          onClick={() => onCheck(question.id)}
        >
          Check answer
        </Button>
        {result != null && (
          <Button
            size="sm"
            variant="secondary"
            data-testid="realtime-try-again"
            onClick={() => onReset(question.id)}
          >
            Try again
          </Button>
        )}
      </div>

      {/*
        Rendered unconditionally and empty until there is something to say — see
        header note 6. `aria-atomic` so the verdict and its explanation are read
        as one utterance rather than two fragments.
      */}
      <div
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="realtime-feedback"
        className="mt-2 text-sm"
      >
        {result != null && (
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2">
              <Badge
                tone={result.isCorrect ? "success" : "warning"}
                data-testid="realtime-verdict"
              >
                <span aria-hidden="true">{result.isCorrect ? "✓" : "✗"}</span>
                {result.isCorrect ? "Correct" : "Not quite"}
              </Badge>
              <span className="text-ink-muted">
                {result.isCorrect
                  ? "That is the right answer."
                  : "The correct answer is marked below."}
              </span>
            </p>
            {result.explanation && (
              <p data-testid="realtime-explanation" className="text-ink">
                {result.explanation}
              </p>
            )}
          </div>
        )}
        {error != null && (
          <p data-testid="realtime-error" className="text-ink">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
