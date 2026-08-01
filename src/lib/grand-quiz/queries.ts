// =============================================================================
// GRAND-QUIZ PERSISTENCE — the ONLY module in this stream that imports @/db.
// -----------------------------------------------------------------------------
// Owner: grand-quiz stream.
//
// Isolating every query here is what makes ./service.ts unit-testable: the tests
// replace this module wholesale (`vi.mock("./queries")`), which is the pattern
// `src/lib/realtime-quiz/queries.ts` established and which `tests/setup.ts`
// requires — a unit test that imports `src/db` is a design smell and the
// DATABASE_URL there points at a deliberately unreachable host.
//
// TWO INVARIANTS ARE ENFORCED IN THIS FILE AND NOWHERE ELSE, because they need
// the database to be enforceable at all:
//
//   I1  `startAttempt` does NOT count existing attempts and then insert. It
//       INSERTS and catches the unique violation from
//       `attempts_student_quiz_number_idx`. Two concurrent Start requests cannot
//       both commit; the loser is handed the winner's row. A read-then-write
//       check has a window between the read and the write, and on a one-attempt
//       exam that window is a second sitting.
//
//   I3  `saveAnswer` and `finalizeAttempt` both take the attempt row
//       `FOR UPDATE` inside their transaction before deciding anything. A
//       concurrent submit therefore BLOCKS on the row lock and, when it proceeds,
//       reads the terminal status the winner committed — so it replays the
//       existing result instead of scoring a second one.
//
// `deadline_at` is written by `startAttempt` and appears in no UPDATE statement
// anywhere in this file. That absence is invariant I2's enforcement; if you are
// about to add one, re-read the invariant first.
//
// Units: milliseconds for durations; `time_limit_minutes` is minutes because the
// column is.
// =============================================================================

import { and, asc, eq, inArray, isNotNull, lte } from "drizzle-orm";

import { db } from "@/db";
import {
  answers as answersTable,
  options as optionsTable,
  questions as questionsTable,
  quizAttempts,
  quizzes as quizzesTable,
} from "@/db/schema";

import { computeDeadlineAt, isExpired } from "./timing";
import { isTerminal } from "./state";
import type { ExamAnswerRow } from "./grading";

// ---------------------------------------------------------------------------
// Row shapes returned to the service (plain data — no Drizzle types leak out)
// ---------------------------------------------------------------------------

export interface GrandQuizRow {
  id: number;
  weekId: number;
  title: string;
  kind: string;
  totalQuestions: number;
  passingScore: number;
  attemptsAllowed: number;
  timeLimitMinutes: number | null;
}

/**
 * A question row WITH its answer key and hidden tests. Server-side only — this
 * shape must never be handed to a client. `src/lib/grand-quiz/payload.ts` is the
 * barrier that strips it.
 */
export interface FullQuestionRow {
  id: number;
  questionText: string;
  type: string;
  orderIndex: number;
  points: number;
  language: string | null;
  starterCode: string | null;
  explanation: string | null;
  tests: unknown;
}

export interface FullOptionRow {
  id: number;
  questionId: number;
  optionText: string;
  orderIndex: number;
  isCorrect: boolean;
}

export interface AttemptRow {
  id: number;
  studentId: number;
  quizId: number;
  status: string;
  score: number;
  totalPossible: number;
  percentage: string;
  attemptNumber: number;
  startedAt: Date;
  submittedAt: Date | null;
  deadlineAt: Date | null;
  autoSubmitted: boolean;
}

export interface StoredAnswerRow {
  questionId: number;
  selectedOptionId: number | null;
  codeAnswer: string | null;
  isCorrect: boolean;
  awarded: number;
  maxPoints: number;
}

