// =============================================================================
// OUTPUT CAPS — bound stdout/stderr before a result leaves this module.
// Owner: code-execution stream. Pure; unit-tested in truncate.test.ts.
// -----------------------------------------------------------------------------
// `while (true) console.log("x")` is the single most common accident in a first
// programming course. Piston kills it on timeout, but by then it has produced
// megabytes, and returning that would: blow the Vercel response budget, freeze
// the student's browser rendering it, and — during a grand quiz — be stored
// alongside the attempt.
//
// The cap is applied HERE, on the way out, not at the display layer. A component
// that forgot to truncate would still have received the megabytes over the wire,
// so the display layer is the wrong place to enforce it.
//
// Character counts, not bytes. The values are budgets for a human reading a
// panel, and JS strings are the unit every consumer actually handles; counting
// bytes would mean a TextEncoder pass over a string we are about to discard.
// =============================================================================

/**
 * Per-stream cap, in characters. 16 000 is ~200 lines of 80 columns — far more
 * than any exercise legitimately prints, and small enough that both streams plus
 * the JSON envelope stay well under 64 kB.
 */
export const MAX_STREAM_CHARS = 16_000;

/**
 * Source text cap, in characters. Applied to the INBOUND program before it is
 * sent anywhere: a 5 MB paste is not a program, and Piston would reject it after
 * we had already paid to upload it.
 */
export const MAX_SOURCE_CHARS = 64_000;

/** Inbound stdin cap, in characters. Same reasoning as the source cap. */
export const MAX_STDIN_CHARS = 16_000;

export interface TruncatedStream {
  text: string;
  truncated: boolean;
  /** Length before truncation, in characters — shown so "…" is not a mystery. */
  originalChars: number;
}

/**
 * Cap one stream, appending a visible marker when anything was dropped.
 *
 * The marker is part of `text` rather than a separate field because every
 * consumer renders `text` verbatim; a sibling flag is a thing to forget, and a
 * silently shortened output teaches the student the wrong lesson about their
 * loop.
 */
export function truncateStream(
  raw: string | null | undefined,
  limit: number = MAX_STREAM_CHARS,
): TruncatedStream {
  const text = typeof raw === "string" ? raw : "";
  const originalChars = text.length;
  if (originalChars <= limit) {
    return { text, truncated: false, originalChars };
  }
  const kept = text.slice(0, limit);
  const dropped = originalChars - limit;
  return {
    text: `${kept}\n… [output truncated: ${dropped} more characters were discarded ` +
      `(cap ${limit}). Check for a loop that prints without a stopping condition.]`,
    truncated: true,
    originalChars,
  };
}

/**
 * Cap inbound text (source or stdin). Returns the clipped value and whether it
 * was clipped, so the caller can refuse rather than silently run a half program
 * — running the first 64 000 characters of a truncated file would produce a
 * confusing syntax error instead of an honest "too long".
 */
export function clipInput(
  raw: string | null | undefined,
  limit: number,
): { text: string; clipped: boolean } {
  const text = typeof raw === "string" ? raw : "";
  if (text.length <= limit) return { text, clipped: false };
  return { text: text.slice(0, limit), clipped: true };
}
