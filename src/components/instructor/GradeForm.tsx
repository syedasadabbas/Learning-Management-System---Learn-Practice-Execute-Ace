"use client";

// =============================================================================
// GRADE FORM — instructor-admin stream.
// -----------------------------------------------------------------------------
// 1..5 stars (required), an optional score override, and written feedback.
//
// The client-side limits below MIRROR `gradeSubmissionSchema` and are a courtesy,
// not the enforcement: the server re-validates with the same schema in both the
// action and the route handler. Never treat a disabled button as a guard.
//
// The score preview calls `deriveScore`, which is the SAME composition of
// `computeLateness` + `assignmentPoints` that the submissions stream's write path
// uses, so the number shown before saving is the number that gets saved. Stars
// below 3 cost 10 points each; that is visible here rather than a surprise after.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, StarRating, Toast } from "@/components/ui";
import { gradeSubmissionAction } from "@/lib/instructor/actions";
import { deriveScore } from "@/lib/instructor/grade-payload";
import type { QueueRow } from "@/lib/instructor/queue";

/** Mirrors gradeSubmissionSchema. The server is still the authority. */
const FEEDBACK_MAX = 4000;
const SCORE_MAX = 40;

export interface GradeFormProps {
  row: QueueRow;
  onSaved?: (result: { score: number; stars: number }) => void;
}

