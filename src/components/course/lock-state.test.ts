// =============================================================================
// Unit tests for week lock-state derivation. Owner: course-content stream.
// -----------------------------------------------------------------------------
// The most important test in this file is "empty progress locks everything after
// week 1": `getWeekProgress` is a stub returning [] until the progress-tracking
// stream lands, and the failure mode we must never ship is the opposite default,
// which would hand every student the entire course.
// =============================================================================

import { describe, expect, it } from "vitest";

import type { WeekProgress } from "@/lib/contracts/events";
import { QUIZ_PASS_PERCENT } from "@/lib/contracts/scoring";

import {
  UNLOCK_THRESHOLD_PERCENT,
  deriveWeekLockStates,
  lockStateForWeek,
  type WeekLockInput,
} from "./lock-state";
import type { CurriculumSection } from "./sections";
import {
  ALL_OPEN_SECTIONS as ALL_OPEN,
  HTML_ONLY_SECTIONS as HTML_ONLY,
  testSection as section,
} from "../../../tests/support/curriculum-sections";

/** Mirrors the seeded four-week course. */
const WEEKS: WeekLockInput[] = [
  { id: 11, weekNumber: 1, title: "HTML5 Foundations", lectureTotal: 3 },
  { id: 12, weekNumber: 2, title: "CSS3 & Responsive Design", lectureTotal: 3 },
  { id: 13, weekNumber: 3, title: "JavaScript Fundamentals", lectureTotal: 3 },
  { id: 14, weekNumber: 4, title: "Git, Deployment & Final Project", lectureTotal: 3 },
];

// ---------------------------------------------------------------------------
// SECTION FIXTURES — shared, see tests/support/curriculum-sections.ts.
// ---------------------------------------------------------------------------
// Two layers now decide `locked`: the subject-section release switch (checked
// first, absolute) and the quiz-progression rule (checked within an open
// subject). Most tests here are about the PROGRESSION layer, so they inject
// ALL_OPEN — otherwise they would silently be re-testing the section switch and
// would stop covering progression the moment the owner closed a subject.
//
// The shipped configuration is asserted in sections.test.ts and in the "section
// release switch" block at the foot of this file.

function progressRow(overrides: Partial<WeekProgress> & Pick<WeekProgress, "weekId">): WeekProgress {
  return {
    weekNumber: 0,
    title: "",
    unlocked: false,
    lecturesCompleted: 0,
    lectureTotal: 3,
    quizCompleted: false,
    quizBestPercent: null,
    assignmentCompleted: false,
    overallScore: 0,
    ...overrides,
  };
}

describe("UNLOCK_THRESHOLD_PERCENT", () => {
  it("is the frozen scoring threshold, not a local copy", () => {
    expect(UNLOCK_THRESHOLD_PERCENT).toBe(QUIZ_PASS_PERCENT);
    expect(UNLOCK_THRESHOLD_PERCENT).toBe(70);
  });
});

describe("deriveWeekLockStates — empty progress (the current stub)", () => {
  // ALL_OPEN on purpose: this block asserts that the PROGRESSION rule fails
  // closed. Left on the shipped config it would pass because the sections are
  // shut, and would keep passing even if the progression default were inverted.
  const states = deriveWeekLockStates(WEEKS, [], ALL_OPEN);

  it("returns one state per week, ordered by week number", () => {
    expect(states.map((s) => s.weekNumber)).toEqual([1, 2, 3, 4]);
  });

  it("unlocks week 1 for a student with no progress at all", () => {
    expect(states[0].locked).toBe(false);
    expect(states[0].reason).toBeNull();
  });

  it("locks every later week — fail closed, never fail open", () => {
    expect(states.slice(1).every((s) => s.locked)).toBe(true);
  });

  it("names the quiz that must be passed, and the threshold", () => {
    expect(states[1].reason).toContain("Week 1 quiz");
    expect(states[1].reason).toContain("70%");
    expect(states[3].reason).toContain("Week 3 quiz");
  });

  it("reports zero completion rather than NaN", () => {
    expect(states.every((s) => s.completionPercent === 0)).toBe(true);
  });
});

