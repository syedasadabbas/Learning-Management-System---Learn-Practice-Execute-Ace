// =============================================================================
// Unit tests — the operator surface's judgements and its stored summary.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// These cover the only two things the ingest-status feature DECIDES rather than
// reports: which verdict an assignment gets, and which skipped rows survive the
// per-run cap. Both are cheap to test only because they are pure and take `now` as
// a parameter; the database read and the page that renders them are e2e's job.
// =============================================================================

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MAX_STORED_SKIPPED_ROWS,
  STALE_AFTER_MS,
  SWEEP_INTERVAL_MS,
  ageLabel,
  selectSkippedSample,
  summariseReport,
  verdictFor,
} from "./ingest-status-view";
import type { IngestReport, SkipReason, SkippedRow } from "./types";

const NOW = new Date("2026-07-31T12:00:00.000Z");

function report(overrides: Partial<IngestReport> = {}): IngestReport {
  return {
    assignmentId: 1,
    assignmentTitle: "Week 1 assignment",
    aborted: null,
    abortDetail: null,
    rowsSeen: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: [],
    skipReasonCounts: {},
    durationMs: 12,
    ...overrides,
  };
}

function skipped(rowNumber: number, reason: SkipReason): SkippedRow {
  return { rowNumber, reason, detail: `row ${rowNumber}` };
}

describe("verdictFor", () => {
  it("calls out a missing sheet URL above everything else", () => {
    // Highest precedence on purpose: no run can EVER succeed, so reporting
    // staleness or a past abort here would describe a symptom.
    const v = verdictFor({ sheetConfigured: false, lastRun: null }, NOW);
    expect(v.label).toBe("no sheet");
    expect(v.tone).toBe("danger");
    expect(v.why).toContain("admin console");
  });

  it("a missing sheet outranks even a recorded successful run", () => {
    const v = verdictFor(
      {
        sheetConfigured: false,
        lastRun: { ranAt: NOW, aborted: null, detail: "fine" },
      },
      NOW,
    );
    expect(v.label).toBe("no sheet");
  });

  it("distinguishes 'never run' from 'ran and failed'", () => {
    // THE ROW THIS SURFACE EXISTS FOR. An assignment the sweep has never reached
    // looks identical to a healthy one if the two are not told apart.
    expect(verdictFor({ sheetConfigured: true, lastRun: null }, NOW).label).toBe("never run");
    expect(
      verdictFor(
        { sheetConfigured: true, lastRun: { ranAt: NOW, aborted: "html_not_csv", detail: "x" } },
        NOW,
      ).label,
    ).toBe("aborted: html_not_csv");
  });

  it("surfaces the abort's own advice as the reason, not the reason code again", () => {
    const v = verdictFor(
      {
        sheetConfigured: true,
        lastRun: { ranAt: NOW, aborted: "html_not_csv", detail: "Re-publish it as CSV." },
      },
      NOW,
    );
    expect(v.why).toBe("Re-publish it as CSV.");
  });

  it("an abort outranks staleness, because the abort is the cause", () => {
    const old = new Date(NOW.getTime() - 10 * STALE_AFTER_MS);
    const v = verdictFor(
      { sheetConfigured: true, lastRun: { ranAt: old, aborted: "fetch_failed", detail: null } },
      NOW,
    );
    expect(v.label).toBe("aborted: fetch_failed");
  });

  it("is healthy inside the staleness window and stale outside it", () => {
    const justInside = new Date(NOW.getTime() - STALE_AFTER_MS + 1);
    const justOutside = new Date(NOW.getTime() - STALE_AFTER_MS - 1);
    expect(
      verdictFor({ sheetConfigured: true, lastRun: { ranAt: justInside, aborted: null, detail: null } }, NOW)
        .label,
    ).toBe("healthy");
    expect(
      verdictFor({ sheetConfigured: true, lastRun: { ranAt: justOutside, aborted: null, detail: null } }, NOW)
        .label,
    ).toBe("stale");
  });

  it("treats exactly the threshold as still healthy", () => {
    // Boundary pinned deliberately: `>` not `>=`, so a run at exactly the
    // threshold is not reported as a failure the instant it ticks over.
    const exactly = new Date(NOW.getTime() - STALE_AFTER_MS);
    expect(
      verdictFor({ sheetConfigured: true, lastRun: { ranAt: exactly, aborted: null, detail: null } }, NOW)
        .label,
    ).toBe("healthy");
  });
});

