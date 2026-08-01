"use client";

// =============================================================================
// PEER REVIEW FORM — the reviewer's writing surface.
// Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// DELIBERATELY THE SAME INTERACTION AS src/components/instructor/GradeForm.tsx,
// because it IS the same interaction by a different actor (the brief says so, and
// re-inventing it would give the app two grading idioms). What is reused, and where
// it comes from:
//   * `StarRating` from @/components/ui, one per rubric criterion. The LMS grades in
//     1..5 stars everywhere — `submissions.instructor_rating`,
//     `gradeSubmissionSchema.stars`, StarRating's own default `max` — so a peer
//     scoring a criterion uses the control a student already recognises from their
//     own feedback.
//   * `Card`, `Button`, `Badge`, `Toast`, all from the barrel. No forked styles: the
//     barrel's header calls a second Button implementation "how a design system
//     dies".
//
// THE CLIENT-SIDE LIMITS BELOW MIRROR THE SERVER AND ARE A COURTESY, NOT THE
// ENFORCEMENT. `submitPeerReviewAction` re-validates with `parseSubmitPeerReview`
// against the round's own rubric read from the database. GradeForm.tsx puts it
// best and the same words apply here: never treat a disabled button as a guard.
//
// THE CHARACTER COUNTER USES THE SERVER'S OWN FUNCTION. `charsRemaining` is imported
// from src/lib/peer-review/validate.ts — the module that also backs the refusal — so
// the number under the textarea cannot disagree with what the server accepts. Same
// technique as GradeForm's score preview calling the real `deriveScore`.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, StarRating, Toast } from "@/components/ui";
import { submitPeerReviewAction } from "@/lib/peer-review/actions";
import { MAX_REVIEW_CHARS, MIN_REVIEW_CHARS } from "@/lib/peer-review/config";
import type { RubricCriterion } from "@/lib/peer-review/rubric";
import type { ReviewTask } from "@/lib/peer-review/reviews";
import { charsRemaining } from "@/lib/peer-review/validate";

export interface PeerReviewFormProps {
  task: ReviewTask;
  criteria: readonly RubricCriterion[];
  onSubmitted?: (result: { reviewId: number; totalScore: number }) => void;
}

