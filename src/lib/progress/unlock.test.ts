// =============================================================================
// Unit tests: week-unlock derivation. No database, no mocks needed — the
// derivation is pure, which is the whole reason it lives in its own module.
// Owner: progress-tracking stream.
// =============================================================================

import { describe, expect, it } from "vitest";

import { QUIZ_PASS_PERCENT } from "@/lib/contracts/scoring";

import {
  ALL_OPEN_SECTIONS,
  HTML_ONLY_SECTIONS,
} from "../../../tests/support/curriculum-sections";

import { currentWeekNumber, deriveUnlocked, type UnlockInput } from "./unlock";

/** Four weeks with the given best percentages (null = never attempted). */
function weeks(...percents: Array<number | null>): UnlockInput[] {
  return percents.map((quizBestPercent, i) => ({ weekNumber: i + 1, quizBestPercent }));
}

// EVERY call below passes ALL_OPEN_SECTIONS. `deriveUnlocked` now ANDs the
// subject-release switch onto the progression result, and the shipped config
// closes weeks 2-4 — so without this these tests would assert `false` for weeks
// that are shut for a reason they are not testing, and would keep passing if the
// progression chain were deleted outright. The switch itself is tested in the
// "subject section release switch" block at the foot of this file.

describe("deriveUnlocked", () => {
  it("returns nothing for a course with no weeks", () => {
    // An empty course must not throw and must not invent a week 1.
    expect(deriveUnlocked([], ALL_OPEN_SECTIONS)).toEqual([]);
  });

  it("opens week 1 and locks the rest for a student with no attempts", () => {
    // The most common first-load state in the whole app.
    expect(deriveUnlocked(weeks(null, null, null, null), ALL_OPEN_SECTIONS)).toEqual([true, false, false, false]);
  });

  it("keeps week 2 locked when week 1 was failed", () => {
    expect(deriveUnlocked(weeks(45, null, null, null), ALL_OPEN_SECTIONS)).toEqual([true, false, false, false]);
  });

  it("opens week 2 when week 1 was passed", () => {
    expect(deriveUnlocked(weeks(85, null, null, null), ALL_OPEN_SECTIONS)).toEqual([true, true, false, false]);
  });

  it("opens every week when every quiz was passed", () => {
    expect(deriveUnlocked(weeks(100, 90, 80, 70), ALL_OPEN_SECTIONS)).toEqual([true, true, true, true]);
  });

  it("unlocks at exactly the pass threshold", () => {
    // The boundary is inclusive: >= 70 passes. Owned by
    // scoring.shouldUnlockNextWeek, asserted here so a change to it fails a
    // progress test too rather than silently shifting who can see week 2.
    expect(deriveUnlocked(weeks(QUIZ_PASS_PERCENT, null), ALL_OPEN_SECTIONS)).toEqual([true, true]);
  });

  it("does not unlock just below the pass threshold", () => {
    // 69.99 is representable and is what a 69.99% stored decimal(5,2) becomes.
    expect(deriveUnlocked(weeks(69.99, null), ALL_OPEN_SECTIONS)).toEqual([true, false]);
  });

  it("stops the chain at the first failed gate even if a later week was passed", () => {
    // Week 3 passed while week 2 failed: week 3 must stay shut. Progression is
    // sequential, so a later pass cannot back-fill an earlier gate.
    expect(deriveUnlocked(weeks(90, 40, 95, null), ALL_OPEN_SECTIONS)).toEqual([true, true, false, false]);
  });

  it("ignores the order rows arrive in", () => {
    const shuffled: UnlockInput[] = [
      { weekNumber: 3, quizBestPercent: null },
      { weekNumber: 1, quizBestPercent: 90 },
      { weekNumber: 2, quizBestPercent: null },
    ];
    // Positions line up with the INPUT array, not with week order.
    expect(deriveUnlocked(shuffled, ALL_OPEN_SECTIONS)).toEqual([false, true, true]);
  });

  it("treats a non-finite percentage as no attempt rather than a pass", () => {
    expect(deriveUnlocked(weeks(Number.NaN, null), ALL_OPEN_SECTIONS)).toEqual([true, false]);
  });
});

describe("currentWeekNumber", () => {
  it("is 1 for a brand-new student", () => {
    expect(currentWeekNumber(weeks(null, null, null, null), ALL_OPEN_SECTIONS)).toBe(1);
  });

  it("is the last unlocked week", () => {
    expect(currentWeekNumber(weeks(90, 90, null, null), ALL_OPEN_SECTIONS)).toBe(3);
  });

  it("is null when there are no weeks", () => {
    expect(currentWeekNumber([], ALL_OPEN_SECTIONS)).toBeNull();
  });
});

// ===========================================================================
// THE SECTION RELEASE SWITCH, in the dashboard derivation
// ---------------------------------------------------------------------------
// This module is the SECOND unlock derivation in the app (the first gates
// content, in components/course/lock-state.ts). If the two disagree the
// dashboard offers a "continue to Week 2" action that /weeks then refuses —
// the student is sent somewhere they are turned away from. These tests pin the
// agreement at this end.
// ===========================================================================

describe("deriveUnlocked — subject section release switch", () => {
  it("shuts a week whose subject is withheld, however well the student did", () => {
    // Perfect scores on weeks 1-3. Under progression alone every week opens.
    expect(deriveUnlocked(weeks(100, 100, 100, null), HTML_ONLY_SECTIONS)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it("shuts week 1 too when its subject is withheld", () => {
    // "The first week is always unlocked" must yield to the switch, or a course
    // whose opening subject is not ready leaks week 1 to everyone.
    const allClosed = ALL_OPEN_SECTIONS.map((s) => ({ ...s, enabled: false }));
    expect(deriveUnlocked(weeks(null, null, null, null), allClosed)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("shuts a week claimed by no section — fail closed on new content", () => {
    const onlyWeek1: UnlockInput[] = [
      { weekNumber: 1, quizBestPercent: 100 },
      { weekNumber: 9, quizBestPercent: null },
    ];
    expect(deriveUnlocked(onlyWeek1, HTML_ONLY_SECTIONS)).toEqual([true, false]);
  });

  it("does not un-pass an earlier gate when a later subject is closed", () => {
    // The chain advances on the QUIZ result alone. If closing CSS also broke the
    // chain, re-opening it later would leave every week behind it wrongly shut,
    // and the owner would have to make students re-sit passed quizzes.
    const cssClosedOnly = ALL_OPEN_SECTIONS.map((s) =>
      s.slug === "css" ? { ...s, enabled: false } : s,
    );
    // Weeks 1-3 all passed. Week 2 is withheld; weeks 3 and 4 are NOT, and their
    // gates were genuinely passed, so they stay open.
    expect(deriveUnlocked(weeks(100, 100, 100, null), cssClosedOnly)).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it("never points currentWeekNumber at a withheld subject", () => {
    // The dashboard's "next action" reads this. Pointing it at week 3 while
    // gateWeek refuses week 3 is the exact disagreement this guards against.
    expect(currentWeekNumber(weeks(100, 100, null, null), HTML_ONLY_SECTIONS)).toBe(1);
  });

  it("uses the shipped configuration by default — HTML only", () => {
    // No second argument: what a student actually gets in production.
    expect(deriveUnlocked(weeks(100, 100, 100, null))).toEqual([true, false, false, false]);
    expect(currentWeekNumber(weeks(100, 100, 100, null))).toBe(1);
  });
});
