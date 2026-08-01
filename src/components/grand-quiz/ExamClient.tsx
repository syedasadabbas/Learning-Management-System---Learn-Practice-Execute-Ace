"use client";

// =============================================================================
// EXAM CLIENT — holds which of the three exam screens is showing.
// Owner: grand-quiz stream.
// -----------------------------------------------------------------------------
// The page is a server component (it reads through the same service the API uses,
// so page and API cannot disagree about the deadline or the score). This thin
// client wrapper exists only so that pressing Start swaps the start card for the
// running exam WITHOUT a navigation — a full page load between "start" and "the
// clock is running" spends a second of a student's 120 minutes on a white screen,
// and on a one-attempt exam that is not a second to spend.
//
// The server's response is stored verbatim. Note it may come back `finished` even
// from Start: if the student already sat this exam, `startExam` hands back the
// existing attempt (I1), and the lazy finalize may have just closed it (I2). So
// this renders whatever state it was given rather than assuming Start implies
// in-progress.
// =============================================================================

import * as React from "react";

import type { ExamOverview } from "@/lib/grand-quiz";

import { ExamResults } from "./ExamResults";
import { ExamRunner } from "./ExamRunner";
import { ExamStart } from "./ExamStart";

export interface ExamClientProps {
  /** The server-rendered starting state, from `loadExamOverview`. */
  initial: ExamOverview;
  weekId: number;
  backHref?: string;
}

export function ExamClient({ initial, weekId, backHref }: ExamClientProps) {
  const [view, setView] = React.useState<ExamOverview>(initial);

  if (view.state === "not_started") {
    return (
      <ExamStart
        weekId={weekId}
        title={view.quiz.title}
        questionCount={view.quiz.totalQuestions}
        totalPoints={view.quiz.totalPoints}
        timeLimitMinutes={view.quiz.timeLimitMinutes}
        passingScore={view.quiz.passingScore}
        onStarted={setView}
      />
    );
  }

  if (view.state === "in_progress") {
    return <ExamRunner exam={view.exam} {...(backHref ? { backHref } : {})} />;
  }

  // `finished`. `ExamResult` is self-contained — each answer carries its own
  // question text (I4 guarantees there is one per question), so this renders fully
  // even on a cold page load with no in-progress payload in memory.
  return <ExamResults result={view.result} {...(backHref ? { backHref } : {})} />;
}
