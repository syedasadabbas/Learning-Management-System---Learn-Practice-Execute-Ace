// =============================================================================
// SEED-CATALOGUE VALIDATION — pure. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// `scripts/seed-content.ts` sets the precedent: content is checked BEFORE the
// first INSERT, not discovered to be broken afterwards. A half-seeded bank is
// worse than an unseeded one, because the failures it produces (a problem with no
// hidden tests silently grading everyone as solved, a problem whose language no
// runtime accepts) look like application bugs rather than content bugs.
//
// The rules below encode what the rest of this stream ASSUMES:
//
//   * unique, URL-safe slugs           — the slug is the route parameter and has a
//                                        unique index on it (coding_problems_slug_idx)
//   * at least one VISIBLE and one HIDDEN test per executable problem
//                                      — visible ones are the worked examples the
//                                        problem view shows; without a hidden one,
//                                        Submit grades only what the student can
//                                        already read, which is not a grade
//   * a reference solution on EVERY problem
//                                      — it is the only content a reference-only
//                                        problem has, and the worked answer a
//                                        solved problem reveals (payload.ts)
//   * non-empty hints                  — `hints` is jsonb and the UI renders it one
//                                        at a time; an empty array is a hint button
//                                        that does nothing
//   * a resolvable language on every executable problem
//                                      — resolveLanguage() is the execution
//                                        stream's allow-list; a language it rejects
//                                        is a Run button that can only ever fail.
//                                        HTML and CSS are the sanctioned exception:
//                                        they are graded by structural assertion
//                                        (markup.ts), not by a runtime, so they are
//                                        executable WITHOUT being on that list
//   * `browser` only where a browser backend exists
//                                      — added 2026-07-31. A C or C++ row declaring
//                                        "browser" promises a free local Run the
//                                        platform cannot deliver; see the rule body
//   * readable requirements on every markup test
//                                      — a mistyped requirement keyword would grade
//                                        nothing and mark everyone correct
//   * NO tests on a `none` problem     — advertising tests that nothing will run
//
// This file is imported by the seeder under scripts/content/problems/ and is unit
// tested against synthetic fixtures here, plus against the real catalogue in
// catalogue.test.ts.
// =============================================================================

import type { ExecutionMode, ProficiencyLevel } from "@/db/schema";
import { hasBrowserBackend, resolveLanguage } from "@/lib/execution/languages";

import { isMarkupLanguage, parseMarkupAssertions } from "./markup";
import { isLevel, isProblemTrack, type ProblemTrack } from "./types";

// ---------------------------------------------------------------------------
// Seed shapes
// ---------------------------------------------------------------------------

export interface SeedProblemTest {
  name: string;
  /** Fed to stdin. For SQL this is the setup script — see sqljs-worker.ts. */
  input?: string | null;
  /**
   * Canonical expected stdout. For SQL, `cell|cell` rows — see grading.ts.
   *
   * For HTML and CSS this is NOT stdout: it is a newline-separated requirement
   * list in the small assertion grammar documented in src/lib/problems/markup.ts
   * (`tag`, `no-tag`, `attr`, `text`, `selector`, `declares`). Overloading the
   * column rather than adding a second one keeps the seeded catalogue, the payload
   * builder and the attempt row on one shape; the cost is that "expectedOutput"
   * names two different things, which is why both are stated here and why the
   * validator parses the markup form instead of accepting any string.
   */
  expectedOutput: string;
  hidden: boolean;
}

