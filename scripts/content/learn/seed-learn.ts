// =============================================================================
// LEARN SEED — idempotent. Safe to run repeatedly against the same database.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
//   npx tsx scripts/content/learn/seed-learn.ts
//
// Lives here rather than in scripts/ because scripts/ at large belongs to other
// streams; scripts/content/learn/** is this stream's grant. It is a standalone
// entry point, so nothing in the shared seed pipeline had to change to accommodate
// it — and `npm run db:seed` is untouched.
//
// IDEMPOTENCY, by natural key, exactly as scripts/seed.ts does it:
//   * module  -> `slug` (uniquely indexed). Found means UPDATE, not a second row.
//   * step    -> `(module_id, step_number)` (uniquely indexed). Same.
// Re-running therefore reconciles content rather than duplicating it, which matters
// because CI seeds before e2e and a developer will run it more than once.
//
// STEPS ARE RECONCILED, NOT APPENDED. If a module's step count shrinks between
// runs, the surplus rows are deleted — otherwise an edited module keeps a trailing
// step that no longer belongs to it. That cascades to `learning_progress` by the
// foreign key's ON DELETE CASCADE, which is the honest outcome: a step that no
// longer exists cannot be completed.
//
// VALIDATE BEFORE WRITING. A validation failure aborts before the first insert, so
// a content typo never lands half a track.
// =============================================================================

import "dotenv/config";
import { and, eq, gt } from "drizzle-orm";

import { db, pool } from "../../../src/db";
import { learningModules, learningSteps } from "../../../src/db/schema";

import { learnContentStats, learnModules, validateLearnContent } from "./index";
import type { SeedModule, SeedStep } from "./types";

/** Derive the `execution` enum value. A lab runs in the browser; nothing else runs. */
function executionFor(step: SeedStep): "browser" | "none" {
  return step.kind === "lab" ? "browser" : "none";
}

/** Assemble the `expectation` jsonb for a step. Shape per kind; parsed on read. */
function expectationFor(step: SeedStep): unknown {
  if (step.kind === "explain") {
    if (!step.diagram) return null;
    return {
      kind: "explain",
      diagramTitle: step.diagram.title,
      frames: step.diagram.frames,
    };
  }
  if (step.kind === "lab") {
    const lab: Record<string, unknown> = { kind: "lab", goal: step.goal };
    if (step.hint) lab.hint = step.hint;
    if (step.setup) lab.setup = step.setup;
    if (step.notProductionReady) lab.notProductionReady = true;
    return lab;
  }
  return {
    kind: "check",
    prompt: step.prompt,
    options: step.options,
    explanation: step.explanation,
  };
}

async function upsertModule(mod: SeedModule, orderIndex: number): Promise<number> {
  const values = {
    slug: mod.slug,
    track: mod.track,
    title: mod.title,
    summary: mod.summary,
    level: mod.level,
    estimatedMinutes: mod.estimatedMinutes,
    orderIndex: mod.orderIndex ?? orderIndex,
    published: mod.published ?? true,
  };

  const [existing] = await db
    .select({ id: learningModules.id })
    .from(learningModules)
    .where(eq(learningModules.slug, mod.slug))
    .limit(1);

  if (existing) {
    await db.update(learningModules).set(values).where(eq(learningModules.id, existing.id));
    return existing.id;
  }

  const [inserted] = await db
    .insert(learningModules)
    .values(values)
    .returning({ id: learningModules.id });
  return inserted.id;
}

async function upsertSteps(moduleId: number, steps: SeedStep[]): Promise<void> {
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const stepNumber = i + 1;
    const values = {
      moduleId,
      stepNumber,
      kind: step.kind,
      title: step.title,
      body: step.body,
      starterCode: step.kind === "lab" ? step.starterCode : null,
      language: step.kind === "lab" ? step.language : null,
      execution: executionFor(step),
      expectation: expectationFor(step),
    };

    const [existing] = await db
      .select({ id: learningSteps.id })
      .from(learningSteps)
      .where(and(eq(learningSteps.moduleId, moduleId), eq(learningSteps.stepNumber, stepNumber)))
      .limit(1);

    if (existing) {
      await db.update(learningSteps).set(values).where(eq(learningSteps.id, existing.id));
    } else {
      await db.insert(learningSteps).values(values);
    }
  }

  // Remove steps beyond the authored count, so shortening a module does not leave
  // an orphan trailing step behind.
  await db
    .delete(learningSteps)
    .where(and(eq(learningSteps.moduleId, moduleId), gt(learningSteps.stepNumber, steps.length)));
}

async function main(): Promise<void> {
  const issues = validateLearnContent();
  if (issues.length > 0) {
    console.error(`\nLearn content failed validation (${issues.length} issue(s)):`);
    for (const issue of issues) {
      const at = issue.step === undefined ? issue.module : `${issue.module} step ${issue.step}`;
      console.error(`  - ${at}: ${issue.problem}`);
    }
    console.error("\nNothing was written.");
    process.exitCode = 1;
    return;
  }

  const stats = learnContentStats();
  console.log(
    `Seeding ${stats.moduleCount} learning modules / ${stats.stepCount} steps ` +
      `(${stats.explains} explain, ${stats.labs} lab, ${stats.checks} check)`,
  );

  // Per-track ordering, so a module's position is its position within its own
  // track rather than its index in the concatenated array.
  const orderByTrack = new Map<string, number>();

  for (const mod of learnModules) {
    const next = orderByTrack.get(mod.track) ?? 0;
    orderByTrack.set(mod.track, next + 1);

    const moduleId = await upsertModule(mod, next);
    await upsertSteps(moduleId, mod.steps);
    console.log(`  ${mod.track}/${mod.slug}: ${mod.steps.length} steps`);
  }

  for (const t of stats.tracks) {
    console.log(`track ${t.track}: ${t.modules} modules, ${t.steps} steps`);
  }
  console.log("Learn content seeded.");
}

main()
  .catch((err) => {
    console.error("Learn seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
