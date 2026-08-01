// =============================================================================
// PROBLEM BROWSER — the list surface for both banks. Owner: coding-problems.
// -----------------------------------------------------------------------------
// A SERVER COMPONENT with no client JavaScript at all: the filters are links that
// change the query string, so filtering works with JavaScript disabled, is
// bookmarkable, and back/forward do the obvious thing. A `useState` filter would
// have cost a client bundle to reimplement what the URL already does.
//
// ONE COMPONENT FOR /problems AND /interview. `coding_problems.is_interview` is the
// only difference between them, exactly as the schema comment says: "the same object
// with the same executor and the same completion rule — two tables would mean two of
// everything downstream". Two list components would be the same mistake one layer up.
//
// SOLVED STATE IS DERIVED. Every `solved` flag on a row here came from
// `solvedProblemIds` over `coding_attempts` (src/lib/problems/completion.ts). There
// is no column to read and there must not be one.
// =============================================================================

import Link from "next/link";

import { Badge, buttonClasses, Card, cn, EmptyState, LockBadge, ProgressBar } from "@/components/ui";
import {
  BANK_BASE_PATH,
  LEVELS,
  TRACK_LABELS,
  type ProblemBank,
  type ProblemSummary,
  type ProblemTrack,
} from "@/lib/problems";
import type { TrackProgress } from "@/lib/problems/service";
import type { ProficiencyLevel } from "@/db/schema";

export interface ProblemBrowserProps {
  bank: ProblemBank;
  problems: ProblemSummary[];
  tracks: TrackProgress[];
  availableTracks: ProblemTrack[];
  activeTrack: ProblemTrack | null;
  activeLevel: ProficiencyLevel | null;
}

function filterHref(
  bank: ProblemBank,
  track: ProblemTrack | null,
  level: ProficiencyLevel | null,
): string {
  const params = new URLSearchParams();
  if (track) params.set("track", track);
  if (level) params.set("level", level);
  const query = params.toString();
  return query ? `${BANK_BASE_PATH[bank]}?${query}` : BANK_BASE_PATH[bank];
}

export function ProblemBrowser({
  bank,
  problems,
  tracks,
  availableTracks,
  activeTrack,
  activeLevel,
}: ProblemBrowserProps) {
  const solvedTotal = tracks.reduce((n, t) => n + t.solved, 0);
  const problemTotal = tracks.reduce((n, t) => n + t.total, 0);

  // The ladder is per (track, bank), so a level's lock state is only meaningful
  // once a track is chosen. With no track selected the level chips are plain
  // filters.
  const ladder = activeTrack ? tracks.find((t) => t.track === activeTrack)?.levels ?? [] : [];

  return (
    <div className="space-y-6" data-testid="problem-browser" data-bank={bank}>
      <section aria-labelledby="problem-progress-heading" className="space-y-2">
        <h2 id="problem-progress-heading" className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Your progress
        </h2>
        <ProgressBar
          percent={problemTotal === 0 ? 0 : (solvedTotal / problemTotal) * 100}
          label={`${solvedTotal} of ${problemTotal} solved`}
          showValue
        />
      </section>

      {/* ---- Track filter --------------------------------------------------- */}
      <nav aria-label="Filter by track" className="flex flex-wrap gap-2" data-testid="track-filter">
        <Link
          href={filterHref(bank, null, activeLevel)}
          className={buttonClasses(activeTrack === null ? "primary" : "secondary", "sm")}
          data-testid="track-filter-all"
        >
          All tracks
        </Link>
        {availableTracks.map((track) => {
          const progress = tracks.find((t) => t.track === track);
          return (
            <Link
              key={track}
              href={filterHref(bank, track, activeLevel)}
              className={buttonClasses(activeTrack === track ? "primary" : "secondary", "sm")}
              data-testid="track-filter-option"
              data-track={track}
            >
              {TRACK_LABELS[track]}
              {progress ? (
                <span className="ml-1 text-xs opacity-80">
                  {progress.solved}/{progress.total}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* ---- Level filter, with the ladder's lock state --------------------- */}
      <nav aria-label="Filter by level" className="flex flex-wrap items-center gap-2" data-testid="level-filter">
        <Link
          href={filterHref(bank, activeTrack, null)}
          className={buttonClasses(activeLevel === null ? "primary" : "secondary", "sm")}
          data-testid="level-filter-all"
        >
          All levels
        </Link>
        {LEVELS.map((level) => {
          const state = ladder.find((l) => l.level === level);
          const locked = state ? !state.unlocked : false;
          return (
            <span key={level} className="inline-flex items-center gap-1">
              <Link
                href={filterHref(bank, activeTrack, level)}
                className={cn(
                  buttonClasses(activeLevel === level ? "primary" : "secondary", "sm"),
                  locked && "opacity-70",
                )}
                data-testid="level-filter-option"
                data-level={level}
                data-locked={locked ? "true" : "false"}
              >
                {level}
              </Link>
              {locked && state ? (
                <LockBadge
                  locked
                  size="sm"
                  reason={`Solve ${Math.max(0, state.requiredBelow - state.solvedBelow)} more at the level below to unlock ${level}.`}
                />
              ) : null}
            </span>
          );
        })}
      </nav>

      {/* ---- Rows ----------------------------------------------------------- */}
      {problems.length === 0 ? (
        <EmptyState
          title="No problems match this filter"
          description="Clear the track or level filter, or try the other bank."
        />
      ) : (
        <ul className="space-y-3" data-testid="problem-list">
          {problems.map((problem) => (
            <li key={problem.slug}>
              <Card
                interactive={!problem.locked}
                title={problem.title}
                subtitle={`${TRACK_LABELS[problem.track]} · ${problem.level}`}
                action={
                  problem.solved ? (
                    <Badge tone="success" data-testid="problem-solved-badge">
                      solved
                    </Badge>
                  ) : problem.locked ? (
                    <LockBadge locked reason="This level is not open yet." size="sm" />
                  ) : problem.attemptCount > 0 ? (
                    <Badge tone="warning">
                      {problem.attemptCount} attempt{problem.attemptCount === 1 ? "" : "s"}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">not started</Badge>
                  )
                }
                data-testid="problem-row"
                data-slug={problem.slug}
                data-solved={problem.solved ? "true" : "false"}
                data-locked={problem.locked ? "true" : "false"}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {problem.locked ? (
                    <span className="text-sm text-ink-muted">
                      Solve more problems at the level below to open this one.
                    </span>
                  ) : (
                    <Link
                      href={`${BANK_BASE_PATH[bank]}/${problem.slug}`}
                      className={buttonClasses("primary", "sm")}
                      data-testid="problem-open-link"
                    >
                      Open
                    </Link>
                  )}
                  {problem.execution === "none" ? (
                    <Badge tone="neutral" size="sm">
                      reference only
                    </Badge>
                  ) : (
                    <Badge tone="brand" size="sm">
                      {problem.language}
                    </Badge>
                  )}
                  {problem.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} tone="neutral" size="sm">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ProblemBrowser;
