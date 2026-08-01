// =============================================================================
// PUBLISHED-CSV FETCH — the only part of ingestion that touches the network.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// Separated from parsing (csv.ts) and from persistence (ingest.ts) so that the
// parser can be unit-tested against fixture strings with no network at all, and
// so the URL-safety rules below live in exactly one place.
// =============================================================================

import { looksLikeHtml } from "./csv";
import type { RunAbortReason } from "./types";

/**
 * Network timeout for one CSV fetch, in milliseconds (metric units).
 *
 * Vercel's cron invocation has its own function timeout, and the sweep fetches
 * one CSV per assignment sequentially. 15 s per assignment keeps four weeks of
 * assignments comfortably inside a 60 s function budget while still tolerating a
 * slow response from Google's publish endpoint.
 */
export const CSV_FETCH_TIMEOUT_MS = 15_000;

/**
 * Hosts a published response sheet may live on.
 *
 * `googleSheetCsvUrl` is set by staff through the admin console, which makes it
 * attacker-influenced input to a server-side fetch — the shape of an SSRF. An
 * allow-list means a mistyped or malicious value cannot be used to make the
 * server request an internal address (link-local metadata endpoints, a database
 * admin port) and hand the body back in an ingestion report.
 *
 * Loopback is permitted so the e2e suite can serve a fixture CSV locally. That
 * is a real, if narrow, widening of the rule: on a developer machine it allows a
 * fetch to localhost. It is accepted because the alternative is either an
 * unverifiable ingestion path or a new environment variable, and this field is
 * writable only by an instructor or admin.
 */
const ALLOWED_HOST_SUFFIXES = [
  "docs.google.com",
  "drive.google.com",
  "googleusercontent.com",
] as const;
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"] as const;

export type CsvFetchResult =
  | { ok: true; text: string; durationMs: number }
  | {
      ok: false;
      reason: Extract<RunAbortReason, "no_csv_url" | "fetch_failed" | "html_not_csv">;
      detail: string;
    };

/** Is this URL one we are willing to make a server-side request to? */
export function isAllowedCsvUrl(rawUrl: string): { ok: true } | { ok: false; detail: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, detail: "googleSheetCsvUrl is not a valid absolute URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, detail: `Unsupported URL scheme "${parsed.protocol}".` };
  }
  const host = parsed.hostname.toLowerCase();
  const allowed =
    LOOPBACK_HOSTS.includes(host as (typeof LOOPBACK_HOSTS)[number]) ||
    ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!allowed) {
    return {
      ok: false,
      detail:
        `Host "${host}" is not an allowed published-sheet host. Expected a Google ` +
        "Sheets published-to-web CSV URL.",
    };
  }
  if (parsed.protocol === "http:" && !LOOPBACK_HOSTS.includes(host as (typeof LOOPBACK_HOSTS)[number])) {
    return { ok: false, detail: "Refusing to fetch a remote sheet over plain http." };
  }
  return { ok: true };
}

/**
 * Fetch a published response sheet as CSV text.
 *
 * A null/blank URL is NOT an error condition here — it is the seeded state of
 * every assignment (see the TODO(decision) in scripts/seed.ts: the real Form and
 * Sheet URLs have not been supplied). It returns `no_csv_url` so the caller can
 * report a clear no-op instead of throwing an unhandled fetch error on `null`.
 *
 * `fetchImpl` is injectable purely so tests can drive this without a network.
 */
export async function fetchPublishedCsv(
  csvUrl: string | null | undefined,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<CsvFetchResult> {
  const url = (csvUrl ?? "").trim();
  if (url === "") {
    return {
      ok: false,
      reason: "no_csv_url",
      detail:
        "assignments.googleSheetCsvUrl is not set. Publish the Google Form's response " +
        "sheet (File -> Share -> Publish to web -> CSV) and store that URL on the " +
        "assignment. Nothing was ingested.",
    };
  }

  const permitted = isAllowedCsvUrl(url);
  if (!permitted.ok) {
    return { ok: false, reason: "fetch_failed", detail: permitted.detail };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? CSV_FETCH_TIMEOUT_MS;
  const startedAt = Date.now();

  try {
    const response = await doFetch(url, {
      // Google answers a published CSV with a 307 to a googleusercontent host;
      // the allow-list above covers that host, so following redirects is safe.
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "text/csv,text/plain,*/*" },
      // Never serve a cached body: the whole point of the hourly run is new rows.
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: "fetch_failed",
        detail:
          `The sheet URL returned HTTP ${response.status}. A published sheet that has ` +
          "been unpublished or moved returns 404; a private one returns 401/403.",
      };
    }

    const text = await response.text();

    if (looksLikeHtml(text, response.headers.get("content-type"))) {
      return {
        ok: false,
        reason: "html_not_csv",
        detail:
          "The sheet URL answered with an HTML page, not CSV. The response sheet is " +
          'published as a WEB PAGE. Re-publish it as CSV: File -> Share -> Publish to ' +
          'web -> choose the response sheet -> change "Web page" to ' +
          '"Comma-separated values (.csv)" -> Publish, then store the new URL. ' +
          "Nothing was ingested; no submission was lost.",
      };
    }

    return { ok: true, text, durationMs: Date.now() - startedAt };
  } catch (error) {
    // Includes the AbortSignal timeout and DNS/TLS failures. The message is
    // reported, never the URL — a published-sheet URL is a capability token.
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "fetch_failed",
      detail: `Fetching the published sheet failed after ${Date.now() - startedAt} ms: ${message}`,
    };
  }
}
