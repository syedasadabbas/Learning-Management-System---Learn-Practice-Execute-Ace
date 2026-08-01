// =============================================================================
// REALTIME-QUIZ QUERIES — the ONLY module in this stream that touches the database.
// -----------------------------------------------------------------------------
// Owner: realtime-quiz stream.
//
// WHY the boundary exists at all:
//   1. tests/setup.ts points DATABASE_URL at a deliberately unreachable host, so
//      a unit test that imports `@/db` hangs or throws. Every other stream mocks
//      at its query module; this stream does the same, and ./service.test.ts
//      replaces exactly this file.
//   2. It makes the stream's write surface auditable at a glance: there are NO
//      insert, update or delete statements in this file, and there never may be.
//      A realtime check that persists anything is one refactor away from
//      persisting a mark, and marks are the one thing this kind must not have.
//      ./no-grade-effects.test.ts enforces the read-only property by source scan.
//
// Reads are filtered on `quizzes.kind = 'realtime'` IN THE WHERE CLAUSE, not
// after the fact, so a practice or grand quiz can never be loaded through this
// path — which is what stops the reveal endpoint becoming an answer-key oracle
// for graded work.
// =============================================================================

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  options as optionsTable,
  questions as questionsTable,
  quizzes as quizzesTable,
} from "@/db/schema";

import { REALTIME_KIND } from "./payload";
import type {
  RealtimeOptionRowLike,
  RealtimeQuestionRowLike,
  RealtimeQuizRowLike,
} from "./payload";

/**
 * Every realtime check attached to a week, oldest id first.
 *
 * WEEK-SCOPED, NOT LECTURE-SCOPED. The original reason — "`quizzes` has no
 * `lecture_id` column and the seam is frozen" — IS NO LONGER TRUE: the
 * shared-contracts owner added nullable `quizzes.lecture_id` in migration 0002
 * after this stream reported the gap (see src/db/schema.ts:223 and the
 * 2026-07-30 14:40 CHANGELOG entry). Nothing in this stream reads it yet, so the
 * positional `pick` below is still what selects a check, and a lecture still
 * renders its whole week's checks. Corrected by qa-hardening so the comment stops
 * citing a constraint that has been lifted; wiring `lecture_id` up is open work,
 * not a documented limitation.
 */
export async function selectRealtimeQuizzesForWeek(
  weekId: number,
): Promise<RealtimeQuizRowLike[]> {
  const rows = await db
    .select({
      id: quizzesTable.id,
      weekId: quizzesTable.weekId,
      title: quizzesTable.title,
      kind: quizzesTable.kind,
    })
    .from(quizzesTable)
    .where(and(eq(quizzesTable.weekId, weekId), eq(quizzesTable.kind, REALTIME_KIND)))
    .orderBy(asc(quizzesTable.id));
  return rows;
}

export interface QuestionsAndOptions {
  questions: RealtimeQuestionRowLike[];
  options: RealtimeOptionRowLike[];
}

/**
 * Questions and options for one quiz, answer key included.
 *
 * The key comes back here and is stripped by `toInlineCheck`. Selecting fewer
 * columns would not be safer — `payload.ts` is the barrier, and duplicating it in
 * the query layer would create two places to keep in step.
 */
export async function selectQuestionsAndOptions(quizId: number): Promise<QuestionsAndOptions> {
  const questions = await db
    .select({
      id: questionsTable.id,
      questionText: questionsTable.questionText,
      type: questionsTable.type,
      orderIndex: questionsTable.orderIndex,
      explanation: questionsTable.explanation,
    })
    .from(questionsTable)
    .where(eq(questionsTable.quizId, quizId))
    .orderBy(asc(questionsTable.orderIndex), asc(questionsTable.id));

  if (questions.length === 0) return { questions: [], options: [] };

  const options = await db
    .select({
      id: optionsTable.id,
      questionId: optionsTable.questionId,
      optionText: optionsTable.optionText,
      orderIndex: optionsTable.orderIndex,
      isCorrect: optionsTable.isCorrect,
    })
    .from(optionsTable)
    .where(
      inArray(
        optionsTable.questionId,
        questions.map((q) => q.id),
      ),
    )
    .orderBy(asc(optionsTable.orderIndex), asc(optionsTable.id));

  return { questions, options };
}

export interface AnswerKeyContext {
  question: { id: number; explanation: string | null };
  /** The owning quiz's kind, so the caller can refuse anything but `realtime`. */
  quizKind: string;
  options: { id: number; isCorrect: boolean }[];
}

/**
 * The answer key for ONE question, plus the kind of the quiz that owns it.
 *
 * `quizKind` is returned rather than filtered here on purpose: the caller needs
 * to distinguish "no such question" from "that question belongs to a graded
 * quiz", because the second is an attempted answer-key read against graded work
 * and deserves a distinct refusal rather than a 404.
 */
export async function selectAnswerKeyContext(
  questionId: number,
): Promise<AnswerKeyContext | null> {
  const [row] = await db
    .select({
      id: questionsTable.id,
      explanation: questionsTable.explanation,
      quizKind: quizzesTable.kind,
    })
    .from(questionsTable)
    .innerJoin(quizzesTable, eq(questionsTable.quizId, quizzesTable.id))
    .where(eq(questionsTable.id, questionId))
    .limit(1);

  if (!row) return null;

  const options = await db
    .select({ id: optionsTable.id, isCorrect: optionsTable.isCorrect })
    .from(optionsTable)
    .where(eq(optionsTable.questionId, questionId))
    .orderBy(asc(optionsTable.orderIndex), asc(optionsTable.id));

  return {
    question: { id: row.id, explanation: row.explanation },
    quizKind: row.quizKind,
    options,
  };
}
