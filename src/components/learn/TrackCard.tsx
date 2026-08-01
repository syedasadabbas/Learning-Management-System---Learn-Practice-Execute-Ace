// =============================================================================
// TRACK CARD — one track on the /learn index. Server component (no interactivity).
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// Composes `Card`, `Badge` and `ProgressBar` from src/components/ui. It defines no
// button and no badge of its own, and it hardcodes no colour: every surface,
// border and text tone is a design token from globals.css. The one bespoke element
// is the link, which uses `buttonClasses` so it matches a Button exactly without a
// second Button implementation existing.
// =============================================================================

import Link from "next/link";

import { Badge, Card, ProgressBar, buttonClasses } from "@/components/ui";
import { levelLabel, moduleProgress, type LearnTrackSummary } from "@/lib/learn";

export interface TrackCardProps {
  track: LearnTrackSummary;
}

export function TrackCard({ track }: TrackCardProps) {
  // Derived here from steps, never read from a stored column — see progress.ts.
  const progress = moduleProgress({
    stepCount: track.stepCount,
    completedSteps: track.completedSteps,
  });

  return (
    <Card
      data-testid="learn-track-card"
      data-track={track.track}
      title={track.title}
      subtitle={track.summary}
      footer={
        <Link
          href={`/learn/${track.track}`}
          className={buttonClasses("primary", "sm")}
          data-testid="learn-track-link"
        >
          Open track
        </Link>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {track.levels.map((level) => (
            <Badge key={level} tone="neutral" size="sm">
              {levelLabel(level)}
            </Badge>
          ))}
        </div>

        <p className="text-sm text-ink-muted">
          {track.moduleCount} {track.moduleCount === 1 ? "module" : "modules"} ·{" "}
          {track.stepCount} {track.stepCount === 1 ? "step" : "steps"}
        </p>

        <ProgressBar
          percent={progress.percent}
          size="sm"
          showValue
          tone={progress.status === "complete" ? "success" : "brand"}
          label={`${progress.completedSteps} of ${progress.stepCount} steps complete`}
          ariaLabel={`${track.title} progress: ${progress.percent} per cent`}
        />
      </div>
    </Card>
  );
}

export default TrackCard;
