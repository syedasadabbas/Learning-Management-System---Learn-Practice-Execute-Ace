// =============================================================================
// GRAND-EXAM VALIDATOR — runs BEFORE the first insert.
// -----------------------------------------------------------------------------
// scripts/seed-content.ts sets the precedent: content is asserted before the
// database is touched, so a content typo aborts cleanly instead of leaving half
// an exam behind. That matters more here than it did there — a partially seeded
// 50-question one-attempt exam would be sat by a student and could not be undone
// for them.
//
// Every failure is COLLECTED rather than thrown on first sight, so one run tells
// an author everything that is wrong instead of one thing at a time.
// =============================================================================

import {
  EXAM_COUNT,
  EXAM_MIN_TESTS_PER_CODE_WRITE,
  EXAM_OPTIONS_PER_QUESTION,
  EXAM_POINTS,
  EXAM_QUESTION_COUNT,
  EXAM_TOTAL_POINTS,
  EXAM_TYPE_COUNTS,
  EXAM_TYPE_SEQUENCE,
  type SeedExam,
  type SeedExamQuestion,
} from "./types";

export type ExamArithmetic = {
  weekNumber: number;
  title: string;
  counts: Record<SeedExamQuestion["type"], number>;
  points: Record<SeedExamQuestion["type"], number>;
  questionTotal: number;
  pointTotal: number;
};

export type ExamsArithmetic = {
  perExam: ExamArithmetic[];
  examCount: number;
  questionTotal: number;
  pointTotal: number;
  counts: Record<SeedExamQuestion["type"], number>;
  points: Record<SeedExamQuestion["type"], number>;
};

const TYPES: SeedExamQuestion["type"][] = ["mcq", "code_fix", "code_write"];

function zero(): Record<SeedExamQuestion["type"], number> {
  return { mcq: 0, code_fix: 0, code_write: 0 };
}

/** Marks for one item. Derived from `type`, never authored per question. */
export function pointsFor(question: SeedExamQuestion): number {
  return EXAM_POINTS[question.type];
}

/** The arithmetic, computed from the content rather than restated by hand. */
export function computeArithmetic(exams: SeedExam[]): ExamsArithmetic {
  const perExam = exams.map((exam) => {
    const counts = zero();
    const points = zero();
    for (const q of exam.questions) {
      counts[q.type] += 1;
      points[q.type] += pointsFor(q);
    }
    return {
      weekNumber: exam.weekNumber,
      title: exam.title,
      counts,
      points,
      questionTotal: exam.questions.length,
      pointTotal: TYPES.reduce((n, t) => n + points[t], 0),
    };
  });

  const counts = zero();
  const points = zero();
  for (const e of perExam) {
    for (const t of TYPES) {
      counts[t] += e.counts[t];
      points[t] += e.points[t];
    }
  }

  return {
    perExam,
    examCount: exams.length,
    questionTotal: perExam.reduce((n, e) => n + e.questionTotal, 0),
    pointTotal: perExam.reduce((n, e) => n + e.pointTotal, 0),
    counts,
    points,
  };
}

/**
 * Every rule the blueprint and docs/GRAND_QUIZ_INVARIANTS.md require of the
 * DATA. Returns the problems; the caller decides whether to throw.
 *
 * Note which invariants this makes satisfiable rather than enforces:
 *   I4 (every question gets an answer row) needs `totalQuestions` to equal the
 *       real question count, so the submit path can enumerate them — checked here.
 *   I5 (0 <= awarded <= max_points, score is a sum) needs every item to carry
 *       points > 0 and a determinable maximum — checked here.
 */
