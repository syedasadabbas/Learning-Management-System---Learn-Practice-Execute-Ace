// =============================================================================
// MODULE CARD — one module on a track page. Server component.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// STATUS IS NEVER COLOUR-ONLY. "Complete" / "In progress" / "Not started" is a
// word in a Badge, and the same fact is repeated in the progress bar's own label.
// The badge tone reinforces it; it does not carry it. A greyscale screenshot of
// this card is still readable, which is the test.
//
// Estimated minutes come straight from `learning_modules.estimated_minutes`, in
// MINUTES — the one place this stream shows a unit, and it is metric by nature.
// =============================================================================

import Link from "next/link";

import { Badge, Card, ProgressBar, buttonClasses } from "@/components/ui";
import { moduleProgress, type LearnModuleSummary, type ModuleStatus } from "@/lib/learn";

export interface ModuleCardProps {
  module: LearnModuleSummary;
}

const STATUS_COPY: Record<ModuleStatus, { label: string; tone: "neutral" | "brand" | "success" }> =
  {
    not_started: { label: "Not started", tone: "neutral" },
    in_progress: { label: "In progress", tone: "brand" },
    complete: { label: "Complete", tone: "success" },
  };

export function ModuleCard({ module }: ModuleCardProps) {
  const progress = moduleProgress({
    stepCount: module.stepCount,
    completedSteps: module.completedSteps,
  });
  const status = STATUS_COPY[progress.status];

  return (
    <Card
      data-testid="learn-module-card"
      data-module-slug={module.slug}
      data-module-status={progress.status}
      title={module.title}
      subtitle={module.summary}
      action={
        <Badge tone={status.tone} size="md">
          {status.label}
        </Badge>
      }
      footer={
        <Link
          href={`/learn/${module.track}/${module.slug}`}
          className={buttonClasses("secondary", "sm")}
          data-testid="learn-module-link"
        >
          {progress.status === "not_started"
            ? "Start module"
            : progress.status === "complete"
              ? "Review module"
              : "Continue module"}
        </Link>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">
          {module.stepCount} {module.stepCount === 1 ? "step" : "steps"}
          {module.estimatedMinutes ? ` · about ${module.estimatedMinutes} minutes` : ""}
        </p>
        <ProgressBar
          percent={progress.percent}
          size="sm"
          showValue
          tone={progress.status === "complete" ? "success" : "brand"}
          label={`${progress.completedSteps} of ${progress.stepCount} steps complete`}
          ariaLabel={`${module.title} progress: ${progress.percent} per cent`}
        />
      </div>
    </Card>
  );
}

export default ModuleCard;
