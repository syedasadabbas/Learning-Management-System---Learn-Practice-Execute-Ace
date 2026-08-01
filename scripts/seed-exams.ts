// =============================================================================
// GRAND-EXAM SEED — idempotent. Safe to run repeatedly against the same database.
// Owner: curriculum-content stream.
// -----------------------------------------------------------------------------
//   npx tsx scripts/seed-exams.ts
//
// A STANDALONE entry point, deliberately. `npm run db:seed` and
// scripts/seed-content.ts are frozen and untouched: the owner's four weeks, their
// lectures, their practice quizzes and their MCQs are not modified by anything
// here. This script only ADDS `quizzes` rows with `kind = 'grand'` plus their
// questions and options, and it refuses to run at all if the weeks it needs are
// not already present.
//
// -----------------------------------------------------------------------------
// IDEMPOTENCY — the natural keys, stated explicitly
// -----------------------------------------------------------------------------
//   exam     -> (week_id, kind = 'grand')   ONE grand exam per week, by
//               definition. Found means RECONCILE the row's settings, never
//               insert a second exam for the same week.
//   question -> (quiz_id, question_text)    The same key scripts/seed.ts uses for
//               practice questions. Found means skip; the validator has already
//               guaranteed no two questions in one exam share their text, so the
//               key is unique within its scope.
//   option   -> inserted only alongside a newly inserted question, so a question
//               can never accumulate a second set of options.
//
// Re-running therefore creates nothing and duplicates nothing.
//
// -----------------------------------------------------------------------------
// WHY QUESTIONS ARE ADDED BUT NOT REWRITTEN
// -----------------------------------------------------------------------------
// An existing question is left exactly as it is, even if the content module has
// since been edited. A grand quiz is a one-attempt graded exam: silently
// restating a question, its options or its marks after a student has sat it would
// change what they were scored against, and `answers.max_points` is copied at
// grade time precisely so that cannot happen. Editing a live exam is an
// instructor action with a record, not a side effect of running a seed script.
// A changed stem seeds as a NEW question; the old one stays and is reported.
// =============================================================================

import "dotenv/config";
import { and, eq, sql as rawSql } from "drizzle-orm";

import { db, pool } from "../src/db";
import { courses, options, questions, quizzes, weeks } from "../src/db/schema";

import {
  assertExamsValid,
  formatArithmetic,
  grandExams,
  pointsFor,
  EXAM_ATTEMPTS_ALLOWED,
  EXAM_PASSING_SCORE_PERCENT,
  EXAM_QUESTION_COUNT,
  EXAM_TIME_LIMIT_MINUTES,
  type SeedExam,
} from "./content/exams/index";

type Counters = {
  quizzesCreated: number;
  quizzesReconciled: number;
  questionsCreated: number;
  questionsExisted: number;
  optionsCreated: number;
};

const counters: Counters = {
  quizzesCreated: 0,
  quizzesReconciled: 0,
  questionsCreated: 0,
  questionsExisted: 0,
  optionsCreated: 0,
};

function line(text: string): void {
  console.log(text);
}

/**
 * Read `--course-id=<n>` (or `--course-id <n>`) from argv, or null when absent.
 *
 * Exists so that seeding exams against a specific course stays possible now that
 * more than one can exist — see the note at the resolution site in `main()`. A
 * present-but-unparseable value THROWS rather than returning null: silently
 * falling back to the active course after the operator explicitly named a
 * different one is how four graded exams end up on the wrong weeks, which is the
 * exact outcome this script's original refusal existed to prevent.
 */
