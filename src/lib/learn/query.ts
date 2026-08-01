// =============================================================================
// LEARN QUERIES — the only place this stream reads learning_* tables.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// TWO INVARIANTS ARE ENFORCED IN SQL, NOT IN THE UI.
//
// 1. `published = false` IS A FILTER, NOT A CSS CLASS. Every query below has
//    `eq(learningModules.published, true)` in its WHERE clause, including the
//    single-module fetch and the step-ownership check used by the completion
//    route. Hiding a draft in the view layer leaves it fetchable — the row is
//    already in the payload, and the module's own URL still resolves. Filtering
//    in the query means an unpublished module does not exist as far as a student
//    is concerned: no card, no page, no step to complete.
//
// 2. NO PERCENTAGE IS READ, BECAUSE NONE IS STORED. These queries return step
//    counts and completed-step counts; progress.ts turns them into figures.
//
// Shape: counts are aggregated in SQL so the track page is a fixed number of
// round trips instead of 1 + n. The volume here is small (tens of modules), so
// legibility wins over the last possible join — but a per-module count query in
// a loop is the one shape that gets worse as content is added, and content is
// certain to be added.
// =============================================================================

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { learningModules, learningProgress, learningSteps } from "@/db/schema";

import { parseCheck, parseExplain, parseLab, parseStepKind, publicCheck } from "./expectation";
import { trackDisplay, trackOrder } from "./tracks";
import { LEARN_LEVELS } from "./types";
import type {
  LearnLevel,
  LearnModuleDetail,
  LearnModuleSummary,
  LearnStepView,
  LearnTrackSummary,
} from "./types";

/** Every query is scoped to published modules. One constant, used everywhere. */
const PUBLISHED = eq(learningModules.published, true);

function toInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function validStudentId(studentId: number | null | undefined): number | null {
  return Number.isInteger(studentId) && (studentId as number) > 0 ? (studentId as number) : null;
}

function toLevel(value: unknown): LearnLevel {
  const candidate = String(value ?? "");
  return (LEARN_LEVELS as readonly string[]).includes(candidate)
    ? (candidate as LearnLevel)
    : "beginner";
}

// ---------------------------------------------------------------------------
// /learn — one card per track
// ---------------------------------------------------------------------------

/**
 * Every track that has at least one published module, with this student's
 * progress across it.
 *
 * Two statements, not one: the per-track totals, then the per-track completions.
 * Doing it as a single left join would multiply the step rows by the progress
 * rows and need a `COUNT(DISTINCT ...)` on both sides — correct, but a shape that
 * is easy to break later. Two small aggregates are cheaper to read and to verify.
 */
export async function listTracks(studentId: number | null): Promise<LearnTrackSummary[]> {
  const totals = await db
    .select({
      track: learningModules.track,
      level: learningModules.level,
      moduleCount: sql<number>`count(distinct ${learningModules.id})::int`,
      stepCount: sql<number>`count(${learningSteps.id})::int`,
    })
    .from(learningModules)
    .leftJoin(learningSteps, eq(learningSteps.moduleId, learningModules.id))
    .where(PUBLISHED)
    .groupBy(learningModules.track, learningModules.level);

  const id = validStudentId(studentId);
  const completions = id
    ? await db
        .select({
          track: learningModules.track,
          completed: sql<number>`count(${learningProgress.id})::int`,
        })
        .from(learningProgress)
        .innerJoin(learningSteps, eq(learningSteps.id, learningProgress.stepId))
        .innerJoin(learningModules, eq(learningModules.id, learningSteps.moduleId))
        .where(and(PUBLISHED, eq(learningProgress.studentId, id)))
        .groupBy(learningModules.track)
    : [];

  const completedByTrack = new Map(completions.map((r) => [r.track, toInt(r.completed)]));

  const byTrack = new Map<
    string,
    { moduleCount: number; stepCount: number; levels: Set<string> }
  >();
  for (const row of totals) {
    const entry =
      byTrack.get(row.track) ?? { moduleCount: 0, stepCount: 0, levels: new Set<string>() };
    entry.moduleCount += toInt(row.moduleCount);
    entry.stepCount += toInt(row.stepCount);
    entry.levels.add(String(row.level));
    byTrack.set(row.track, entry);
  }

  return [...byTrack.entries()]
    .map(([track, entry]) => {
      const display = trackDisplay(track);
      return {
        track,
        title: display.title,
        summary: display.summary,
        moduleCount: entry.moduleCount,
        stepCount: entry.stepCount,
        // Clamped: a step deleted after completion would otherwise read as
        // "more completed than exist".
        completedSteps: Math.min(entry.stepCount, completedByTrack.get(track) ?? 0),
        levels: LEARN_LEVELS.filter((l) => entry.levels.has(l)),
      };
    })
    .sort((a, b) => trackOrder(a.track) - trackOrder(b.track) || a.track.localeCompare(b.track));
}