export function PeerReviewForm({ task, criteria, onSubmitted }: PeerReviewFormProps) {
  const [scores, setScores] = React.useState<Record<string, number>>({});
  const [content, setContent] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [toast, setToast] = React.useState<
    { tone: "success" | "error" | "warning"; message: string } | null
  >(null);

  const remaining = charsRemaining(content);
  const unscored = criteria.filter((c) => !scores[c.key]);
  const tooLong = content.length > MAX_REVIEW_CHARS;
  const total = Object.values(scores).reduce((sum, n) => sum + n, 0);
  const maxTotal = criteria.reduce((sum, c) => sum + c.maxPoints, 0);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Mirrors the server's two refusals so the reviewer is told before a round trip.
    // The server checks both again.
    if (unscored.length > 0) {
      setToast({
        tone: "error",
        message: `Score every criterion first: ${unscored.map((c) => c.name).join(", ")}.`,
      });
      return;
    }
    if (remaining > 0) {
      setToast({
        tone: "error",
        message: `Write ${remaining} more character${remaining === 1 ? "" : "s"} — a review under ${MIN_REVIEW_CHARS} is not useful to the person receiving it.`,
      });
      return;
    }

    setPending(true);
    setToast(null);
    const result = await submitPeerReviewAction({
      allocationId: task.allocationId,
      content,
      rubricScores: scores,
    });
    setPending(false);

    if (!result.ok) {
      setToast({ tone: "error", message: result.issues?.join(" ") ?? result.error });
      return;
    }
    setToast({
      tone: "success",
      message: "Review submitted. It cannot be changed, and it is anonymous to the student who receives it.",
    });
    onSubmitted?.(result.data);
  }

  // ------------------------------------------------------------------ read-only
  // A submitted review is rendered, not editable. There is no edit path in the
  // stream at all (`peer_reviews.allocation_id` is UNIQUE and no code issues an
  // UPDATE), so this branch is the honest UI for that fact rather than a disabled
  // form that looks as though it might save.
  if (task.submittedAt) {
    return (
      <Card
        title="Your review"
        subtitle={`Submitted ${task.submittedAt.toISOString().slice(0, 16).replace("T", " ")} UTC — submitted reviews cannot be changed`}
        action={
          task.flagged ? (
            <Badge tone="warning">Withheld by an instructor</Badge>
          ) : (
            <Badge tone="success">Submitted</Badge>
          )
        }
        data-testid="peer-review-submitted"
      >
        <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-3">
          {task.scoreLines.map((line) => (
            <div key={line.key}>
              <dt className="text-ink-muted">{line.name}</dt>
              <dd>
                <StarRating
                  value={line.score ?? 0}
                  max={line.maxPoints}
                  readOnly
                  size="sm"
                  showValue
                  label={line.name}
                  testId={`submitted-score-${line.key}`}
                />
              </dd>
            </div>
          ))}
        </dl>
        <p className="whitespace-pre-wrap text-sm" data-testid="submitted-content">
          {task.content}
        </p>
      </Card>
    );
  }

  // ----------------------------------------------------------------- write form
  return (
    <Card
      title={`Review: ${task.assignmentTitle}`}
      subtitle={`Week ${task.weekNumber} — you are not told whose work this is, and they are not told who reviewed it`}
      action={
        <Badge tone="neutral">
          Due {task.reviewDueAt.toISOString().slice(0, 10)}
        </Badge>
      }
      data-testid="peer-review-form-card"
    >
      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        {task.githubUrl && (
          <a
            className="text-brand underline"
            href={task.githubUrl}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="review-github-link"
          >
            GitHub repository
          </a>
        )}
        {task.liveUrl && (
          <a
            className="text-brand underline"
            href={task.liveUrl}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="review-live-link"
          >
            Live site
          </a>
        )}
        {!task.githubUrl && !task.liveUrl && (
          <span className="text-ink-muted">
            No links were captured for this submission. Review the notes below.
          </span>
        )}
      </div>

      {task.description && (
        <p className="mb-4 rounded border border-line bg-surface p-3 text-sm text-ink-muted">
          {task.description}
        </p>
      )}

      <form onSubmit={onSubmit} data-testid="peer-review-form" className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">
            Score each criterion ({total} / {maxTotal})
          </legend>
          {criteria.length === 0 && (
            <p className="text-sm text-ink-muted">
              This round&apos;s rubric could not be read. An instructor needs to fix it before
              reviews can be submitted.
            </p>
          )}
          {criteria.map((criterion) => (
            <div key={criterion.key} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="text-sm font-medium">{criterion.name}</span>
                {criterion.hint && (
                  <span className="block text-xs text-ink-muted">{criterion.hint}</span>
                )}
              </span>
              <StarRating
                value={scores[criterion.key] ?? 0}
                max={criterion.maxPoints}
                label={criterion.name}
                testId={`criterion-${criterion.key}`}
                onChange={(value) =>
                  setScores((prev) => ({ ...prev, [criterion.key]: value }))
                }
              />
            </div>
          ))}
        </fieldset>

        <div>
          <label className="block text-sm font-medium" htmlFor="peer-review-content">
            Written feedback
          </label>
          <textarea
            id="peer-review-content"
            name="content"
            data-testid="peer-review-content"
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-bg p-2 text-sm"
            placeholder="What works, and what would you change? Be specific — name a file, a page or a behaviour."
          />
          <p className="mt-1 text-xs text-ink-muted" data-testid="chars-remaining">
            {remaining > 0
              ? `${remaining} more character${remaining === 1 ? "" : "s"} needed (minimum ${MIN_REVIEW_CHARS}).`
              : tooLong
                ? `${content.length} characters — the limit is ${MAX_REVIEW_CHARS}.`
                : `${content.trim().length} characters. Long enough to submit.`}
          </p>
        </div>

        <Button type="submit" disabled={pending} data-testid="peer-review-submit">
          {pending ? "Submitting…" : "Submit review"}
        </Button>
        <p className="text-xs text-ink-muted">
          Once submitted, a review cannot be edited. The student receives it only when an
          instructor releases the round.
        </p>
      </form>

      {toast && (
        <Toast tone={toast.tone} message={toast.message} onDismiss={() => setToast(null)} />
      )}
    </Card>
  );
}