function readCourseIdFlag(argv: readonly string[]): number | null {
  const index = argv.findIndex((arg) => arg === "--course-id" || arg.startsWith("--course-id="));
  if (index === -1) return null;

  const arg = argv[index];
  const raw = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
  const parsed = Number(raw);
  if (!raw || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--course-id needs a positive integer; got ${JSON.stringify(raw ?? null)}.`);
  }
  return parsed;
}

/**
 * Resolve a week by NUMBER, never by id. Serial ids are reassigned by every
 * reseed, so a hardcoded id is how an exam ends up attached to the wrong week.
 *
 * Scoped to a single course: the schema's unique index is on
 * (course_id, week_number), so week 3 is only unambiguous inside a course.
 */
async function resolveWeekId(courseId: number, weekNumber: number): Promise<number> {
  const [week] = await db
    .select({ id: weeks.id, title: weeks.title })
    .from(weeks)
    .where(and(eq(weeks.courseId, courseId), eq(weeks.weekNumber, weekNumber)))
    .limit(1);

  if (!week) {
    throw new Error(
      `Week ${weekNumber} does not exist in course ${courseId}. ` +
        `Run "npm run db:seed" first — this script ADDS exams to the owner's ` +
        `existing weeks and never creates a week itself.`,
    );
  }
  return week.id;
}

/** Find the single grand exam for a week, or create it. Natural key: (week_id, kind). */
async function upsertExamRow(weekId: number, exam: SeedExam): Promise<number> {
  const settings = {
    title: exam.title,
    totalQuestions: exam.questions.length,
    passingScore: EXAM_PASSING_SCORE_PERCENT,
    attemptsAllowed: EXAM_ATTEMPTS_ALLOWED,
    timeLimitMinutes: EXAM_TIME_LIMIT_MINUTES,
  };

  const [existing] = await db
    .select({
      id: quizzes.id,
      title: quizzes.title,
      totalQuestions: quizzes.totalQuestions,
      passingScore: quizzes.passingScore,
      attemptsAllowed: quizzes.attemptsAllowed,
      timeLimitMinutes: quizzes.timeLimitMinutes,
    })
    .from(quizzes)
    .where(and(eq(quizzes.weekId, weekId), eq(quizzes.kind, "grand")))
    .limit(1);

  if (existing) {
    const drifted =
      existing.title !== settings.title ||
      existing.totalQuestions !== settings.totalQuestions ||
      existing.passingScore !== settings.passingScore ||
      existing.attemptsAllowed !== settings.attemptsAllowed ||
      existing.timeLimitMinutes !== settings.timeLimitMinutes;

    if (drifted) {
      // The exam ROW is reconciled where the questions are not, because these
      // five settings are what invariants I1 (one attempt) and I2 (a
      // server-computed deadline) read. A row left at attemptsAllowed = 3
      // would quietly turn the exam into a practice quiz.
      await db.update(quizzes).set(settings).where(eq(quizzes.id, existing.id));
      counters.quizzesReconciled += 1;
      line(`  ~ exam row reconciled: "${settings.title}" (settings had drifted)`);
    } else {
      line(`  = exam row exists: "${existing.title}"`);
    }
    return existing.id;
  }

  const [inserted] = await db
    .insert(quizzes)
    .values({
      weekId,
      kind: "grand",
      // lectureId stays null: a grand exam covers a week, not one lecture.
      lectureId: null,
      ...settings,
    })
    .returning({ id: quizzes.id });

  counters.quizzesCreated += 1;
  line(
    `  + exam row created: "${settings.title}" ` +
      `(${settings.totalQuestions} questions, ${settings.timeLimitMinutes} min, ` +
      `${settings.attemptsAllowed} attempt, pass ${settings.passingScore}%)`,
  );
  return inserted.id;
}