// ---------------------------------------------------------------------------
// /learn/[track] — modules grouped by level
// ---------------------------------------------------------------------------

/** Published modules of one track, each with its step count and this student's completions. */
export async function listTrackModules(
  track: string,
  studentId: number | null,
): Promise<LearnModuleSummary[]> {
  const rows = await db
    .select({
      id: learningModules.id,
      slug: learningModules.slug,
      track: learningModules.track,
      title: learningModules.title,
      summary: learningModules.summary,
      level: learningModules.level,
      estimatedMinutes: learningModules.estimatedMinutes,
      orderIndex: learningModules.orderIndex,
      stepCount: sql<number>`count(${learningSteps.id})::int`,
    })
    .from(learningModules)
    .leftJoin(learningSteps, eq(learningSteps.moduleId, learningModules.id))
    .where(and(PUBLISHED, eq(learningModules.track, track)))
    .groupBy(learningModules.id)
    .orderBy(asc(learningModules.orderIndex), asc(learningModules.id));

  if (rows.length === 0) return [];

  const id = validStudentId(studentId);
  const moduleIds = rows.map((r) => r.id);
  const completions = id
    ? await db
        .select({
          moduleId: learningSteps.moduleId,
          completed: sql<number>`count(${learningProgress.id})::int`,
        })
        .from(learningProgress)
        .innerJoin(learningSteps, eq(learningSteps.id, learningProgress.stepId))
        .where(and(eq(learningProgress.studentId, id), inArray(learningSteps.moduleId, moduleIds)))
        .groupBy(learningSteps.moduleId)
    : [];

  const completedByModule = new Map(completions.map((r) => [r.moduleId, toInt(r.completed)]));

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    track: r.track,
    title: r.title,
    summary: r.summary ?? "",
    level: toLevel(r.level),
    estimatedMinutes: r.estimatedMinutes ?? null,
    orderIndex: r.orderIndex,
    stepCount: toInt(r.stepCount),
    completedSteps: Math.min(toInt(r.stepCount), completedByModule.get(r.id) ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// /learn/[track]/[moduleSlug] — the stepped module
// ---------------------------------------------------------------------------

/**
 * One published module with its steps, ordered by `step_number`, and this
 * student's completed step ids.
 *
 * Returns null for an unknown slug AND for an unpublished one — the caller
 * `notFound()`s on either. A distinct "this module is not published yet" page
 * would confirm the slug exists, which is the small leak that turns a draft
 * curriculum into something guessable.
 */
export async function getModuleBySlug(
  slug: string,
  studentId: number | null,
): Promise<LearnModuleDetail | null> {
  if (typeof slug !== "string" || slug.trim() === "") return null;

  const [module] = await db
    .select({
      id: learningModules.id,
      slug: learningModules.slug,
      track: learningModules.track,
      title: learningModules.title,
      summary: learningModules.summary,
      level: learningModules.level,
      estimatedMinutes: learningModules.estimatedMinutes,
      orderIndex: learningModules.orderIndex,
    })
    .from(learningModules)
    .where(and(PUBLISHED, eq(learningModules.slug, slug.trim())))
    .limit(1);

  if (!module) return null;

  const stepRows = await db
    .select({
      id: learningSteps.id,
      stepNumber: learningSteps.stepNumber,
      kind: learningSteps.kind,
      title: learningSteps.title,
      body: learningSteps.body,
      starterCode: learningSteps.starterCode,
      language: learningSteps.language,
      execution: learningSteps.execution,
      expectation: learningSteps.expectation,
    })
    .from(learningSteps)
    .where(eq(learningSteps.moduleId, module.id))
    .orderBy(asc(learningSteps.stepNumber));

  const steps: LearnStepView[] = stepRows.map((row) => {
    const kind = parseStepKind(row.kind);
    const parsedCheck = kind === "check" ? parseCheck(row.expectation) : null;
    return {
      id: row.id,
      stepNumber: row.stepNumber,
      kind,
      title: row.title,
      body: row.body ?? "",
      starterCode: row.starterCode ?? null,
      language: row.language ?? null,
      execution: row.execution,
      explain: kind === "explain" ? parseExplain(row.expectation) : null,
      lab: kind === "lab" ? parseLab(row.expectation) : null,
      // The answer key is dropped HERE, at the read boundary, so no page can
      // forget to drop it. See learn-payload.test.ts for the round-trip assertion.
      check: parsedCheck ? publicCheck(parsedCheck) : null,
    };
  });

  const id = validStudentId(studentId);
  const stepIds = steps.map((s) => s.id);
  const completedRows =
    id && stepIds.length > 0
      ? await db
          .select({ stepId: learningProgress.stepId })
          .from(learningProgress)
          .where(
            and(eq(learningProgress.studentId, id), inArray(learningProgress.stepId, stepIds)),
          )
      : [];

  return {
    id: module.id,
    slug: module.slug,
    track: module.track,
    title: module.title,
    summary: module.summary ?? "",
    level: toLevel(module.level),
    estimatedMinutes: module.estimatedMinutes ?? null,
    orderIndex: module.orderIndex,
    stepCount: steps.length,
    completedSteps: completedRows.length,
    steps,
    completedStepIds: completedRows.map((r) => r.stepId),
  };
}

// ---------------------------------------------------------------------------
// Support for the completion route
// ---------------------------------------------------------------------------

export interface StepOwnership {
  stepId: number;
  moduleId: number;
  moduleSlug: string;
  kind: string;
  /** Raw jsonb; the caller parses it. */
  expectation: unknown;
  /** Steps in the module, for the response's derived progress. */
  stepCount: number;
}

/**
 * Look up a step, refusing to see one whose module is unpublished.
 *
 * This is the authorization-shaped half of the completion route: `apiGuard`
 * proves the caller is signed in, and this proves the step is one a student is
 * allowed to have reached. Without the `published` predicate here, a student who
 * guessed a numeric step id could accumulate progress inside a draft module.
 */
export async function findPublishedStep(stepId: number): Promise<StepOwnership | null> {
  if (!Number.isInteger(stepId) || stepId <= 0) return null;

  const [row] = await db
    .select({
      stepId: learningSteps.id,
      moduleId: learningSteps.moduleId,
      moduleSlug: learningModules.slug,
      kind: learningSteps.kind,
      expectation: learningSteps.expectation,
    })
    .from(learningSteps)
    .innerJoin(learningModules, eq(learningModules.id, learningSteps.moduleId))
    .where(and(PUBLISHED, eq(learningSteps.id, stepId)))
    .limit(1);

  if (!row) return null;

  const [counted] = await db
    .select({ total: count() })
    .from(learningSteps)
    .where(eq(learningSteps.moduleId, row.moduleId));

  return { ...row, stepCount: toInt(counted?.total) };
}

/** How many steps of `moduleId` this student has completed. */
export async function completedCountForModule(
  studentId: number,
  moduleId: number,
): Promise<number> {
  const id = validStudentId(studentId);
  if (!id || !Number.isInteger(moduleId) || moduleId <= 0) return 0;

  const [row] = await db
    .select({ total: count() })
    .from(learningProgress)
    .innerJoin(learningSteps, eq(learningSteps.id, learningProgress.stepId))
    .where(and(eq(learningProgress.studentId, id), eq(learningSteps.moduleId, moduleId)));

  return toInt(row?.total);
}
