// =============================================================================
// /admin/quizzes — quiz + question authoring. instructor-admin stream.
// -----------------------------------------------------------------------------
// ADMIN ONLY. Quiz content decides who passes and therefore who unlocks the next
// week; `ROLES_SATISFYING.admin` is ["admin"] alone, so an instructor is refused
// here and every action this page calls re-checks the same thing server-side.
// =============================================================================

import Link from "next/link";

import { QuestionForm, QuizForm } from "@/components/instructor";
import { Badge, buttonClasses, Card, EmptyState } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { listQuestions, listQuizzes, listWeeks } from "@/lib/instructor/admin";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ quizId?: string }>;
}

export default async function AdminQuizzesPage({ searchParams }: PageProps) {
  await requireRole("admin");
  const params = await searchParams;

  const quizIdRaw = Number(params.quizId);
  const quizId = Number.isInteger(quizIdRaw) && quizIdRaw > 0 ? quizIdRaw : null;

  const [weeks, quizzes] = await Promise.all([listWeeks(), listQuizzes()]);
  const selected = quizId ? quizzes.find((q) => q.id === quizId) ?? null : null;
  const questions = selected ? await listQuestions(selected.id) : [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Quizzes</h1>
        <p className="text-sm text-ink-muted">
          One quiz per week. The pass mark drives week unlocking via
          shouldUnlockNextWeek in the scoring contract.
        </p>
      </header>

      {quizzes.length === 0 ? (
        <EmptyState
          title="No quizzes yet"
          description="Create the first quiz below; questions can be added once it exists."
        />
      ) : (
        <Card padded={false} title="Existing quizzes">
          <ul className="divide-y divide-line text-sm">
            {quizzes.map((q) => (
              <li key={q.id} className="flex items-center justify-between px-4 py-2">
                <span>
                  <span className="font-medium">
                    Week {q.weekNumber} — {q.title}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    pass {q.passingScore}% · {q.attemptsAllowed} attempts ·{" "}
                    {q.timeLimitMinutes === null
                      ? "untimed"
                      : `${q.timeLimitMinutes} min`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge
                    tone={q.authoredQuestions === q.totalQuestions ? "success" : "warning"}
                    size="sm"
                  >
                    {q.authoredQuestions} / {q.totalQuestions} questions
                  </Badge>
                  <Link
                    href={`/admin/quizzes?quizId=${q.id}`}
                    className={buttonClasses("secondary", "sm")}
                    data-testid={`edit-quiz-${q.id}`}
                  >
                    Edit
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <QuizForm weeks={weeks} quiz={selected ?? undefined} />

      {selected && (
        <>
          <Card padded={false} title={`Questions in "${selected.title}"`}>
            {questions.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-muted">
                No questions authored yet.
              </p>
            ) : (
              <ol className="divide-y divide-line text-sm">
                {questions.map((q, i) => (
                  <li key={q.id} className="px-4 py-2">
                    <p className="font-medium">
                      {i + 1}. {q.questionText}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {q.options.map((o) => (
                        <li
                          key={o.id}
                          className={o.isCorrect ? "text-emerald-800" : "text-ink-muted"}
                        >
                          {o.isCorrect ? "✓" : "·"} {o.optionText}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <QuestionForm quizId={selected.id} hasAttempts={selected.attemptCount > 0} />
        </>
      )}
    </div>
  );
}
