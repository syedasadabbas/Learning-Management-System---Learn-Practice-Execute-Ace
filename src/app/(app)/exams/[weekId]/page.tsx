// =============================================================================
// /exams/:weekId — sit this week's grand quiz.
// Owner: grand-quiz stream.
// -----------------------------------------------------------------------------
// A server component. It reads through `loadExamOverview` — the SAME service the
// API routes use — so the page and the API cannot drift into two different ideas
// of how much time is left or what the score is. It renders no answer key:
// `src/lib/grand-quiz/payload.ts` produces the payload and has no `isCorrect`,
// `explanation` or `tests` in its output types.
//
// THIS PAGE STARTS NOTHING. `loadExamOverview` reads; only the Start button POSTs
// to /api/exams/:weekId/start. That separation matters more here than on a
// practice quiz: a page that started the attempt on render would mean a mistyped
// URL, a link preview or a browser prefetch consumed the one attempt a student
// gets (I1) and started a 120-minute clock (I2) they never asked for.
//
// It DOES finalize an already-expired attempt, inside the service (expiry trigger
// 2 of 3), because the student returning to this URL is the commonest way an
// abandoned exam is discovered.
//
// WEEK-LOCK GATE, matching the practice quiz: reuses course-content's own gate so
// this page cannot disagree with the week list, and refuses by stating the rule
// rather than redirecting silently.
// =============================================================================

import { notFound } from "next/navigation";

import { gateWeek } from "@/components/course/data";
import { LockedNotice } from "@/components/course/LockedNotice";
import { ExamClient } from "@/components/grand-quiz";
import { requireUser } from "@/lib/guard";
import { parsePositiveInt } from "@/lib/quizzes/params";
import { loadExamOverview } from "@/lib/grand-quiz";

// Per-student, and the countdown seed is a per-request fact. Never cached: a
// cached exam page would hand a student a stale deadline.
export const dynamic = "force-dynamic";

export default async function ExamPage({
  params,
}: {
  params: Promise<{ weekId: string }>;
}) {
  const { weekId: rawWeekId } = await params;
  const weekId = parsePositiveInt(rawWeekId);
  if (weekId === null) notFound();

  const user = await requireUser(`/exams/${rawWeekId}`);

  const week = await gateWeek(user.id, weekId);
  if (!week.ok) {
    if (week.kind === "locked") {
      return (
        <main className="mx-auto max-w-3xl space-y-6 p-4">
          <LockedNotice
            weekNumber={week.lock.weekNumber}
            title={week.lock.title}
            reason={week.lock.reason ?? "This week is not yet available."}
          />
        </main>
      );
    }
    notFound();
  }

  const overview = await loadExamOverview({ weekId, studentId: user.id });
  if (!overview.ok) {
    // `not_found` (no grand quiz authored for this week) and `quiz_empty` (one
    // authored with no questions) both render as absent rather than as an error:
    // the curriculum-content stream seeds these later, and a half-seeded week must
    // not show a student a stack trace.
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <header>
        <h1 className="text-xl font-semibold">Week {week.week.weekNumber} exam</h1>
        <p className="text-sm text-ink-muted">
          One attempt, timed on the server. There is no negative marking, and
          questions you do not reach are recorded with no mark.
        </p>
      </header>

      <ExamClient
        initial={overview.data}
        weekId={weekId}
        backHref={`/weeks/${weekId}`}
      />
    </main>
  );
}
