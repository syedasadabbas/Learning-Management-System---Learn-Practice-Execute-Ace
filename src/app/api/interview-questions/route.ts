// =============================================================================
// GET  /api/interview-questions  —  "student"
// POST /api/interview-questions  —  "instructor"
// Feature flag: learningEnhancements
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// ANSWER-KEY BARRIER. The list uses `interviewQuestionListColumns`, which does
// not name `sample_answer`, `answer_explanation` or `common_mistakes`. A study
// index that shows the model answer beside the question is not a study index;
// it is reading. `hasSampleAnswer` is computed in SQL so the badge can render
// without the text travelling. The FULL answer lives at
// GET /api/interview-questions/:id, which is a deliberate second request.
//
// PARENTAGE. A question hangs off a lecture OR a week, never both and never
// neither — a CHECK in schema.learning.ts enforces it. The `weekId` and
// `lectureId` query parameters here are FILTERS on that parentage, and
// supplying both is a 422 rather than an empty result, because a query that can
// match nothing by construction is a client bug and an empty list hides it.
// =============================================================================

import { and, asc, count, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { interviewQuestions } from "@/db/schema.learning";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { statusForDbError } from "@/lib/learning/db-errors";
import { paginated, parsePage } from "@/lib/learning/pagination";
import { interviewQuestionListColumns } from "@/lib/learning/projection";
import { createInterviewQuestionSchema, parseBody } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

function isDifficulty(value: string): value is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(value);
}

/**
 * List interview questions, WITHOUT model answers.
 *
 * @param request query: `lectureId`, `weekId` (mutually exclusive),
 *        `difficulty`, `category`, `limit` (1..100, default 20), `offset`
 * @returns 200 `{ items, limit, offset, total }`, each item carrying
 *          `hasSampleAnswer: boolean` in place of the answer
 * @throws 404 the feature flag is off
 * @throws 401 not signed in
 * @throws 422 both `lectureId` and `weekId` supplied, a malformed id, an
 *          unrecognised `difficulty`, or malformed `limit` / `offset`
 */
export async function GET(request: Request): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const params = new URL(request.url).searchParams;

  const pageResult = parsePage(params);
  if (!pageResult.ok) return apiError(422, pageResult.error, pageResult.code);
  const { page } = pageResult;

  const rawLecture = params.get("lectureId");
  const rawWeek = params.get("weekId");
  if (rawLecture !== null && rawWeek !== null) {
    return apiError(
      422,
      "Supply lectureId or weekId, not both — a question has exactly one parent.",
      "conflicting_parents",
    );
  }

  const filters: SQL[] = [];

  if (rawLecture !== null) {
    const lectureId = parsePositiveInt(rawLecture);
    if (lectureId === null) {
      return apiError(422, "lectureId must be a positive integer.", "invalid_lecture_id");
    }
    filters.push(eq(interviewQuestions.lectureId, lectureId));
  }

  if (rawWeek !== null) {
    const weekId = parsePositiveInt(rawWeek);
    if (weekId === null) {
      return apiError(422, "weekId must be a positive integer.", "invalid_week_id");
    }
    filters.push(eq(interviewQuestions.weekId, weekId));
  }

  const rawDifficulty = params.get("difficulty");
  if (rawDifficulty !== null) {
    if (!isDifficulty(rawDifficulty)) {
      return apiError(422, `"${rawDifficulty}" is not a proficiency level.`, "invalid_difficulty");
    }
    filters.push(eq(interviewQuestions.difficultyLevel, rawDifficulty));
  }

  const rawCategory = params.get("category");
  if (rawCategory !== null) {
    // `category` is a free varchar in the schema (the list is editorial), so an
    // exact match is the only filter that cannot silently mean something else.
    if (rawCategory.length === 0 || rawCategory.length > 50) {
      return apiError(422, "category must be 1-50 characters.", "invalid_category");
    }
    filters.push(eq(interviewQuestions.category, rawCategory));
  }

  // `and()` of an empty list is undefined in Drizzle, which is the correct
  // "no WHERE clause" value — but writing it explicitly keeps the two branches
  // from diverging.
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        ...interviewQuestionListColumns,
        hasSampleAnswer: sql<boolean>`${interviewQuestions.sampleAnswer} is not null`,
      })
      .from(interviewQuestions)
      .where(where)
      .orderBy(asc(interviewQuestions.questionOrder), asc(interviewQuestions.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(interviewQuestions).where(where),
  ]);

  return apiOk(paginated(rows, page, totals?.total ?? 0));
}

/**
 * Create an interview question under exactly one parent.
 *
 * No transaction and no counter: there is no denormalized count of interview
 * questions anywhere in the schema, so this writes exactly one row. Said
 * explicitly because every sibling create in this feature IS transactional and
 * the asymmetry would otherwise look like an omission.
 *
 * @param request JSON body validated by `createInterviewQuestionSchema`
 * @returns 201 the created row
 * @throws 404 the feature flag is off
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 `questionOrder` is taken under that parent (one of the two
 *          PARTIAL unique indexes — see schema.learning.ts on why a plain
 *          composite unique would not constrain the NULL half at all)
 * @throws 422 body fails validation, or the named lecture/week does not exist
 *          (foreign-key violation, mapped to 422 rather than 500)
 */
export async function POST(request: Request): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const body = await parseBody(request, createInterviewQuestionSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  try {
    const [row] = await db
      .insert(interviewQuestions)
      .values({
        lectureId: body.value.lectureId ?? null,
        weekId: body.value.weekId ?? null,
        title: body.value.title,
        difficultyLevel: body.value.difficultyLevel,
        category: body.value.category,
        questionText: body.value.questionText,
        context: body.value.context,
        sampleAnswer: body.value.sampleAnswer,
        answerExplanation: body.value.answerExplanation,
        commonMistakes: body.value.commonMistakes,
        followUpQuestions: body.value.followUpQuestions,
        visualWalkthroughHtml: body.value.visualWalkthroughHtml,
        codeExample: body.value.codeExample,
        relatedConcepts: body.value.relatedConcepts,
        relatedPracticeId: body.value.relatedPracticeId,
        questionOrder: body.value.questionOrder,
        createdBy: gate.user.id,
      })
      .returning();

    return apiOk(row, 201);
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 409) {
      return apiError(
        409,
        "Another question already occupies that questionOrder under this parent.",
        "order_taken",
      );
    }
    if (status === 422) {
      return apiError(
        422,
        "The lecture, week or related practice problem named does not exist.",
        "unknown_parent",
      );
    }
    if (status) return apiError(status, "The question was rejected by the database.", "db_rejected");
    throw error;
  }
}
