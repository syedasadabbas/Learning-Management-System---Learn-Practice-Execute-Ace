"use client";

// =============================================================================
// <AsyncSection /> — loading, failure and empty, rendered once instead of
// eleven times.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// Every component in this wave that reads an endpoint owes the user three
// states it does not owe them content for. Written out per component that is
// ~25 lines each, eleven times, and the eleventh one forgets the live region.
//
// WHY THE LOADING STATE IS A SKELETON AND NOT A SPINNER.
// The house primitive is `Skeleton` and its module header argues the case: a
// spinner replaced by a tall list shifts the page. The skeleton reserves the
// height. `label` is required here (it is optional on the primitive) because an
// unlabelled skeleton announces nothing, and "this region is busy" is the entire
// accessibility content of a loading state.
//
// WHY FAILURE IS NOT AN EmptyState.
// `EmptyState` says "there is nothing here", which is a fact about the data. A
// failed request is a fact about the request, and conflating them tells a
// student their class has no questions when actually the server is down. The
// failure branch renders a `Toast`-toned alert with a retry, and marks it
// `role="alert"` so it is announced without the user having to go looking.
// =============================================================================

import * as React from "react";

import { Button, EmptyState, Skeleton, cn } from "@/components/ui";
import type { ResourceState } from "@/lib/client/use-api-resource";

export interface AsyncSectionProps<T> {
  state: ResourceState<T>;
  /** Spoken while loading, e.g. "Loading practice problems". */
  loadingLabel: string;
  /** Rows of skeleton text to reserve. Tune to the shape being replaced. */
  loadingLines?: number;
  /** Called by the retry button in the failure state. */
  onRetry?: () => void;
  /** Treat a ready-but-empty payload as empty. Returns true when there is nothing. */
  isEmpty?: (data: T) => boolean;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  emptyAction?: React.ReactNode;
  className?: string;
  children: (data: T) => React.ReactNode;
}

export function AsyncSection<T>({
  state,
  loadingLabel,
  loadingLines = 3,
  onRetry,
  isEmpty,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  className,
  children,
}: AsyncSectionProps<T>) {
  if (state.status === "loading") {
    return (
      <div className={className} data-testid="async-loading">
        <Skeleton shape="text" lines={loadingLines} label={loadingLabel} />
      </div>
    );
  }

  if (state.status === "failed") {
    return (
      <div
        // role="alert" implies aria-live="assertive": a failed load is the one
        // async event where interrupting is correct, because nothing the user
        // does next will work until they know.
        role="alert"
        data-testid="async-error"
        className={cn(
          "flex flex-col items-start gap-3 rounded-lg border border-dashed border-line",
          "bg-panel px-4 py-5 text-sm text-ink",
          className,
        )}
      >
        <p className="font-semibold">Could not load this section</p>
        <p className="text-ink-muted">{state.failure.error}</p>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  if (isEmpty?.(state.data)) {
    return (
      <div className={className}>
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      </div>
    );
  }

  return <div className={className}>{children(state.data)}</div>;
}
