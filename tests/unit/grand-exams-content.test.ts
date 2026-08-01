// =============================================================================
// GRAND-EXAM CONTENT TESTS — owner: curriculum-content stream.
// -----------------------------------------------------------------------------
// These are content tests, not engine tests: they prove the DATA satisfies the
// blueprint in docs/research/CURRICULUM_PLAN.md Section A and is shaped so the
// grand-quiz engine's invariants I4 and I5 remain satisfiable. No database and no
// network — the content modules are plain data.
//
// Located here rather than colocated beside the content because vitest.config.ts
// includes only `src/**/*.test.ts` and `tests/unit/**`, and a colocated test
// under scripts/ would never run. A test that does not run is worse than no test:
// it reads as coverage that is not there.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  computeArithmetic,
  formatArithmetic,
  grandExams,
  pointsFor,
  validateExams,
  EXAM_COUNT,
  EXAM_MIN_TESTS_PER_CODE_WRITE,
  EXAM_OPTIONS_PER_QUESTION,
  EXAM_QUESTION_COUNT,
  EXAM_TOTAL_POINTS,
  EXAM_TYPE_COUNTS,
} from "../../scripts/content/exams/index";

describe("grand-exam content — the blueprint", () => {
  it("passes its own validator with no problems", () => {
    // Printed on failure so the reason is in the output rather than a bare count.
    const problems = validateExams(grandExams);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("is four exams, one per existing week, in week order", () => {
    expect(grandExams).toHaveLength(EXAM_COUNT);
    expect(grandExams.map((e) => e.weekNumber)).toEqual([1, 2, 3, 4]);
  });

  it("attaches every exam by week NUMBER and never by an id", () => {
    for (const exam of grandExams) {
      expect(Number.isInteger(exam.weekNumber)).toBe(true);
      // A `weekId` on the content would be the bug this asserts against: serial
      // ids are reassigned by every reseed.
      expect(exam).not.toHaveProperty("weekId");
      expect(exam).not.toHaveProperty("quizId");
    }
  });

  it("totals 50 questions and 150 points per exam", () => {
    for (const exam of grandExams) {
      expect(exam.questions).toHaveLength(EXAM_QUESTION_COUNT);
      const total = exam.questions.reduce((n, q) => n + pointsFor(q), 0);
      expect(total, `week ${exam.weekNumber}`).toBe(EXAM_TOTAL_POINTS);
    }
  });

  it("totals 200 questions and 600 points across the four exams", () => {
    const a = computeArithmetic(grandExams);
    expect(a.questionTotal).toBe(EXAM_COUNT * EXAM_QUESTION_COUNT);
    expect(a.pointTotal).toBe(EXAM_COUNT * EXAM_TOTAL_POINTS);
    expect(a.counts).toEqual({ mcq: 120, code_fix: 56, code_write: 24 });
    expect(a.points).toEqual({ mcq: 240, code_fix: 168, code_write: 192 });
  });

  it("holds 30 mcq, 14 code_fix and 6 code_write per exam, in that order", () => {
    for (const exam of grandExams) {
      const types = exam.questions.map((q) => q.type);
      expect(types.filter((t) => t === "mcq")).toHaveLength(EXAM_TYPE_COUNTS.mcq);
      expect(types.filter((t) => t === "code_fix")).toHaveLength(EXAM_TYPE_COUNTS.code_fix);
      expect(types.filter((t) => t === "code_write")).toHaveLength(EXAM_TYPE_COUNTS.code_write);

      // The easy-to-hard curve: once code items begin, no mcq may follow.
      const firstCodeFix = types.indexOf("code_fix");
      const firstCodeWrite = types.indexOf("code_write");
      expect(types.lastIndexOf("mcq")).toBeLessThan(firstCodeFix);
      expect(types.lastIndexOf("code_fix")).toBeLessThan(firstCodeWrite);
    }
  });
});

describe("grand-exam content — auto-gradeability", () => {
  it("gives every mcq and code_fix four options with exactly one correct", () => {
    for (const exam of grandExams) {
      for (const q of exam.questions) {
        if (q.type === "code_write") continue;
        expect(q.options, q.questionText).toHaveLength(EXAM_OPTIONS_PER_QUESTION);
        expect(q.options.filter((o) => o.correct), q.questionText).toHaveLength(1);
      }
    }
  });

  it("gives every code_fix a broken artefact to read and a language", () => {
    for (const exam of grandExams) {
      for (const q of exam.questions) {
        if (q.type !== "code_fix") continue;
        expect(q.starterCode.trim().length, q.questionText).toBeGreaterThan(0);
        expect(q.language.trim().length, q.questionText).toBeGreaterThan(0);
      }
    }
  });

  it("gives every code_write at least three tests including an edge case", () => {
    for (const exam of grandExams) {
      for (const q of exam.questions) {
        if (q.type !== "code_write") continue;
        expect(q.tests.length, q.questionText).toBeGreaterThanOrEqual(
          EXAM_MIN_TESTS_PER_CODE_WRITE,
        );
        const hasEdge = q.tests.some((t) =>
          /edge|empty|boundary|none|missing|invalid/i.test(t.name),
        );
        expect(hasEdge, q.questionText).toBe(true);
      }
    }
  });

  it("weights every item to 2, 3 or 8 marks and never zero", () => {
    // Invariant I5 needs a determinable, positive ceiling per item: the grader
    // clamps `awarded` to [0, max_points] and the score is the sum.
    for (const exam of grandExams) {
      for (const q of exam.questions) {
        expect([2, 3, 8]).toContain(pointsFor(q));
        expect(pointsFor(q)).toBeGreaterThan(0);
      }
    }
  });

  it("explains every item, so a result screen can say why", () => {
    for (const exam of grandExams) {
      for (const q of exam.questions) {
        expect(q.explanation.trim().length, q.questionText).toBeGreaterThan(20);
      }
    }
  });
});

describe("grand-exam content — question text as the idempotency key", () => {
  it("has no duplicate stem within an exam", () => {
    for (const exam of grandExams) {
      const texts = exam.questions.map((q) => q.questionText.trim());
      expect(new Set(texts).size, `week ${exam.weekNumber}`).toBe(texts.length);
    }
  });

  it("has no duplicate stem across the four exams either", () => {
    // Not required by the natural key — which is (quiz_id, question_text) — but a
    // stem repeated across two exams is almost always a copy-paste slip.
    const all = grandExams.flatMap((e) => e.questions.map((q) => q.questionText.trim()));
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const text of all) {
      if (seen.has(text)) duplicates.push(text);
      seen.add(text);
    }
    expect(duplicates, duplicates.join("\n")).toEqual([]);
  });
});

describe("grand-exam content — the two test dialects, stated not assumed", () => {
  const byWeek = (n: number) => grandExams.find((e) => e.weekNumber === n)!;

  it("weeks 3 and 4 carry literally executable stdin/stdout pairs", () => {
    for (const weekNumber of [3, 4]) {
      const exam = byWeek(weekNumber);
      for (const q of exam.questions) {
        if (q.type !== "code_write") continue;
        expect(q.language, q.questionText).toBe("javascript");
        // A structural probe here would mean an item the executor cannot grade.
        for (const t of q.tests) {
          expect(t.input.startsWith("probe:"), `${q.questionText} / ${t.name}`).toBe(false);
        }
        // The stdin bridge must be present, or the program reads nothing on
        // either runtime. Mirrors scripts/content/problems/prelude.ts.
        expect(q.starterCode, q.questionText).toContain("readAll");
      }
    }
  });

  it("weeks 1 and 2 carry structural probes, and say so by prefix", () => {
    for (const weekNumber of [1, 2]) {
      const exam = byWeek(weekNumber);
      const expectedLanguage = weekNumber === 1 ? "html" : "css";
      for (const q of exam.questions) {
        if (q.type !== "code_write") continue;
        expect(q.language, q.questionText).toBe(expectedLanguage);
        // The prefix is what lets a grader refuse to hand these to an executor
        // and defer them instead — see the note in scripts/content/exams/index.ts.
        for (const t of q.tests) {
          expect(t.input.includes("probe:"), `${q.questionText} / ${t.name}`).toBe(true);
        }
      }
    }
  });

  it("names every test and never leaves an expected value undefined", () => {
    for (const exam of grandExams) {
      for (const q of exam.questions) {
        if (q.type !== "code_write") continue;
        for (const t of q.tests) {
          expect(t.name.trim().length).toBeGreaterThan(0);
          expect(typeof t.expected).toBe("string");
        }
      }
    }
  });
});

describe("grand-exam content — the printed arithmetic", () => {
  it("prints a human-checkable summary", () => {
    const text = formatArithmetic(computeArithmetic(grandExams));
    // Printed so the arithmetic appears in the test output a human reads, which
    // is the same output the seeder emits before its first insert.
    console.log("\n" + text + "\n");
    expect(text).toContain("200 questions / 600 points");
    for (const weekNumber of [1, 2, 3, 4]) {
      expect(text).toContain(`Week ${weekNumber} —`);
    }
  });
});