/** Everything the submit path needs, read in one go before the transaction. */
export interface AttemptContext {
  attempt: AttemptRow;
  quiz: GrandQuizRow;
  questions: FullQuestionRow[];
  options: FullOptionRow[];
  saved: StoredAnswerRow[];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The grand quiz for a week, or null. Filtered on `kind` so a practice quiz can never be sat as an exam. */
export async function selectGrandQuizForWeek(weekId: number): Promise<GrandQuizRow | null> {
  if (!Number.isInteger(weekId) || weekId <= 0) return null;

  const [row] = await db
    .select({
      id: quizzesTable.id,
      weekId: quizzesTable.weekId,
      title: quizzesTable.title,
      kind: quizzesTable.kind,
      totalQuestions: quizzesTable.totalQuestions,
      passingScore: quizzesTable.passingScore,
      attemptsAllowed: quizzesTable.attemptsAllowed,
      timeLimitMinutes: quizzesTable.timeLimitMinutes,
    })
    .from(quizzesTable)
    .where(and(eq(quizzesTable.weekId, weekId), eq(quizzesTable.kind, "grand")))
    .orderBy(asc(quizzesTable.id))
    .limit(1);

  return row ?? null;
}

export async function selectQuizById(quizId: number): Promise<GrandQuizRow | null> {
  const [row] = await db
    .select({
      id: quizzesTable.id,
      weekId: quizzesTable.weekId,
      title: quizzesTable.title,
      kind: quizzesTable.kind,
      totalQuestions: quizzesTable.totalQuestions,
      passingScore: quizzesTable.passingScore,
      attemptsAllowed: quizzesTable.attemptsAllowed,
      timeLimitMinutes: quizzesTable.timeLimitMinutes,
    })
    .from(quizzesTable)
    .where(eq(quizzesTable.id, quizId))
    .limit(1);
  return row ?? null;
}

export async function selectQuestions(quizId: number): Promise<FullQuestionRow[]> {
  return db
    .select({
      id: questionsTable.id,
      questionText: questionsTable.questionText,
      type: questionsTable.type,
      orderIndex: questionsTable.orderIndex,
      points: questionsTable.points,
      language: questionsTable.language,
      starterCode: questionsTable.starterCode,
      explanation: questionsTable.explanation,
      tests: questionsTable.tests,
    })
    .from(questionsTable)
    .where(eq(questionsTable.quizId, quizId))
    .orderBy(asc(questionsTable.orderIndex), asc(questionsTable.id));
}

export async function selectOptions(questionIds: readonly number[]): Promise<FullOptionRow[]> {
  if (questionIds.length === 0) return [];
  return db
    .select({
      id: optionsTable.id,
      questionId: optionsTable.questionId,
      optionText: optionsTable.optionText,
      orderIndex: optionsTable.orderIndex,
      isCorrect: optionsTable.isCorrect,
    })
    .from(optionsTable)
    .where(inArray(optionsTable.questionId, [...questionIds]))
    .orderBy(asc(optionsTable.orderIndex), asc(optionsTable.id));
}

export async function selectStoredAnswers(attemptId: number): Promise<StoredAnswerRow[]> {
  return db
    .select({
      questionId: answersTable.questionId,
      selectedOptionId: answersTable.selectedOptionId,
      codeAnswer: answersTable.codeAnswer,
      isCorrect: answersTable.isCorrect,
      awarded: answersTable.awarded,
      maxPoints: answersTable.maxPoints,
    })
    .from(answersTable)
    .where(eq(answersTable.attemptId, attemptId));
}

/**
 * One attempt, scoped to its owner in the WHERE clause.
 *
 * `studentId` is part of the predicate rather than checked afterwards: a student
 * must not be able to read — or finalize — somebody else's exam by guessing an
 * attempt id, and a filter applied after the query is one refactor away from
 * being dropped.
 */
export async function selectAttempt(
  attemptId: number,
  studentId: number,
): Promise<AttemptRow | null> {
  if (!Number.isInteger(attemptId) || attemptId <= 0) return null;

  const [row] = await db
    .select(attemptColumns())
    .from(quizAttempts)
    .where(and(eq(quizAttempts.id, attemptId), eq(quizAttempts.studentId, studentId)))
    .limit(1);
  return row ?? null;
}

/** The student's attempt at one quiz. For a grand quiz there is at most one (I1). */
export async function selectAttemptForQuiz(
  studentId: number,
  quizId: number,
): Promise<AttemptRow | null> {
  const [row] = await db
    .select(attemptColumns())
    .from(quizAttempts)
    .where(and(eq(quizAttempts.studentId, studentId), eq(quizAttempts.quizId, quizId)))
    .orderBy(asc(quizAttempts.attemptNumber))
    .limit(1);
  return row ?? null;
}

/**
 * Everything the submit and read paths need, in four queries.
 *
 * Read OUTSIDE any transaction on purpose: the grading of `code_write` items that
 * follows makes network calls to Piston, and holding one of the pool's five
 * connections open across them would starve the cohort. The authoritative status
 * decision happens afterwards, inside `finalizeAttempt`, under a row lock — so a
 * stale read here can only cost this process its wasted grading work, never a
 * student's result (I3).
 */
export async function selectAttemptContext(
  attemptId: number,
  studentId: number,
): Promise<AttemptContext | null> {
  const attempt = await selectAttempt(attemptId, studentId);
  if (!attempt) return null;

  const quiz = await selectQuizById(attempt.quizId);
  if (!quiz) return null;

  const questions = await selectQuestions(quiz.id);
  const options = await selectOptions(questions.map((question) => question.id));
  const saved = await selectStoredAnswers(attempt.id);

  return { attempt, quiz, questions, options, saved };
}

/**
 * In-progress grand-quiz attempts whose stored deadline has passed.
 *
 * The cron sweeper's input (the third expiry trigger). Bounded by `limit` so one
 * invocation cannot run for minutes; the schedule picks up the remainder. Ordered
 * oldest-deadline-first so the longest-abandoned attempt is always finalized
 * first, which is the one a student is most likely to be asking about.
 */
export async function selectExpiredInProgressAttempts(
  now: Date,
  limit: number,
): Promise<{ attemptId: number; studentId: number }[]> {
  return db
    .select({ attemptId: quizAttempts.id, studentId: quizAttempts.studentId })
    .from(quizAttempts)
    .innerJoin(quizzesTable, eq(quizzesTable.id, quizAttempts.quizId))
    .where(
      and(
        eq(quizzesTable.kind, "grand"),
        eq(quizAttempts.status, "in_progress"),
        isNotNull(quizAttempts.deadlineAt),
        lte(quizAttempts.deadlineAt, now),
      ),
    )
    .orderBy(asc(quizAttempts.deadlineAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// I1 — Start
// ---------------------------------------------------------------------------

export type StartAttemptResult =
  /** This call created the attempt. */
  | { created: true; attempt: AttemptRow }
  /** An attempt already existed (this call, or a concurrent one, lost the race). */
  | { created: false; attempt: AttemptRow };

/**
 * Start the one attempt a student gets at a grand quiz — idempotently.
 *
 * WHY THIS IS AN INSERT-AND-CATCH AND NOT A COUNT-THEN-INSERT.
 *
 * `attempt_number` is the literal 1 for every grand-quiz attempt. Combined with
 * `UNIQUE (student_id, quiz_id, attempt_number)` that makes "one attempt, ever" a
 * property the database holds, not a property this function remembers to check.
 * Two Start requests racing — a double-clicked button, two tabs, a retried POST
 * — both compute 1, both insert, and exactly one commits. The loser receives
 * SQLSTATE 23505 and is handed the winner's row, so BOTH callers see the same
 * attempt id. A `SELECT count(*)` first would leave a window in which both reads
 * return 0, and on an exam that window is a second sitting.
 *
 * `started_at` is set explicitly from `now` rather than left to `defaultNow()`, so
 * `deadline_at` is exactly `started_at + limit` (I2). Letting Postgres pick
 * `started_at` while JavaScript picks the deadline would put a few milliseconds
 * of disagreement into the one column the whole timing rule rests on.
 *
 * A unique violation is caught rather than pre-empted, so this needs no lock and
 * does not serialise the cohort's Start requests against each other.
 */
export async function startAttempt(params: {
  studentId: number;
  quiz: GrandQuizRow;
  totalPossible: number;
  now: Date;
}): Promise<StartAttemptResult> {
  const { studentId, quiz, totalPossible, now } = params;
  const deadlineAt = computeDeadlineAt(now, quiz.timeLimitMinutes);

  try {
    const [inserted] = await db
      .insert(quizAttempts)
      .values({
        studentId,
        quizId: quiz.id,
        score: 0,
        totalPossible,
        percentage: "0",
        status: "in_progress",
        // The literal that makes the unique index a one-attempt constraint.
        attemptNumber: 1,
        startedAt: now,
        submittedAt: null,
        deadlineAt,
        autoSubmitted: false,
      })
      .returning(attemptColumns());

    if (inserted) return { created: true, attempt: inserted };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Fall through to the read below — this is the losing racer.
  }

  const existing = await selectAttemptForQuiz(studentId, quiz.id);
  if (!existing) {
    // Only reachable if the winning transaction rolled back between our violation
    // and this read. Surfaced as an error rather than silently retried, because a
    // retry loop here could mask a genuine constraint problem forever.
    throw new Error(
      `[grand-quiz] startAttempt: unique violation for student ${studentId} on quiz ${quiz.id}, but no attempt row exists.`,
    );
  }
  return { created: false, attempt: existing };
}

/** SQLSTATE 23505 — unique_violation. The one error `startAttempt` expects. */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return true;
  // node-postgres wraps some driver errors; check one level of `cause`.
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    return (cause as { code?: unknown }).code === "23505";
  }
  return false;
}

// ---------------------------------------------------------------------------
// I3 — Autosave
// ---------------------------------------------------------------------------

export type SaveAnswerResult =
  | { outcome: "saved" }
  | { outcome: "not_found" }
  /** The attempt is terminal or expired. `status`/`deadlineAt` are returned so the caller can say which. */
  | { outcome: "refused"; status: string; deadlineAt: Date | null };

/**
 * Upsert one answer, refusing once the attempt is closed.
 *
 * The status check and the write are in ONE transaction with the attempt row
 * taken `FOR UPDATE`. That ordering is invariant I3's autosave half: a submit
 * that has already begun holds this lock, so this call waits, then reads
 * `submitted`, then refuses. Checking the status in a separate query first would
 * leave a window in which an answer lands after the exam closed — and a mark
 * written after submit is exactly the audit failure I3 exists to prevent.
 *
 * The write itself is an UPSERT on `answers_attempt_question_idx`, so a student
 * editing question 7 forty times owns one row rather than forty. Grading columns
 * (`awarded`, `max_points`, `is_correct`) are NOT touched here: nothing is scored
 * during the exam, and writing a provisional mark would give a student a live
 * score to optimise against.
 */
export async function saveAnswer(params: {
  attemptId: number;
  studentId: number;
  questionId: number;
  selectedOptionId: number | null;
  codeAnswer: string | null;
  /** The SERVER's instant, passed in so the expiry re-check uses the caller's clock (I2). */
  now: Date;
}): Promise<SaveAnswerResult> {
  const { attemptId, studentId, questionId, selectedOptionId, codeAnswer, now } = params;

  return db.transaction(async (tx): Promise<SaveAnswerResult> => {
    const [locked] = await tx
      .select({
        id: quizAttempts.id,
        status: quizAttempts.status,
        deadlineAt: quizAttempts.deadlineAt,
      })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.id, attemptId), eq(quizAttempts.studentId, studentId)))
      .for("update")
      .limit(1);

    if (!locked) return { outcome: "not_found" };
    if (isTerminal(locked.status)) {
      return { outcome: "refused", status: locked.status, deadlineAt: locked.deadlineAt };
    }
    // Expiry is decided by the caller against the SERVER clock and the STORED
    // deadline, then re-checked here inside the lock, so the two cannot disagree.
    if (isExpired(locked.deadlineAt, now)) {
      return { outcome: "refused", status: locked.status, deadlineAt: locked.deadlineAt };
    }

    await tx
      .insert(answersTable)
      .values({
        attemptId,
        questionId,
        selectedOptionId,
        codeAnswer,
        // Explicit defaults. `awarded`/`maxPoints` stay 0 until grading — an
        // in-progress answer carries no marks.
        isCorrect: false,
        awarded: 0,
        maxPoints: 0,
      })
      .onConflictDoUpdate({
        target: [answersTable.attemptId, answersTable.questionId],
        set: {
          selectedOptionId,
          codeAnswer,
        },
      });

    return { outcome: "saved" };
  });
}