export function GradeForm({ row, onSaved }: GradeFormProps) {
  const [stars, setStars] = React.useState<number>(row.stars ?? 0);
  const [overrideScore, setOverrideScore] = React.useState(false);
  const [score, setScore] = React.useState<string>(
    row.score === null ? "" : String(row.score),
  );
  const [feedback, setFeedback] = React.useState<string>(row.feedback ?? "");
  const [pending, setPending] = React.useState(false);
  const [toast, setToast] = React.useState<
    { tone: "success" | "error" | "warning"; message: string } | null
  >(null);

  // Same function the write path uses (via pointsForSubmission), so the preview
  // cannot disagree with what gets saved.
  const derived =
    stars >= 1
      ? deriveScore({
          submittedAt: new Date(row.submittedAt),
          dueAt: new Date(row.dueAt),
          gracePeriodDays: row.gracePeriodDays,
          latePenaltyPercentPerDay: row.latePenaltyPercentPerDay,
          stars,
        }).score
      : null;

  const starsInvalid = stars < 1 || stars > 5;
  const feedbackTooLong = feedback.length > FEEDBACK_MAX;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (starsInvalid) {
      setToast({ tone: "error", message: "Choose a rating from 1 to 5 stars." });
      return;
    }
    if (feedbackTooLong) {
      setToast({
        tone: "error",
        message: `Feedback is ${feedback.length} characters; the limit is ${FEEDBACK_MAX}.`,
      });
      return;
    }

    setPending(true);
    setToast(null);
    const parsedScore = Number(score);
    const result = await gradeSubmissionAction({
      submissionId: row.submissionId,
      stars,
      // Omit rather than send an empty string: the schema treats score as
      // optional and the server derives it from stars when absent.
      score:
        overrideScore && score !== "" && Number.isFinite(parsedScore)
          ? Math.round(parsedScore)
          : undefined,
      feedback: feedback.trim() === "" ? undefined : feedback,
    });
    setPending(false);

    if (!result.ok) {
      setToast({ tone: "error", message: result.error });
      return;
    }
    const notes: string[] = [];
    if (result.data.overridden) {
      notes.push(`overrode the computed ${result.data.derivedScore}`);
    }
    if (result.data.penaltiesIssued > 0) {
      notes.push(
        `${result.data.penaltiesIssued} penalt${result.data.penaltiesIssued === 1 ? "y" : "ies"} issued`,
      );
    }
    setToast({
      tone: "success",
      message:
        `Saved: ${result.data.stars} stars, ${result.data.score} / ${SCORE_MAX} points.` +
        (notes.length ? ` (${notes.join("; ")})` : ""),
    });
    onSaved?.({ score: result.data.score, stars: result.data.stars });
  }

  return (
    <Card
      title={`Grade: ${row.assignmentTitle}`}
      subtitle={`${row.studentName} — week ${row.weekNumber}`}
      action={
        row.daysLate > 0 ? (
          <Badge tone="warning">{row.daysLate} day(s) late</Badge>
        ) : row.withinGrace ? (
          <Badge tone="accent">Within grace window</Badge>
        ) : (
          <Badge tone="success">On time</Badge>
        )
      }
      data-testid="grade-form-card"
    >
      <form onSubmit={onSubmit} data-testid="grade-form" className="space-y-4">
        <div className="flex flex-wrap gap-4 text-sm">
          {row.githubUrl && (
            <a
              className="text-brand underline"
              href={row.githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              data-testid="github-link"
            >
              GitHub repository
            </a>
          )}
          {row.liveUrl && (
            <a
              className="text-brand underline"
              href={row.liveUrl}
              target="_blank"
              rel="noreferrer noopener"
              data-testid="live-link"
            >
              Live site
            </a>
          )}
          {!row.githubUrl && !row.liveUrl && (
            <span className="text-ink-muted">
              No links were captured for this submission.
            </span>
          )}
        </div>

        {row.description && (
          <p className="rounded-md bg-surface p-3 text-sm text-ink-muted">
            {row.description}
          </p>
        )}

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Rating (required)</legend>
          <StarRating
            value={stars}
            onChange={setStars}
            label={`Week ${row.weekNumber} assignment rating`}
            showValue
            testId="grade-stars"
          />
          <p className="text-xs text-ink-muted">
            3 stars awards the full {SCORE_MAX} points before late penalties; each
            star below 3 removes 10.
          </p>
          {/* Hidden mirror so the value is in the DOM for e2e assertions. */}
          <input type="hidden" name="stars" value={stars} readOnly />
        </fieldset>

        <div
          className="rounded-md border border-line p-3 text-sm"
          data-testid="score-preview"
          data-derived-score={derived ?? ""}
        >
          {derived === null ? (
            <span className="text-ink-muted">
              Pick a rating to see the score this awards.
            </span>
          ) : (
            <span>
              Computed score:{" "}
              <strong className="tabular-nums">
                {derived} / {SCORE_MAX}
              </strong>
              {row.daysLate > 0 &&
                ` (after a ${row.latePenaltyPercentPerDay}%/day late penalty, capped at 20%)`}
              {row.withinGrace &&
                ` (late, but inside the ${row.gracePeriodDays}-day grace window, so no penalty)`}
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overrideScore}
            onChange={(e) => setOverrideScore(e.target.checked)}
            data-testid="override-toggle"
          />
          Override the computed score
        </label>

        {overrideScore && (
          <label className="block text-sm">
            <span className="font-medium">Score (0-{SCORE_MAX})</span>
            <input
              type="number"
              name="score"
              min={0}
              max={SCORE_MAX}
              step={1}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              data-testid="score-input"
              className="mt-1 block w-32 rounded-md border border-line bg-panel px-2 py-1 tabular-nums"
            />
          </label>
        )}

        <label className="block text-sm">
          <span className="font-medium">Feedback</span>
          <textarea
            name="feedback"
            rows={5}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={FEEDBACK_MAX + 1}
            data-testid="feedback-input"
            className="mt-1 block w-full rounded-md border border-line bg-panel px-2 py-1"
          />
          <span
            className={
              feedbackTooLong ? "text-xs text-red-700" : "text-xs text-ink-muted"
            }
            data-testid="feedback-counter"
          >
            {feedback.length} / {FEEDBACK_MAX} characters
          </span>
        </label>

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            loading={pending}
            disabled={pending || starsInvalid || feedbackTooLong}
            data-testid="save-grade"
          >
            Save grade
          </Button>
          {row.gradedAt && (
            <span className="text-xs text-ink-muted">
              Previously graded {new Date(row.gradedAt).toISOString().slice(0, 16)}Z
            </span>
          )}
        </div>
      </form>

      {toast && (
        <div className="mt-3">
          <Toast
            tone={toast.tone}
            message={toast.message}
            // 6000 ms for success; problems stay until dismissed.
            autoDismissMs={toast.tone === "success" ? 6_000 : 0}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}
    </Card>
  );
}
