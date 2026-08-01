"use client";

// =============================================================================
// EXAM RESULTS — invariant I6's visible half.
// Owner: grand-quiz stream.
// -----------------------------------------------------------------------------
// I6 exists because of two OPPOSITE failures, and this component is where both are
// avoided:
//
//   1. A blank "your instructor will be in touch" screen after a two-hour exam.
//      That is the thing students complain about most, so a score is always shown
//      — the auto-graded items were scored inside the submit transaction, so a
//      score always exists.
//
//   2. A confident total that later DROPS. That is the defect already open on
//      ungraded assignments scoring 40/40 (HANDOFF.md, decision 1). So the total
//      is labelled `Provisional` exactly when `deferredCount > 0`, and the copy
//      states the direction plainly: it can only go UP. That claim is true because
//      a deferred item currently holds 0 and I5 forbids a negative award.
//
// The wording is deliberate. "Provisional — this can only go up" tells a student
// what to expect; "pending grading" tells them nothing and invites them to assume
// the worst.
//
// This view MAY show `explanation` and correctness: the attempt is terminal (I3),
// so nothing here can help anyone re-answer. It still never shows hidden tests —
// those are reused for the next cohort.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, ProgressBar } from "@/components/ui";
import type { ExamResult, ExamResultAnswer } from "@/lib/grand-quiz";

export interface ExamResultsProps {
  /**
   * The whole result, and the ONLY prop this view needs.
   *
   * `ExamResultAnswer` carries its own `questionText` and `selectedOptionText`, so
   * this renders identically whether the student just submitted or reloaded the
   * page an hour later — there is no companion `questions` prop that could be
   * missing on the second path.
   */
  result: ExamResult;
  backHref?: string;
}

export function ExamResults({ result, backHref }: ExamResultsProps) {
  return (
    <div className="space-y-4" data-testid="exam-results">
      <Card
        title={result.provisional ? "Provisional result" : "Your result"}
        subtitle={
          result.autoSubmitted
            ? "The timer submitted this exam for you. Everything you had saved was marked."
            : "Submitted by you."
        }
        action={
          <Badge
            tone={result.provisional ? "warning" : result.passed ? "success" : "danger"}
            data-testid="exam-result-badge"
          >
            {result.provisional ? "Provisional" : result.passed ? "Passed" : "Not passed"}
          </Badge>
        }
      >
        <p className="text-lg font-semibold" data-testid="exam-score">
          {result.score} / {result.totalPossible} ({result.percentage}%)
        </p>
        <div className="mt-2">
          <ProgressBar
            percent={result.percentage}
            label={`Pass mark ${result.passingScore}%`}
            showValue
            // ProgressTone is "brand" | "accent" | "success" | "danger" — there is
            // no "warning" member, and src/components/ui is read-only for this
            // stream. `brand` rather than `danger` for a not-yet-passing total:
            // while items are still awaiting grading the bar can only grow, so
            // colouring it as a failure would state something not yet true.
            tone={result.passed ? "success" : result.provisional ? "brand" : "danger"}
          />
        </div>

        {result.provisional ? (
          <p className="mt-3 text-sm text-ink-muted" data-testid="exam-provisional-note">
            {result.deferredCount}{" "}
            {result.deferredCount === 1 ? "answer is" : "answers are"} waiting for an
            instructor, because the code runner could not mark{" "}
            {result.deferredCount === 1 ? "it" : "them"} automatically.{" "}
            <strong>
              This total can only go up — at most to {result.provisionalCeiling} /{" "}
              {result.totalPossible}.
            </strong>{" "}
            Nothing you have already been awarded can be taken away.
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink-muted" data-testid="exam-final-note">
            Every answer was marked automatically, so this total is final.
          </p>
        )}

        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Stat label="Answered" value={`${result.answers.length - result.unansweredCount}`} />
          <Stat label="Unanswered" value={`${result.unansweredCount}`} />
          <Stat label="Awaiting grading" value={`${result.deferredCount}`} />
          <Stat
            label="Time taken"
            value={result.elapsedMs == null ? "—" : formatDuration(result.elapsedMs)}
          />
        </dl>

        {result.unansweredCount > 0 && (
          <p className="mt-3 text-sm text-ink-muted" data-testid="exam-unanswered-note">
            {result.unansweredCount} question{result.unansweredCount === 1 ? "" : "s"} were
            recorded with no answer and no mark. There is no negative marking, so leaving a
            question blank cost you nothing beyond its own marks.
          </p>
        )}
      </Card>

      <ol className="space-y-2">
        {result.answers.map((answer, index) => (
          <li key={answer.questionId}>
            <AnswerCard answer={answer} index={index} />
          </li>
        ))}
      </ol>

      {backHref && (
        <Button
          variant="ghost"
          onClick={() => {
            window.location.href = backHref;
          }}
        >
          Back to the week
        </Button>
      )}
    </div>
  );
}

function AnswerCard({ answer, index }: { answer: ExamResultAnswer; index: number }) {
  const tone = answer.deferred
    ? "warning"
    : answer.unanswered
      ? "neutral"
      : answer.isCorrect
        ? "success"
        : "danger";
  const label = answer.deferred
    ? "Awaiting grading"
    : answer.unanswered
      ? "Not answered"
      : answer.isCorrect
        ? "Correct"
        : "Incorrect";

  return (
    <Card
      data-testid={`exam-answer-${answer.questionId}`}
      action={
        <span className="flex items-center gap-2">
          <Badge tone={tone} size="sm">
            {label}
          </Badge>
          <Badge tone="neutral" size="sm" data-testid={`exam-awarded-${answer.questionId}`}>
            {answer.awarded} / {answer.maxPoints}
          </Badge>
        </span>
      }
    >
      <p className="font-medium">
        {index + 1}. {answer.questionText}
      </p>
      {answer.selectedOptionText && (
        <p className="mt-1 text-sm text-ink-muted">
          Your answer: <span className="text-ink">{answer.selectedOptionText}</span>
        </p>
      )}
      {answer.codeAnswer && (
        <pre className="mt-2 max-h-48 overflow-auto rounded border border-line bg-surface p-2 text-xs">
          <code>{answer.codeAnswer}</code>
        </pre>
      )}
      {answer.note && (
        <p className="mt-1 text-sm text-ink-muted" data-testid={`exam-note-${answer.questionId}`}>
          {answer.note}
        </p>
      )}
      {answer.explanation && (
        <p className="mt-2 text-sm text-ink-muted">{answer.explanation}</p>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** `1 h 58 min` / `12 min` / `45 s`. Metric, from a millisecond input (house rule 5). */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return `${Math.floor(ms / 1000)} s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}
