"use client";

// =============================================================================
// <QAPanel /> — ask, upvote, and (for staff) answer.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// UPVOTING IS IDEMPOTENT PER USER, AND THE UI SAYS SO HONESTLY.
//
// This was not always true and the handover brief for this stream still says it
// is not — it warned "a student can upvote repeatedly, do not build UI that
// pretends one-vote-per-user is enforced". That warning is now STALE, and
// building to it would have been the wrong call. `class_qa_votes` exists with
// `(question_id, user_id)` as its PRIMARY KEY, and the upvote route inserts into
// it with `ON CONFLICT DO NOTHING` inside a transaction, incrementing the
// denormalized `class_qa.upvotes` only when the ledger insert actually
// inserted. Its module header documents the change and the hole it closed.
//
// So the button is a one-way "Upvote" that becomes "Upvoted" and stays
// disabled. The route's response carries `counted: boolean` for exactly this —
// it distinguishes "your vote landed" from "you had already voted" without the
// client inferring it from an unchanged total. WHAT THIS PANEL CANNOT DO is
// know, ON FIRST LOAD, whether the current user has already voted: the list
// endpoint returns the total, not the ledger. So a returning student sees
// "Upvote" until they press it once, at which point the reply tells the truth.
// That is a cosmetic inaccuracy with no effect on the tally, and it is stated
// here rather than hidden behind a hopeful `hasVoted` field that does not exist.
//
// THE INSTRUCTOR CONTROLS ARE NOT DRIVEN BY A PROP A STUDENT COULD INFLUENCE.
// `canAnswer` comes from the page, which reads it from the SESSION via
// `apiGuard`/`auth()`. Rendering it is a convenience only: the answer route is
// `ROUTE_AUTH: "instructor"` and additionally filters on class ownership in its
// WHERE clause, so a student who forges the prop gets a 404 from the server.
// The UI is never the control.
//
// THE COMPOSER IS DISABLED, WITH A STATED REASON, UNTIL REACT HAS HYDRATED, and
// anything typed before that is salvaged rather than discarded. Same bug and
// same remedy as ChatPanel's composer; ./use-composer-hydration.ts carries the
// full reasoning. It applies here for the same reason it applies there — a
// student watching a class that has already started types the moment the field
// appears.
// =============================================================================

import * as React from "react";

import { AsyncSection } from "@/components/async/AsyncSection";
import { LiveRegion, useAnnouncer } from "@/components/learn/visualizations/controls";
import { Badge, Button, Card, cn } from "@/components/ui";
import { apiPath, apiPathWithQuery, apiRequest } from "@/lib/client/api";
import { useApiResource } from "@/lib/client/use-api-resource";
import type { Paginated } from "@/lib/learning/pagination";
import type { RealtimeMode } from "@/lib/live-classes/use-realtime";

import { RealtimeStatusLine } from "./ClassStatusBadge";
import { useComposerHydration } from "./use-composer-hydration";
import type { QaRow } from "./types";

const QA_GET = "GET  /api/classes/:classId/qa" as const;
const QA_POST = "POST /api/classes/:classId/qa" as const;
const QA_UPVOTE = "POST /api/classes/:classId/qa/:questionId/upvote" as const;
const QA_ANSWER = "POST /api/classes/:classId/qa/:questionId/answer" as const;

/** Matches `askQuestionSchema` — 1000 characters, per src/lib/live-classes/schemas.ts. */
export const QA_MAX_CHARS = 1_000;

/** Q&A moves slower than chat, so it polls slower. See ChatPanel's argument. */
export const QA_POLL_MS = 15_000;

export interface QAPanelProps {
  classId: number;
  currentUserId: number;
  /** `class.allowQa` from `/join`. Server-derived. */
  allowQa: boolean;
  /** Derived from the SESSION by the page, never from a client value. */
  canAnswer?: boolean;
  mode: RealtimeMode;
  className?: string;
  fetchImpl?: typeof fetch;
}

