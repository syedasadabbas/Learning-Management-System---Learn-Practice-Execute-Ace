// =============================================================================
// OPERATOR SURFACE — the presentation decisions, kept out of the page.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// Pure functions: no `db`, no React, no clock of their own. They live here rather
// than in the page component for one reason — the verdict rule ("healthy", "stale",
// "aborted", "never run", "no sheet") is the only judgement this feature makes, and
// a judgement that can only be exercised by rendering a page in a browser is a
// judgement nobody tests. `now` is a parameter for the same reason.
// =============================================================================

import type { IngestReport, SkipReason, SkippedRow } from "./types";

/**
 * How many individual skipped rows are kept per run.
 *
 * Bounded because the counts are the aggregate and the samples are only there so
 * an operator can see what one looks like. A cohort of 80 that all mistyped the
 * same Form question would otherwise write 80 objects into one jsonb column every
 * hour, and the surface would be less readable, not more.
 */
export const MAX_STORED_SKIPPED_ROWS = 20;

/**
 * Which rows to keep when there are more than the cap.
 *
 * ONE PER DISTINCT REASON FIRST, then fill from the front. Taking a plain
 * `slice(0, 20)` would hide the single `supersedes_graded_submission` behind
 * twenty `blank_row`s from a sheet with trailing spacer rows — the rarest reason
 * is almost always the one worth acting on, and a trailing-newline blank row is
 * never worth acting on at all.
 */
export function selectSkippedSample(
  skipped: readonly SkippedRow[],
  limit = MAX_STORED_SKIPPED_ROWS,
): SkippedRow[] {
  if (skipped.length <= limit) return [...skipped];

  const chosen: SkippedRow[] = [];
  const takenRowNumbers = new Set<number>();
  const seenReasons = new Set<SkipReason>();

  for (const row of skipped) {
    if (seenReasons.has(row.reason)) continue;
    seenReasons.add(row.reason);
    chosen.push(row);
    takenRowNumbers.add(row.rowNumber);
    if (chosen.length === limit) return chosen;
  }

  for (const row of skipped) {
    if (takenRowNumbers.has(row.rowNumber)) continue;
    chosen.push(row);
    takenRowNumbers.add(row.rowNumber);
    if (chosen.length === limit) break;
  }

  return chosen;
}

/**
 * One line summarising the run, for the `detail` column.
 *
 * Composed here rather than at read time so the stored row is self-describing to
 * anyone who reaches the table with `psql` and has not read this file.
 */
export function summariseReport(report: IngestReport): string {
  if (report.aborted) {
    // The advice, when there is any, is the whole value of the row. The reason code
    // is already in its own column, so repeating it here would spend the operator's
    // attention on a string they can already see.
    const advice = (report.abortDetail ?? "").trim();
    return advice === "" ? `Run did no work: ${report.aborted}.` : advice;
  }
  const reasons = Object.entries(report.skipReasonCounts)
    .map(([reason, n]) => `${reason}×${n}`)
    .join(", ");
  const tail = reasons === "" ? "no rows skipped" : `skipped: ${reasons}`;
  return (
    `${report.rowsSeen} row(s) seen, ${report.inserted} inserted, ` +
    `${report.updated} updated, ${report.unchanged} unchanged; ${tail}.`
  );
}

/** Tones the ui-shell `Badge` accepts. Narrowed here so the page cannot drift. */
export type VerdictTone = "success" | "warning" | "danger" | "neutral";

export type Verdict = {
  /** Short label for the badge. Also written to `data-verdict` for e2e. */
  label: string;
  tone: VerdictTone;
  /** The actionable sentence. Prefers the run's own stored advice when there is one. */
  why: string;
};

/** Minimum an assignment row must carry for a verdict. Structural, not the DB shape. */
export type VerdictInput = {
  sheetConfigured: boolean;
  lastRun: {
    ranAt: Date;
    aborted: string | null;
    detail: string | null;
  } | null;
};

/**
 * How old a successful last run may be before it is called stale.
 *
 * The sweep is hourly (vercel.json), so three hours means two scheduled runs did
 * not happen. Three rather than one because a single missed serverless invocation
 * is the platform's business and not the operator's, and raising an alarm on it
 * would train the operator to ignore this page — which is the failure mode the
 * page exists to fix.
 */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Order matters and is not arbitrary. "No sheet" outranks everything because no
 * run can ever succeed; "never run" outranks "stale" because there is no clock to
 * measure; an abort outranks staleness because the abort is the cause and the
 * staleness would be a symptom of the operator having stopped looking.
 */
export function verdictFor(row: VerdictInput, now: Date): Verdict {
  if (!row.sheetConfigured) {
    return {
      label: "no sheet",
      tone: "danger",
      why:
        "No response-sheet URL is stored, so nothing can ever be ingested for this " +
        "assignment. Set it in the admin console under Assignments.",
    };
  }
  if (row.lastRun === null) {
    return {
      label: "never run",
      tone: "warning",
      why:
        "A sheet is configured but no ingest has ever been recorded for this assignment. " +
        "Either the sweep has not reached it yet, or the report store was unavailable " +
        "when it did.",
    };
  }
  if (row.lastRun.aborted != null) {
    return {
      label: `aborted: ${row.lastRun.aborted}`,
      tone: "danger",
      why: row.lastRun.detail ?? "The run did no work and gave no detail.",
    };
  }
  if (now.getTime() - row.lastRun.ranAt.getTime() > STALE_AFTER_MS) {
    return {
      label: "stale",
      tone: "warning",
      why:
        "The last run succeeded, but it was more than 3 hours ago and the sweep is " +
        "scheduled hourly. At least two scheduled runs did not happen.",
    };
  }
  return {
    label: "healthy",
    tone: "success",
    why: "The last run read the sheet and reported per-row outcomes.",
  };
}

/**
 * How long ago, in whole metric units.
 *
 * "Ran at 02:00 UTC" does not answer the only question this page is asked — "is
 * the sweep still running?" — without the reader doing date arithmetic against a
 * clock they may not be looking at.
 *
 * A future timestamp is called out rather than rendered as "0 minutes ago": on a
 * shared database it means the writer's clock and the reader's disagree, and every
 * staleness judgement on the page is then unreliable.
 */
export function ageLabel(then: Date, now: Date): string {
  const ms = now.getTime() - then.getTime();
  if (ms < 0) return "in the future (check the server clock)";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
