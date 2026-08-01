// =============================================================================
// /learn/[track] — modules of one track, grouped by proficiency level.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// LEVELS ARE HEADINGS, NOT LOCKS. `beginner` / `intermediate` / `advanced` order
// the ladder and set expectations; they gate nothing. These tracks are ungraded and
// self-paced, so a student who already knows the beginner material should be able to
// start at intermediate — and week unlocking, which does gate, deliberately lives in
// the graded course structure this content sits outside of.
//
// An unpublished-only track 404s rather than rendering an empty page: the modules
// were filtered out in SQL, so there is genuinely nothing at this URL for a student.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";

import { ModuleCard } from "@/components/learn";
import { ProgressBar, buttonClasses } from "@/components/ui";
import { requireRole } from "@/lib/guard";
// NOTE: the loader is imported from src/lib/navigation/guards.ts, not from its own
// module. That wrapper is the shared React `cache()` memo, and the sibling
// layout.tsx guard calls the SAME one — which is what makes this route's 404
// correct (the guard runs above this route's loading.tsx boundary, where the HTTP
// status is still settable) without paying for the query twice at ~245 ms a round
// trip. See that file and src/components/nav/PageSkeleton.tsx.
import { loadTrackModules } from "@/lib/navigation/guards";
import {
  LEARN_LEVELS,
  groupByLevel,
  levelLabel,
  trackDisplay,
  trackProgress,
  type LearnLevel,
} from "@/lib/learn";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ track: string }>;
}

export default async function LearnTrackPage({ params }: PageProps) {
  const { track } = await params;
  const user = await requireRole("student", `/learn/${track}`);

  const modules = await loadTrackModules(track, user.id);
  // Nothing published for this slug — indistinguishable from a slug that never
  // existed, which is the point: the response must not confirm draft content.
  if (modules.length === 0) notFound();

  const display = trackDisplay(track);
  const progress = trackProgress(
    modules.map((m) => ({ stepCount: m.stepCount, completedSteps: m.completedSteps })),
  );
  const groups = groupByLevel(modules, LEARN_LEVELS);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6" data-testid="learn-track-page" data-track={track}>
      <header className="space-y-3">
        <Link href="/learn" className="inline-block text-sm text-brand underline underline-offset-2">
          ← All tracks
        </Link>
        <h1 className="text-2xl font-semibold text-ink">{display.title}</h1>
        {display.summary && (
          <p className="max-w-prose text-sm text-ink-muted">{display.summary}</p>
        )}
        <ProgressBar
          percent={progress.percent}
          showValue
          tone={progress.percent === 100 ? "success" : "brand"}
          label={`${progress.completedSteps} of ${progress.stepCount} steps complete · ${progress.modulesComplete} of ${progress.moduleCount} modules`}
          ariaLabel={`${display.title} progress: ${progress.percent} per cent`}
        />
      </header>

      {groups.map((group) => (
        <section
          key={group.level}
          aria-labelledby={`level-${group.level}`}
          data-testid="learn-level-group"
          data-level={group.level}
          className="space-y-3"
        >
          <h2 id={`level-${group.level}`} className="text-lg font-semibold text-ink">
            {levelLabel(group.level as LearnLevel)}
          </h2>
          <p className="text-sm text-ink-muted">
            Levels order the ladder; they do not lock anything. Start wherever the
            material is new to you.
          </p>
          <ul className="grid gap-4 sm:grid-cols-2">
            {group.modules.map((module) => (
              <li key={module.id}>
                <ModuleCard module={module} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p>
        <Link href="/learn" className={buttonClasses("secondary", "sm")}>
          Back to all tracks
        </Link>
      </p>
    </main>
  );
}