/**
 * Does this option belong to this question, and this question to this quiz?
 *
 * Called before an autosave writes `selected_option_id`. Storing an option from
 * another question would produce a row that renders as somebody else's answer
 * text forever, and storing an answer for a question outside the quiz would break
 * the "one row per quiz question" count that invariant I4 rests on.
 */
export async function validateAnswerTarget(params: {
  quizId: number;
  questionId: number;
  selectedOptionId: number | null;
}): Promise<{ ok: true; type: string } | { ok: false; reason: "unknown_question" | "option_not_in_question" }> {
  const { quizId, questionId, selectedOptionId } = params;

  const [question] = await db
    .select({ id: questionsTable.id, type: questionsTable.type })
    .from(questionsTable)
    .where(and(eq(questionsTable.id, questionId), eq(questionsTable.quizId, quizId)))
    .limit(1);
  if (!question) return { ok: false, reason: "unknown_question" };

  if (selectedOptionId != null) {
    const [option] = await db
      .select({ id: optionsTable.id })
      .from(optionsTable)
      .where(and(eq(optionsTable.id, selectedOptionId), eq(optionsTable.questionId, questionId)))
      .limit(1);
    if (!option) return { ok: false, reason: "option_not_in_question" };
  }

  return { ok: true, type: question.type };
}

