// =============================================================================
// QUIZ RESULTS — post-grading view.
// Owner: quizzes stream.
// -----------------------------------------------------------------------------
// This is the ONLY quiz surface that shows correctness or explanations, and it
// renders exclusively from the POST /submit response — never from the GET quiz
// payload, which has no answer key in it (see src/lib/quizzes/payload.ts).
//
// Percentages and pass/fail come from the server response. Nothing is
// recomputed here: a client-side threshold check would be a second copy of
// scoring.ts and could disagree with the recorded grade.
// =============================================================================

import { Badge, Card, ProgressBar } from "@/components/ui";
import type { AttemptResult } from "@/lib/quizzes/service";
import type { StudentQuestion } from "@/lib/quizzes/payload";

export interface QuizResultsProps {
  result: AttemptResult;
  /** The questions as shown to the student, for question text and option text. */
  questions: readonly StudentQuestion[];
  /** Rendered under the summary — typically a "try again" / "back" control. */
  actions?: React.ReactNode;
}

export function QuizResults({ result, questions, actions }: QuizResultsProps) {
  const questionById = new Map(questions.map((q) => [q.id, q]));

  return (
    <div className="space-y-4" data-testid="quiz-results">
      <Card
        title={result.passed ? "Passed" : "Not passed"}
        subtitle={`Attempt ${result.attemptNumber} of ${result.attemptsAllowed}`}
        action={
          <Badge tone={result.passed ? "success" : "danger"} data-testid="result-status">
            {result.passed ? "PASS" : "FAIL"}
          </Badge>
        }
      >
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Score" value={`${result.score} / ${result.totalPossible}`} testId="result-score" />
          <Stat label="Percentage" value={`${result.percentage}%`} testId="result-percentage" />
          <Stat label="Pass mark" value={`${result.passingScore}%`} testId="result-pass-mark" />
          <Stat
            label="Attempts left"
            value={String(result.attemptsRemaining)}
            testId="attempts-remaining"
          />
        </dl>

        <div className="mt-4">
          <ProgressBar
            percent={result.percentage}
            tone={result.passed ? "success" : "danger"}
            ariaLabel="Quiz percentage"
          />
        </div>

        <p className="mt-3 text-sm text-ink-muted" data-testid="best-percent">
          Best attempt so far: {result.bestPercent}% — {result.quizPoints} quiz points.
        </p>

        {result.unlockedWeekNumber != null && (
          <p className="mt-1 text-sm" data-testid="unlock-notice">
            Week {result.unlockedWeekNumber} is unlocked
            {result.unlockedNow ? "." : " (already unlocked by an earlier attempt)."}
          </p>
        )}

        {result.ignored.length > 0 && (
          // Surfaced rather than hidden: a non-empty list means the client sent
          // something the grader could not use, which is a bug worth seeing.
          <p className="mt-1 text-sm text-ink-muted" data-testid="ignored-notice">
            {result.ignored.length} submitted answer(s) were not counted.
          </p>
        )}

        {actions && <div className="mt-4 flex gap-2">{actions}</div>}
      </Card>

      <ol className="space-y-3" data-testid="result-breakdown">
        {result.answers.map((answer, index) => {
          const question = questionById.get(answer.questionId);
          const selected = question?.options.find((o) => o.id === answer.selectedOptionId);
          return (
            <li key={answer.questionId}>
              <Card data-testid={`question-result-${answer.questionId}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">
                    {index + 1}. {question?.questionText ?? "(question unavailable)"}
                  </p>
                  <Badge tone={answer.isCorrect ? "success" : "danger"} dot>
                    {answer.isCorrect ? "Correct" : "Incorrect"}
                  </Badge>
                </div>

                <p className="mt-2 text-sm">
                  <span className="text-ink-muted">Your answer: </span>
                  {selected ? selected.optionText : <em>Not answered</em>}
                </p>

                {answer.explanation && (
                  <p
                    className="mt-2 rounded border border-line bg-surface p-2 text-sm"
                    data-testid={`explanation-${answer.questionId}`}
                  >
                    {answer.explanation}
                  </p>
                )}
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-lg font-semibold" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
