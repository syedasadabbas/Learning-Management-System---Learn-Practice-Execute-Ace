// =============================================================================
// Tests for the pure badge criteria. Owner: badges stream.
// -----------------------------------------------------------------------------
// WHAT THESE PROVE AND WHAT THEY DELIBERATELY DO NOT.
//
// These cover the DECISION — "given these numbers, is the badge earned?" — and
// nothing else. They run without a database, which is why the boundary cases are
// affordable one per test.
//
// They prove NOTHING about awarding exactly once. That guarantee lives in a unique
// index in Postgres and is proven against the real database in
// ./award.integration.test.ts, which also demonstrates its own sensitivity by
// running the same race against a table WITHOUT the index. A mocked test of
// "awarded twice produces one row" would be a fake agreeing with itself — the trap
// src/lib/queue/store.integration.test.ts:6-13 describes.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

import { courseMaxScore } from "@/lib/contracts/scoring";

import { BADGE_TYPES, CODING_GENIUS_PROBLEMS, highScoreThreshold } from "./catalogue";
import { CRITERION_TYPES, evaluateBadges, type BadgeFacts } from "./evaluate";

/** A student who has done nothing at all. Every test starts here and adds one fact. */
function facts(over: Partial<BadgeFacts> = {}): BadgeFacts {
  return {
    studentId: 1,
    submissionCount: 0,
    bestQuizPercent: null,
    bestQuizId: null,
    assignmentTotal: 4,
    onTimeAssignmentCount: 0,
    lateAssignmentCount: 0,
    solvedProblemCount: 0,
    totalScore: 0,
    maxScore: courseMaxScore(),
    ...over,
  };
}

function types(f: BadgeFacts): string[] {
  return evaluateBadges(f).map((e) => e.type);
}

describe("the catalogue and the criteria cannot drift apart", () => {
  it("every badge in BADGE_TYPES has a criterion", () => {
    // Without this, adding a catalogue entry and forgetting the rule ships a card
    // that is permanently unearnable — and it would look fine on the page.
    expect([...CRITERION_TYPES].sort()).toEqual([...BADGE_TYPES].sort());
  });

  it("a student who has done nothing earns nothing", () => {
    // The vacuous-pass guard for this whole file: if every criterion returned truthy
    // the tests below would all pass while asserting nothing.
    expect(types(facts())).toEqual([]);
  });
});

describe("first_submission", () => {
  it("is earned by one submission", () => {
    expect(types(facts({ submissionCount: 1 }))).toContain("first_submission");
  });

  it("is NOT earned with zero submissions", () => {
    expect(types(facts({ submissionCount: 0 }))).not.toContain("first_submission");
  });

  it("does not require the submission to be graded", () => {
    // Deliberate, and NOT the mistake scoring.ts:65-94 was changed to fix today. A
    // badge moves no marks, no rank and no letter grade, so recognising the act of
    // handing something in is fair where awarding 40% for it was not.
    expect(types(facts({ submissionCount: 1, totalScore: 0 }))).toContain("first_submission");
  });
});

describe("perfect_quiz", () => {
  it("is earned at exactly 100", () => {
    expect(types(facts({ bestQuizPercent: 100, bestQuizId: 7 }))).toContain("perfect_quiz");
  });

  it("is NOT earned at 99.99", () => {
    // The boundary. `quiz_attempts.percentage` is decimal(5,2), so 99.99 is a value
    // the column can actually hold.
    expect(types(facts({ bestQuizPercent: 99.99 }))).not.toContain("perfect_quiz");
  });

  it("is NOT earned when the student has never attempted a quiz", () => {
    // Guards against a null being coerced to 0 and then compared, or worse, a null
    // slipping past the `!== null` check into `null >= 100` (which is false, but for
    // the wrong reason and only by luck).
    expect(types(facts({ bestQuizPercent: null }))).not.toContain("perfect_quiz");
  });

  it("records the percentage and quiz id as evidence", () => {
    const earned = evaluateBadges(facts({ bestQuizPercent: 100, bestQuizId: 42 }));
    const badge = earned.find((e) => e.type === "perfect_quiz");
    expect(badge?.evidence).toMatchObject({ percentage: 100, quizId: 42 });
  });

  it("survives a later, worse attempt because the fact is a maximum", () => {
    // The monotonicity property: quizzes allow three attempts and count the best,
    // so `bestQuizPercent` cannot fall. If ./facts.ts ever changed to read the
    // LATEST attempt instead, this badge would become revocable — and the table has
    // no un-award path.
    expect(types(facts({ bestQuizPercent: 100 }))).toContain("perfect_quiz");
  });
});