// ---------------------------------------------------------------------------
// I3 + I4 + I5 — Finalize
// ---------------------------------------------------------------------------

export type FinalizeResult =
  | { outcome: "finalized"; attempt: AttemptRow }
  /**
   * Somebody else finalized it first. The stored rows are returned so the caller
   * can REPLAY that result rather than score a second one (I3).
   */
  | { outcome: "already_terminal"; attempt: AttemptRow; stored: StoredAnswerRow[] }
  | { outcome: "not_found" };

/**
 * Write the graded exam: one answer row per question, then the attempt totals.
 *
 * THE TRANSACTION, STEP BY STEP, AND WHICH INVARIANT EACH STEP CARRIES:
 *
 *  1. `SELECT ... FOR UPDATE` on the attempt, scoped to its owner. (I3) Any
 *     concurrent submit — the student's click, the client auto-submitter, the
 *     cron sweeper — blocks here. Exactly one proceeds past step 2.
 *
 *  2. Terminal check. (I3) If the row is already `submitted`/`graded`, NOTHING is
 *     written: no re-scoring, no second attempt, no second scoring event. The
 *     stored answers come back so the caller replays the recorded result. This is
 *     what makes three independent expiry triggers safe.
 *
 *  3. INSERT one row per question with ON CONFLICT DO NOTHING. (I4) Every
 *     question in the quiz gets a row, including the 38 the student never
 *     reached; DO NOTHING means a question they DID answer keeps the selection
 *     and code they saved.
 *
 *  4. UPDATE the grading columns only. (I5) `awarded` and `max_points` were
 *     already clamped to [0, maxPoints] by ./grading.ts; `selected_option_id` and
 *     `code_answer` are deliberately absent from every SET clause here, so the
 *     student's saved work is untouched by grading. Rows are grouped by identical
 *     (isCorrect, awarded, maxPoints) triples so a 50-question exam costs a
 *     handful of statements rather than fifty round trips.
 *
 *  5. UPDATE the attempt: score, totals, status, `submitted_at`,
 *     `auto_submitted`. `deadline_at` is NOT in the SET clause and must never be
 *     (I2).
 *
 * Either all of that applies or none of it does — the reason the seam chose
 * node-postgres over neon-http (see src/db/index.ts).
 */