export function validateExams(exams: SeedExam[]): string[] {
  const problems: string[] = [];

  if (exams.length !== EXAM_COUNT) {
    problems.push(`Expected ${EXAM_COUNT} exams (one per existing week), found ${exams.length}.`);
  }

  const weekNumbers = exams.map((e) => e.weekNumber);
  const uniqueWeeks = new Set(weekNumbers);
  if (uniqueWeeks.size !== weekNumbers.length) {
    problems.push(`Two exams claim the same week number: [${weekNumbers.join(", ")}].`);
  }
  for (const n of weekNumbers) {
    if (!Number.isInteger(n) || n < 1) {
      problems.push(`Invalid week number ${n}: exams attach to a week by NUMBER, resolved at runtime.`);
    }
  }

  for (const exam of exams) {
    const where = `week ${exam.weekNumber} ("${exam.title}")`;

    if (!exam.title.trim()) problems.push(`${where}: empty exam title.`);

    if (exam.questions.length !== EXAM_QUESTION_COUNT) {
      problems.push(
        `${where}: ${exam.questions.length} questions, expected ${EXAM_QUESTION_COUNT}.`,
      );
    }

    // --- type counts -------------------------------------------------------
    const counts = zero();
    for (const q of exam.questions) counts[q.type] += 1;
    for (const t of TYPES) {
      if (counts[t] !== EXAM_TYPE_COUNTS[t]) {
        problems.push(`${where}: ${counts[t]} ${t} items, expected ${EXAM_TYPE_COUNTS[t]}.`);
      }
    }

    // --- difficulty curve: the ORDER, not only the counts ------------------
    exam.questions.forEach((q, i) => {
      const expected = EXAM_TYPE_SEQUENCE[i];
      if (expected && q.type !== expected) {
        problems.push(
          `${where}: item ${i + 1} is ${q.type}, expected ${expected} — the easy-to-hard curve is out of order.`,
        );
      }
    });

    // --- point total -------------------------------------------------------
    const pointTotal = exam.questions.reduce((n, q) => n + pointsFor(q), 0);
    if (pointTotal !== EXAM_TOTAL_POINTS) {
      problems.push(`${where}: ${pointTotal} points, expected ${EXAM_TOTAL_POINTS}.`);
    }

    // --- duplicate stems within an exam ------------------------------------
    const seen = new Map<string, number>();
    exam.questions.forEach((q, i) => {
      const key = q.questionText.trim();
      const first = seen.get(key);
      if (first !== undefined) {
        // Question text is the idempotency natural key, so a duplicate would
        // make the second item silently un-seedable rather than merely ugly.
        problems.push(
          `${where}: items ${first + 1} and ${i + 1} share the same question text — ` +
            `that text is the idempotency key, so the second would never be inserted.`,
        );
      } else {
        seen.set(key, i);
      }
    });

    // --- per-item rules ----------------------------------------------------
    exam.questions.forEach((q, i) => {
      const at = `${where}: item ${i + 1} (${q.type})`;

      if (!q.questionText.trim()) problems.push(`${at}: empty question text.`);
      if (!q.explanation.trim()) problems.push(`${at}: missing explanation.`);
      if (pointsFor(q) <= 0) problems.push(`${at}: points must be > 0.`);
      if (pointsFor(q) !== EXAM_POINTS[q.type]) {
        problems.push(`${at}: ${pointsFor(q)} points, expected ${EXAM_POINTS[q.type]}.`);
      }

      if (q.type === "mcq" || q.type === "code_fix") {
        if (q.options.length !== EXAM_OPTIONS_PER_QUESTION) {
          problems.push(`${at}: ${q.options.length} options, expected ${EXAM_OPTIONS_PER_QUESTION}.`);
        }
        const correct = q.options.filter((o) => o.correct).length;
        if (correct !== 1) {
          // Zero correct options makes the item unearnable; two makes the grade
          // depend on which one the grader happens to compare against first.
          problems.push(`${at}: ${correct} correct options, expected exactly 1.`);
        }
        const texts = q.options.map((o) => o.text.trim());
        if (new Set(texts).size !== texts.length) {
          problems.push(`${at}: duplicate option text.`);
        }
        if (texts.some((t) => !t)) problems.push(`${at}: empty option text.`);
      }

      if (q.type === "code_fix") {
        if (!q.starterCode.trim()) problems.push(`${at}: code_fix needs the broken artefact in starterCode.`);
        if (!q.language.trim()) problems.push(`${at}: code_fix needs a language.`);
      }

      if (q.type === "code_write") {
        if (!q.language.trim()) problems.push(`${at}: code_write needs a language.`);
        if (!q.starterCode.trim()) problems.push(`${at}: code_write needs a starter skeleton.`);
        if (q.tests.length < EXAM_MIN_TESTS_PER_CODE_WRITE) {
          problems.push(
            `${at}: ${q.tests.length} tests, expected at least ${EXAM_MIN_TESTS_PER_CODE_WRITE} ` +
              `including an edge case.`,
          );
        }
        const names = q.tests.map((t) => t.name.trim());
        if (new Set(names).size !== names.length) problems.push(`${at}: duplicate test name.`);
        q.tests.forEach((t, j) => {
          if (!t.name.trim()) problems.push(`${at}: test ${j + 1} has no name.`);
          // `input` may legitimately be empty (an empty-input edge case), but
          // `expected` may not: a test with nothing to compare against passes
          // vacuously and would hand out 8 marks for nothing.
          if (t.expected === undefined || t.expected === null) {
            problems.push(`${at}: test "${t.name}" has no expected value.`);
          }
        });
        // The blueprint requires an edge case per item. It cannot be detected
        // mechanically, so it is asserted by naming convention instead: at least
        // one test name marked as the edge.
        if (!q.tests.some((t) => /edge|empty|boundary|none|missing|invalid/i.test(t.name))) {
          problems.push(
            `${at}: no test name identifies an edge case (expected one of ` +
              `edge/empty/boundary/none/missing/invalid).`,
          );
        }
      }
    });
  }

  return problems;
}

