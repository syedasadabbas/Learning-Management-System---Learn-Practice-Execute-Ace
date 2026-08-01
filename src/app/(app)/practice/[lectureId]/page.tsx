// =============================================================================
// /practice/[lectureId] — every live exercise on one lecture
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// Two empty-ish states are handled explicitly, because both occur in the seeded
// curriculum: a lecture id that does not exist (404), and a lecture that exists
// but carries no `sandpack` resource — 8 of the 12 seeded lectures are in that
// second group, so it is the common case, not an edge case. It must read as a
// deliberate "nothing here yet", never as a broken page.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";

// Deep imports, NOT the "@/components/exercises" barrel, and LazyExerciseList
// rather than ExerciseList. The barrel re-exports LiveEditor, so importing
// anything from it statically pulls Sandpack into this page's first load —
// which measured 378 kB here, the exact regression the lecture page fixed by
// going 377 kB -> 116 kB. Sandpack must load when a student opens an
// exercise, not when they open the index.
import { ConceptAnimation } from "@/components/exercises/ConceptAnimation";
import { LazyExerciseList } from "@/components/exercises/LazyExerciseList";
import { Card, EmptyState, buttonClasses } from "@/components/ui";
import { parseLectureIdParam } from "@/lib/exercises";
import { requireRole } from "@/lib/guard";

import { loadPracticeLecture } from "../exercise-queries";

export const dynamic = "force-dynamic";

interface PageProps {
  // Next.js 15: route params are async.
  params: Promise<{ lectureId: string }>;
}

export default async function LecturePracticePage({ params }: PageProps) {
  const { lectureId: rawId } = await params;
  await requireRole("student", `/practice/${rawId}`);

  const lectureId = parseLectureIdParam(rawId);
  if (lectureId === null) notFound();

  // The cached loader, so this shares ./layout.tsx's existence lookup rather
  // than issuing a second identical query (~245 ms) for the same row.
  const lecture = await loadPracticeLecture(lectureId);
  if (!lecture) notFound();

  const brokenCount = lecture.entries.filter((entry) => !entry.ok).length;

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6" data-testid="lecture-practice-page">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-ink-muted">
          Week {lecture.weekNumber} — {lecture.weekTitle}
        </p>
        <h1 className="text-2xl font-semibold text-ink">
          Lecture {lecture.lectureNumber}: {lecture.lectureTitle}
        </h1>
        <Link href="/practice" className="inline-block text-sm text-brand underline underline-offset-2">
          ← All practice
        </Link>
      </header>

      <section aria-labelledby="exercises-heading" className="space-y-4">
        <h2 id="exercises-heading" className="text-lg font-semibold text-ink">
          Live exercises
        </h2>

        {lecture.entries.length === 0 ? (
          <EmptyState
            title="This lecture has no in-browser exercise"
            description="Its practice is the W3Schools link on the lecture page, which opens in a new tab. The concept explainers below are still worth a few minutes."
            action={
              <Link href="/practice" className={buttonClasses("secondary", "sm")}>
                Browse other exercises
              </Link>
            }
          />
        ) : (
          <>
            {brokenCount > 0 && (
              <p className="text-sm text-ink-muted" data-testid="broken-exercise-notice">
                {brokenCount} of {lecture.entries.length}{" "}
                {lecture.entries.length === 1 ? "exercise" : "exercises"} on this lecture is
                incomplete and cannot be opened. The rest work normally.
              </p>
            )}
            <LazyExerciseList entries={lecture.entries} />
          </>
        )}
      </section>

      {lecture.concepts.length > 0 && (
        <section aria-labelledby="concepts-heading" className="space-y-4">
          <h2 id="concepts-heading" className="text-lg font-semibold text-ink">
            Concept explainers for this lecture
          </h2>
          {lecture.concepts.map((concept) => (
            <ConceptAnimation key={concept.id} conceptId={concept.id} />
          ))}
        </section>
      )}

      {lecture.entries.length === 0 && lecture.concepts.length === 0 && (
        <Card title="Nothing interactive on this lecture">
          <p className="text-sm text-ink-muted">
            There is no live exercise and no matching explainer for this topic yet.
          </p>
        </Card>
      )}
    </main>
  );
}
