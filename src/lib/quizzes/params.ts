// =============================================================================
// ROUTE PARAM PARSING — shared by the three quiz route handlers.
// Owner: quizzes stream.
// -----------------------------------------------------------------------------
// Dynamic segments arrive as strings. `Number("12abc")` is NaN and
// `parseInt("12abc")` is 12 — the second one silently accepts a malformed URL
// and queries a real row. This parser accepts digits only, so both are rejected.
// =============================================================================

/** A positive integer id, or null when the segment is not exactly one. */
export function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}
