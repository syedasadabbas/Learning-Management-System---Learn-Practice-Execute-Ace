// =============================================================================
// Presentation helpers for the progress components. Pure and unit-testable.
// Owner: progress-tracking stream.
// -----------------------------------------------------------------------------
// LOCALE TRADE-OFF (house rule 7): these render on the server, so `toLocale*`
// would use the SERVER's locale, not the student's, and formatting in the browser
// instead produces a hydration mismatch unless it is suppressed. A fixed
// day-month-year locale is used, which is unambiguous and deterministic in tests.
// TODO(ui-shell): if a per-user locale/timezone preference is ever added, thread
// it through `DISPLAY_LOCALE` here rather than sprinkling `toLocaleDateString`
// across pages.
// =============================================================================

/** Day-month-year, no ambiguity between 03/04 and 04/03. */
export const DISPLAY_LOCALE = "en-GB";

/** Dates are stored UTC; render them UTC so every student sees one deadline. */
export const DISPLAY_TIME_ZONE = "UTC";

/** "14 Sep 2026" — null-safe, and never renders "Invalid Date". */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "Not scheduled";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

/** ISO-8601 for the `<time datetime>` attribute; empty when there is no date. */
export function isoAttribute(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * "in 3 days" / "today" / "6 days overdue". Takes whole days so it agrees with
 * the deadline arithmetic in `dashboard.ts` rather than recomputing it.
 */
export function relativeDays(daysRemaining: number): string {
  if (!Number.isFinite(daysRemaining)) return "";
  if (daysRemaining === 0) return "due today";
  if (daysRemaining > 0) return `in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;
  const late = Math.abs(daysRemaining);
  return `${late} day${late === 1 ? "" : "s"} overdue`;
}

/**
 * "2 of 3 lectures" — the exact string the read model's `lectureTotal` exists to
 * make possible without a second query. Handles a week with no lectures yet.
 */
export function lectureCountLabel(completed: number, total: number): string {
  if (total <= 0) return "No lectures yet";
  return `${Math.min(completed, total)} of ${total} lecture${total === 1 ? "" : "s"}`;
}

/** Completion percentage of a week's lectures. Zero, never NaN, when total is 0. */
export function lecturePercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

/** "82%" for a quiz best, "Not attempted" for null. Never "null%" or "NaN%". */
export function quizPercentLabel(quizBestPercent: number | null): string {
  if (quizBestPercent == null || !Number.isFinite(quizBestPercent)) return "Not attempted";
  return `${Math.round(quizBestPercent * 10) / 10}%`;
}
