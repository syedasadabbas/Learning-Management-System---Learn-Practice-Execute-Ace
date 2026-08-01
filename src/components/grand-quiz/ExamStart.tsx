"use client";

// =============================================================================
// EXAM START — the one screen a student sees before their single attempt begins.
// Owner: grand-quiz stream.
// -----------------------------------------------------------------------------
// This component exists for one reason: INFORMED CONSENT. A one-attempt,
// 120-minute exam whose clock starts on a page load is a trap. So the terms are
// stated before anything is created, and starting is an explicit act.
//
// The confirmation is a courtesy, not a control. The button is disabled while the
// request is in flight, but I1 does not depend on that: `startAttempt` inserts and
// catches the unique violation, so ten clicks produce one attempt and all ten
// responses carry the same attempt id. That is why this handler can safely just
// re-render whatever the server returns.
// =============================================================================

import * as React from "react";

import { Button, Card } from "@/components/ui";
import type { ApiResult } from "@/lib/contracts/api";
import type { ExamView } from "@/lib/grand-quiz";

export interface ExamStartProps {
  weekId: number;
  title: string;
  questionCount: number;
  totalPoints: number;
  timeLimitMinutes: number;
  passingScore: number;
  /** Called with whatever the server returned — an open exam, or a finished result. */
  onStarted: (view: ExamView) => void;
}

export function ExamStart({
  weekId,
  title,
  questionCount,
  totalPoints,
  timeLimitMinutes,
  passingScore,
  onStarted,
}: ExamStartProps) {
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function start(): Promise<void> {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/exams/${weekId}/start`, { method: "POST" });
      const payload: ApiResult<ExamView> = await response.json();
      if (!payload.ok) {
        setError(payload.error);
        return;
      }
      onStarted(payload.data);
    } catch {
      setError("Could not reach the server. Nothing was started — try again.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card title={title} subtitle="Weekly exam" data-testid="exam-start">
      <ul className="space-y-1 text-sm">
        <li>
          <strong>{questionCount}</strong> questions worth <strong>{totalPoints}</strong>{" "}
          marks in total. Questions are not all worth the same.
        </li>
        <li>
          <strong>{timeLimitMinutes} minutes</strong>, timed on the server from the moment
          you start. Closing the tab does not pause it.
        </li>
        <li>
          <strong>One attempt.</strong> There is no retake, and starting cannot be undone.
        </li>
        <li>Pass mark {passingScore}%.</li>
        <li>
          Every answer saves itself as you work, so a crash or a flat battery loses at most
          your last sentence.
        </li>
        <li>
          <strong>No negative marking.</strong> A wrong answer scores 0; it never takes
          marks off. Questions you never reach are recorded with no answer and no mark.
        </li>
        <li>
          When time runs out the exam submits itself and marks whatever you had saved.
        </li>
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700" data-testid="exam-start-error">
          {error}
        </p>
      )}

      <div className="mt-4">
        <Button loading={starting} onClick={() => void start()} data-testid="start-exam">
          Start the {timeLimitMinutes}-minute exam
        </Button>
      </div>
    </Card>
  );
}
