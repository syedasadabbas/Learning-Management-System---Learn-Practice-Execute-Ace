"use client";

// =============================================================================
// useApiResource — fetch-on-mount for the data-bound components in this wave.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// WHY A HOOK RATHER THAN THE HOUSE IDIOM.
//
// The established pattern in this repo is a SERVER component that awaits a
// service function and passes plain props down (see ReviewTaskList,
// WeekProgressList, AssignmentCard). That is the better pattern and it is used
// for every page this stream adds. This hook exists for the cases where it
// genuinely cannot apply, and there are exactly three of them:
//
//   1. The prop API is fixed by TECHNICAL_SPECIFICATION.md §3.1 as
//      `<AssignmentSampleShowcase assignmentId={1} />` — an id, not data. A
//      component whose contract is "given an id, show the thing" has to fetch.
//   2. The hint ladder is METERED SERVER-SIDE
//      (src/app/api/practice-problems/[id]/hints/route.ts): each rung is a
//      separate request made in response to a click. There is no initial payload
//      to pass down, by design.
//   3. The class room re-reads chat and Q&A on an interval when the socket
//      service is absent. Polling is a client concern.
//
// Everything else in this stream is a server component.
//
// WHY THE STATE IS ONE OBJECT AND NOT THREE useStates.
// `{data, error, loading}` as three independent pieces of state can hold
// "loading AND has an error AND has data", which is three renders of a
// contradiction and the source of the flash-of-stale-error every list in every
// codebase eventually grows. One discriminated value cannot express it.
// =============================================================================

import * as React from "react";

import { apiRequest, type ApiFailure, type RouteKey } from "./api";

export type ResourceState<T> =
  | { status: "loading"; data: null; failure: null }
  | { status: "ready"; data: T; failure: null }
  | { status: "failed"; data: null; failure: ApiFailure };

export interface UseApiResourceOptions {
  /**
   * When false the hook does nothing and stays in `loading`.
   *
   * Used by panels that must not call an endpoint until a precondition holds —
   * the Q&A panel does not fetch until it knows the class allows Q&A, because
   * the route answers 409 and a 409 rendered as an error looks like a fault
   * rather than a setting.
   */
  enabled?: boolean;
  /** Poll interval in milliseconds. Omit or 0 for a single fetch. */
  refreshMs?: number;
  fetchImpl?: typeof fetch;
}

export interface UseApiResourceResult<T> {
  state: ResourceState<T>;
  /** Re-fetch now. Returns once the request settles, so callers can await it. */
  reload: () => Promise<void>;
  /**
   * Replace the held data without a round trip.
   *
   * The optimistic-send path in ChatPanel needs this: it appends a pending
   * message, then either reconciles it with the server row or rolls it back.
   */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

const LOADING = { status: "loading", data: null, failure: null } as const;

export function useApiResource<T>(
  key: RouteKey,
  url: string | null,
  options: UseApiResourceOptions = {},
): UseApiResourceResult<T> {
  const { enabled = true, refreshMs = 0, fetchImpl } = options;

  const [state, setState] = React.useState<ResourceState<T>>(LOADING);

  // The in-flight controller, so a reload supersedes rather than races the
  // request it replaces. Without this, a poll that resolves after a manual
  // reload overwrites the newer data with the older.
  const inFlight = React.useRef<AbortController | null>(null);
  const mounted = React.useRef(true);

  const active = enabled && url !== null;

  const run = React.useCallback(async (): Promise<void> => {
    if (!active || url === null) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    const result = await apiRequest<T>(key, url, {
      signal: controller.signal,
      fetchImpl,
    });

    // An abort is either an unmount or a supersede. In both cases the state that
    // matters belongs to somebody else, so writing here would clobber it.
    if (!mounted.current || (result.ok === false && result.aborted)) return;

    setState(
      result.ok
        ? { status: "ready", data: result.data, failure: null }
        : { status: "failed", data: null, failure: result },
    );
  }, [active, fetchImpl, key, url]);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
    };
  }, []);

  React.useEffect(() => {
    if (!active) return;
    // Back to loading whenever the address changes, so a component switching
    // from problem 3 to problem 4 does not render problem 3's body under
    // problem 4's heading for one frame.
    setState(LOADING);
    void run();
  }, [active, run]);

  React.useEffect(() => {
    if (!active || refreshMs <= 0) return;
    const timer = setInterval(() => {
      void run();
    }, refreshMs);
    return () => clearInterval(timer);
  }, [active, refreshMs, run]);

  const setData = React.useCallback<React.Dispatch<React.SetStateAction<T | null>>>(
    (update) => {
      setState((prev) => {
        const current = prev.status === "ready" ? prev.data : null;
        const next = typeof update === "function"
          ? (update as (value: T | null) => T | null)(current)
          : update;
        if (next === null) return LOADING;
        return { status: "ready", data: next, failure: null };
      });
    },
    [],
  );

  return { state, reload: run, setData };
}