/** Human-checkable arithmetic, printed by both the seeder and the test. */
export function formatArithmetic(a: ExamsArithmetic): string {
  const lines: string[] = [];
  const pad = (s: string | number, n: number) => String(s).padStart(n);

  lines.push("Grand-exam arithmetic (computed from the content, not restated):");
  lines.push("");
  for (const e of a.perExam) {
    lines.push(`  Week ${e.weekNumber} — ${e.title}`);
    lines.push(
      `    mcq        ${pad(e.counts.mcq, 3)} x 2 = ${pad(e.points.mcq, 3)}` +
        `   code_fix ${pad(e.counts.code_fix, 3)} x 3 = ${pad(e.points.code_fix, 3)}` +
        `   code_write ${pad(e.counts.code_write, 3)} x 8 = ${pad(e.points.code_write, 3)}`,
    );
    lines.push(
      `    questions  ${pad(e.questionTotal, 3)} (expected ${EXAM_QUESTION_COUNT})` +
        `   points ${pad(e.pointTotal, 4)} (expected ${EXAM_TOTAL_POINTS})` +
        `   pass at ${Math.round(EXAM_TOTAL_POINTS * 0.6)} pts = 60%`,
    );
  }
  lines.push("");
  lines.push(
    `  TOTAL  ${a.examCount} exams` +
      `  ·  mcq ${a.counts.mcq} (${a.points.mcq} pts)` +
      `  ·  code_fix ${a.counts.code_fix} (${a.points.code_fix} pts)` +
      `  ·  code_write ${a.counts.code_write} (${a.points.code_write} pts)`,
  );
  lines.push(
    `  TOTAL  ${a.questionTotal} questions / ${a.pointTotal} points` +
      `  (expected ${EXAM_COUNT * EXAM_QUESTION_COUNT} / ${EXAM_COUNT * EXAM_TOTAL_POINTS})`,
  );
  return lines.join("\n");
}

/** Throws with every problem listed. Used by the seeder before its first insert. */
export function assertExamsValid(exams: SeedExam[]): ExamsArithmetic {
  const problems = validateExams(exams);
  if (problems.length > 0) {
    throw new Error(
      `Grand-exam content is invalid (${problems.length} problem(s)); nothing was written:\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
  }
  return computeArithmetic(exams);
}
