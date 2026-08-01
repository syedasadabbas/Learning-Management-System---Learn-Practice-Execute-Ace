// =============================================================================
// YOUTUBE URL / ID PARSING — pure, unit-tested, no React.
// -----------------------------------------------------------------------------
// Owner: course-content stream.
//
// WHY THIS EXISTS AS A SEPARATE MODULE
// `lectures.youtube_url` is a varchar(500) that the schema documents as "video id
// or full url; renderer extracts the id". That means the renderer receives at
// least four shapes in practice (watch URL, youtu.be short URL, bare 11-char id,
// null) and, from the instructor-admin editing UI later, arbitrary paste-errors.
// Parsing lives here so it can be tested without mounting a component, and so the
// embed component has exactly one branch: "id or no id".
//
// PRIVACY: the embed host is always youtube-nocookie.com. The regular
// youtube.com embed sets tracking cookies on first paint, before the student has
// pressed play, which we are not willing to do to a cohort of students.
//
// SECURITY: an id is only ever accepted after matching ^[A-Za-z0-9_-]{11}$ and
// the host is checked against an allow-list. Interpolating an unvalidated string
// into the iframe `src` would let a malicious `youtube_url` row point the frame
// at any origin.
// =============================================================================

/** Anything the `lectures.youtube_url` column can hold. */
export type YouTubeSource = string | null | undefined;

/**
 * A YouTube video id is exactly 11 characters of the URL-safe base64 alphabet.
 * Anchored deliberately: an unanchored test would happily accept the middle of a
 * phishing URL.
 */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Hosts we will read an id out of. Everything else is rejected outright. */
const ALLOWED_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

/** Path prefixes that carry the id as the next segment: /embed/ID, /shorts/ID … */
const ID_BEARING_SEGMENTS = new Set(["embed", "v", "shorts", "live"]);

/** Is `value` on its own a valid video id? */
export function isYouTubeVideoId(value: string): boolean {
  return VIDEO_ID_PATTERN.test(value);
}

/**
 * Extract the 11-character video id from any supported input.
 *
 * Accepts:
 *   - a full watch URL          https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *   - a short URL               https://youtu.be/dQw4w9WgXcQ
 *   - an embed / shorts / live URL, with or without a query string
 *   - a protocol-relative or bare host URL   www.youtube.com/watch?v=…
 *   - a bare id                 dQw4w9WgXcQ
 *
 * Returns null for null/undefined/empty input, for a non-YouTube host, and for
 * anything whose extracted candidate is not a well-formed id. Never throws —
 * a malformed value in one lecture row must not 500 the lecture page.
 */
export function extractYouTubeId(input: YouTubeSource): string | null {
  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (raw === "") return null;

  // Bare id: the common case once an instructor pastes just the id.
  if (isYouTubeVideoId(raw)) return raw;

  // A bare id is the only accepted non-URL form; everything else must parse as a
  // URL. Prepend a scheme so "www.youtube.com/watch?v=ID" and "//youtu.be/ID"
  // are handled rather than rejected on a technicality.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw.replace(/^\/\//, "")}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!ALLOWED_HOSTS.has(host)) return null;

  const segments = url.pathname.split("/").filter((s) => s !== "");
  let candidate: string | null = null;

  if (host === "youtu.be") {
    // youtu.be/<id> — the id is the whole first segment.
    candidate = segments[0] ?? null;
  } else {
    const queryId = url.searchParams.get("v");
    if (queryId) {
      candidate = queryId;
    } else if (segments.length >= 2 && ID_BEARING_SEGMENTS.has(segments[0])) {
      candidate = segments[1];
    }
  }

  if (!candidate) return null;
  return isYouTubeVideoId(candidate) ? candidate : null;
}

export interface EmbedUrlOptions {
  /**
   * Start offset into the video. Milliseconds per the house metric-units rule;
   * converted to whole seconds here because that is the only unit the YouTube
   * player accepts on its `start` parameter.
   */
  startMs?: number;
}

/**
 * Privacy-mode embed URL for a video, or null when there is nothing to embed.
 *
 * Accepts the same inputs as `extractYouTubeId`, so callers can hand it the raw
 * column value. `rel=0` keeps "related videos" inside the same channel and
 * `modestbranding=1` drops the watermark — both reduce the chance a student is
 * pulled out of the lesson by an unrelated recommendation.
 */
export function youTubeEmbedUrl(
  input: YouTubeSource,
  options: EmbedUrlOptions = {},
): string | null {
  const id = extractYouTubeId(input);
  if (!id) return null;

  const params = new URLSearchParams({ rel: "0", modestbranding: "1" });

  const { startMs } = options;
  if (typeof startMs === "number" && Number.isFinite(startMs) && startMs > 0) {
    params.set("start", String(Math.floor(startMs / 1000)));
  }

  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

/** Canonical watch URL, for the "open on YouTube" fallback link. Null if no id. */
export function youTubeWatchUrl(input: YouTubeSource): string | null {
  const id = extractYouTubeId(input);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}
