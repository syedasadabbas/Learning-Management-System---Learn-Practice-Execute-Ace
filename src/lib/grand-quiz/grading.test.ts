// =============================================================================
// INVARIANTS I4, I5 and I6 — the marking rules, proved without a database.
// -----------------------------------------------------------------------------
//   I4  one answer row per QUESTION, including the ones never reached.
//   I5  0 <= awarded <= maxPoints, and score = SUM(awarded). No negative marking.
//   I6  provisional iff deferred, and a provisional total can only RISE.
//
// The 50-question, 12-answered case named in I4 is built explicitly below rather
// than mocked, because the failure it prevents — a shrinking denominator turning
// 12/50 into 12/12 — is arithmetic, and arithmetic is exactly what a unit test can
// pin down.
// =============================================================================

import { describe, expect, it } from "vitest";

import { QUIZ_PASS_PERCENT } from "@/lib/contracts/scoring";

import {
  buildExamAnswerRows,
  clampAwarded,
  deferredCandidateCount,
  gradeExam,
  provisionalCeiling,
  summariseExam,
  sumAwarded,
  type CodeOutcome,
  type ExamGradableOption,
  type ExamGradableQuestion,
  type ExamSavedAnswer,
} from "./grading";

// ---------------------------------------------------------------------------
// Fixtures — built, not seeded. `tests/setup.ts` forbids a unit test touching @/db,
// and no grand quiz is seeded yet in any case.
// ---------------------------------------------------------------------------

/** A 50-question MCQ exam, 1 mark each, option `q*10+1` correct. */
function mcqExam(count = 50): {
  questions: ExamGradableQuestion[];
  options: ExamGradableOption[];
} {
  const questions: ExamGradableQuestion[] = [];
  const options: ExamGradableOption[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = index + 1;
    questions.push({ id, type: "mcq", points: 1, orderIndex: index });
    for (let choice = 0; choice < 4; choice += 1) {
      options.push({ id: id * 10 + choice, questionId: id, isCorrect: choice === 0 });
    }
  }
  return { questions, options };
}

/** The correct option id for question `id` in `mcqExam`. */
const correctOption = (id: number): number => id * 10;
/** A wrong option id for question `id`. */
const wrongOption = (id: number): number => id * 10 + 1;

// ---------------------------------------------------------------------------
// I5 — the clamp
// ---------------------------------------------------------------------------

describe("clampAwarded (I5 — no negative marking, no exceeding the ceiling)", () => {
  it("boundary: 0 stays 0", () => {
    expect(clampAwarded(0, 4)).toBe(0);
  });

  it("boundary: maxPoints stays maxPoints", () => {
    expect(clampAwarded(4, 4)).toBe(4);
  });

  it("boundary: above maxPoints is capped at maxPoints", () => {
    // A mis-weighted question must not push a total past `total_possible`.
    expect(clampAwarded(9, 4)).toBe(4);
    expect(clampAwarded(1_000_000, 1)).toBe(1);
  });

  it("a NEGATIVE raw mark becomes 0 — a wrong answer never eats earned marks", () => {
    expect(clampAwarded(-1, 4)).toBe(0);
    expect(clampAwarded(-100, 4)).toBe(0);
  });

  it("a negative maxPoints yields 0, not a negative ceiling", () => {
    // Math.min(x, -3) would otherwise let the clamp itself go negative.
    expect(clampAwarded(2, -3)).toBe(0);
    expect(clampAwarded(-2, -3)).toBe(0);
  });

  it("non-finite input yields 0 rather than NaN reaching an integer column", () => {
    // Both NaN and Infinity mean the grader produced garbage. 0 is chosen over
    // maxPoints because I6 forbids OVERSTATING a total specifically: awarding full
    // marks on a bug inflates a grade, which is the failure the invariant names.
    // Understating is visible and correctable; overstating is the one that later
    // has to be taken back.
    expect(clampAwarded(Number.NaN, 4)).toBe(0);
    expect(clampAwarded(Number.POSITIVE_INFINITY, 4)).toBe(0);
    expect(clampAwarded(Number.NEGATIVE_INFINITY, 4)).toBe(0);
    expect(clampAwarded(2, Number.NaN)).toBe(0);
  });

  it("floors a fractional mark — the column is an integer", () => {
    expect(clampAwarded(2.9, 4)).toBe(2);
  });
});