/** Insert any question not already present, with its options. Natural key: (quiz_id, question_text). */
async function seedQuestions(quizId: number, exam: SeedExam): Promise<void> {
  let created = 0;
  let existed = 0;
  let optionRows = 0;

  for (const [index, question] of exam.questions.entries()) {
    const [existing] = await db
      .select({ id: questions.id })
      .from(questions)
      .where(and(eq(questions.quizId, quizId), eq(questions.questionText, question.questionText)))
      .limit(1);

    if (existing) {
      existed += 1;
      continue;
    }

    const [inserted] = await db
      .insert(questions)
      .values({
        quizId,
        questionText: question.questionText,
        type: question.type,
        explanation: question.explanation,
        // The blueprint's easy-to-hard curve IS this column. A student who runs
        // out of time must lose the items they were least likely to earn.
        orderIndex: index + 1,
        points: pointsFor(question),
        language: question.type === "mcq" ? null : question.language,
        starterCode: question.type === "mcq" ? null : question.starterCode,
        // Hidden, graded server-side, and stripped by the payload layer before
        // anything reaches a browser. Null for the auto-graded types.
        tests: question.type === "code_write" ? question.tests : null,
      })
      .returning({ id: questions.id });

    if (question.type === "mcq" || question.type === "code_fix") {
      const rows = question.options.map((option, j) => ({
        questionId: inserted.id,
        optionText: option.text,
        isCorrect: Boolean(option.correct),
        orderIndex: j + 1,
      }));
      await db.insert(options).values(rows);
      optionRows += rows.length;
    }

    created += 1;
  }

  counters.questionsCreated += created;
  counters.questionsExisted += existed;
  counters.optionsCreated += optionRows;

  if (created > 0) line(`  + ${created} question(s) with ${optionRows} option(s)`);
  if (existed > 0) line(`  = ${existed} question(s) already present`);
}

