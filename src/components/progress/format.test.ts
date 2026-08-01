// =============================================================================
// Unit tests: dashboard presentation helpers. The point of these is the ugly
// strings — "NaN%", "null%", "Invalid Date", "0 of 0 lectures" — that a
// zero-activity first load would otherwise show.
// Owner: progress-tracking stream.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  formatDate,
  isoAttribute,
  lectureCountLabel,
  lecturePercent,
  quizPercentLabel,
  relativeDays,
} from "./format";

describe("formatDate", () => {
  it("formats a scheduled deadline unambiguously", () => {
    expect(formatDate(new Date("2026-09-07T00:00:00.000Z"))).toBe("7 Sept 2026");
  });

  it("accepts an ISO string as well as a Date", () => {
    expect(formatDate("2026-09-07T00:00:00.000Z")).toBe(formatDate(new Date("2026-09-07T00:00:00.000Z")));
  });

  it("says 'Not scheduled' instead of rendering an empty or invalid date", () => {
    expect(formatDate(null)).toBe("Not scheduled");
    expect(formatDate(undefined)).toBe("Not scheduled");
    expect(formatDate("not a date")).toBe("Not scheduled");
  });
});

describe("isoAttribute", () => {
  it("returns an ISO string for a valid date", () => {
    expect(isoAttribute(new Date("2026-09-07T00:00:00.000Z"))).toBe("2026-09-07T00:00:00.000Z");
  });

  it("returns undefined so <time> omits the attribute entirely", () => {
    expect(isoAttribute(null)).toBeUndefined();
    expect(isoAttribute("nonsense")).toBeUndefined();
  });
});

describe("relativeDays", () => {
  it("reads naturally either side of the deadline", () => {
    expect(relativeDays(3)).toBe("in 3 days");
    expect(relativeDays(1)).toBe("in 1 day");
    expect(relativeDays(0)).toBe("due today");
    expect(relativeDays(-1)).toBe("1 day overdue");
    expect(relativeDays(-4)).toBe("4 days overdue");
  });
});

describe("lectureCountLabel", () => {
  it("renders 'x of y lectures' — the string lectureTotal exists for", () => {
    expect(lectureCountLabel(2, 3)).toBe("2 of 3 lectures");
    expect(lectureCountLabel(0, 3)).toBe("0 of 3 lectures");
    expect(lectureCountLabel(1, 1)).toBe("1 of 1 lecture");
  });

  it("never claims more lectures watched than exist", () => {
    expect(lectureCountLabel(9, 3)).toBe("3 of 3 lectures");
  });

  it("handles a week with no lectures authored yet", () => {
    expect(lectureCountLabel(0, 0)).toBe("No lectures yet");
  });
});

describe("lecturePercent", () => {
  it("is 0, not NaN, when the week has no lectures", () => {
    expect(lecturePercent(0, 0)).toBe(0);
    expect(Number.isNaN(lecturePercent(0, 0))).toBe(false);
  });

  it("caps at 100", () => {
    expect(lecturePercent(9, 3)).toBe(100);
  });

  it("rounds to a whole percent", () => {
    expect(lecturePercent(1, 3)).toBe(33);
  });
});

describe("quizPercentLabel", () => {
  it("says 'Not attempted' rather than 'null%'", () => {
    expect(quizPercentLabel(null)).toBe("Not attempted");
    expect(quizPercentLabel(Number.NaN)).toBe("Not attempted");
  });

  it("renders a percentage with at most one decimal", () => {
    expect(quizPercentLabel(70)).toBe("70%");
    expect(quizPercentLabel(69.99)).toBe("70%");
    expect(quizPercentLabel(66.66)).toBe("66.7%");
  });
});
