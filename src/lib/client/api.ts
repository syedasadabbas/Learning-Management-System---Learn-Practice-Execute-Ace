// =============================================================================
// CLIENT API ACCESS — the one place a browser component turns a frozen route
// key into a URL and an `ApiResult` into a value.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL.
//
// `ROUTES` in @/lib/contracts/api is the seam that keeps parallel streams from
// colliding, but until now nothing on the CLIENT consumed it: every component
// in the repo writes `fetch("/api/quizzes/" + id + "/submit")`. That works right
// up to the day a path changes, at which point the compiler is silent and the
// failure is a 404 at runtime in a student's browser. `apiPath` below takes a
// ROUTE KEY — the literal string from the map, double space after GET and all —
// so a typo is a type error and a renamed route breaks the build instead of the
// class.
//
// It deliberately does NOT wrap every route in a named function. A generated
// client would be a second contract to keep in step with the first; the route
// key IS the contract, and passing it verbatim is what makes the check work.
//
// WHY THE RESULT IS A VALUE AND NOT A THROW.
// Every data-bound component in this wave has to render three states — loading,
// error, content. A helper that throws forces each one to write a try/catch
// whose catch block cannot distinguish "the server said 409 chat is disabled"
// from "the network died", and those need different copy. So the failure is a
// discriminated union carrying the HTTP status and the server's `code`, which is
// what the panels switch on.
//
// All timeouts are milliseconds (house rule: metric units).
// =============================================================================

import { ROUTES, type ApiResult } from "@/lib/contracts/api";

/** Every key of the frozen route map, e.g. `"GET  /api/classes/:classId"`. */
export type RouteKey = keyof typeof ROUTES;

/**
 * Default client-side request timeout.
 *
 * 20 s matches `SUBMIT_TIMEOUT_MS` in QuizRunner, which is the house precedent.
 * Long enough for a cold serverless function on a bad mobile connection, short
 * enough that a hung request eventually renders an error rather than a spinner
 * that never resolves.
 */
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Substitute path parameters into a route key.
 *
 * @param key    a literal key from `ROUTES`. Typed as `RouteKey`, so an
 *               unregistered path does not compile.
 * @param params values for the `:name` segments. Numbers are stringified;
 *               strings are percent-encoded, because a slide id or a room name
 *               can legitimately contain characters that would otherwise change
 *               which resource is addressed.
 * @returns the path, with any `?query` left to the caller
 *
 * @throws Error when a `:name` segment has no value. This is a PROGRAMMER error
 *         — the alternative is fetching a literal `/api/classes/:classId`, which
 *         404s in a way that looks like a missing row rather than a missing
 *         argument. Throwing at the call site is the shortest path to the bug.
 */
export function apiPath(
  key: RouteKey,
  params: Readonly<Record<string, string | number>> = {},
): string {
  // The key is `"<METHOD><spaces>/api/..."`. Splitting on the first slash rather
  // than on whitespace tolerates the map's inconsistent spacing (`"GET  "` has
  // two spaces so the paths line up in the source; every other verb has one).
  const slash = key.indexOf("/");
  const template = key.slice(slash);

  return template.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`apiPath: missing path parameter ":${name}" for ${key}`);
    }
    return encodeURIComponent(String(value));
  });
}

/** The HTTP verb a route key declares, for callers that pass the key to fetch. */
export function apiMethod(key: RouteKey): string {
  const slash = key.indexOf("/");
  return key.slice(0, slash).trim();
}

/**
 * Build a path plus a query string, dropping absent values.
 *
 * Undefined and null are DROPPED rather than serialised: `?limit=undefined` is
 * a 422 from every list route in this wave, and the caller that wrote
 * `{ limit: props.limit }` for an optional prop did not mean to ask for that.
 */
export function apiPathWithQuery(
  key: RouteKey,
  params: Readonly<Record<string, string | number>> = {},
  query: Readonly<Record<string, string | number | boolean | undefined | null>> = {},
): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    search.set(name, String(value));
  }
  const qs = search.toString();
  return qs.length > 0 ? `${apiPath(key, params)}?${qs}` : apiPath(key, params);
}

/** Why a request failed, in the shape the panels switch on. */
export interface ApiFailure {
  ok: false;
  /** HTTP status, or 0 when the request never reached a server. */
  status: number;
  /** Server-supplied machine code (`"not_started"`, `"class_full"`, …) if any. */
  code?: string;
  /** Human-readable message safe to render. */
  error: string;
  /** True when the caller aborted — the component should render nothing new. */
  aborted: boolean;
}

export type ApiCall<T> = { ok: true; data: T; status: number } | ApiFailure;

export interface ApiRequestOptions {
  /** JSON body. Serialised here so no caller forgets the content-type header. */
  body?: unknown;
  /** Caller-owned abort signal, for unmount cancellation. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injected for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Call an API route and normalise the outcome.
 *
 * Handles the four ways this can go wrong, which callers otherwise each
 * reimplement: a non-2xx with a JSON `ApiErr` body, a non-2xx with an HTML body
 * (the Next.js 404 page, which is what a disabled feature flag returns), a 204
 * with no body at all, and a transport failure or timeout.
 *
 * @param key the frozen route key — also supplies the HTTP method
 */
export async function apiRequest<T>(
  key: RouteKey,
  url: string,
  options: ApiRequestOptions = {},
): Promise<ApiCall<T>> {
  const { body, signal, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl } = options;
  const doFetch = fetchImpl ?? globalThis.fetch;

  // Two abort sources — the caller's unmount and our own timeout — merged by
  // hand rather than with AbortSignal.any(), which is Node 20.3+/Safari 17.4+
  // and would narrow the browser support of a page for no functional gain.
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(url, {
      method: apiMethod(key),
      signal: controller.signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // 204 is a documented success for the DELETE routes in this wave. Trying to
    // parse its (empty) body is a SyntaxError that would be reported as a
    // network failure.
    if (response.status === 204) {
      return { ok: true, data: undefined as T, status: 204 };
    }

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const envelope = payload as Partial<ApiResult<never>> | null;
      return {
        ok: false,
        status: response.status,
        code: typeof envelope?.ok === "boolean" && envelope.ok === false
          ? (envelope as { code?: string }).code
          : undefined,
        // A feature-flagged-off route returns Next's own 404 page, which is HTML
        // and parses to null. Falling back to the status text keeps the panel
        // from rendering the word "undefined" at a student.
        error:
          (payload as { error?: string } | null)?.error ??
          `Request failed (${response.status}).`,
        aborted: false,
      };
    }

    const envelope = payload as ApiResult<T> | null;
    if (envelope && envelope.ok === true) {
      return { ok: true, data: envelope.data, status: response.status };
    }
    if (envelope && envelope.ok === false) {
      return {
        ok: false,
        status: response.status,
        code: envelope.code,
        error: envelope.error,
        aborted: false,
      };
    }

    return {
      ok: false,
      status: response.status,
      error: "The server sent a response this page could not read.",
      aborted: false,
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      status: 0,
      aborted,
      // An aborted request that came from an unmount is not a fault, but the
      // caller still gets a message in case it aborted for its own reasons.
      error: aborted
        ? "The request was cancelled."
        : "Could not reach the server. Check your connection and try again.",
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}