describe("sumAwarded (I5 — the score is a SUM, never a running total)", () => {
  it("adds up the parts", () => {
    expect(sumAwarded([{ awarded: 3 }, { awarded: 0 }, { awarded: 2 }])).toBe(5);
  });

  it("is 0 for no rows, not NaN", () => {
    expect(sumAwarded([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// I4 — a row for every question
// ---------------------------------------------------------------------------

describe("buildExamAnswerRows (I4 — unanswered questions are recorded, not omitted)", () => {
  it("THE NAMED CASE: 50 questions, 12 answered → 50 rows, 38 blank and awarded 0", () => {
    const { questions, options } = mcqExam(50);
    const saved: ExamSavedAnswer[] = [];
    for (let id = 1; id <= 12; id += 1) {
      saved.push({ questionId: id, selectedOptionId: correctOption(id), codeAnswer: null });
    }

    const rows = buildExamAnswerRows({ questions, options, saved, codeOutcomes: [] });

    expect(rows).toHaveLength(50);
    const blank = rows.filter((row) => row.unanswered);
    expect(blank).toHaveLength(38);
    for (const row of blank) {
      expect(row.selectedOptionId).toBeNull();
      expect(row.codeAnswer).toBeNull();
      expect(row.awarded).toBe(0);
      expect(row.isCorrect).toBe(false);
    }

    // The denominator is the QUIZ, not the payload: 12/50, never 12/12.
    const summary = summariseExam(rows);
    expect(summary.score).toBe(12);
    expect(summary.totalPossible).toBe(50);
    expect(summary.percentage).toBe(24);
    expect(summary.unansweredCount).toBe(38);
  });

  it("emits exactly one row per question id, with no duplicates", () => {
    const { questions, options } = mcqExam(7);
    const rows = buildExamAnswerRows({ questions, options, saved: [], codeOutcomes: [] });
    expect(new Set(rows.map((row) => row.questionId)).size).toBe(7);
  });

  it("cannot be made to emit fewer rows by sending answers for unknown questions", () => {
    // A client shrinking the denominator is the attack; questions drive the loop.
    const { questions, options } = mcqExam(5);
    const rows = buildExamAnswerRows({
      questions,
      options,
      saved: [{ questionId: 9_999, selectedOptionId: 1, codeAnswer: null }],
      codeOutcomes: [],
    });
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.unanswered)).toBe(true);
  });

  it("discards an option belonging to another question instead of scoring it", () => {
    const { questions, options } = mcqExam(3);
    const rows = buildExamAnswerRows({
      questions,
      options,
      // Question 1, but option 20 belongs to question 2.
      saved: [{ questionId: 1, selectedOptionId: 20, codeAnswer: null }],
      codeOutcomes: [],
    });
    const row = rows.find((r) => r.questionId === 1);
    expect(row?.selectedOptionId).toBeNull();
    expect(row?.awarded).toBe(0);
    expect(row?.unanswered).toBe(true);
  });

  it("orders rows by orderIndex regardless of input order", () => {
    const questions: ExamGradableQuestion[] = [
      { id: 3, type: "mcq", points: 1, orderIndex: 2 },
      { id: 1, type: "mcq", points: 1, orderIndex: 0 },
      { id: 2, type: "mcq", points: 1, orderIndex: 1 },
    ];
    const rows = buildExamAnswerRows({ questions, options: [], saved: [], codeOutcomes: [] });
    expect(rows.map((row) => row.questionId)).toEqual([1, 2, 3]);
  });

  it("treats whitespace-only code as unanswered, matching what the runner is sent", () => {
    const questions: ExamGradableQuestion[] = [
      { id: 1, type: "code_write", points: 4, orderIndex: 0 },
    ];
    const rows = buildExamAnswerRows({
      questions,
      options: [],
      saved: [{ questionId: 1, selectedOptionId: null, codeAnswer: "   \n\t " }],
      codeOutcomes: [],
    });
    expect(rows[0]?.unanswered).toBe(true);
    expect(rows[0]?.codeAnswer).toBeNull();
    expect(rows[0]?.awarded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// I5 — the all-wrong exam
// ---------------------------------------------------------------------------

describe("gradeExam (I5 — an all-wrong exam scores exactly 0, not a negative)", () => {
  it("THE NAMED CASE: 50 questions all answered wrongly scores 0", () => {
    const { questions, options } = mcqExam(50);
    const saved: ExamSavedAnswer[] = questions.map((question) => ({
      questionId: question.id,
      selectedOptionId: wrongOption(question.id),
      codeAnswer: null,
    }));

    const graded = gradeExam({ questions, options, saved, codeOutcomes: [] });

    expect(graded.score).toBe(0);
    expect(graded.score).not.toBeLessThan(0);
    expect(graded.percentage).toBe(0);
    expect(graded.passed).toBe(false);
    // Every row is present and every row is a hard zero — nothing subtracted.
    expect(graded.rows).toHaveLength(50);
    expect(graded.rows.every((row) => row.awarded === 0)).toBe(true);
    // And they are NOT 'unanswered': the student answered, and answered wrongly.
    expect(graded.unansweredCount).toBe(0);
  });

  it("a weighted exam sums the weights, so the score is not a correct-answer count", () => {
    const questions: ExamGradableQuestion[] = [
      { id: 1, type: "mcq", points: 1, orderIndex: 0 },
      { id: 2, type: "code_fix", points: 5, orderIndex: 1 },
    ];
    const options: ExamGradableOption[] = [
      { id: 10, questionId: 1, isCorrect: true },
      { id: 11, questionId: 1, isCorrect: false },
      { id: 20, questionId: 2, isCorrect: true },
      { id: 21, questionId: 2, isCorrect: false },
    ];
    const graded = gradeExam({
      questions,
      options,
      saved: [
        { questionId: 1, selectedOptionId: 11, codeAnswer: null },
        { questionId: 2, selectedOptionId: 20, codeAnswer: null },
      ],
      codeOutcomes: [],
    });
    // One of two questions correct, but 5 of 6 marks.
    expect(graded.score).toBe(5);
    expect(graded.totalPossible).toBe(6);
    expect(graded.percentage).toBe(83.33);
    expect(graded.passed).toBe(true);
  });

  it("code_fix auto-grades from the option key and never touches a runner", () => {
    const questions: ExamGradableQuestion[] = [
      { id: 1, type: "code_fix", points: 3, orderIndex: 0 },
    ];
    const options: ExamGradableOption[] = [
      { id: 10, questionId: 1, isCorrect: true },
      { id: 11, questionId: 1, isCorrect: false },
    ];
    const graded = gradeExam({
      questions,
      options,
      saved: [{ questionId: 1, selectedOptionId: 10, codeAnswer: null }],
      // No code outcomes supplied, and none needed.
      codeOutcomes: [],
    });
    expect(graded.rows[0]?.awarded).toBe(3);
    expect(graded.rows[0]?.deferred).toBe(false);
    expect(graded.deferredCount).toBe(0);
  });

  it("uses the frozen pass threshold, never a literal", () => {
    const { questions, options } = mcqExam(10);
    const saved: ExamSavedAnswer[] = questions
      .slice(0, 7)
      .map((question) => ({
        questionId: question.id,
        selectedOptionId: correctOption(question.id),
        codeAnswer: null,
      }));
    const graded = gradeExam({ questions, options, saved, codeOutcomes: [] });
    expect(graded.percentage).toBe(70);
    expect(graded.passed).toBe(graded.percentage >= QUIZ_PASS_PERCENT);
    expect(graded.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// I6 — provisional iff deferred, and it can only rise
// ---------------------------------------------------------------------------

describe("the pass mark comes from the exam row, not the practice threshold", () => {
  // REGRESSION. `summariseExam` compared against QUIZ_PASS_PERCENT (70)
  // unconditionally, while the seeder writes passing_score = 60 for every grand
  // exam and the result card renders that as "Pass mark 60%". A student on 65%
  // therefore saw the badge "Not passed" directly beside the chip "Pass mark 60%"
  // — two contradictory numbers on one screen, on an exam with no retake.
  const twoMcqs: ExamGradableQuestion[] = [
    { id: 1, type: "mcq", points: 1, orderIndex: 0 },
    { id: 2, type: "mcq", points: 1, orderIndex: 1 },
  ];
  const opts: ExamGradableOption[] = [
    { id: 10, questionId: 1, isCorrect: true },
    { id: 11, questionId: 1, isCorrect: false },
    { id: 20, questionId: 2, isCorrect: true },
    { id: 21, questionId: 2, isCorrect: false },
  ];
  /** One of two correct = 50%. Sits below 70 and below 60, above 40. */
  const halfRight: ExamSavedAnswer[] = [
    { questionId: 1, selectedOptionId: 10, codeAnswer: null },
    { questionId: 2, selectedOptionId: 21, codeAnswer: null },
  ];

  function summaryAt(passingScore: number | null | undefined) {
    const rows = buildExamAnswerRows({
      questions: twoMcqs,
      options: opts,
      saved: halfRight,
      codeOutcomes: [],
    });
    return summariseExam(rows, passingScore);
  }

  it("passes at 50% when the exam's own pass mark is 40", () => {
    expect(summaryAt(40).percentage).toBe(50);
    expect(summaryAt(40).passed).toBe(true);
  });

  it("fails at 50% when the exam's own pass mark is 60", () => {
    expect(summaryAt(60).passed).toBe(false);
  });

  it("falls back to the frozen practice threshold when the row has no pass mark", () => {
    // Not a second copy of the threshold: the fallback IS QUIZ_PASS_PERCENT.
    expect(summaryAt(null).passed).toBe(50 >= QUIZ_PASS_PERCENT);
    expect(summaryAt(undefined).passed).toBe(50 >= QUIZ_PASS_PERCENT);
  });

  it("clamps a nonsensical stored pass mark instead of making an exam unpassable", () => {
    // A hand-edited row must not be able to set an impossible bar, or a free one
    // that quietly passes everybody.
    expect(summaryAt(999).passed).toBe(false);
    expect(summaryAt(-5).passed).toBe(true);
    expect(summaryAt(Number.NaN).passed).toBe(50 >= QUIZ_PASS_PERCENT);
  });
});

describe("summariseExam (I6 — a score at submit that never overstates)", () => {
  const codeQuiz: ExamGradableQuestion[] = [
    { id: 1, type: "mcq", points: 1, orderIndex: 0 },
    { id: 2, type: "mcq", points: 1, orderIndex: 1 },
    { id: 3, type: "code_write", points: 8, orderIndex: 2 },
  ];
  const codeOptions: ExamGradableOption[] = [
    { id: 10, questionId: 1, isCorrect: true },
    { id: 11, questionId: 1, isCorrect: false },
    { id: 20, questionId: 2, isCorrect: true },
    { id: 21, questionId: 2, isCorrect: false },
  ];
  const savedBoth: ExamSavedAnswer[] = [
    { questionId: 1, selectedOptionId: 10, codeAnswer: null },
    { questionId: 2, selectedOptionId: 20, codeAnswer: null },
    { questionId: 3, selectedOptionId: null, codeAnswer: "print(1)" },
  ];

  it("an all-MCQ attempt returns a FINAL score at submit", () => {
    const { questions, options } = mcqExam(4);
    const graded = gradeExam({
      questions,
      options,
      saved: questions.map((q) => ({
        questionId: q.id,
        selectedOptionId: correctOption(q.id),
        codeAnswer: null,
      })),
      codeOutcomes: [],
    });
    expect(graded.deferredCount).toBe(0);
    expect(graded.provisional).toBe(false);
    expect(graded.score).toBe(4);
  });

  it("a mixed attempt with a deferred item returns a PROVISIONAL score plus a count", () => {
    const codeOutcomes: CodeOutcome[] = [
      { questionId: 3, kind: "deferred", reason: "runner unavailable", infrastructure: true },
    ];
    const graded = gradeExam({
      questions: codeQuiz,
      options: codeOptions,
      saved: savedBoth,
      codeOutcomes,
    });

    expect(graded.deferredCount).toBe(1);
    expect(graded.provisional).toBe(true);
    // The two MCQs are scored; the deferred item holds 0 rather than 8.
    expect(graded.score).toBe(2);
    expect(graded.totalPossible).toBe(10);
    expect(graded.deferredPointsOutstanding).toBe(8);
    // A deferred item is NOT marked incorrect — it is unknown.
    const deferredRow = graded.rows.find((row) => row.questionId === 3);
    expect(deferredRow?.deferred).toBe(true);
    expect(deferredRow?.awarded).toBe(0);
    expect(deferredRow?.note).toBe("runner unavailable");
  });

  it("provisional_total <= final_total once the deferred item is graded", () => {
    const provisionalGrade = gradeExam({
      questions: codeQuiz,
      options: codeOptions,
      saved: savedBoth,
      codeOutcomes: [
        { questionId: 3, kind: "deferred", reason: "runner unavailable", infrastructure: true },
      ],
    });

    // An instructor later awards the full 8. Same rows, a scored outcome.
    const finalGrade = gradeExam({
      questions: codeQuiz,
      options: codeOptions,
      saved: savedBoth,
      codeOutcomes: [{ questionId: 3, kind: "scored", awarded: 8, note: "8 of 8 passed" }],
    });

    expect(provisionalGrade.score).toBeLessThanOrEqual(finalGrade.score);
    expect(finalGrade.score).toBe(10);
    expect(finalGrade.provisional).toBe(false);
    // The ceiling advertised at submit is exactly what the final total reached.
    expect(provisionalCeiling(provisionalGrade)).toBe(finalGrade.score);
  });

  it("the WORST case for a deferred item is unchanged, never lower", () => {
    // An instructor awarding zero must leave the total exactly where it was.
    const provisionalGrade = gradeExam({
      questions: codeQuiz,
      options: codeOptions,
      saved: savedBoth,
      codeOutcomes: [
        { questionId: 3, kind: "deferred", reason: "runner unavailable", infrastructure: true },
      ],
    });
    const zeroGrade = gradeExam({
      questions: codeQuiz,
      options: codeOptions,
      saved: savedBoth,
      codeOutcomes: [{ questionId: 3, kind: "scored", awarded: 0, note: "0 of 8 passed" }],
    });
    expect(zeroGrade.score).toBe(provisionalGrade.score);
  });

  it("provisional is false when nothing is deferred, even with wrong code", () => {
    const graded = gradeExam({
      questions: codeQuiz,
      options: codeOptions,
      saved: savedBoth,
      codeOutcomes: [{ questionId: 3, kind: "scored", awarded: 0, note: "0 of 8 passed" }],
    });
    expect(graded.deferredCount).toBe(0);
    expect(graded.provisional).toBe(false);
  });

  it("clamps an out-of-range code award rather than trusting the runner's number", () => {
    const graded = gradeExam({
      questions: codeQuiz,
      options: codeOptions,
      saved: savedBoth,
      codeOutcomes: [{ questionId: 3, kind: "scored", awarded: 999, note: null }],
    });
    expect(graded.rows.find((row) => row.questionId === 3)?.awarded).toBe(8);
    expect(graded.score).toBe(10);
    expect(graded.score).toBeLessThanOrEqual(graded.totalPossible);
  });
});

describe("deferredCandidateCount (the stored-attempt estimate)", () => {
  const rows = [
    { type: "mcq", awarded: 0, maxPoints: 1 },
    { type: "code_write", awarded: 0, maxPoints: 8 },
    { type: "code_write", awarded: 8, maxPoints: 8 },
  ];

  it("is 0 for a `graded` attempt — nothing was deferred when it closed", () => {
    expect(deferredCandidateCount("graded", rows)).toBe(0);
  });

  it("counts zero-scored code_write rows for a `submitted` attempt", () => {
    expect(deferredCandidateCount("submitted", rows)).toBe(1);
  });

  it("never counts an option-keyed question, however it scored", () => {
    expect(
      deferredCandidateCount("submitted", [{ type: "mcq", awarded: 0, maxPoints: 5 }]),
    ).toBe(0);
  });

  it("is over-inclusive by design, which keeps a total labelled provisional rather than final", () => {
    // A code answer that genuinely failed every test is counted here too. That is
    // the SAFE direction: the number shown is still the stored sum and can still
    // only rise. Under-counting would print "final" over a total that later moved.
    const failedNotDeferred = [{ type: "code_write", awarded: 0, maxPoints: 4 }];
    expect(deferredCandidateCount("submitted", failedNotDeferred)).toBe(1);
  });
});
