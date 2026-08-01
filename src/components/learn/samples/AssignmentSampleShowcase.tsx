"use client";

// =============================================================================
// <AssignmentSampleShowcase /> — every worked sample for one assignment.
// Spec: TECHNICAL_SPECIFICATION.md §3.1.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// The spec fixes the prop API as `{ assignmentId }` — an id, not data — so this
// is one of the three components in the wave that fetches for itself. See the
// header of src/lib/client/use-api-resource.ts for why the rest do not.
//
// WHY A LIST AND NOT A CAROUSEL. The spec says "carousel/tabs". A carousel hides
// N-1 of N samples behind an interaction that is easy to miss, and the whole
// purpose of this surface is "here is what done looks like" — a student
// comparing the desktop and mobile variants wants both on screen. Samples are
// rendered as a vertical stack of collapsed cards, which is the tabs behaviour
// (one expanded at a time by default) without the discoverability cost, and it
// is the layout that survives a 360 px viewport without a horizontal scroller.
//
// `onSampleCreated` is in the spec's prop list. It is accepted and documented as
// UNUSED by this component: creation is an instructor action against
// `POST /api/assignments/:id/samples`, that form is not part of the student
// showcase, and a prop that silently does nothing is worse than one that says so.
// =============================================================================

import * as React from "react";

import { AsyncSection } from "@/components/async/AsyncSection";
import { Button, cn } from "@/components/ui";
import { apiPathWithQuery } from "@/lib/client/api";
import { useApiResource } from "@/lib/client/use-api-resource";
import type { Paginated } from "@/lib/learning/pagination";

import { SampleCard } from "./SampleCard";
import type { AssignmentSample } from "./types";

export interface AssignmentSampleShowcaseProps {
  assignmentId: number;
  /** Reserved for the instructor authoring surface; this component never writes. */
  isReadOnly?: boolean;
  /** Accepted for prop-API compatibility with the spec. Never called here. */
  onSampleCreated?: (sample: AssignmentSample) => void;
  /** CSS length, e.g. "800px". Applied as a max-width so narrow screens still fit. */
  maxWidth?: string;
  className?: string;
  fetchImpl?: typeof fetch;
}

/** One request's worth of samples. An assignment with more than 50 is a content bug. */
const PAGE_LIMIT = 50;

export function AssignmentSampleShowcase({
  assignmentId,
  isReadOnly: _isReadOnly = true,
  onSampleCreated: _onSampleCreated,
  maxWidth,
  className,
  fetchImpl,
}: AssignmentSampleShowcaseProps) {
  const url = React.useMemo(
    () =>
      apiPathWithQuery(
        "GET  /api/assignments/:assignmentId/samples",
        { assignmentId },
        { limit: PAGE_LIMIT },
      ),
    [assignmentId],
  );

  const { state, reload } = useApiResource<Paginated<AssignmentSample>>(
    "GET  /api/assignments/:assignmentId/samples",
    url,
    { fetchImpl },
  );

  return (
    <section
      aria-labelledby={`samples-${assignmentId}-heading`}
      className={cn("flex flex-col gap-3", className)}
      style={maxWidth ? { maxWidth } : undefined}
      data-testid="assignment-sample-showcase"
    >
      <h2 id={`samples-${assignmentId}-heading`} className="text-lg font-semibold text-ink">
        Worked samples
      </h2>
      <p className="text-sm text-ink-muted">
        What a finished submission looks like, with the code that produced it. Read these
        before you start — they are published on purpose.
      </p>

      <AsyncSection
        state={state}
        loadingLabel="Loading worked samples"
        loadingLines={4}
        onRetry={() => void reload()}
        isEmpty={(page) => page.items.length === 0}
        emptyTitle="No samples published yet"
        emptyDescription="Your instructor has not attached a worked sample to this assignment. The brief is still the source of truth."
      >
        {(page) => (
          <>
            <p className="sr-only" data-testid="sample-count">
              {`${page.items.length} of ${page.total} samples shown.`}
            </p>
            <ul className="flex flex-col gap-4">
              {page.items.map((sample) => (
                <li key={sample.id}>
                  <SampleCard sample={sample} />
                </li>
              ))}
            </ul>
            {page.total > page.items.length && (
              // No infinite scroll and no pager: the page limit is 50 and an
              // assignment with more samples than that is a content problem, not
              // a pagination problem. Saying so is more useful than a button
              // that loads a 51st.
              <p className="mt-3 text-sm text-ink-muted">
                {`Showing the first ${page.items.length} of ${page.total} samples.`}
              </p>
            )}
          </>
        )}
      </AsyncSection>

      {state.status === "ready" && state.data.items.length > 0 && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => void reload()}>
          Refresh samples
        </Button>
      )}
    </section>
  );
}