describe("deriveWeekLockStates — unlock derived from the previous quiz", () => {
  it("unlocks week 2 at exactly the pass threshold (boundary)", () => {
    const states = deriveWeekLockStates(WEEKS, [
      progressRow({ weekId: 11, weekNumber: 1, quizBestPercent: 70, quizCompleted: true }),
    ], ALL_OPEN);
    expect(states[1].locked).toBe(false);
    expect(states[1].reason).toBeNull();
  });

  it("keeps week 2 locked one point below the threshold", () => {
    const states = deriveWeekLockStates(WEEKS, [
      progressRow({ weekId: 11, weekNumber: 1, quizBestPercent: 69, quizCompleted: true }),
    ], ALL_OPEN);
    expect(states[1].locked).toBe(true);
    expect(states[1].reason).toContain("69%");
    expect(states[1].reason).toContain("70%");
  });

  it("does not cascade: passing week 1 unlocks week 2 only", () => {
    const states = deriveWeekLockStates(WEEKS, [
      progressRow({ weekId: 11, weekNumber: 1, quizBestPercent: 100, quizCompleted: true }),
    ], ALL_OPEN);
    expect(states.map((s) => s.locked)).toEqual([false, false, true, true]);
  });

  it("unlocks progressively as each week is passed", () => {
    const states = deriveWeekLockStates(WEEKS, [
      progressRow({ weekId: 11, weekNumber: 1, quizBestPercent: 80 }),
      progressRow({ weekId: 12, weekNumber: 2, quizBestPercent: 75 }),
      progressRow({ weekId: 13, weekNumber: 3, quizBestPercent: 40 }),
    ], ALL_OPEN);
    expect(states.map((s) => s.locked)).toEqual([false, false, false, true]);
    expect(states[3].reason).toContain("40%");
  });
});

describe("deriveWeekLockStates — an already-recorded unlock is trusted", () => {
  it("honours progress.unlocked even without a passing previous score", () => {
    // The quizzes stream writes week_unlocked transactionally on the unlock
    // event; a later retake at a lower score must not re-lock a week the student
    // has already been let into.
    const states = deriveWeekLockStates(WEEKS, [
      progressRow({ weekId: 11, weekNumber: 1, quizBestPercent: 50 }),
      progressRow({ weekId: 12, weekNumber: 2, unlocked: true }),
    ], ALL_OPEN);
    expect(states[1].locked).toBe(false);
  });

  it("does not treat unlocked:false as an override of a passing score", () => {
    const states = deriveWeekLockStates(WEEKS, [
      progressRow({ weekId: 11, weekNumber: 1, quizBestPercent: 90 }),
      progressRow({ weekId: 12, weekNumber: 2, unlocked: false }),
    ], ALL_OPEN);
    expect(states[1].locked).toBe(false);
  });
});

describe("deriveWeekLockStates — completion and totals", () => {
  it("computes whole-percent completion from the read model", () => {
    const states = deriveWeekLockStates(WEEKS, [
      progressRow({ weekId: 11, weekNumber: 1, lecturesCompleted: 2, lectureTotal: 3 }),
    ], ALL_OPEN);
    expect(states[0].completionPercent).toBe(67);
  });

  it("clamps completion at 100 when more lectures are recorded than exist", () => {
    const states = deriveWeekLockStates(WEEKS, [
      progressRow({ weekId: 11, weekNumber: 1, lecturesCompleted: 9, lectureTotal: 3 }),
    ], ALL_OPEN);
    expect(states[0].completionPercent).toBe(100);
  });

  it("falls back to the week row's lecture count when progress has none", () => {
    const states = deriveWeekLockStates(WEEKS, [], ALL_OPEN);
    expect(states[0].lectureTotal).toBe(3);
  });

  it("returns 0 rather than NaN for a week with no lectures", () => {
    const states = deriveWeekLockStates(
      [{ id: 99, weekNumber: 1, title: "Empty", lectureTotal: 0 }],
      [],
      ALL_OPEN,
    );
    expect(states[0].completionPercent).toBe(0);
  });
});

describe("deriveWeekLockStates — input robustness", () => {
  it("sorts unordered input before deciding which week is first", () => {
    const shuffled = [WEEKS[2], WEEKS[0], WEEKS[3], WEEKS[1]];
    const states = deriveWeekLockStates(shuffled, [], ALL_OPEN);
    expect(states[0].weekNumber).toBe(1);
    expect(states[0].locked).toBe(false);
  });

  it("does not mutate the caller's array", () => {
    const input = [WEEKS[2], WEEKS[0]];
    const snapshot = [...input];
    deriveWeekLockStates(input, [], ALL_OPEN);
    expect(input).toEqual(snapshot);
  });

  it("returns an empty list for a course with no weeks", () => {
    expect(deriveWeekLockStates([], [], ALL_OPEN)).toEqual([]);
  });

  it("ignores progress rows for weeks that are not in the list", () => {
    const states = deriveWeekLockStates(WEEKS, [
      progressRow({ weekId: 999, weekNumber: 7, quizBestPercent: 100 }),
    ], ALL_OPEN);
    expect(states.map((s) => s.locked)).toEqual([false, true, true, true]);
  });
});

describe("lockStateForWeek", () => {
  it("finds the state for a known week id", () => {
    expect(lockStateForWeek(12, WEEKS, [], ALL_OPEN)?.locked).toBe(true);
    expect(lockStateForWeek(11, WEEKS, [], ALL_OPEN)?.locked).toBe(false);
  });

  it("returns null for an unknown week id so callers must deny", () => {
    expect(lockStateForWeek(4242, WEEKS, [], ALL_OPEN)).toBeNull();
  });
});

