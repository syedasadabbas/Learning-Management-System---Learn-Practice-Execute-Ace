// =============================================================================
// LEARN CLIENT — the browser's side of POST /api/learn/steps/:stepId/complete.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// Separated from the component for two reasons:
//
//   1. NEVER THROW AT THE UI. A network blip while a student advances a step must
//      degrade to "not saved yet", not to a rejected promise inside an onClick
//      handler where React has no error boundary to catch it. Every failure below
//      is a value, following the execution stream's rule for the same reason.
//   2. `fetch` IS INJECTED, so this is unit-testable with no network and no
//      jsdom quirks. The path is built from the frozen route key so a typo in the
//      URL is a compile error rather than a 404 at run time.
//
// The path template lives in `src/lib/contracts/api.ts` as
// "POST /api/learn/steps/:stepId/complete"; `completeStepPath` substitutes the
// one parameter and is asserted against that constant in the tests.
// =============================================================================

import type { CheckOutcome } from "./expectation";
import type { ModuleProgress } from "./progress";

/** Build the completion URL for a step. */
export function completeStepPath(stepId: number): string {
  return `/api/learn/steps/${encodeURIComponent(String(stepId))}/complete`;
}

export interface CompletePayload {
  created: boolean;
  stepId: number;
  moduleId: number;
  progress: ModuleProgress;
  announcement: string;
  check: CheckOutcome | null;
}

export type CompleteResponse =
  | { ok: true; data: CompletePayload }
  | { ok: false; error: string; code?: string };

/** Minimal fetch shape, so tests need no DOM types. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function isPayload(value: unknown): value is CompletePayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.created === "boolean" && typeof v.stepId === "number";
}

/**
 * Mark a step complete, optionally submitting an inline check answer.
 *
 * Always resolves. A non-2xx response, an unparseable body and a thrown fetch all
 * come back as `{ ok: false }` with a message safe to show a student.
 */
export async function postStepComplete(
  stepId: number,
  answerIndex?: number,
  fetchImpl?: FetchLike,
): Promise<CompleteResponse> {
  const doFetch = (fetchImpl ?? (globalThis.fetch as unknown as FetchLike)) as
    | FetchLike
    | undefined;
  if (typeof doFetch !== "function") {
    return { ok: false, error: "This browser cannot reach the server.", code: "no_fetch" };
  }

  let parsed: unknown;
  try {
    const response = await doFetch(completeStepPath(stepId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Always send a body, even an empty object: a route that has to tolerate
      // "no body at all" AND "a body" has two paths, and one of them gets tested.
      body: JSON.stringify(answerIndex === undefined ? {} : { answerIndex }),
    });
    parsed = await response.json();
  } catch {
    return {
      ok: false,
      error: "Could not save that step. Check your connection and try again.",
      code: "network",
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "The server sent an unexpected response.", code: "bad_response" };
  }

  const envelope = parsed as Record<string, unknown>;
  if (envelope.ok === true && isPayload(envelope.data)) {
    return { ok: true, data: envelope.data };
  }

  return {
    ok: false,
    error:
      typeof envelope.error === "string" && envelope.error !== ""
        ? envelope.error
        : "Could not save that step.",
    code: typeof envelope.code === "string" ? envelope.code : undefined,
  };
}