export interface SeedProblem {
  slug: string;
  title: string;
  /** Markdown. ORIGINAL PROSE ONLY (docs/DECISIONS.md). */
  statement: string;
  track: ProblemTrack;
  level: ProficiencyLevel;
  /** true => interview bank (/interview), false => syllabus practice (/problems). */
  isInterview: boolean;
  /** Passed through the execution allow-list, not to a runtime, when executable. */
  language: string;
  starterCode: string;
  referenceSolution: string;
  hints: string[];
  tags: string[];
  execution: ExecutionMode;
  /** Milliseconds (house rule 5). Clamped to [500, 10 000] by the runner. */
  timeLimitMs?: number;
  tests: SeedProblemTest[];
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_TIME_LIMIT_MS = 500;
const MAX_TIME_LIMIT_MS = 10_000;

export interface CatalogueProblem extends SeedProblem {
  /** Position within its (bank, track, level) group. Assigned by the validator. */
  orderIndex: number;
}

/** One problem found unfit to seed. `where` is the slug when there is a usable one. */
export interface ValidationError {
  where: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Every problem that fails a rule, with the reason. An empty array means the
 * catalogue is safe to seed.
 *
 * Returns errors rather than throwing so a content author sees ALL of them in one
 * run; `assertValidCatalogue` is the throwing wrapper the seeder calls.
 */
export function validateCatalogue(problems: readonly SeedProblem[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenSlugs = new Map<string, number>();

  problems.forEach((problem, index) => {
    const where = problem.slug?.trim() ? problem.slug : `problem #${index}`;
    const fail = (message: string) => errors.push({ where, message });

    // --- slug -------------------------------------------------------------
    const slug = (problem.slug ?? "").trim();
    if (slug === "") fail("slug is empty.");
    else if (!SLUG_PATTERN.test(slug)) {
      fail(`slug "${slug}" must be lowercase alphanumeric words joined by single hyphens.`);
    } else if (slug.length > 120) {
      fail(`slug is ${slug.length} characters; the column holds 120.`);
    } else if (seenSlugs.has(slug)) {
      fail(`slug duplicates problem #${seenSlugs.get(slug)}. Slugs are the route key.`);
    } else {
      seenSlugs.set(slug, index);
    }

    // --- prose ------------------------------------------------------------
    if ((problem.title ?? "").trim() === "") fail("title is empty.");
    else if (problem.title.length > 255) fail("title exceeds the 255-character column.");
    if ((problem.statement ?? "").trim() === "") fail("statement is empty.");

    // --- taxonomy ---------------------------------------------------------
    if (!isProblemTrack(problem.track)) fail(`track "${String(problem.track)}" is not an allow-listed track.`);
    if (!isLevel(problem.level)) fail(`level "${String(problem.level)}" is not a proficiency level.`);
    if (typeof problem.isInterview !== "boolean") fail("isInterview must be a boolean.");

    // --- reference solution, hints, tags ----------------------------------
    if ((problem.referenceSolution ?? "").trim() === "") {
      fail("referenceSolution is empty. Every problem needs a worked answer.");
    }
    if (!Array.isArray(problem.hints) || problem.hints.length === 0) {
      fail("hints is empty. A hint button with nothing behind it is worse than none.");
    } else if (problem.hints.some((h) => typeof h !== "string" || h.trim() === "")) {
      fail("hints contains an empty or non-string entry.");
    }
    if (!Array.isArray(problem.tags) || problem.tags.length === 0) {
      fail("tags is empty; tags are how a student finds a pattern to drill.");
    } else if (problem.tags.some((t) => typeof t !== "string" || t.trim() === "")) {
      fail("tags contains an empty or non-string entry.");
    }

    // --- timing -----------------------------------------------------------
    if (problem.timeLimitMs != null) {
      const ms = problem.timeLimitMs;
      if (!Number.isInteger(ms) || ms < MIN_TIME_LIMIT_MS || ms > MAX_TIME_LIMIT_MS) {
        fail(`timeLimitMs must be an integer in [${MIN_TIME_LIMIT_MS}, ${MAX_TIME_LIMIT_MS}] ms; got ${String(ms)}.`);
      }
    }

    // --- execution and tests ---------------------------------------------
    const executable = problem.execution === "browser" || problem.execution === "piston";
    if (problem.execution !== "browser" && problem.execution !== "piston" && problem.execution !== "none") {
      fail(`execution "${String(problem.execution)}" is not an execution mode.`);
    }

    const tests = Array.isArray(problem.tests) ? problem.tests : [];

    const markup = isMarkupLanguage(problem.language);

    if (executable) {
      if (!markup && resolveLanguage(problem.language) === null) {
        fail(
          `language "${String(problem.language)}" is not on the execution allow-list, ` +
            "so this problem could only ever fail to run. Use execution: \"none\" instead.",
        );
      }

      // --- the latent C++/C gating bug, refused at seed time ------------------
      // `execution: "browser"` promises the student a free, unlimited practice loop
      // on their own machine. For a language with `browserBackend: null` (C, C++,
      // Java, TypeScript) that promise cannot be kept: runCode's "auto" backend
      // resolves to Piston (src/lib/execution/index.ts:110), so every Run is a
      // server call that fails outright while Piston is down. The UI now degrades
      // correctly either way (`requiresServerRuntime` in grading.ts), but a row
      // that lies about where it runs should never reach the database in the first
      // place — and the fix is one word in the seed file.
      if (
        problem.execution === "browser" &&
        !markup &&
        resolveLanguage(problem.language) !== null &&
        !hasBrowserBackend(problem.language)
      ) {
        fail(
          `execution is "browser" but ${String(problem.language)} has no in-browser backend, ` +
            "so every Run would go to Piston and fail whenever it is unreachable. " +
            'Use execution: "piston".',
        );
      }

      // --- markup problems ----------------------------------------------------
      if (markup && problem.execution === "piston") {
        fail(
          `language "${String(problem.language)}" is graded by structural assertion, not by a ` +
            'runtime; Piston has no HTML or CSS runtime. Use execution: "browser".',
        );
      }
      if ((problem.starterCode ?? "").trim() === "") {
        fail("starterCode is empty on an executable problem; the editor would open blank.");
      }
      if (!tests.some((t) => !t.hidden)) {
        fail("no visible test. The problem view has no worked example to show.");
      }
      if (!tests.some((t) => t.hidden)) {
        fail("no hidden test. Submit would grade only what the student can already read.");
      }
    } else if (tests.length > 0) {
      fail("execution is \"none\" but tests are declared; nothing would ever run them.");
    }

    const names = new Set<string>();
    tests.forEach((test, testIndex) => {
      const label = (test.name ?? "").trim();
      if (label === "") fail(`test #${testIndex} has no name.`);
      else if (names.has(label)) fail(`two tests are both named "${label}".`);
      else names.add(label);
      if (typeof test.expectedOutput !== "string") {
        fail(`test "${label}" has no expectedOutput.`);
      } else if (markup && executable) {
        // A markup test's expectedOutput is a REQUIREMENT LIST, not expected stdout.
        // Parsing it here is the whole reason `parseMarkupAssertions` keeps
        // unparseable lines instead of skipping them: a mistyped keyword that was
        // silently dropped would shrink the requirement list, and a test with zero
        // requirements marks every student correct. Caught at seed time, before any
        // student sees it.
        const assertions = parseMarkupAssertions(test.expectedOutput);
        if (assertions.length === 0) {
          fail(`test "${label}" declares no requirements; it would grade nothing.`);
        }
        for (const assertion of assertions) {
          if (!assertion.check) {
            fail(`test "${label}" has an unreadable requirement "${assertion.source}": ${assertion.error}`);
          }
        }
      }
      if (typeof test.hidden !== "boolean") {
        fail(`test "${label}" must state hidden: true or false explicitly.`);
      }
    });
  });

  return errors;
}

/** Throw with every failure listed. Called by the seeder before any INSERT. */
export function assertValidCatalogue(problems: readonly SeedProblem[]): void {
  const errors = validateCatalogue(problems);
  if (errors.length === 0) return;
  const lines = errors.map((e) => `  - ${e.where}: ${e.message}`).join("\n");
  throw new Error(`Coding-problem catalogue is invalid (${errors.length} problem(s)):\n${lines}`);
}

/**
 * Stamp `orderIndex` per (bank, track, level) group, in declaration order.
 *
 * Done here rather than by hand in the catalogue because a hand-maintained
 * orderIndex drifts the moment a problem is inserted in the middle, and the
 * browse index (`coding_problems_browse_idx`) sorts on it.
 */
export function withOrderIndexes(problems: readonly SeedProblem[]): CatalogueProblem[] {
  const counters = new Map<string, number>();
  return problems.map((problem) => {
    const key = `${problem.isInterview ? "i" : "p"}:${problem.track}:${problem.level}`;
    const next = counters.get(key) ?? 0;
    counters.set(key, next + 1);
    return { ...problem, orderIndex: next };
  });
}

/** Counts per track and level, for the seeder's summary and the report. */
export function catalogueCounts(
  problems: readonly SeedProblem[],
): Map<string, { practice: number; interview: number }> {
  const counts = new Map<string, { practice: number; interview: number }>();
  for (const problem of problems) {
    const key = `${problem.track}/${problem.level}`;
    const entry = counts.get(key) ?? { practice: 0, interview: 0 };
    if (problem.isInterview) entry.interview += 1;
    else entry.practice += 1;
    counts.set(key, entry);
  }
  return counts;
}