describe("all_assignments_ontime", () => {
  it("is earned when every assignment is submitted and none is late", () => {
    expect(
      types(facts({ assignmentTotal: 4, onTimeAssignmentCount: 4, lateAssignmentCount: 0 })),
    ).toContain("all_assignments_ontime");
  });

  it("is NOT earned with one assignment still outstanding", () => {
    expect(
      types(facts({ assignmentTotal: 4, onTimeAssignmentCount: 3, lateAssignmentCount: 0 })),
    ).not.toContain("all_assignments_ontime");
  });

  it("is NOT earned when all four are in but one was late", () => {
    // 3 on time + 1 late = all four submitted. The count alone would say "complete";
    // the separate late check is what refuses it.
    expect(
      types(facts({ assignmentTotal: 4, onTimeAssignmentCount: 3, lateAssignmentCount: 1 })),
    ).not.toContain("all_assignments_ontime");
  });

  it("is NOT earned when the course has no assignments at all", () => {
    // THE VACUOUS-TRUTH BUG this guard exists for: "all zero of them were on time"
    // would otherwise award an epic badge to every student on a fresh database,
    // which has courses and weeks before it has assignments.
    expect(
      types(facts({ assignmentTotal: 0, onTimeAssignmentCount: 0, lateAssignmentCount: 0 })),
    ).not.toContain("all_assignments_ontime");
  });

  it("stays earned if the denominator later shrinks", () => {
    // An admin deleting an assignment must not un-earn a badge that cannot be
    // un-awarded. `>=` rather than `===` is what makes this hold.
    expect(
      types(facts({ assignmentTotal: 3, onTimeAssignmentCount: 4, lateAssignmentCount: 0 })),
    ).toContain("all_assignments_ontime");
  });
});

describe("coding_genius", () => {
  it(`is earned at exactly ${CODING_GENIUS_PROBLEMS} solved problems`, () => {
    expect(types(facts({ solvedProblemCount: CODING_GENIUS_PROBLEMS }))).toContain(
      "coding_genius",
    );
  });

  it("is NOT earned one short", () => {
    expect(types(facts({ solvedProblemCount: CODING_GENIUS_PROBLEMS - 1 }))).not.toContain(
      "coding_genius",
    );
  });
});

describe("high_score", () => {
  it("is earned at the A threshold derived from the scoring contract", () => {
    const max = courseMaxScore();
    expect(types(facts({ totalScore: highScoreThreshold(max), maxScore: max }))).toContain(
      "high_score",
    );
  });

  it("is NOT earned one point below the threshold", () => {
    const max = courseMaxScore();
    expect(
      types(facts({ totalScore: highScoreThreshold(max) - 1, maxScore: max })),
    ).not.toContain("high_score");
  });

  it("moves with the course length rather than a hardcoded total", () => {
    // The regression guard for the rotted-constant defect scoring.ts:128-131
    // records. A literal threshold would make this badge unearnable (or trivial) the
    // first time the course is not four weeks long.
    const shortCourse = courseMaxScore(2);
    const longCourse = courseMaxScore(8);
    expect(highScoreThreshold(shortCourse)).toBeLessThan(highScoreThreshold(longCourse));

    // Earned in the short course at a total that is nowhere near enough in the long one.
    const total = highScoreThreshold(shortCourse);
    expect(types(facts({ totalScore: total, maxScore: shortCourse }))).toContain("high_score");
    expect(types(facts({ totalScore: total, maxScore: longCourse }))).not.toContain("high_score");
  });
});

describe("evaluateBadges returns everything qualified, not only what is new", () => {
  it("returns a badge the student has presumably held for weeks", () => {
    // This is the property that lets the unique index own de-duplication: the
    // evaluator has no idea what is already awarded and must not pretend to.
    const all = types(
      facts({
        submissionCount: 9,
        bestQuizPercent: 100,
        assignmentTotal: 4,
        onTimeAssignmentCount: 4,
        solvedProblemCount: CODING_GENIUS_PROBLEMS,
        totalScore: highScoreThreshold(),
      }),
    );
    expect(all).toEqual([...BADGE_TYPES]);
  });

  it("returns them in catalogue order", () => {
    const all = types(facts({ submissionCount: 1, bestQuizPercent: 100 }));
    expect(all).toEqual(["first_submission", "perfect_quiz"]);
  });
});

describe("one bad criterion does not cost the student the others", () => {
  it("logs and continues when a criterion throws", async () => {
    // Evaluation runs off the back of a grading event. A NaN out of a decimal parse,
    // or a helper that starts throwing, must not turn into "no badges at all this
    // pass" — the student would silently lose four badges because of the fifth.
    //
    // `high_score` is the only criterion that calls out to a helper, so breaking
    // `highScoreThreshold` is the honest way to make exactly one rule throw without
    // reaching into the private CRITERIA map. Done with doMock + a fresh module
    // registry so the sabotage is confined to this test.
    vi.resetModules();
    vi.doMock("./catalogue", async () => {
      const actual = await vi.importActual<typeof import("./catalogue")>("./catalogue");
      return {
        ...actual,
        highScoreThreshold: () => {
          throw new Error("sabotaged threshold");
        },
      };
    });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { evaluateBadges: reloaded } = await import("./evaluate");
      const earned = reloaded(
        facts({
          submissionCount: 1,
          bestQuizPercent: 100,
          totalScore: 10_000, // would earn high_score if the helper worked
        }),
      ).map((e) => e.type);

      // The four healthy criteria still produced their answers...
      expect(earned).toContain("first_submission");
      expect(earned).toContain("perfect_quiz");
      // ...and only the broken one was dropped, loudly.
      expect(earned).not.toContain("high_score");
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      vi.doUnmock("./catalogue");
      vi.resetModules();
    }
  });
});
