// =============================================================================
// LEARN CONTENT INDEX + VALIDATOR.
// Owner: interactive-learning stream (scripts/content/learn/** only).
// -----------------------------------------------------------------------------
// PROVENANCE, STATED PLAINLY.
//
//   oop, dbms          — built from docs/research/CURRICULUM_PLAN.md. Slugs,
//                        titles, estimated minutes, step kinds and step subjects
//                        are the plan's; the prose, starter code, diagram frames
//                        and check options are written here. BEGINNER LEVEL ONLY:
//                        the plan lists eighteen modules per track and this is a
//                        starter set of six each.
//   cryptography       — this stream's own outline. The plan file was still marked
//   cybersecurity        CHUNK-2 and covered only oop and dbms when this was
//                        authored, so these two tracks follow the plan's slug
//                        conventions (`crypto-`, `sec-`) and its stated
//                        constraints for them, but not a module list it had not
//                        published. Expect to reconcile when the plan lands.
//
// The plan's remaining four tracks (dsa, prompt-engineering, claude-usage,
// llm-apps) are registered in src/lib/learn/tracks.ts and have NO content here.
// That is deliberate and safe: `listTracks` is driven by published rows, so a
// registered track with no modules simply does not appear on /learn.
//
// VALIDATE BEFORE WRITING, as scripts/seed-content.ts already does. The checks
// below are the ones that would otherwise produce content a student cannot use:
// a duplicate slug (the unique index would reject the second insert mid-seed), a
// check with no correct answer (unanswerable) or two (ambiguous), a lab naming a
// language with no browser runner (a Run button that always fails), and a diagram
// with one frame (an explainer with nothing to step through).
// =============================================================================

import { cryptographyModules } from "./cryptography";
import { cybersecurityModules } from "./cybersecurity";
import { dbmsModules } from "./dbms";
import { oopModules } from "./oop";
import type { SeedModule } from "./types";

/** Every module in the starter set, in track order. */
export const learnModules: SeedModule[] = [
  ...oopModules,
  ...dbmsModules,
  ...cryptographyModules,
  ...cybersecurityModules,
];

/**
 * Languages a lab may declare. Exactly the set with an in-browser runner —
 * `BROWSER_RUNNABLE` in src/lib/execution/browser/index.ts. A lab in any other
 * language would need Piston, and this stream's whole premise is that a concept
 * lab works with no server.
 */
const BROWSER_LANGUAGES = new Set(["javascript", "python", "sql"]);

export interface ValidationIssue {
  module: string;
  step?: number;
  problem: string;
}

/**
 * Check the whole content set. Returns every problem found rather than throwing on
 * the first, so one seed run tells an author everything to fix.
 */
export function validateLearnContent(modules: SeedModule[] = learnModules): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenSlugs = new Set<string>();

  for (const mod of modules) {
    const where = mod.slug;

    if (!mod.slug || !/^[a-z0-9-]+$/.test(mod.slug)) {
      issues.push({ module: where, problem: "slug must be lowercase letters, digits and hyphens" });
    }
    if (seenSlugs.has(mod.slug)) {
      issues.push({
        module: where,
        problem: "duplicate slug — learning_modules.slug is uniquely indexed",
      });
    }
    seenSlugs.add(mod.slug);

    if (!mod.track) issues.push({ module: where, problem: "missing track" });
    if (!mod.title) issues.push({ module: where, problem: "missing title" });
    if (!mod.summary) issues.push({ module: where, problem: "missing summary" });
    if (!(mod.estimatedMinutes > 0)) {
      issues.push({ module: where, problem: "estimatedMinutes must be positive (minutes)" });
    }
    if (mod.steps.length === 0) {
      issues.push({ module: where, problem: "module has no steps" });
    }

    mod.steps.forEach((step, i) => {
      const stepNumber = i + 1;
      const push = (problem: string) => issues.push({ module: where, step: stepNumber, problem });

      if (!step.title) push("missing title");
      if (!step.body || step.body.trim() === "") push("missing body");

      if (step.kind === "lab") {
        if (!BROWSER_LANGUAGES.has(step.language)) {
          push(`language "${step.language}" has no in-browser runner`);
        }
        if (!step.starterCode || step.starterCode.trim() === "") push("lab has no starter code");
        if (!step.goal || step.goal.trim() === "") push("lab has no goal");
      }

      if (step.kind === "check") {
        if (!step.prompt) push("check has no prompt");
        if (step.options.length < 2) push("check needs at least two options");
        const correct = step.options.filter((o) => o.correct === true).length;
        if (correct !== 1) push(`check has ${correct} correct options — exactly one is required`);
        if (!step.explanation) push("check has no explanation");
      }

      if (step.kind === "explain" && step.diagram) {
        if (step.diagram.frames.length < 2) {
          push("a diagram needs at least two frames to be worth stepping through");
        }
        step.diagram.frames.forEach((frame, fi) => {
          if (!frame.label) push(`diagram frame ${fi + 1} has no label`);
          // The caption is what survives when motion is reduced, so it is not
          // optional — without it the static diagram loses the information.
          if (!frame.caption) push(`diagram frame ${fi + 1} has no caption`);
        });
      }
    });
  }

  return issues;
}

/** Counts for the seed script's summary line and for the content test. */
export function learnContentStats(modules: SeedModule[] = learnModules) {
  const byTrack = new Map<string, { modules: number; steps: number }>();
  let labs = 0;
  let checks = 0;
  let explains = 0;

  for (const mod of modules) {
    const entry = byTrack.get(mod.track) ?? { modules: 0, steps: 0 };
    entry.modules += 1;
    entry.steps += mod.steps.length;
    byTrack.set(mod.track, entry);

    for (const step of mod.steps) {
      if (step.kind === "lab") labs += 1;
      else if (step.kind === "check") checks += 1;
      else explains += 1;
    }
  }

  return {
    moduleCount: modules.length,
    stepCount: modules.reduce((sum, m) => sum + m.steps.length, 0),
    labs,
    checks,
    explains,
    tracks: [...byTrack.entries()].map(([track, v]) => ({ track, ...v })),
  };
}

export type { SeedModule, SeedStep } from "./types";