describe("the staleness window against the real cron schedule", () => {
  // THE REGRESSION THIS PINS. The window used to be three hours because every
  // comment in this directory said the sweep was hourly, while vercel.json has
  // scheduled it daily. Every assignment therefore turned amber three hours after
  // midnight and stayed amber until the next run — a permanently warning page,
  // which is the state that trains an operator to stop reading it.
  it("is at least one full sweep interval, so a healthy daily run is not called stale", () => {
    expect(STALE_AFTER_MS).toBeGreaterThan(SWEEP_INTERVAL_MS);
  });

  it("is less than two intervals, so a whole missed day is still reported", () => {
    expect(STALE_AFTER_MS).toBeLessThan(2 * SWEEP_INTERVAL_MS);
  });

  it("matches the cron entry in vercel.json — the only authority on cadence", () => {
    // Read, not restated: a test that hardcodes "daily" alongside the constant
    // proves the two literals agree with each other and nothing about the deploy.
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const entry = config.crons.find((c) => c.path === "/api/cron/ingest-submissions");
    expect(entry, "the ingest sweep must still be scheduled").toBeDefined();

    const [minute, hour, dom, month, dow] = entry!.schedule.split(" ");
    // A daily schedule is a fixed minute at a fixed hour, every day.
    const isDaily =
      /^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === "*" && month === "*" && dow === "*";
    expect(
      isDaily,
      `schedule "${entry!.schedule}" is no longer daily — SWEEP_INTERVAL_MS must be updated to match`,
    ).toBe(true);
    expect(SWEEP_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("ageLabel", () => {
  it("reports whole metric units", () => {
    expect(ageLabel(new Date(NOW.getTime() - 30_000), NOW)).toBe("less than a minute ago");
    expect(ageLabel(new Date(NOW.getTime() - 60_000), NOW)).toBe("1 minute ago");
    expect(ageLabel(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5 minutes ago");
    expect(ageLabel(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe("3 hours ago");
    expect(ageLabel(new Date(NOW.getTime() - 72 * 3_600_000), NOW)).toBe("3 days ago");
    expect(ageLabel(new Date(NOW.getTime() - 24 * 3_600_000 * 1), NOW)).toBe("24 hours ago");
  });

  it("says so rather than rendering 0 when the timestamp is in the future", () => {
    // A future `ran_at` on a shared database means two clocks disagree, and every
    // staleness verdict on the page is then untrustworthy. Saying "0 minutes ago"
    // would hide that.
    expect(ageLabel(new Date(NOW.getTime() + 60_000), NOW)).toContain("server clock");
  });
});

describe("selectSkippedSample", () => {
  it("keeps everything when under the cap", () => {
    const rows = [skipped(1, "blank_row"), skipped(2, "unknown_student")];
    expect(selectSkippedSample(rows)).toEqual(rows);
  });

  it("keeps ONE OF EACH REASON before filling from the front", () => {
    // THE POINT OF THIS FUNCTION. A sheet with trailing spacer rows produces a wall
    // of `blank_row`s, which a plain slice() would use up the whole budget on —
    // burying the single `supersedes_graded_submission` that a human must act on.
    const rows: SkippedRow[] = [
      ...Array.from({ length: 30 }, (_, i) => skipped(i + 1, "blank_row")),
      skipped(31, "supersedes_graded_submission"),
      skipped(32, "unknown_student"),
    ];
    const sample = selectSkippedSample(rows, 3);
    expect(sample.map((r) => r.reason)).toEqual([
      "blank_row",
      "supersedes_graded_submission",
      "unknown_student",
    ]);
  });

  it("fills the remaining budget in sheet order once every reason is represented", () => {
    const rows: SkippedRow[] = [
      skipped(1, "blank_row"),
      skipped(2, "blank_row"),
      skipped(3, "unknown_student"),
      skipped(4, "blank_row"),
    ];
    const sample = selectSkippedSample(rows, 3);
    expect(sample.map((r) => r.rowNumber)).toEqual([1, 3, 2]);
  });

  it("never exceeds the cap, even when there are more reasons than the cap", () => {
    const reasons: SkipReason[] = [
      "blank_row",
      "missing_email",
      "invalid_email",
      "missing_timestamp",
      "malformed_timestamp",
    ];
    const rows = reasons.map((r, i) => skipped(i + 1, r));
    expect(selectSkippedSample(rows, 2)).toHaveLength(2);
  });

  it("defaults to MAX_STORED_SKIPPED_ROWS", () => {
    const rows = Array.from({ length: 200 }, (_, i) => skipped(i + 1, "blank_row"));
    expect(selectSkippedSample(rows)).toHaveLength(MAX_STORED_SKIPPED_ROWS);
  });
});

describe("summariseReport", () => {
  it("prefers the abort's actionable advice over the reason code", () => {
    expect(
      summariseReport(
        report({ aborted: "html_not_csv", abortDetail: "Re-publish the sheet as CSV." }),
      ),
    ).toBe("Re-publish the sheet as CSV.");
  });

  it("falls back to the reason code when there is no advice", () => {
    expect(summariseReport(report({ aborted: "fetch_failed", abortDetail: null }))).toContain(
      "fetch_failed",
    );
  });

  it("counts the outcome for a run that did work", () => {
    const line = summariseReport(
      report({
        rowsSeen: 5,
        inserted: 2,
        updated: 1,
        unchanged: 1,
        skipped: [skipped(3, "unknown_student")],
        skipReasonCounts: { unknown_student: 1 },
      }),
    );
    expect(line).toContain("5 row(s) seen");
    expect(line).toContain("2 inserted");
    expect(line).toContain("unknown_student×1");
  });

  it("says so explicitly when nothing was skipped", () => {
    // "skipped: " with an empty list would read as truncated output.
    expect(summariseReport(report({ rowsSeen: 1, inserted: 1 }))).toContain("no rows skipped");
  });
});
