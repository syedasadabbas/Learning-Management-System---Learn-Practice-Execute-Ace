// =============================================================================
// GET  /api/lectures/:lectureId/practice-problems  —  "student"
// POST /api/lectures/:lectureId/practice-problems  —  "instructor"
// Feature flag: learningEnhancements
// Owner: the API stream. Paths fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// ANSWER-KEY BARRIER. The list projection is `practiceProblemListColumns` from
// src/lib/learning/projection.ts, which names its columns and does NOT name
// `solution_code`, `solution_explanation` or `solution_screenshot_url`. The
// solution never enters the result set; `solutionAvailable` is computed in SQL
// as `solution_code IS NOT NULL`, so the presence of an answer is reported
// without the answer travelling. See that module for the rule per resource and
// why this is a projection rather than a delete on a fetched object.
// =============================================================================

import { and, asc, count, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { lectures } from "@/db/schema";
import { practiceProblems } from "@/db/schema.learning";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { increment, statusForDbError } from "@/lib/learning/db-errors";
import { paginated, parsePage } from "@/lib/learning/pagination";
import {
  practiceProblemListColumns,
  practiceProblemListItem,
} from "@/lib/learning/projection";
import { createPracticeProblemSchema, parseBody } from "@/lib/learning/schemas";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

function isDifficulty(value: string): value is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(value);
}

/**
 * List the practice problems attached to a lecture, without solutions.
 *
 * @param request query: `difficulty` (beginner|intermediate|advanced),
 *                `limit` (1..100, default 20), `offset`
 * @param ctx     path: `lectureId`
 * @returns 200 `{ items, limit, offset, total }`, each item carrying
 *          `hintCount`, `testCasesCount` and `solutionAvailable` in place of the
 *          arrays and the solution
 * @throws 404 flag off, or the lecture does not exist
 * @throws 401 not signed in
 * @throws 422 malformed `limit` / `offset` / `difficulty`
 * @throws 400 `lectureId` is not a positive integer
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ lectureId: string }> },
): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const lectureId = parsePositiveInt((await ctx.params).lectureId);
  if (lectureId === null) {
    return apiError(400, "lectureId must be a positive integer.", "invalid_id");
  }

  const params = new URL(request.url).searchParams;

  const pageResult = parsePage(params);
  if (!pageResult.ok) return apiError(422, pageResult.error, pageResult.code);
  const { page } = pageResult;

  // An unrecognised filter value is rejected rather than ignored. Silently
  // widening a filter shows a student advanced problems after they asked for
  // beginner ones, and they conclude the filter is broken.
  const rawDifficulty = params.get("difficulty");
  if (rawDifficulty !== null && !isDifficulty(rawDifficulty)) {
    return apiError(
      422,
      `"${rawDifficulty}" is not a proficiency level.`,
      "invalid_difficulty",
    );
  }

  const [parent] = await db
    .select({ id: lectures.id })
    .from(lectures)
    .where(eq(lectures.id, lectureId))
    .limit(1);
  if (!parent) return apiError(404, "Lecture not found.", "not_found");

  const filters: SQL[] = [eq(practiceProblems.lectureId, lectureId)];
  if (rawDifficulty !== null) {
    filters.push(eq(practiceProblems.difficultyLevel, rawDifficulty));
  }
  // `and(...)` over a one-element list is that element; over two it is the
  // conjunction. Built as an array so adding a filter is one push, not a
  // restructure of a nested expression.
  const where = and(...filters);

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        ...practiceProblemListColumns,
        // Presence of the answer, computed by Postgres. The column itself is
        // absent from this projection, so the text never crosses the wire.
        // `sql<boolean>` rather than `isNotNull(...)`: the latter is typed
        // SQL<unknown> in a select projection, which would widen the row type
        // and lose the very guarantee this line exists to give.
        solutionAvailable: sql<boolean>`${practiceProblems.solutionCode} is not null`,
      })
      .from(practiceProblems)
      .where(where)
      .orderBy(asc(practiceProblems.problemOrder), asc(practiceProblems.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(practiceProblems).where(where),
  ]);

  const items = rows.map(({ solutionAvailable, ...row }) =>
    practiceProblemListItem(row, solutionAvailable),
  );

  return apiOk(paginated(items, page, totals?.total ?? 0));
}

/**
 * Create a practice problem under a lecture.
 *
 * Transactional: writes the problem row and increments
 * `lectures.practice_problems_count` together.
 *
 * @param request JSON body validated by `createPracticeProblemSchema`
 * @returns 201 the created row (solution columns included — the CREATOR is
 *          staff, and echoing back what they just sent leaks nothing)
 * @throws 404 flag off, or the lecture does not exist
 * @throws 401 / 403 not signed in / not staff
 * @throws 409 `problemOrder` is taken for this lecture
 * @throws 422 body fails validation, or a CHECK rejects it
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ lectureId: string }> },
): Promise<Response> {
  const off = featureGate("learningEnhancements");
  if (off) return off;

  const gate = await apiGuard("instructor");
  if (!gate.ok) return gate.response;

  const lectureId = parsePositiveInt((await ctx.params).lectureId);
  if (lectureId === null) {
    return apiError(400, "lectureId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, createPracticeProblemSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  try {
    const created = await db.transaction(async (tx) => {
      const [parent] = await tx
        .select({ id: lectures.id })
        .from(lectures)
        .where(eq(lectures.id, lectureId))
        .limit(1);
      if (!parent) return null;

      const [row] = await tx
        .insert(practiceProblems)
        .values({
          lectureId,
          title: body.value.title,
          description: body.value.description,
          difficultyLevel: body.value.difficultyLevel,
          learningObjectives: body.value.learningObjectives,
          problemContext: body.value.problemContext,
          problemStatement: body.value.problemStatement,
          acceptanceCriteria: body.value.acceptanceCriteria,
          starterCode: body.value.starterCode,
          starterLanguage: body.value.starterLanguage,
          hints: body.value.hints,
          solutionCode: body.value.solutionCode,
          solutionExplanation: body.value.solutionExplanation,
          solutionScreenshotUrl: body.value.solutionScreenshotUrl,
          testCases: body.value.testCases,
          execution: body.value.execution,
          problemOrder: body.value.problemOrder,
          createdBy: gate.user.id,
        })
        .returning();

      await tx
        .update(lectures)
        .set({ practiceProblemsCount: increment(lectures.practiceProblemsCount) })
        .where(eq(lectures.id, lectureId));

      return row;
    });

    if (!created) return apiError(404, "Lecture not found.", "not_found");
    return apiOk(created, 201);
  } catch (error) {
    const status = statusForDbError(error);
    if (status === 409) {
      return apiError(
        409,
        "Another problem already occupies that problemOrder for this lecture.",
        "order_taken",
      );
    }
    if (status) return apiError(status, "The problem was rejected by the database.", "db_rejected");
    throw error;
  }
}
