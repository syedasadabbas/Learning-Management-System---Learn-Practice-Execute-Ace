"use client";

// =============================================================================
// <QuestionExplanationViewer /> — why the right answer is right, and why each
// wrong one is wrong.
// Spec: TECHNICAL_SPECIFICATION.md §3.3.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// This is a PRESENTATION component: the explanation is handed in, never fetched.
// That is not a style preference, it is where the answer-key barrier sits. The
// quiz payload a student receives while ANSWERING is stripped of `isCorrect` and
// `explanation` (src/lib/quizzes/payload.ts) and the learning wave's
// `explanation_html`, `correct_breakdown` and `incorrect_analysis` columns are
// listed in `ANSWER_KEY_FIELDS`. A component that fetched its own explanation by
// question id would be a route from the quiz page to the answer key, which is
// the one thing the projection module exists to prevent. It renders what the
// RESULTS payload already contains, after grading, and nothing else.
//
// `visualBreakdown` and `visual_refutation` are rendered as TEXT. See the header
// of CommonMistakesDisplay for the argument; it is the same one.
//
// FOCUS AND ORDER. The correct answer comes first and the wrong-answer analysis
// second, with the student's OWN selection called out wherever it appears. A
// student who got it wrong needs to find their own answer in the list, and
// "which of these did I pick?" should not require reading all four.
// =============================================================================

import * as React from "react";

import { Badge, Card, cn } from "@/components/ui";

export interface QuestionExplanation {
  correctAnswer: {
    text: string;
    whyCorrect: string;
    visualBreakdown?: string;
  };
  incorrectOptions: Array<{
    optionText: string;
    whyWrong: string;
    commonMistake?: string;
  }>;
  deeperLearning?: {
    concepts: string[];
    videoUrl?: string;
  };
}

export interface QuestionExplanationViewerProps {
  questionId: number;
  explanation: QuestionExplanation;
  /** The option text the student chose. Compared verbatim — see `wasChosen`. */
  selectedAnswer: string;
  className?: string;
}

/**
 * Did the student pick this option?
 *
 * Compared on trimmed, case-folded text because `selectedAnswer` is the option
 * label as rendered and the explanation blob is authored separately; an author
 * who wrote "Block " with a trailing space should not silently break the
 * "you chose this" marker. Exported so the comparison is assertable.
 */
export function wasChosen(optionText: string, selectedAnswer: string): boolean {
  return optionText.trim().toLocaleLowerCase() === selectedAnswer.trim().toLocaleLowerCase();
}

export function QuestionExplanationViewer({
  questionId,
  explanation,
  selectedAnswer,
  className,
}: QuestionExplanationViewerProps) {
  const gotItRight = wasChosen(explanation.correctAnswer.text, selectedAnswer);
  const headingId = `explanation-${questionId}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex flex-col gap-4", className)}
      data-testid={`question-explanation-${questionId}`}
      data-correct={gotItRight}
    >
      <h3 id={headingId} className="text-base font-semibold text-ink">
        Explanation
      </h3>

      {/* The verdict in words. Not a coloured border, not an icon alone. */}
      <p className="text-sm font-medium text-ink" data-testid="explanation-verdict">
        {gotItRight
          ? "You chose the correct answer."
          : `You chose "${selectedAnswer}". That is not the correct answer.`}
      </p>

      <Card
        padded
        data-testid="correct-answer"
        className="border-l-4 border-l-emerald-500"
        title={
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="success" size="sm">
              Correct answer
            </Badge>
            <span className="font-semibold text-ink">{explanation.correctAnswer.text}</span>
          </span>
        }
      >
        <p className="text-sm text-ink-muted">{explanation.correctAnswer.whyCorrect}</p>
        {explanation.correctAnswer.visualBreakdown && (
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface p-3 font-mono text-xs text-ink-muted">
            {explanation.correctAnswer.visualBreakdown}
          </pre>
        )}
      </Card>

      {explanation.incorrectOptions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-ink">Why the others are wrong</h4>
          <ul className="flex flex-col gap-2">
            {explanation.incorrectOptions.map((option, index) => {
              const chosen = wasChosen(option.optionText, selectedAnswer);
              return (
                <li key={`${option.optionText}-${index}`}>
                  <Card
                    padded
                    data-testid={`incorrect-option-${index}`}
                    data-chosen={chosen || undefined}
                    className={cn(
                      "border-l-4",
                      chosen ? "border-l-red-500" : "border-l-line",
                    )}
                    title={
                      <span className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold text-ink">{option.optionText}</span>
                        {chosen && (
                          // The marker is a text badge, so "this is the one I
                          // picked" survives without colour vision.
                          <Badge tone="danger" size="sm">
                            You chose this
                          </Badge>
                        )}
                      </span>
                    }
                  >
                    <p className="text-sm text-ink-muted">{option.whyWrong}</p>
                    {option.commonMistake && (
                      <p className="mt-2 text-sm text-ink-muted">
                        <span className="font-semibold text-ink">Common mistake: </span>
                        {option.commonMistake}
                      </p>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {explanation.deeperLearning &&
        (explanation.deeperLearning.concepts.length > 0 ||
          explanation.deeperLearning.videoUrl) && (
          <div className="flex flex-col gap-2" data-testid="deeper-learning">
            <h4 className="text-sm font-semibold text-ink">Go deeper</h4>
            {explanation.deeperLearning.concepts.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {explanation.deeperLearning.concepts.map((concept) => (
                  <li key={concept}>
                    <Badge tone="neutral" size="sm">
                      {concept}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {explanation.deeperLearning.videoUrl && (
              <p className="text-sm">
                <a
                  className="text-brand underline"
                  href={explanation.deeperLearning.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Watch the explainer
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </p>
            )}
          </div>
        )}
    </section>
  );
}
