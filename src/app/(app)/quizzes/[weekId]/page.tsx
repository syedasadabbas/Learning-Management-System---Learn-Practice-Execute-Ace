// =============================================================================
// /quizzes/:weekId — take this week's quiz.
// Owner: quizzes stream.
// -----------------------------------------------------------------------------
// PATH NOTE (raised, not silently resolved): the quizzes SKILL.md names
// `(app)/course/[weekId]/quiz/page.tsx`, but `(app)/course/**` belongs to the
// course-content stream and this stream's file ownership is `(app)/quizzes/**`.
// Creating the file under course/ would have been a cross-stream write, so the
// page lives here and course-content can link to `/quizzes/{weekId}` (or add a
// one-line re-export at its own path). Flagged to the coordinator.
//
// A server component: it reads through the same service the API route uses, so
// the page and the API cannot disagree about attempts remaining or which fields
// are visible. It renders no answer key — `loadStudentQuizByWeek` returns the
// stripped payload.
// =============================================================================

import { notFound } from "next/navigation";

import { AttemptHistoryList, QuizRunner } from "@/components/quiz";
import { LockedNotice } from "@/components/course/LockedNotice";
import { gateWeek } from "@/components/course/data";
import { requireUser } from "@/lib/guard";
import { parsePositiveInt } from "@/lib/quizzes/params";
import { loadAttemptHistory, loadStudentQuizByWeek } from "@/lib/quizzes/service";

// Attempt counts are per-student and change on submit; never statically cached.
export const dynamic = "force-dynamic";

export default async function QuizPage({
  params,
}: {
  params: Promise<{ weekId: string }>;
}) {
  const { weekId: rawWeekId } = await params;
  const weekId = parsePositiveInt(rawWeekId);
  if (weekId === null) notFound();

  const user = await requireUser(`/quizzes/${rawWeekId}`);

  // WEEK-LOCK GATE (added at integration). Without this a student could take a
  // later week's quiz by typing the URL, defeating sequential unlocking. Reuses
  // course-content's gate so the page cannot disagree with the week list; a
  // refusal states the rule rather than silently redirecting.
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

  const quiz = await loadStudentQuizByWeek(weekId, user.id);
  if (!quiz) notFound();

  const history = await loadAttemptHistory(quiz.quiz.id, user.id);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <header>
        <h1 className="text-xl font-semibold">{quiz.quiz.title}</h1>
        <p className="text-sm text-ink-muted">
          Best attempt counts. Pass mark {quiz.quiz.passingScore}% — passing unlocks
          the next week.
        </p>
      </header>

      <QuizRunner quiz={quiz} backHref={`/weeks/${weekId}`} />

      {history && <AttemptHistoryList history={history} />}
    </main>
  );
}
