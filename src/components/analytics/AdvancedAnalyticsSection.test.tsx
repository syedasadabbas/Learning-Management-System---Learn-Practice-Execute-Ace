// =============================================================================
// RENDER TESTS FOR THE FEATURE-7 SECTION.
// -----------------------------------------------------------------------------
// WHY THESE EXIST WHEN THERE IS ALSO A PLAYWRIGHT SPEC: the Playwright spec could
// not be RUN by the agent that wrote it (eight agents, one shared database and
// port), so every claim in it is unverified until the coordinator runs it. These
// cases run here and now, in jsdom, against the real components with fixture data,
// and they cover the three properties that do not need a browser or a session:
//
//   * THE ZERO-DENOMINATOR CONTRACT. A fresh cohort must render "no data" and
//     stated empty states — never NaN%, never Infinity, never a stray "undefined",
//     and never a full-width bar drawn from a null percent. This is the state a new
//     install is in, so it is the state most likely to ship broken.
//   * THE PRIVACY GUARANTEE, against the real rendered markup rather than against
//     the payload: an address that reaches the DOM fails here.
//   * THE GRID IS COMPLETE. 7 ISO days x 6 four-hour blocks = 42 cells, quiet
//     cells included, because a hole in a heatmap reads as missing data when it
//     means nobody worked.
//
// What these CANNOT check, and what the e2e spec is therefore still needed for:
// authorization (needs a session), that both pages compose this section, and that
// the RSC payload carries no address.
// =============================================================================

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildHeatmap, gradeDistribution } from "@/lib/analytics/distribution";
import type { AdvancedAnalytics } from "@/lib/analytics/queries";
import { rankRisk, type RiskSignals } from "@/lib/analytics/risk";
import { rate } from "@/lib/instructor/rates";

import { AdvancedAnalyticsSection } from "./AdvancedAnalyticsSection";
import type { WeekProgressRow } from "./CourseProgressChart";

/** A cohort where NOTHING has happened yet — the normal first state. */
function emptyAdvanced(): AdvancedAnalytics {
  return {
    cohortId: null,
    engagement: {
      activeStudents7d: 0,
      activeStudents30d: 0,
      cohortStudentCount: 0,
      eventCount: 0,
      lastEventAt: null,
      submissionCount: 0,
      lateSubmissionCount: 0,
    },
    daily: Array.from({ length: 14 }, (_, i) => ({
      day: `2026-07-${String(18 + i).padStart(2, "0")}`,
      activeStudents: 0,
      events: 0,
    })),
    heatmap: buildHeatmap([]),
    problems: [],
    grades: gradeDistribution([], 0),
    risk: [],
    computeMs: 12,
    queryCount: 1,
  };
}

/** A cohort mid-term, with real numbers in every panel. */
function populatedAdvanced(): AdvancedAnalytics {
  const signals: RiskSignals[] = [
    {
      studentId: 3,
      name: "Chandni Struggling",
      penaltyCount: 4,
      penaltyPoints: 12,
      weeksWithoutQuizAttempt: 3,
      weekCount: 4,
      ungradedSubmissionCount: 1,
      lateSubmissionCount: 2,
      daysSinceLastActivity: 19,
    },
  ];
  return {
    cohortId: 1,
    engagement: {
      activeStudents7d: 5,
      activeStudents30d: 7,
      cohortStudentCount: 8,
      eventCount: 214,
      lastEventAt: new Date("2026-07-31T09:15:00.000Z"),
      submissionCount: 20,
      lateSubmissionCount: 3,
    },
    daily: Array.from({ length: 14 }, (_, i) => ({
      day: `2026-07-${String(18 + i).padStart(2, "0")}`,
      activeStudents: (i % 5) + 1,
      events: i * 2,
    })),
    heatmap: buildHeatmap([
      { dow: 1, block: 2, count: 8 },
      { dow: 4, block: 5, count: 3 },
    ]),
    problems: [
      {
        problemId: 76,
        title: "A document that validates",
        track: "html",
        level: "beginner",
        attemptCount: 12,
        studentCount: 4,
        solverCount: 1,
        solveRatePercent: 25,
        attemptsPerSolver: 12,
        avgRuntimeMs: 2.41666,
      },
      {
        problemId: 77,
        title: "Never attempted problem",
        track: "css",
        level: "beginner",
        attemptCount: 0,
        studentCount: 0,
        solverCount: 0,
        solveRatePercent: null,
        attemptsPerSolver: null,
        avgRuntimeMs: null,
      },
    ],
    grades: gradeDistribution([310, 250, 100], 8),
    risk: rankRisk(signals),
    computeMs: 248,
    queryCount: 1,
  };
}

function weeks(withData: boolean): WeekProgressRow[] {
  return [1, 2, 3, 4].map((n) => ({
    weekId: n,
    weekNumber: n,
    title: `Week ${n} title`,
    completionRate: withData ? rate(n, 8) : rate(0, 0),
    quizPassRate: withData ? rate(n, 6) : rate(0, 0),
    // Deliberately >100% on week 4 when populated: submissions over enrolled
    // students CAN exceed 1 and must not overflow the track.
    submissionRate: withData ? rate(n * 3, 8) : rate(0, 0),
  }));
}

