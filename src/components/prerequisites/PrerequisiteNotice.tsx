// =============================================================================
// PREREQUISITE NOTICE — what the student is TOLD when a prerequisite blocks them.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// NOT a "use client" component, and it has no state. It is rendered by server
// pages only, and it imports exclusively from `@/lib/prerequisites/labels` (the
// zero-import pure module) plus the shared UI primitives — never from ./policy or
// ./store, which would pull `@/lib/guard` -> `@/lib/auth` -> `pg` into whatever
// bundle it lands in. That hazard is not hypothetical; see
// src/lib/prerequisites/labels.ts's header.
//
// =============================================================================
// THIS COMPONENT IS REQUIREMENT 5 OF FEATURE 8.
// =============================================================================
// "Locked" with no reason is the failure mode the feature exists to remove. Every
// refusal rendered here NAMES the course that is missing and, where a threshold is
// involved, both the number required and the number the student has. The codebase
// already holds this line elsewhere and for the same reason:
// docs/SUBJECT_SECTIONS.md:101 records that a section refusal must never say
// "Locked until you pass the Week N quiz", because a wrong reason sends a student
// to spend one of their three quiz attempts for nothing. A missing reason is the
// same defect with less information.
//
// IT DECIDES NOTHING. `unmet` and `override` are computed on the server by
// `evaluatePrerequisites` and arrive as props. Rendering a notice to someone who is
// not blocked would be a cosmetic bug; NOT rendering one to someone who is blocked
// would still leave them refused, because the refusal is `decideCourseAccess`'s and
// not this component's. Hiding a message is not access control, and neither is
// showing one.
//
// "LOCKED IS NOT MISSING." This renders inside a page returning HTTP 200. Nothing
// in this stream calls `notFound()` — a 404 in place of "you still need Course B"
// destroys the only information the feature delivers, which is the argument
// /courses/[courseId]/page.tsx:15 already makes for a pending request.
// =============================================================================

import { Badge } from "@/components/ui";
import {
  describeUnmet,
  UNMET_REASON_LABEL,
  UNMET_REASON_TONE,
  type UnmetPrerequisite,
} from "@/lib/prerequisites/labels";

export interface PrerequisiteOverrideNotice {
  reason: string;
  grantedByName: string | null;
  /** ISO 8601 UTC. Dates cross the RSC boundary as strings, never as Date. */
  grantedAt: string;
}

export interface PrerequisiteNoticeProps {
  /** What is unmet ON MERIT. Non-empty even when an override admits them. */
  unmet: readonly UnmetPrerequisite[];
  /** The live admin exception, when one applies. */
  override?: PrerequisiteOverrideNotice | null;
  /**
   * `blocked` — the student is refused (the gate's denial branch).
   * `advisory` — they are NOT refused but should know what stands in the way
   *   (the catalog, where the Request button has been withheld).
   * `granted` — an override is admitting them; this is the visible half of
   *   requirement 4.
   */
  variant: "blocked" | "advisory" | "granted";
}

const HEADING: Record<PrerequisiteNoticeProps["variant"], string> = {
  blocked: "Entry requirements not met",
  advisory: "Before you can request this course",
  // Named as an exception, not as an achievement. A student who believes they
  // earned a prerequisite they did not is a student who will be surprised by the
  // next course that cites it.
  granted: "Admitted by an admin override",
};

export function PrerequisiteNotice({ unmet, override, variant }: PrerequisiteNoticeProps) {
  if (unmet.length === 0 && !override) return null;

  return (
    <div
      className="space-y-3"
      data-testid="prerequisite-notice"
      data-variant={variant}
      data-unmet-count={unmet.length}
    >
      <p className="text-sm font-semibold text-ink">{HEADING[variant]}</p>

      {unmet.length > 0 && (
        <ul className="space-y-2" data-testid="unmet-prerequisites">
          {unmet.map((item) => (
            <li
              key={item.courseId}
              className="flex flex-wrap items-start gap-2"
              // The id and the machine-readable reason are attributes so an e2e
              // spec asserts the STATE rather than pattern-matching prose that a
              // copy edit will change — the convention CourseCatalog.tsx:25
              // established with `data-access-state`.
              data-testid={`unmet-prerequisite-${item.courseId}`}
              data-unmet-reason={item.reason}
            >
              <Badge tone={UNMET_REASON_TONE[item.reason]} size="sm">
                {UNMET_REASON_LABEL[item.reason]}
              </Badge>
              <span className="max-w-prose text-sm text-ink">{describeUnmet(item)}</span>
            </li>
          ))}
        </ul>
      )}

      {override && (
        // THE OVERRIDE IS SHOWN TO THE STUDENT, not only on the admin console.
        // Requirement 4 is that it is visible rather than silent, and a record only
        // the granter can see is silent to the person it is about.
        <div
          className="rounded-md border border-line bg-surface px-3 py-2"
          data-testid="prerequisite-override"
        >
          <p className="text-sm text-ink">
            An admin granted you access despite the requirement{unmet.length === 1 ? "" : "s"} above.
          </p>
          <p className="mt-1 text-sm text-ink-muted" data-testid="override-reason">
            Reason: {override.reason}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {override.grantedByName ? `Granted by ${override.grantedByName}` : "Granted"} on{" "}
            {new Date(override.grantedAt).toISOString().slice(0, 10)}
          </p>
        </div>
      )}

      {variant === "blocked" && (
        // The limit of what satisfying these will buy, stated here rather than
        // discovered. Course access is one of three layers
        // (docs/SUBJECT_SECTIONS.md:14) and opening a course does not open a
        // withheld subject inside it.
        <p className="max-w-prose text-xs text-ink-muted">
          Meeting these opens the course. Individual subjects and weeks inside it
          still unlock in the usual way.
        </p>
      )}
    </div>
  );
}
