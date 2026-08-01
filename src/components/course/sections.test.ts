// =============================================================================
// Unit tests for subject-section derivation. Owner: course-content stream.
// -----------------------------------------------------------------------------
// Two things are under test and they matter for different reasons:
//
//   1. THE PURE HELPERS, against injected fixtures — the grouping and lookup
//      logic, including the fail-closed behaviour for a week no section claims.
//   2. THE SHIPPED CONFIGURATION ITSELF, against appConfig — that HTML is the
//      only open subject, that every seeded week is claimed by exactly one
//      section, and that no two sections claim the same week. A config with a
//      typo'd week number silently locks a subject nobody meant to lock, and
//      nothing else in the app would notice.
// =============================================================================

import { describe, expect, it } from "vitest";

import { appConfig } from "@/lib/config/app.config";

import {
  getCurriculumSections,
  groupWeeksBySection,
  isWeekNumberEnabled,
  sectionForWeekNumber,
  sectionLockReason,
  unsectionedWeekNumbers,
  type CurriculumSection,
} from "./sections";
import { testSection as section } from "../../../tests/support/curriculum-sections";

const FIXTURE: CurriculumSection[] = [
  section({ slug: "html", title: "HTML5", weekNumbers: [1] }),
  section({ slug: "css", title: "CSS3", weekNumbers: [2, 3], enabled: false }),
];

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

describe("sectionForWeekNumber", () => {
  it("finds the section claiming a week", () => {
    expect(sectionForWeekNumber(1, FIXTURE)?.slug).toBe("html");
    expect(sectionForWeekNumber(3, FIXTURE)?.slug).toBe("css");
  });

  it("returns null for a week no section claims", () => {
    expect(sectionForWeekNumber(9, FIXTURE)).toBeNull();
  });
});

describe("isWeekNumberEnabled", () => {
  it("is true only inside an enabled section", () => {
    expect(isWeekNumberEnabled(1, FIXTURE)).toBe(true);
    expect(isWeekNumberEnabled(2, FIXTURE)).toBe(false);
  });

  it("is false for an unclaimed week — fail closed, never fail open", () => {
    // The dangerous default. A week added to the curriculum before anyone writes
    // a section for it must not be published to every student by omission.
    expect(isWeekNumberEnabled(9, FIXTURE)).toBe(false);
  });
});

describe("sectionLockReason", () => {
  it("names the closed subject and says a quiz will not open it", () => {
    const reason = sectionLockReason(2, FIXTURE);
    expect(reason).toContain("CSS3");
    expect(reason).toMatch(/not unlocked by quiz scores/i);
  });

  it("does not invent a subject name for an unclaimed week", () => {
    const reason = sectionLockReason(9, FIXTURE);
    expect(reason).toMatch(/not part of a released subject/i);
  });
});

describe("unsectionedWeekNumbers", () => {
  it("reports weeks that no section claims", () => {
    expect(unsectionedWeekNumbers([1, 2, 3, 9], FIXTURE)).toEqual([9]);
  });

  it("is empty when every week is claimed", () => {
    expect(unsectionedWeekNumbers([1, 2, 3], FIXTURE)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

describe("groupWeeksBySection", () => {
  const weeks = [
    { weekNumber: 3, title: "c" },
    { weekNumber: 1, title: "a" },
    { weekNumber: 2, title: "b" },
  ];

  it("groups in configured section order, ascending within a section", () => {
    const { groups } = groupWeeksBySection(weeks, FIXTURE);
    expect(groups.map((g) => g.section.slug)).toEqual(["html", "css"]);
    expect(groups[1].weeks.map((w) => w.weekNumber)).toEqual([2, 3]);
  });

  it("drops a section with no week rows behind it", () => {
    const withEmpty = [...FIXTURE, section({ slug: "js", weekNumbers: [7] })];
    const { groups } = groupWeeksBySection(weeks, withEmpty);
    expect(groups.map((g) => g.section.slug)).not.toContain("js");
  });

  it("returns unclaimed weeks separately rather than dropping them", () => {
    // Dropping them would hide content from the one screen meant to account for
    // all of it — a week would simply cease to exist in the UI with no trace.
    const { groups, unsectioned } = groupWeeksBySection(
      [...weeks, { weekNumber: 9, title: "orphan" }],
      FIXTURE,
    );
    expect(unsectioned.map((w) => w.weekNumber)).toEqual([9]);
    expect(groups.flatMap((g) => g.weeks.map((w) => w.weekNumber))).toEqual([1, 2, 3]);
  });

  it("does not mutate the caller's array", () => {
    const input = [...weeks];
    const snapshot = [...input];
    groupWeeksBySection(input, FIXTURE);
    expect(input).toEqual(snapshot);
  });

  it("handles an empty week list", () => {
    expect(groupWeeksBySection([], FIXTURE)).toEqual({ groups: [], unsectioned: [] });
  });
});

// ---------------------------------------------------------------------------
// The shipped configuration
// ---------------------------------------------------------------------------

describe("the configured curriculum sections", () => {
  const sections = getCurriculumSections();

  it("exposes exactly what app.config declares", () => {
    expect(sections.map((s) => s.slug)).toEqual(
      appConfig.curriculumSections.map((s) => s.slug),
    );
  });

  it("opens HTML and only HTML", () => {
    // The owner's stated policy. If a subject is deliberately released later,
    // this test is the place that must be updated to say so out loud.
    const open = sections.filter((s) => s.enabled).map((s) => s.slug);
    expect(open).toEqual(["html"]);
  });

  it("claims every week of the seeded course exactly once", () => {
    // appConfig.course.durationWeeks is 4 and scripts/seed-content.ts authors
    // week numbers 1-4. A section listing week 5, or omitting week 3, would lock
    // real content with no error anywhere else in the app.
    const all = sections.flatMap((s) => [...s.weekNumbers]);
    const expected = Array.from({ length: appConfig.course.durationWeeks }, (_, i) => i + 1);
    expect([...all].sort((a, b) => a - b)).toEqual(expected);
    expect(new Set(all).size).toBe(all.length);
  });

  it("gives the HTML section week 1, the week the seeded HTML content lives in", () => {
    expect(sectionForWeekNumber(1)?.slug).toBe("html");
    expect(isWeekNumberEnabled(1)).toBe(true);
  });

  it("closes weeks 2, 3 and 4 for students", () => {
    expect([2, 3, 4].map((n) => isWeekNumberEnabled(n))).toEqual([false, false, false]);
  });

  it("uses unique slugs, so a section can be addressed unambiguously", () => {
    const slugs = sections.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("returns a mutable copy, so a caller cannot corrupt the config", () => {
    const first = getCurriculumSections();
    first[0].enabled = false;
    expect(getCurriculumSections()[0].enabled).toBe(true);
  });
});