describe("AdvancedAnalyticsSection — fresh cohort (every denominator zero)", () => {
  it("renders every panel without NaN, Infinity or undefined", () => {
    const { container } = render(
      <AdvancedAnalyticsSection advanced={emptyAdvanced()} weeks={weeks(false)} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });

  it("says 'no data' rather than 0% for every zero-denominator rate", () => {
    render(<AdvancedAnalyticsSection advanced={emptyAdvanced()} weeks={weeks(false)} />);
    // 3 series x 4 weeks in the completion chart, all with no denominator.
    const values = screen.getAllByTestId("progress-bar-value");
    expect(values.length).toBe(12);
    for (const value of values) {
      expect(value.getAttribute("data-has-data")).toBe("false");
      expect(value.textContent).toBe("no data");
    }
  });

  it("shows a stated empty state for each panel instead of an empty chart", () => {
    render(<AdvancedAnalyticsSection advanced={emptyAdvanced()} weeks={weeks(false)} />);
    expect(screen.getByTestId("heatmap-empty")).toBeTruthy();
    expect(screen.getByTestId("grade-distribution-empty")).toBeTruthy();
    expect(screen.getByTestId("problem-difficulty-empty")).toBeTruthy();
    expect(screen.getByTestId("risk-alerts-empty")).toBeTruthy();
    expect(screen.getByTestId("spark-empty")).toBeTruthy();
  });

  it("reports one round trip in the section header", () => {
    render(<AdvancedAnalyticsSection advanced={emptyAdvanced()} weeks={weeks(false)} />);
    expect(screen.getByTestId("advanced-analytics").textContent).toContain(
      "in 1 database round trip",
    );
  });
});

describe("AdvancedAnalyticsSection — populated cohort", () => {
  it("draws the full 42-cell grid with quiet cells present", () => {
    const { container } = render(
      <AdvancedAnalyticsSection advanced={populatedAdvanced()} weeks={weeks(true)} />,
    );
    const cells = container.querySelectorAll("[data-testid^='heat-']");
    expect(cells.length).toBe(42);
    expect(container.querySelector("[data-testid='heat-1-2']")?.getAttribute("data-count")).toBe("8");
    // A block nobody worked in is present at zero, not missing.
    expect(container.querySelector("[data-testid='heat-2-0']")?.getAttribute("data-count")).toBe("0");
  });

  it("clamps a rate above 100% instead of overflowing the bar", () => {
    // Week 4 submissionRate is 12/8 = 150%.
    const { container } = render(
      <AdvancedAnalyticsSection advanced={populatedAdvanced()} weeks={weeks(true)} />,
    );
    const widths = Array.from(container.querySelectorAll<HTMLElement>("div[style*='width']"))
      .map((el) => Number.parseFloat(el.style.width))
      .filter((n) => Number.isFinite(n));
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect(width).toBeLessThanOrEqual(100);
  });

  it("renders 'no data' for a problem nobody has attempted, not 0%", () => {
    render(<AdvancedAnalyticsSection advanced={populatedAdvanced()} weeks={weeks(true)} />);
    const cells = screen.getAllByTestId("problem-solve-rate");
    expect(cells.some((c) => c.textContent === "no data")).toBe(true);
    expect(cells.some((c) => c.textContent === "25%")).toBe(true);
  });

  it("states its runtime in milliseconds", () => {
    const { container } = render(
      <AdvancedAnalyticsSection advanced={populatedAdvanced()} weeks={weeks(true)} />,
    );
    // House rule: metric units, and visible.
    expect(container.textContent).toContain(" ms");
    expect(container.textContent).toContain("2 ms"); // 2.41666 -> "2 ms"
  });

  it("excludes unscored students from the grade chart and says how many", () => {
    render(<AdvancedAnalyticsSection advanced={populatedAdvanced()} weeks={weeks(true)} />);
    // 3 of 8 scored, so 5 unscored — and they are NOT F.
    expect(screen.getByTestId("grade-unscored-count").textContent).toContain("5");
    const counts = ["A", "B", "C", "D", "F"].map((g) =>
      Number(screen.getByTestId(`grade-bar-${g}`).getAttribute("data-count")),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("names the at-risk student and lists the signals that fired", () => {
    render(<AdvancedAnalyticsSection advanced={populatedAdvanced()} weeks={weeks(true)} />);
    const row = screen.getByTestId("risk-row-3");
    expect(row.textContent).toContain("Chandni Struggling");
    expect(row.textContent).toContain("no activity for 19 days");
    expect(row.textContent).toContain("3 of 4 weeks with no quiz attempt");
    expect(row.getAttribute("data-band")).toBe("high");
  });

  it("renders NO email address anywhere in the DOM", () => {
    // The privacy guarantee, against real markup. `name` reaches the page and an
    // address never does — see src/lib/analytics/privacy.ts.
    const { container } = render(
      <AdvancedAnalyticsSection advanced={populatedAdvanced()} weeks={weeks(true)} />,
    );
    expect(container.innerHTML).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(container.innerHTML).not.toContain("@codequeenshub.test");
  });

  it("draws the sparkline as inline SVG — no charting dependency", () => {
    const { container } = render(
      <AdvancedAnalyticsSection advanced={populatedAdvanced()} weeks={weeks(true)} />,
    );
    const spark = container.querySelector("[data-testid='engagement-sparkline']");
    expect(spark?.tagName.toLowerCase()).toBe("svg");
    const points = spark?.querySelector("polyline")?.getAttribute("points") ?? "";
    // Every coordinate must be finite: one NaN silently blanks the whole polyline.
    expect(points.length).toBeGreaterThan(0);
    expect(points).not.toContain("NaN");
    for (const pair of points.split(" ")) {
      const [x, y] = pair.split(",").map(Number);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});
