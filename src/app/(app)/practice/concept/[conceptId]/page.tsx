// =============================================================================
// /practice/concept/[conceptId] — one animated explainer plus a matching editor
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// Pairs the diagram with a snippet from src/lib/exercises/registry.ts so a student
// can immediately try the thing they were just shown. The snippet is OURS, not
// seeded content, and is labelled as such: it carries no marks and is not the
// lecture's exercise.
//
// A static "concept" segment alongside the dynamic "[lectureId]" segment is
// unambiguous in the App Router — static segments win — so /practice/concept/... is
// never parsed as a lecture id.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";

// Deep imports, not the barrel: the barrel re-exports LiveEditor, so a single
// named import from it dragged Sandpack into this page (378 kB first load) even
// though a concept explainer does not need an editor at all.
import { ConceptAnimation } from "@/components/exercises/ConceptAnimation";
import { LazyExercisePanel } from "@/components/exercises/LazyExerciseList";
import { buttonClasses } from "@/components/ui";
import { conceptById, conceptExercise } from "@/lib/exercises";
import { requireRole } from "@/lib/guard";

interface PageProps {
  params: Promise<{ conceptId: string }>;
}

export default async function ConceptPage({ params }: PageProps) {
  const { conceptId } = await params;
  await requireRole("student", `/practice/concept/${conceptId}`);

  const concept = conceptById(conceptId);
  if (!concept) notFound();

  const exercise = conceptExercise(concept.id);

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6" data-testid="concept-page">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-ink">{concept.title}</h1>
        <p className="max-w-prose text-sm text-ink-muted">{concept.summary}</p>
        <Link href="/practice" className="inline-block text-sm text-brand underline underline-offset-2">
          ← All practice
        </Link>
      </header>

      <ConceptAnimation conceptId={concept.id} />

      {exercise && (
        <section aria-labelledby="try-heading" className="space-y-3">
          <h2 id="try-heading" className="text-lg font-semibold text-ink">
            Try it yourself
          </h2>
          <p className="max-w-prose text-sm text-ink-muted">
            A scratch exercise for this concept — not part of any lecture and not marked.
            Change a value, watch the preview, and reset when it gets away from you.
          </p>
          <LazyExercisePanel entry={{ ok: true, exercise }} />
        </section>
      )}

      <p>
        <Link href="/practice" className={buttonClasses("secondary", "sm")}>
          Back to practice
        </Link>
      </p>
    </main>
  );
}
