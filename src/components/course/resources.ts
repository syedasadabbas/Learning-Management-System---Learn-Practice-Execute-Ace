// =============================================================================
// LECTURE RESOURCES — parsing the `lectures.resources` jsonb column.
// -----------------------------------------------------------------------------
// Owner: course-content stream.
//
// The column is untyped jsonb, so it is validated on read rather than trusted.
// Documented shape (src/db/schema.ts):
//   Array<{ title: string; type: "link" | "sandpack"; url?: string;
//           starterCode?: object }>
//
// STREAM BOUNDARY: this stream renders ONLY `type: "link"` entries — the external
// practice links. `type: "sandpack"` entries are the in-browser exercises and
// belong to the interactive-exercises stream; rendering them here would produce
// two competing editors on one page.
//
// WHY LINKS AND NOT EMBEDS: W3Schools "Try it Yourself" pages send
// X-Frame-Options and cannot be iframed. Every practice resource therefore opens
// in a new tab with rel="noopener noreferrer" (without `noopener` the opened tab
// gets a `window.opener` handle back into the LMS session).
// =============================================================================

/** A validated external practice link. */
export interface LinkResource {
  title: string;
  url: string;
  /** Host shown as a secondary line, e.g. "w3schools.com". */
  host: string;
  /** True when the link points at W3Schools, used only for the label. */
  isW3Schools: boolean;
}

/** Only http(s) links are rendered. `javascript:` and `data:` URLs are dropped. */
function safeExternalUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

/**
 * Extract the renderable practice links from a raw `resources` value.
 *
 * Tolerant by design: a lecture with a malformed resources blob should still show
 * its content, minus the broken entries — never a 500. Returns [] for null,
 * non-arrays, and arrays with no usable link entries.
 */
export function linkResourcesFrom(raw: unknown): LinkResource[] {
  if (!Array.isArray(raw)) return [];

  const out: LinkResource[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;

    // Sandpack entries are deliberately skipped — see the stream boundary note.
    if (record.type !== "link") continue;

    const url = safeExternalUrl(record.url);
    if (!url) continue;

    const host = url.hostname.replace(/^www\./, "");
    const title =
      typeof record.title === "string" && record.title.trim() !== ""
        ? record.title.trim()
        : host;

    out.push({
      title,
      url: url.toString(),
      host,
      isW3Schools: host.endsWith("w3schools.com"),
    });
  }
  return out;
}

/** How many interactive exercises the other stream will render, for a hint line. */
export function sandpackResourceCount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.filter(
    (e) => typeof e === "object" && e !== null && (e as Record<string, unknown>).type === "sandpack",
  ).length;
}
