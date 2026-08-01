// =============================================================================
// /practice — index of in-app live coding exercises
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// The nav already links here (src/components/nav/nav-links.ts, student role).
// Middleware requires a session for /practice; requireRole() re-checks on the
// server because middleware covers path prefixes and a page must not depend on a
// matcher entry staying correct (see the note at the top of middleware.ts).
// =============================================================================

import Link from "next/link";

import { Badge, Card, EmptyState, buttonClasses } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { CONCEPTS } from "@/lib/exercises";

import { listPracticeLectures, type PracticeLectureSummary } from "../exercise-queries";

// Reads the database per request; nothing here is prerenderable at build time.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Practice",
  description: "Live in-browser HTML, CSS and JavaScript exercises.",
};

function groupByWeek(lectures: PracticeLectureSummary[]) {
  const groups = new Map<number, { weekTitle: string; lectures: PracticeLectureSummary[] }>();
  for (const lecture of lectures) {
    const group = groups.get(lecture.weekNumber) ?? {
      weekTitle: lecture.weekTitle,
      lectures: [],
    };
    group.lectures.push(lecture);
    groups.set(lecture.weekNumber, group);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

export default async function PracticePage() {
  await requireRole("student", "/practice");

  const lectures = await listPracticeLectures();
  const withExercises = lectures.filter((lecture) => lecture.exerciseCount > 0);
  const grouped = groupByWeek(withExercises);

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6" data-testid="practice-page">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-ink">Practice</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Write real HTML, CSS and JavaScript in the browser and watch the result update as
          you type. Nothing here is marked — break it, reset it, try again. The
          W3Schools examples linked from each lecture open in a new tab because
          W3Schools cannot be embedded; these exercises are the in-app equivalent.
        </p>
      </header>

      <section aria-labelledby="exercises-heading" className="space-y-4">
        <h2 id="exercises-heading" className="text-lg font-semibold text-ink">
          Exercises by week
        </h2>

        {grouped.length === 0 ? (
          <EmptyState
            title="No live exercises yet"
            description="No lecture currently carries an in-browser exercise. Concept explainers below still work, and each lecture links out to W3Schools for practice."
          />
        ) : (
          grouped.map(([weekNumber, group]) => (
            <div key={weekNumber} className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
                Week {weekNumber} — {group.weekTitle}
              </h3>
              <ul className="space-y-3">
                {group.lectures.map((lecture) => (
                  <li key={lecture.lectureId}>
                    <Card
                      interactive
                      title={`Lecture ${lecture.lectureNumber}: ${lecture.lectureTitle}`}
                      subtitle={`${lecture.exerciseCount} ${
                        lecture.exerciseCount === 1 ? "exercise" : "exercises"
                      }`}
                      action={<Badge tone="brand">Live editor</Badge>}
                      data-testid="practice-lecture-card"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          href={`/practice/${lecture.lectureId}`}
                          className={buttonClasses("primary", "sm")}
                          data-testid="practice-open-link"
                        >
                          Open exercises
                        </Link>
                        {lecture.concepts.map((concept) => (
                          <Link
                            key={concept.id}
                            href={`/practice/concept/${concept.id}`}
                            className="text-sm text-brand underline underline-offset-2"
                          >
                            {concept.title}
                          </Link>
                        ))}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="concepts-heading" className="space-y-4">
        <h2 id="concepts-heading" className="text-lg font-semibold text-ink">
          Animated concept explainers
        </h2>
        <p className="max-w-prose text-sm text-ink-muted">
          Step through each idea one change at a time. If your system asks for reduced
          motion, the diagrams change instantly instead of animating — nothing is hidden.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="concept-index">
          {CONCEPTS.map((concept) => (
            <li key={concept.id}>
              <Card interactive title={concept.title} subtitle={concept.summary}>
                <Link
                  href={`/practice/concept/${concept.id}`}
                  className={buttonClasses("secondary", "sm")}
                  data-testid="concept-open-link"
                >
                  Open explainer
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
