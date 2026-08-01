// =============================================================================
// /learn — the track index.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// WHAT DECIDES WHICH TRACKS APPEAR: the database, filtered to `published = true`
// in `listTracks`. Not the registry in src/lib/learn/tracks.ts — that only supplies
// each track's title and blurb. So a track whose modules are all still drafts does
// not appear here at all, and adding content never requires editing app code.
//
// These tracks are self-paced and ungraded, which the page says out loud. A student
// who does not know that will reasonably assume a module affects their week score,
// and then avoid it when they are behind — the opposite of the intent.
// =============================================================================

import Link from "next/link";

import { TrackCard } from "@/components/learn";
import { EmptyState, buttonClasses } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { listTracks } from "@/lib/learn/query";
import { trackProgress } from "@/lib/learn";

export const metadata = {
  title: "Learn — concept tracks",
};

// Progress changes as soon as a student completes a step, so a cached index would
// show stale figures immediately after they earned them.
export const dynamic = "force-dynamic";

export default async function LearnIndexPage() {
  const user = await requireRole("student", "/learn");
  const tracks = await listTracks(user.id);
  const overall = trackProgress(
    tracks.map((t) => ({ stepCount: t.stepCount, completedSteps: t.completedSteps })),
  );

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6" data-testid="learn-index">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-ink">Concept tracks</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Self-paced tracks with try-it labs that run entirely in your browser. Nothing
          here is marked, nothing here affects your week score or your leaderboard
          position, and there is no deadline. Your place in each module is saved step by
          step, so closing the tab loses nothing.
        </p>
        {overall.stepCount > 0 && (
          <p className="text-sm text-ink" data-testid="learn-overall-progress">
            {overall.completedSteps} of {overall.stepCount} steps complete across{" "}
            {overall.moduleCount} {overall.moduleCount === 1 ? "module" : "modules"} —{" "}
            {overall.percent} per cent.
          </p>
        )}
      </header>

      {tracks.length === 0 ? (
        <EmptyState
          title="No tracks are published yet"
          description="Concept tracks appear here once a module is published. Nothing is broken — there is simply no content to show."
          action={
            <Link href="/dashboard" className={buttonClasses("secondary", "sm")}>
              Back to dashboard
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" data-testid="learn-track-grid">
          {tracks.map((track) => (
            <li key={track.track}>
              <TrackCard track={track} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
