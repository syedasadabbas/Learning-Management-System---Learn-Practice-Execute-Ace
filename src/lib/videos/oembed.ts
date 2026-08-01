// =============================================================================
// KEYLESS oEMBED VALIDATION — the only gate an id passes before it is stored.
// -----------------------------------------------------------------------------
// Owner: video-ingestion stream.
//
// WHY THIS FILE EXISTS
// FREE_STACK.md drops the YouTube Data API and its Google Cloud key. What is
// left, and what this file uses, is `https://www.youtube.com/oembed`, which needs
// no key at all. It does two jobs at once, which is why every ingestion path goes
// through it:
//
//   1. PROOF OF EXISTENCE. A syntactically perfect 11-character id can still be
//      a video that never existed, was deleted, or is private. oEmbed answers
//      404 for all three. Storing such an id would ship an iframe that renders
//      "Video unavailable" to a cohort — the exact failure earlier waves avoided
//      by refusing to invent ids. So a 404 is a REJECT, never a store.
//   2. HUMAN-READABLE METADATA. The response carries `title` and `author_name`,
//      which are the only things that make the /admin/videos review screen a
//      real review rather than a list of opaque ids.
//
// WHAT oEMBED DOES *NOT* GIVE US: duration. The response has title, author_name,
// thumbnail_url and player dimensions — no length field. `duration_seconds` is
// therefore only ever populated from what staff put in the curated list; it stays
// null otherwise, and the review screen says "duration unknown" instead of
// guessing. Units: SECONDS, because that is the column's unit and the granularity
// a human quotes a video length in (house rule 5 asks for metric/SI — seconds is
// the SI unit; milliseconds are used everywhere a *machine* interval is measured,
// e.g. the request timeout below).
//
// `fetch` IS INJECTED. Every function here takes its HTTP client as a parameter
// so unit tests exercise 200 / 404 / malformed-JSON / network-failure branches
// with zero network access. The harvester passes globalThis.fetch.
// =============================================================================

import { extractYouTubeId, isYouTubeVideoId } from "@/components/course/youtube";

/** Minimal fetch shape this module needs. Keeps test doubles tiny. */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** Why an id was refused. Discriminated so the harvester can report per reason. */
export type VideoRejectReason =
  /** Not an 11-character YouTube id and not a URL we can pull one out of. */
  | "invalid_id"
  /**
   * The video does not resolve: deleted, private, or never existed. PERMANENT.
   *
   * MEASURED, NOT ASSUMED: on 2026-07-30 this endpoint answered `400 Bad Request`
   * — not 404 — for the nonexistent ids `zzzzzzzzzzz` and `aaaaaaaaaaa`, while a
   * live id answered 200. So 400 AND 404 both map here. Treating 400 as a generic
   * server problem (the obvious reading of the status code) would have reported
   * every dead id as "retry later" forever and never flagged it to an operator.
   */
  | "not_found"
  /**
   * 401 / 403: the video exists but the owner refuses embedding. PERMANENT, and a
   * reject rather than a store — an embed a student cannot play is worth no more
   * than a dead one.
   */
  | "unavailable"
  /** 429 or 5xx — YouTube's problem, not the id's. Retryable. */
  | "server_error"
  /** 200 with a body that is not the oEmbed shape. */
  | "bad_payload"
  /** DNS failure, offline machine, timeout. NOT the id's fault — see below. */
  | "network_error";

export interface VideoMetadata {
  youtubeId: string;
  /** oEmbed `title`. Truncated to the column width (500) by the store layer. */
  title: string;
  /** oEmbed `author_name` — the channel. */
  channelTitle: string;
  /**
   * Canonical thumbnail URL, derived from the id rather than trusted from the
   * payload: `thumbnail_url` is an arbitrary string from a remote server and this
   * value goes into an `<img src>`. Deriving it means the review screen cannot be
   * pointed at an attacker-chosen origin by a poisoned response.
   */
  thumbnailUrl: string;
}

export type ValidationResult =
  | { ok: true; metadata: VideoMetadata }
  | { ok: false; reason: VideoRejectReason; detail?: string };

/**
 * Request timeout in MILLISECONDS (house rule: metric units for machine
 * intervals). The harvester walks a whole curated list serially; one unresponsive
 * request must not stall the run indefinitely.
 */
export const OEMBED_TIMEOUT_MS = 10_000;

/**
 * Reasons worth retrying, and ONLY those.
 *
 * A machine with no route to youtube.com, or a 5xx from YouTube, must not make an
 * operator conclude their curated ids are wrong — so those are flagged retryable
 * and nothing is stored; a later re-run picks them up, which the unique index makes
 * safe. Everything else (bad id, 400/404, embedding refused) is a permanent verdict
 * the operator has to act on, and mislabelling one of those as retryable would hide
 * a dead link indefinitely.
 */
export const TRANSIENT_REASONS: readonly VideoRejectReason[] = [
  "network_error",
  "server_error",
];

export function isTransient(reason: VideoRejectReason): boolean {
  return TRANSIENT_REASONS.includes(reason);
}

/** The oEmbed endpoint URL for a video id. Exported so tests assert on it. */
export function oembedUrl(youtubeId: string): string {
  const watchUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
}

/** Deterministic thumbnail for an id. hqdefault exists for every public video. */
export function thumbnailUrlFor(youtubeId: string): string {
  return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
}

interface OEmbedPayload {
  title?: unknown;
  author_name?: unknown;
}

/**
 * Validate one id (or URL) through oEmbed and return its metadata.
 *
 * Never throws. Every failure — bad id, 404, offline, malformed JSON — comes back
 * as `{ ok: false, reason }`, because this runs inside a loop over a staff CSV
 * and one bad row must not abort the other forty.
 */
export async function validateVideo(
  idOrUrl: string,
  fetchImpl: FetchLike,
  options: { timeoutMs?: number } = {},
): Promise<ValidationResult> {
  const youtubeId = isYouTubeVideoId(idOrUrl.trim())
    ? idOrUrl.trim()
    : extractYouTubeId(idOrUrl);

  if (!youtubeId) return { ok: false, reason: "invalid_id", detail: idOrUrl };

  const timeoutMs = options.timeoutMs ?? OEMBED_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(oembedUrl(youtubeId), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
  } catch (error) {
    return {
      ok: false,
      reason: "network_error",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }

  // The whole point of this call. 400 is what YouTube actually answers for a
  // nonexistent id (measured — see the `not_found` doc comment); 404 is what the
  // oEmbed spec says it should answer. Accept both as the same permanent verdict.
  if (response.status === 400 || response.status === 404) {
    return { ok: false, reason: "not_found", detail: `HTTP ${response.status} for ${youtubeId}` };
  }
  // Exists, but the owner refuses embedding. Permanent, and still a reject.
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      reason: "unavailable",
      detail: `HTTP ${response.status} — embedding is disabled for this video`,
    };
  }
  if (!response.ok) {
    return { ok: false, reason: "server_error", detail: `HTTP ${response.status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "bad_payload", detail: "response was not JSON" };
  }

  const body = (payload ?? {}) as OEmbedPayload;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const channelTitle =
    typeof body.author_name === "string" ? body.author_name.trim() : "";

  // A 200 with no title is not a usable review row: the admin would be asked to
  // approve a blank. Refuse it rather than storing an empty string.
  if (title === "") {
    return { ok: false, reason: "bad_payload", detail: "no title in oEmbed response" };
  }

  return {
    ok: true,
    metadata: {
      youtubeId,
      title,
      channelTitle,
      thumbnailUrl: thumbnailUrlFor(youtubeId),
    },
  };
}