async function main(): Promise<void> {
  // ---- Validate the content BEFORE the first insert -----------------------
  // scripts/seed-content.ts sets this precedent and it matters more here: a
  // half-seeded one-attempt exam would be sat by a student and could not be
  // undone for them.
  const arithmetic = assertExamsValid(grandExams);
  line("Grand-exam content validated: nothing has been written yet.");
  line("");
  line(formatArithmetic(arithmetic));
  line("");

  // ---- Resolve the course, then each week BY NUMBER -----------------------
  const courseRows = await db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .orderBy(courses.id);

  if (courseRows.length === 0) {
    throw new Error(
      'No course exists. Run "npm run db:seed" first — this script adds exams to ' +
        "the owner's existing weeks and creates neither a course nor a week.",
    );
  }
  // WHICH COURSE, NOW THAT THERE CAN BE MORE THAN ONE.
  //
  // This used to refuse outright when it saw a second course, on the sound
  // grounds that attaching four graded exams to the wrong course's weeks is not
  // recoverable by re-running. That refusal was correct when one course existed
  // and became a BUILD BREAK the moment multiple courses shipped: the
  // multi-course feature's own seeder (scripts/seed-course-access.ts) creates two
  // extra courses, after which `npm run db:seed:addons` aborted here — and
  // because that script is an `&&` chain, the problems and learn seeders after it
  // never ran either. One refusal took out three streams' fixtures.
  //
  // Resolved by naming a default instead of guessing. The ACTIVE course is the
  // lowest id, which is not a convenience: it is the same rule
  // `loadCourseAndWeeks` (src/components/course/data.ts:160) and
  // `getActiveCourseId` (src/lib/courses/store.ts:46) already use to decide which
  // course the /weeks surface serves. Seeding exams anywhere else would attach
  // them to weeks no student can currently reach.
  //
  // The original caution is kept, not discarded: --course-id makes a deliberate
  // choice possible, an unknown id is refused by name rather than falling back,
  // and the resolved course is printed before anything is written. When the
  // explicit active-course marker that data.ts:123 carries a TODO for lands, this
  // and the two functions above should all read it instead.
  const requestedId = readCourseIdFlag(process.argv);
  if (requestedId !== null && !courseRows.some((c) => c.id === requestedId)) {
    throw new Error(
      `--course-id=${requestedId} does not exist. Courses present: ` +
        `${courseRows.map((c) => `${c.id} "${c.title}"`).join(", ")}.`,
    );
  }
  const course = requestedId === null ? courseRows[0] : courseRows.find((c) => c.id === requestedId)!;

  if (courseRows.length > 1) {
    line(
      `NOTE: ${courseRows.length} courses exist (${courseRows
        .map((c) => `${c.id} "${c.title}"`)
        .join(", ")}).`,
    );
    line(
      requestedId === null
        ? `      Seeding the ACTIVE course (lowest id), which is what /weeks serves. ` +
            `Pass --course-id=<n> to target another.`
        : `      Seeding course ${requestedId} because --course-id said so.`,
    );
  }
  line(`Course: "${course.title}" (id ${course.id})`);

  for (const exam of grandExams) {
    line("");
    line(`Week ${exam.weekNumber} — ${exam.title}:`);
    const weekId = await resolveWeekId(course.id, exam.weekNumber);
    const quizId = await upsertExamRow(weekId, exam);
    await seedQuestions(quizId, exam);
  }

  // ---- Verify what is actually in the database now ------------------------
  const verification = await db
    .select({
      weekNumber: weeks.weekNumber,
      quizId: quizzes.id,
      title: quizzes.title,
      questionCount: rawSql<number>`count(${questions.id})::int`,
      pointTotal: rawSql<number>`coalesce(sum(${questions.points}), 0)::int`,
    })
    .from(quizzes)
    .innerJoin(weeks, eq(weeks.id, quizzes.weekId))
    .leftJoin(questions, eq(questions.quizId, quizzes.id))
    .where(and(eq(weeks.courseId, course.id), eq(quizzes.kind, "grand")))
    .groupBy(weeks.weekNumber, quizzes.id, quizzes.title)
    .orderBy(weeks.weekNumber);

  line("");
  line("-".repeat(74));
  line("In the database now (grand quizzes only):");
  let dbQuestionTotal = 0;
  let dbPointTotal = 0;
  for (const row of verification) {
    dbQuestionTotal += row.questionCount;
    dbPointTotal += row.pointTotal;
    line(
      `  week ${row.weekNumber}: quiz ${row.quizId} — ${row.questionCount} questions, ` +
        `${row.pointTotal} points — "${row.title}"`,
    );
  }
  line(
    `  TOTAL: ${verification.length} exams, ${dbQuestionTotal} questions, ${dbPointTotal} points ` +
      `(expected ${grandExams.length} / ${arithmetic.questionTotal} / ${arithmetic.pointTotal})`,
  );
  line("");
  line(
    `Created: ${counters.quizzesCreated} exam row(s), ${counters.questionsCreated} question(s), ` +
      `${counters.optionsCreated} option(s). ` +
      `Reconciled: ${counters.quizzesReconciled} exam row(s). ` +
      `Already present: ${counters.questionsExisted} question(s).`,
  );
  line("-".repeat(74));

  // A mismatch here means the database holds content from a different revision
  // — most likely an edited stem seeded alongside its predecessor. Fail loudly:
  // an exam with 51 questions silently changes every student's denominator.
  const problems: string[] = [];
  if (verification.length !== grandExams.length) {
    problems.push(`Expected ${grandExams.length} grand exams, found ${verification.length}.`);
  }
  for (const row of verification) {
    if (row.questionCount !== EXAM_QUESTION_COUNT) {
      problems.push(
        `Week ${row.weekNumber} grand exam has ${row.questionCount} questions, ` +
          `expected ${EXAM_QUESTION_COUNT}.`,
      );
    }
  }
  if (dbPointTotal !== arithmetic.pointTotal) {
    problems.push(`Total points in database is ${dbPointTotal}, expected ${arithmetic.pointTotal}.`);
  }
  if (problems.length > 0) {
    throw new Error(
      "Post-seed verification failed:\n" + problems.map((p) => `  - ${p}`).join("\n"),
    );
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("\nGrand-exam seed FAILED:");
    console.error(error);
    await pool.end().catch(() => {});
    process.exit(1);
  });