export async function finalizeAttempt(params: {
  attemptId: number;
  studentId: number;
  rows: readonly ExamAnswerRow[];
  score: number;
  totalPossible: number;
  /** Already rounded to the 2dp of `quiz_attempts.percentage`. */
  percentage: number;
  status: "submitted" | "graded";
  autoSubmitted: boolean;
  now: Date;
}): Promise<FinalizeResult> {
  const { attemptId, studentId, rows, score, totalPossible, percentage, status, autoSubmitted, now } =
    params;

  return db.transaction(async (tx): Promise<FinalizeResult> => {
    // 1. Serialise every finalizer for this attempt.
    const [locked] = await tx
      .select(attemptColumns())
      .from(quizAttempts)
      .where(and(eq(quizAttempts.id, attemptId), eq(quizAttempts.studentId, studentId)))
      .for("update")
      .limit(1);

    if (!locked) return { outcome: "not_found" };

    // 2. I3: terminal is terminal. Nothing below runs.
    if (isTerminal(locked.status)) {
      const stored = await tx
        .select({
          questionId: answersTable.questionId,
          selectedOptionId: answersTable.selectedOptionId,
          codeAnswer: answersTable.codeAnswer,
          isCorrect: answersTable.isCorrect,
          awarded: answersTable.awarded,
          maxPoints: answersTable.maxPoints,
        })
        .from(answersTable)
        .where(eq(answersTable.attemptId, attemptId));
      return { outcome: "already_terminal", attempt: locked, stored };
    }

    if (rows.length > 0) {
      // 3. I4: a row for EVERY question. ON CONFLICT DO NOTHING leaves saved work
      //    exactly as the student left it.
      await tx
        .insert(answersTable)
        .values(
          rows.map((row) => ({
            attemptId,
            questionId: row.questionId,
            selectedOptionId: row.selectedOptionId,
            codeAnswer: row.codeAnswer,
            isCorrect: false,
            awarded: 0,
            maxPoints: 0,
          })),
        )
        .onConflictDoNothing({
          target: [answersTable.attemptId, answersTable.questionId],
        });

      // 4. I5: grading columns only, clamped upstream, batched by identical marks.
      for (const group of groupByMarks(rows)) {
        await tx
          .update(answersTable)
          .set({
            isCorrect: group.isCorrect,
            awarded: group.awarded,
            maxPoints: group.maxPoints,
          })
          .where(
            and(
              eq(answersTable.attemptId, attemptId),
              inArray(answersTable.questionId, group.questionIds),
            ),
          );
      }
    }

    // 5. The attempt totals. Note the absence of `deadlineAt` (I2) and of
    //    `startedAt` — an exam's start time is not rewritten by its end.
    const [updated] = await tx
      .update(quizAttempts)
      .set({
        score,
        totalPossible,
        // decimal(5,2) is a string in Drizzle. Fixing the scale here means the
        // value stored equals the one already compared against the threshold.
        percentage: percentage.toFixed(2),
        status,
        submittedAt: now,
        autoSubmitted,
      })
      .where(eq(quizAttempts.id, attemptId))
      .returning(attemptColumns());

    if (!updated) {
      // The row was locked two statements ago, so this cannot happen without the
      // lock having been lost. Roll back rather than report a success we cannot
      // evidence.
      throw new Error(`[grand-quiz] finalizeAttempt: attempt ${attemptId} vanished under its own lock.`);
    }

    return { outcome: "finalized", attempt: updated };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The attempt columns every read in this file selects.
 *
 * An explicit projection rather than `select()`: `select()` would widen silently
 * if the frozen schema ever grew a column, and this stream would start shipping
 * whatever that column was.
 */
function attemptColumns() {
  return {
    id: quizAttempts.id,
    studentId: quizAttempts.studentId,
    quizId: quizAttempts.quizId,
    status: quizAttempts.status,
    score: quizAttempts.score,
    totalPossible: quizAttempts.totalPossible,
    percentage: quizAttempts.percentage,
    attemptNumber: quizAttempts.attemptNumber,
    startedAt: quizAttempts.startedAt,
    submittedAt: quizAttempts.submittedAt,
    deadlineAt: quizAttempts.deadlineAt,
    autoSubmitted: quizAttempts.autoSubmitted,
  };
}

interface MarkGroup {
  isCorrect: boolean;
  awarded: number;
  maxPoints: number;
  questionIds: number[];
}

/**
 * Group graded rows by their (isCorrect, awarded, maxPoints) triple.
 *
 * A 50-question exam has at most a handful of distinct triples — typically
 * "correct 1-mark", "wrong 1-mark", "correct 3-mark", "wrong 3-mark" — so this
 * turns fifty UPDATE round trips into four or five. Latency matters here: the
 * student is watching a spinner at the end of a two-hour exam, and the
 * transaction is holding one of five pooled connections while it runs.
 */
export function groupByMarks(rows: readonly ExamAnswerRow[]): MarkGroup[] {
  const groups = new Map<string, MarkGroup>();
  for (const row of rows) {
    const key = `${row.isCorrect ? 1 : 0}:${row.awarded}:${row.maxPoints}`;
    const existing = groups.get(key);
    if (existing) existing.questionIds.push(row.questionId);
    else {
      groups.set(key, {
        isCorrect: row.isCorrect,
        awarded: row.awarded,
        maxPoints: row.maxPoints,
        questionIds: [row.questionId],
      });
    }
  }
  return [...groups.values()];
}