export function QAPanel({
  classId,
  currentUserId,
  allowQa,
  canAnswer = false,
  mode,
  className,
  fetchImpl,
}: QAPanelProps) {
  const url = React.useMemo(
    () => apiPathWithQuery(QA_GET, { classId }, { limit: 100 }),
    [classId],
  );

  const { state, reload, setData } = useApiResource<Paginated<QaRow>>(QA_GET, url, {
    refreshMs: mode === "live" ? 0 : QA_POLL_MS,
    fetchImpl,
  });

  const [draft, setDraft] = React.useState("");
  const [asking, setAsking] = React.useState(false);
  const [askError, setAskError] = React.useState<string | null>(null);
  const [voted, setVoted] = React.useState<ReadonlySet<number>>(new Set());
  const [answerDrafts, setAnswerDrafts] = React.useState<Record<number, string>>({});
  const { message: announcement, announce } = useAnnouncer();

  const askInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  // See ./use-composer-hydration.ts: a question typed before hydration is in
  // the DOM and not in state, and hydration renders "" over it. `setDraft` is
  // the salvage path.
  const hydration = useComposerHydration(askInputRef, setDraft);

  const trimmed = draft.trim();
  const tooLong = trimmed.length > QA_MAX_CHARS;

  async function ask(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!allowQa || !hydration.ready || trimmed.length === 0 || tooLong || asking) return;

    setAsking(true);
    setAskError(null);
    const result = await apiRequest<QaRow>(QA_POST, apiPath(QA_POST, { classId }), {
      body: { question: trimmed },
      fetchImpl,
    });
    setAsking(false);

    if (!result.ok) {
      if (result.aborted) return;
      setAskError(result.error);
      announce(`Your question was not sent. ${result.error}`);
      return;
    }

    setDraft("");
    setData((page) =>
      page === null
        ? page
        : { ...page, items: [result.data, ...page.items], total: page.total + 1 },
    );
    announce("Your question was posted.");
  }

  async function upvote(question: QaRow): Promise<void> {
    if (voted.has(question.id) || question.studentId === currentUserId) return;

    // Optimistic: the count moves immediately and the button locks. Rolled back
    // below if the server refuses.
    setVoted((prev) => new Set(prev).add(question.id));
    setData((page) =>
      page === null
        ? page
        : {
            ...page,
            items: page.items.map((row) =>
              row.id === question.id ? { ...row, upvotes: row.upvotes + 1 } : row,
            ),
          },
    );

    const result = await apiRequest<{ id: number; upvotes: number; counted: boolean }>(
      QA_UPVOTE,
      apiPath(QA_UPVOTE, { classId, questionId: question.id }),
      { fetchImpl },
    );

    if (!result.ok) {
      if (result.aborted) return;
      setVoted((prev) => {
        const next = new Set(prev);
        next.delete(question.id);
        return next;
      });
      setData((page) =>
        page === null
          ? page
          : {
              ...page,
              items: page.items.map((row) =>
                row.id === question.id ? { ...row, upvotes: question.upvotes } : row,
              ),
            },
      );
      announce(`Your upvote was not recorded. ${result.error}`);
      return;
    }

    // The server's total is authoritative — the optimistic +1 is wrong whenever
    // somebody else voted between the render and the request, and it is wrong
    // by exactly one when `counted` is false because the user had already voted.
    setData((page) =>
      page === null
        ? page
        : {
            ...page,
            items: page.items.map((row) =>
              row.id === question.id ? { ...row, upvotes: result.data.upvotes } : row,
            ),
          },
    );
    announce(
      result.data.counted
        ? `Upvoted. ${result.data.upvotes} votes.`
        : "You had already upvoted this question.",
    );
  }

  async function answer(question: QaRow): Promise<void> {
    const text = (answerDrafts[question.id] ?? "").trim();
    if (text.length === 0) return;

    const result = await apiRequest<QaRow>(
      QA_ANSWER,
      apiPath(QA_ANSWER, { classId, questionId: question.id }),
      { body: { answer: text }, fetchImpl },
    );

    if (!result.ok) {
      if (result.aborted) return;
      announce(`The answer was not saved. ${result.error}`);
      return;
    }

    setAnswerDrafts((prev) => ({ ...prev, [question.id]: "" }));
    setData((page) =>
      page === null
        ? page
        : {
            ...page,
            items: page.items.map((row) => (row.id === question.id ? result.data : row)),
          },
    );
    announce("Answer posted.");
  }

  return (
    <section
      aria-labelledby={`qa-${classId}-heading`}
      className={cn("flex min-h-0 flex-col gap-2", className)}
      data-testid="qa-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`qa-${classId}-heading`} className="text-base font-semibold text-ink">
          Questions
        </h3>
        {!allowQa && (
          <Badge tone="neutral" size="sm">
            Read only
          </Badge>
        )}
      </div>

      <RealtimeStatusLine mode={mode} />

      <form onSubmit={(event) => void ask(event)} className="flex flex-col gap-1">
        <label htmlFor={`qa-${classId}-input`} className="sr-only">
          Ask a question
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={`qa-${classId}-input`}
            ref={askInputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!allowQa || !hydration.ready}
            rows={2}
            aria-describedby={`qa-${classId}-hint`}
            aria-invalid={tooLong || undefined}
            placeholder={
              !allowQa
                ? "Questions are switched off"
                : hydration.ready
                  ? "Ask the instructor"
                  : "Loading…"
            }
            className={cn(
              "min-h-11 flex-1 resize-y rounded-md border border-line bg-panel p-2 text-sm",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
            data-testid="qa-input"
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={asking}
            disabled={!allowQa || !hydration.ready || trimmed.length === 0 || tooLong || asking}
          >
            Ask
          </Button>
        </div>
        <p id={`qa-${classId}-hint`} className="text-xs text-ink-muted">
          {tooLong
            ? `That is ${trimmed.length} characters. The limit is ${QA_MAX_CHARS}.`
            : // The hydrating reason outranks the standing tip: a dead control
              // with only a tip beside it reads as a broken page.
              !hydration.ready && allowQa
              ? hydration.reason
              : "Upvote a question instead of asking it again — the instructor answers the top ones first."}
        </p>
        {askError && (
          <p role="alert" className="text-sm text-ink" data-testid="qa-ask-error">
            {askError}
          </p>
        )}
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="qa-list">
        <AsyncSection
          state={state}
          loadingLabel="Loading questions"
          loadingLines={4}
          onRetry={() => void reload()}
          isEmpty={(page) => page.items.length === 0}
          emptyTitle="No questions yet"
          emptyDescription="Be the first. Questions asked here are kept with the class recording."
        >
          {(page) => (
            <ul className="flex flex-col gap-2">
              {page.items.map((question) => {
                const isMine = question.studentId === currentUserId;
                const hasVoted = voted.has(question.id);
                return (
                  <li key={question.id}>
                    <Card
                      padded
                      data-testid={`qa-question-${question.id}`}
                      className={cn(question.isPinned && "border-l-4 border-l-accent")}
                      action={
                        <span className="flex items-center gap-2">
                          {question.isAnswered && (
                            <Badge tone="success" size="sm">
                              Answered
                            </Badge>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isMine || hasVoted}
                            onClick={() => void upvote(question)}
                            // The count is inside the accessible name, so a
                            // screen-reader user does not have to hunt for the
                            // number the button is about.
                            aria-label={
                              isMine
                                ? "You cannot upvote your own question"
                                : hasVoted
                                  ? `Upvoted. ${question.upvotes} votes`
                                  : `Upvote this question. ${question.upvotes} votes`
                            }
                            data-testid={`qa-upvote-${question.id}`}
                          >
                            <span aria-hidden="true">▲ </span>
                            {question.upvotes}
                          </Button>
                        </span>
                      }
                    >
                      <p className="text-sm text-ink">{question.question}</p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {isMine ? "Asked by you" : `Asked by ${question.studentName ?? "a student"}`}
                      </p>

                      {question.answer && (
                        <div className="mt-2 rounded-md border-l-4 border-l-emerald-500 bg-emerald-50 p-2">
                          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                            Answer
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                            {question.answer}
                          </p>
                        </div>
                      )}

                      {canAnswer && !question.isAnswered && (
                        <div className="mt-2 flex flex-col gap-1">
                          <label
                            htmlFor={`qa-answer-${question.id}`}
                            className="text-xs font-semibold text-ink"
                          >
                            Answer this question
                          </label>
                          <textarea
                            id={`qa-answer-${question.id}`}
                            rows={2}
                            value={answerDrafts[question.id] ?? ""}
                            onChange={(event) =>
                              setAnswerDrafts((prev) => ({
                                ...prev,
                                [question.id]: event.target.value,
                              }))
                            }
                            className="min-h-11 rounded-md border border-line bg-panel p-2 text-sm"
                          />
                          <Button
                            variant="primary"
                            size="sm"
                            className="self-start"
                            disabled={(answerDrafts[question.id] ?? "").trim().length === 0}
                            onClick={() => void answer(question)}
                          >
                            Post answer
                          </Button>
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </AsyncSection>
      </div>

      <LiveRegion message={announcement} testId="qa-live-region" />
    </section>
  );
}
