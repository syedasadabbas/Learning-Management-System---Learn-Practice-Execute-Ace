"use client";

// =============================================================================
// QUIZ RUNNER — the take-a-quiz form.
// Owner: quizzes stream.
// -----------------------------------------------------------------------------
// A client component because answering is stateful. It holds only the student's
// selections; it holds no answer key, because the payload it is given has none
// (src/lib/quizzes/payload.ts strips `isCorrect` and `explanation`).
//
// The Submit button is disabled while a request is in flight and once the
// attempt budget is spent, but neither is a security control: the 3-attempt
// limit and the grading are both enforced in
// POST /api/quizzes/:quizId/submit inside a transaction.
//
// Durations are milliseconds (house rule 5).
// =============================================================================

import * as React from "react";

import { Badge, Button, Card } from "@/components/ui";
import type { StudentQuizPayload } from "@/lib/quizzes/payload";
import type { AttemptResult } from "@/lib/quizzes/service";
import type { ApiResult } from "@/lib/contracts/api";

import { QuizResults } from "./QuizResults";

export interface QuizRunnerProps {
  quiz: StudentQuizPayload;
  /** Where "Back to the week" links to. Supplied by the page, which knows the route. */
  backHref?: string;
}

/** Client-side request timeout, in milliseconds. */
const SUBMIT_TIMEOUT_MS = 20_000;

export function QuizRunner({ quiz, backHref }: QuizRunnerProps) {
  // questionId -> selected optionId. A Map keyed by number avoids the
  // string-keyed-object coercion that makes `answers[q.id]` quietly stringy.
  const [selected, setSelected] = React.useState<Map<number, number>>(new Map());
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<AttemptResult | null>(null);
  /** Attempts used, kept locally so the counter updates without a reload. */
  const [attemptsUsed, setAttemptsUsed] = React.useState(quiz.attemptsUsed);

  const attemptsLeft = Math.max(0, quiz.quiz.attemptsAllowed - attemptsUsed);
  const answeredCount = selected.size;
  const total = quiz.questions.length;

  function choose(questionId: number, optionId: number): void {
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(questionId, optionId);
      return next;
    });
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    // `quizSubmitSchema` requires at least one answer, so an empty submission
    // would come back as a 400. Say so here instead of round-tripping.
    if (selected.size === 0) {
      setError("Answer at least one question before submitting.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

    try {
      const response = await fetch(`/api/quizzes/${quiz.quiz.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          quizId: quiz.quiz.id,
          answers: [...selected.entries()].map(([questionId, selectedOptionId]) => ({
            questionId,
            selectedOptionId,
          })),
        }),
      });

      const body: ApiResult<AttemptResult> = await response.json();
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setResult(body.data);
      setAttemptsUsed(body.data.attemptsUsed);
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "AbortError"
          ? `The server did not respond within ${SUBMIT_TIMEOUT_MS} ms. Your attempt was not recorded.`
          : "Could not reach the server. Your attempt was not recorded.",
      );
    } finally {
      clearTimeout(timer);
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <QuizResults
        result={result}
        questions={quiz.questions}
        actions={
          <>
            {result.attemptsRemaining > 0 && (
              <Button
                variant="secondary"
                data-testid="retake-quiz"
                onClick={() => {
                  setResult(null);
                  setSelected(new Map());
                }}
              >
                Try again ({result.attemptsRemaining} left)
              </Button>
            )}
            {backHref && (
              <Button variant="ghost" onClick={() => { window.location.href = backHref; }}>
                Back to the week
              </Button>
            )}
          </>
        }
      />
    );
  }

  if (attemptsLeft === 0) {
    return (
      <Card
        title="No attempts left"
        subtitle={`You have used all ${quiz.quiz.attemptsAllowed} attempts.`}
        data-testid="attempts-exhausted"
      >
        <p className="text-sm text-ink-muted">
          Best attempt: {quiz.bestPercent ?? 0}% ({quiz.passed ? "passed" : "not passed"}).
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} data-testid="quiz-form" className="space-y-4">
      <Card
        title={quiz.quiz.title}
        subtitle={`${total} questions · pass mark ${quiz.quiz.passingScore}%`}
        action={
          <Badge tone={attemptsLeft > 1 ? "brand" : "warning"} data-testid="attempts-remaining">
            {attemptsLeft} of {quiz.quiz.attemptsAllowed} attempts left
          </Badge>
        }
      >
        <p className="text-sm text-ink-muted" data-testid="answered-count">
          Answered {answeredCount} of {total}.
        </p>
        {quiz.bestPercent != null && (
          <p className="mt-1 text-sm text-ink-muted">
            Best so far: {quiz.bestPercent}%.
          </p>
        )}
      </Card>

      <ol className="space-y-3">
        {quiz.questions.map((question, index) => (
          <li key={question.id}>
            <Card data-testid={`question-${question.id}`}>
              <fieldset>
                <legend className="font-medium">
                  {index + 1}. {question.questionText}
                </legend>
                <div className="mt-3 space-y-2">
                  {question.options.map((option) => (
                    <label
                      key={option.id}
                      className="flex cursor-pointer items-start gap-2 rounded border border-line p-2 hover:bg-surface"
                    >
                      <input
                        type="radio"
                        name={`question-${question.id}`}
                        value={option.id}
                        checked={selected.get(question.id) === option.id}
                        onChange={() => choose(question.id, option.id)}
                        className="mt-1"
                      />
                      <span className="text-sm">{option.optionText}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </Card>
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="text-sm text-red-700" data-testid="quiz-error">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" loading={submitting} data-testid="submit-quiz">
          Submit quiz
        </Button>
        <span className="text-sm text-ink-muted">
          {answeredCount < total
            ? `${total - answeredCount} unanswered — they will be marked incorrect.`
            : "All questions answered."}
        </span>
      </div>
    </form>
  );
}
