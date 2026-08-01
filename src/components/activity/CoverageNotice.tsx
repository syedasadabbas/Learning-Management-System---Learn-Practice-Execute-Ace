// =============================================================================
// COVERAGE NOTICE — activity-logs stream.
// -----------------------------------------------------------------------------
// WHY A FEATURE SHIPS WITH A PANEL SAYING WHAT IT DOES NOT YET COVER.
//
// The roadmap's success metric for this feature is "Coverage: 100% of actions"
// (IMPLEMENTATION_ROADMAP.md:710). It is not 100% in this commit and cannot be: the
// write paths that would emit `login`, `quiz_submit`, `submission_graded` and the
// rest live in files owned by other streams (src/lib/auth.ts, the quiz submit
// handler, the grading handler), and this stream owns src/lib/activity/**, its own
// admin page and its own routes.
//
// The alternative to saying so on screen is an admin console that looks like a
// complete audit trail and is not. That is worse than a partial one, because a gap
// an operator knows about is a gap they can work around, while a gap they believe
// is coverage is a wrong conclusion in an investigation. `unwiredActions()` derives
// this list from the code — it cannot go stale the way a paragraph would, and it
// shrinks by itself as each owning stream adds its call site.
// =============================================================================

import { Badge, Card } from "@/components/ui";
import {
  DEFAULT_RETENTION_DAYS,
  HOOK_POINTS,
  actionLabel,
  type ActivityActionName,
} from "@/lib/activity";

export interface CoverageNoticeProps {
  /** From `unwiredActions()`. Actions declared but with no call site yet. */
  unwired: readonly ActivityActionName[];
  /** Effective retention, in days, from ACTIVITY_RETENTION_DAYS. */
  retentionDays: number;
}

export function CoverageNotice({ unwired, retentionDays }: CoverageNoticeProps) {
  const wiredCount = new Set(HOOK_POINTS.map((h) => h.action)).size;

  return (
    <Card
      title="Coverage and retention"
      subtitle="What this trail records today, and what it does not."
      data-testid="activity-coverage"
    >
      <div className="space-y-3 text-sm text-ink-muted">
        <p className="max-w-prose">
          <strong className="text-ink">Live call sites:</strong> the audit trail
          currently records its own events — exports and prunes. {wiredCount} further
          actions have a documented hook point in{" "}
          <code>src/lib/activity/hook-points.ts</code>, naming the exact route, the
          entity type and whether the row must be written inside the act&apos;s
          transaction. Each becomes live when its owning stream calls{" "}
          <code>recordActivity()</code>.
        </p>

        <p className="max-w-prose">
          <strong className="text-ink">Write failure is fail-closed</strong> for every
          action classified critical: the audit row is inserted on the same
          transaction as the act, so if it cannot be written the act is rolled back
          rather than performed unrecorded. High-volume routine actions (code
          execution above all) use a detached write whose loss mode is stated at the
          call site.
        </p>

        <p className="max-w-prose">
          <strong className="text-ink">Not recorded, ever:</strong> passwords and
          hashes, session or reset tokens, request bodies, query strings, email
          addresses on the row itself, quiz answers, submitted work, instructor
          feedback, full IP addresses (a /24 or /48 prefix only) and full User-Agent
          strings (a coarse family only). Exception messages are reduced to a short
          code.
        </p>

        <p className="max-w-prose">
          <strong className="text-ink">Retention:</strong> {retentionDays} days
          {retentionDays === DEFAULT_RETENTION_DAYS
            ? " (the policy default)"
            : " (set by ACTIVITY_RETENTION_DAYS)"}
          . Pruning deletes in bounded batches, refuses to run without an explicit
          confirmation that the window has been exported, and records itself as an{" "}
          <code>activity_pruned</code> event. There is no cold-storage archive on
          this stack — the CSV export is the archive path.
        </p>

        {unwired.length > 0 && (
          <div>
            <p className="mb-2">
              <strong className="text-ink">
                Declared but not yet emitted ({unwired.length}):
              </strong>{" "}
              these will never appear in the table above until the owning stream
              wires them. Listed so the absence of a row is not read as the absence
              of the act.
            </p>
            <ul className="flex flex-wrap gap-2">
              {unwired.map((action) => (
                <li key={action}>
                  <Badge tone="neutral" size="sm">
                    {actionLabel(action)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