// ===========================================================================
// THE SECTION RELEASE SWITCH
// ---------------------------------------------------------------------------
// These are the tests that make the switch real. The property that matters is
// PRECEDENCE: a closed subject must beat every reason a week could otherwise be
// open — being week 1, having a passing previous score, and a stored
// `unlocked: true` from a quiz the student passed before the subject was shut.
// If any one of those wins, the switch is advisory and the owner cannot rely on
// it to hold a subject back.
// ===========================================================================

describe("deriveWeekLockStates — subject section release switch", () => {
  it("locks every week outside an enabled section, whatever the progress says", () => {
    const states = deriveWeekLockStates(
      WEEKS,
      [
        progressRow({ weekId: 11, weekNumber: 1, quizBestPercent: 100, quizCompleted: true }),
        progressRow({ weekId: 12, weekNumber: 2, quizBestPercent: 100, quizCompleted: true }),
        progressRow({ weekId: 13, weekNumber: 3, quizBestPercent: 100, quizCompleted: true }),
      ],
      HTML_ONLY,
    );
    // Week 1 (HTML, open) unlocked; 2-4 shut despite three perfect scores.
    expect(states.map((s) => s.locked)).toEqual([false, true, true, true]);
    expect(states.slice(1).map((s) => s.lockedBy)).toEqual(["section", "section", "section"]);
  });

  it("overrides a stored unlocked:true — closing a subject re-closes it", () => {
    // The student passed week 1 and the quizzes stream wrote week_unlocked for
    // week 2 BEFORE the owner closed the CSS section. Trusting that stored row
    // (rule 2) would leave the subject open for exactly the students who had got
    // furthest, which is the opposite of withdrawing it.
    const states = deriveWeekLockStates(
      WEEKS,
      [progressRow({ weekId: 12, weekNumber: 2, unlocked: true })],
      HTML_ONLY,
    );
    expect(states[1].locked).toBe(true);
    expect(states[1].lockedBy).toBe("section");
  });

  it("overrides the always-unlock-the-first-week rule", () => {
    // Rule 1 exists so a new student is never staring at four padlocks. It must
    // still yield to the switch, or a course whose first subject is not ready
    // would leak its first week to everyone.
    const allClosed = ALL_OPEN.map((s) => ({ ...s, enabled: false }));
    const states = deriveWeekLockStates(WEEKS, [], allClosed);
    expect(states.every((s) => s.locked)).toBe(true);
    expect(states[0].lockedBy).toBe("section");
  });

  it("locks a week claimed by no section at all — fail closed on new content", () => {
    // Week 5 is added to the curriculum and nobody writes a section for it. The
    // dangerous default is publishing it; this asserts the safe one.
    const withWeek5: WeekLockInput[] = [
      ...WEEKS,
      { id: 15, weekNumber: 5, title: "Unsectioned", lectureTotal: 2 },
    ];
    const states = deriveWeekLockStates(
      withWeek5,
      [progressRow({ weekId: 14, weekNumber: 4, quizBestPercent: 100 })],
      ALL_OPEN,
    );
    expect(states[4].locked).toBe(true);
    expect(states[4].lockedBy).toBe("section");
  });

  it("does not tell a student to pass a quiz that cannot open the subject", () => {
    // The whole point of `lockedBy`. Reusing the progression wording here would
    // send a student to burn one of their three quiz attempts on a week whose
    // result changes nothing.
    const states = deriveWeekLockStates(WEEKS, [], HTML_ONLY);
    expect(states[1].reason).toContain("CSS3");
    // It may MENTION quizzes — it says one will not help — but it must never
    // give the "Locked until you pass the Week N quiz" instruction.
    expect(states[1].reason).not.toMatch(/Locked until you pass/i);
    expect(states[1].reason).toMatch(/not unlocked by quiz scores/i);
    // ...and the progression wording is still used where it IS the blocker.
    const open = deriveWeekLockStates(WEEKS, [], ALL_OPEN);
    expect(open[1].lockedBy).toBe("progression");
    expect(open[1].reason).toContain("quiz");
  });

  it("leaves progression in force INSIDE an open subject", () => {
    // A subject holding two weeks must not open both at once just because the
    // subject is released — the section switch gates the subject, not the weeks
    // within it.
    const twoWeekSubject: CurriculumSection[] = [
      section({ slug: "html", title: "HTML5", weekNumbers: [1, 2] }),
    ];
    const states = deriveWeekLockStates(WEEKS.slice(0, 2), [], twoWeekSubject);
    expect(states[0].locked).toBe(false);
    expect(states[1].locked).toBe(true);
    expect(states[1].lockedBy).toBe("progression");
  });

  it("uses the shipped configuration by default — HTML open, the rest shut", () => {
    // No third argument: this is what a student actually gets in production.
    // Asserted here so flipping a subject open in app.config cannot happen
    // without a test acknowledging it.
    const states = deriveWeekLockStates(WEEKS, [
      progressRow({ weekId: 11, weekNumber: 1, quizBestPercent: 100, quizCompleted: true }),
    ]);
    expect(states.map((s) => s.locked)).toEqual([false, true, true, true]);
  });
});
