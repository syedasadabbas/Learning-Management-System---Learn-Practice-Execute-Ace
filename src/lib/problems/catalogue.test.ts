// =============================================================================
// UNIT TESTS — the REAL seed catalogue. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// validate.test.ts exercises the validator against synthetic fixtures. This file
// runs it against the content that will actually be inserted, so a broken problem
// fails `npm test` rather than failing halfway through a run against a live
// database — the failure mode scripts/seed-content.ts's own pre-flight checks exist
// to prevent.
//
// It imports the seed data by relative path because `scripts/` is outside the "@/"
// alias. That is the one place this stream reaches out of `src/`, and it is a
// type-and-data import with no side effects: the catalogue modules touch no
// database, which is what lets them run under tests/setup.ts's prohibition.
// =============================================================================

import { describe, expect, it } from "vitest";

import { problemCatalogue } from "../../../scripts/content/problems/index";

import { hasBrowserBackend } from "@/lib/execution/languages";

import { catalogueCounts, validateCatalogue, withOrderIndexes } from "./validate";
import { isExecutable } from "./grading";
import {
  evaluateMarkupTest,
  isMarkupLanguage,
  parseMarkupAssertions,
  splitMarkupBundle,
  type MarkupLanguage,
} from "./markup";
import { LEVELS, PROBLEM_TRACKS, type ProblemTrack } from "./types";

/** Slug prefix per track, matching the convention in docs/research/CURRICULUM_PLAN.md. */
const SLUG_PREFIX: Record<ProblemTrack, string> = {
  javascript: "js-",
  python: "py-",
  sql: "sql-",
  c: "c-",
  cpp: "cpp-",
  html: "html-",
  css: "css-",
  "agentic-ai": "ai-",
};

/**
 * Tracks that do not yet carry the full five problems per level.
 *
 * TODO(content): the `c` track was added 2026-07-31 with SIX problems — one practice
 * and one interview at each level — and not the five per level every other track
 * carries. That is a deliberate, temporary shortfall, and the reason is written at
 * the head of scripts/content/problems/c.ts: no C toolchain was available to the
 * author, so every reference solution in that file is UNCOMPILED, and padding the
 * track to fifteen would have multiplied that risk rather than the value. Author the
 * remaining problems against a live Piston instance and delete this exemption; do
 * not widen it to another track.
 */
const UNDER_QUOTA_TRACKS = new Set<ProblemTrack>(["c"]);

/** Minimum problems per (track, level) for a track that is not exempted above. */
const QUOTA_PER_LEVEL = 5;

describe("the seeded catalogue", () => {
  it("passes every validation rule the seeder enforces", () => {
    // Listed, not counted: a failure here should say WHICH problem and why.
    expect(validateCatalogue(problemCatalogue)).toEqual([]);
  });

  it("covers every track at every level", () => {
    const counts = catalogueCounts(problemCatalogue);
    for (const track of PROBLEM_TRACKS) {
      for (const level of LEVELS) {
        const cell = counts.get(`${track}/${level}`);
        expect(cell, `${track}/${level} has no problems`).toBeDefined();
        // The brief asks for roughly 5-8 per track per level; the starter set is 5.
        // An exempted track still has to have SOMETHING at every level and to fill
        // both banks (asserted below) — the exemption relaxes the quota, not the
        // requirement that the track works.
        const quota = UNDER_QUOTA_TRACKS.has(track) ? 2 : QUOTA_PER_LEVEL;
        expect(cell!.practice + cell!.interview, `${track}/${level}`).toBeGreaterThanOrEqual(quota);
      }
    }
  });

  it("populates BOTH banks for every track and level", () => {
    // /problems and /interview render from the same table. A track with an empty
    // interview bank would give a student an empty page rather than a drill.
    const counts = catalogueCounts(problemCatalogue);
    for (const track of PROBLEM_TRACKS) {
      for (const level of LEVELS) {
        const cell = counts.get(`${track}/${level}`)!;
        expect(cell.practice, `${track}/${level} practice`).toBeGreaterThan(0);
        expect(cell.interview, `${track}/${level} interview`).toBeGreaterThan(0);
      }
    }
  });

  it("prefixes every slug with its track, so slugs cannot collide across tracks", () => {
    for (const problem of problemCatalogue) {
      expect(problem.slug.startsWith(SLUG_PREFIX[problem.track]), problem.slug).toBe(true);
    }
  });

  it("gives every executable problem at least two visible and two hidden tests", () => {
    for (const problem of problemCatalogue) {
      if (!isExecutable(problem.execution)) continue;
      const visible = problem.tests.filter((t) => !t.hidden).length;
      const hidden = problem.tests.filter((t) => t.hidden).length;
      expect(visible, `${problem.slug} visible tests`).toBeGreaterThanOrEqual(2);
      expect(hidden, `${problem.slug} hidden tests`).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps every problem's test count within one submit's Piston budget", () => {
    // Each test is one Piston call and the per-user burst window is 6 runs / 10 s
    // (src/lib/execution/rate-limit.ts). A problem with more tests than that would
    // make every submit end in `rate_limited` rather than a verdict.
    for (const problem of problemCatalogue) {
      expect(problem.tests.length, problem.slug).toBeLessThanOrEqual(6);
    }
  });

  it("never gives a VISIBLE sql test an empty expected result", () => {
    // The two SQL runtimes diverge on the empty case and only there: sql.js prints
    // "Statement executed. Rows changed: 0." where sqlite3 prints nothing at all.
    // Grading happens on the server so a hidden empty case is fine, but a VISIBLE
    // one would fail in the browser during Run while passing on Submit — the worst
    // failure mode, because the student has no way to see why.
    for (const problem of problemCatalogue) {
      if (problem.language !== "sql") continue;
      for (const test of problem.tests) {
        if (test.hidden) continue;
        expect(test.expectedOutput.trim(), `${problem.slug} / ${test.name}`).not.toBe("");
      }
    }
  });

  it("gives reference-only problems no tests, and only markup problems may be one", () => {
    for (const problem of problemCatalogue) {
      if (isExecutable(problem.execution)) continue;
      expect(problem.tests, problem.slug).toEqual([]);
      // HTML and CSS remain the only reference-only tracks. Since 2026-07-31 they are
      // no longer ENTIRELY reference-only — the ones whose requirement is a checkable
      // structure carry assertions — but a `none` problem in any other track would
      // mean a language whose runtime we dropped, which is a regression.
      expect(["html", "css"]).toContain(problem.track);
    }
  });

  // -------------------------------------------------------------------------
  // Markup problems: the reference solution must satisfy its own requirements.
  //
  // THIS IS THE MOST VALUABLE TEST IN THIS FILE for the markup work, and it is
  // cheap only because the grader is pure. A requirement list is hand-written prose
  // in a small grammar; the most likely content bug by far is a requirement the
  // worked answer does not actually meet — a property name spelled differently, a
  // value with different whitespace, an element the reference solution never uses.
  // That bug is invisible until a student who has written the correct answer is told
  // it is wrong, and they have no way to discover why.
  //
  // The submission is modelled as the STARTER OVERRIDDEN BY THE REFERENCE, because
  // that is what a real submission is: the student edits the files the problem gave
  // them, and any file they did not touch is still there. For a CSS problem that
  // means the reference stylesheet is graded against the starter's HTML scaffold,
  // exactly as it will be at run time.
  // -------------------------------------------------------------------------
  it("checks that every graded markup reference solution passes its own requirements", () => {
    const failures: string[] = [];

    for (const problem of problemCatalogue) {
      if (!isMarkupLanguage(problem.language) || !isExecutable(problem.execution)) continue;
      const language = problem.language as MarkupLanguage;

      const submission = {
        ...splitMarkupBundle(problem.starterCode, language),
        ...splitMarkupBundle(problem.referenceSolution, language),
      };

      for (const test of problem.tests) {
        const assertions = parseMarkupAssertions(test.expectedOutput);
        const outcome = evaluateMarkupTest(submission, assertions);
        if (outcome.passed) continue;
        for (const result of outcome.results) {
          if (result.met) continue;
          failures.push(
            `${problem.slug} / ${test.name}: ${result.description}${result.detail ? ` (${result.detail})` : ""}`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("checks that every graded markup STARTER fails, so the problem is not pre-solved", () => {
    // The other half of the pair. A requirement the starter already satisfies is not
    // a requirement — it is a decoration that makes a problem look graded while
    // marking an untouched starter as correct. At least one test per problem must
    // fail on the starter.
    for (const problem of problemCatalogue) {
      if (!isMarkupLanguage(problem.language) || !isExecutable(problem.execution)) continue;
      const files = splitMarkupBundle(problem.starterCode, problem.language as MarkupLanguage);

      const anyFailing = problem.tests.some(
        (test) => !evaluateMarkupTest(files, parseMarkupAssertions(test.expectedOutput)).passed,
      );
      expect(anyFailing, `${problem.slug}: the starter code already passes every test`).toBe(true);
    }
  });

  it("keeps markup problems off Piston and executed problems off the markup grader", () => {
    for (const problem of problemCatalogue) {
      if (isMarkupLanguage(problem.language)) {
        // Piston has no HTML or CSS runtime; "piston" here would be a submit that
        // could only ever report a compile error.
        expect(problem.execution, problem.slug).not.toBe("piston");
      } else if (isExecutable(problem.execution)) {
        // And the converse: a compiled language must not claim a browser practice
        // loop it has no runtime for. See requiresServerRuntime in grading.ts.
        if (problem.execution === "browser") {
          expect(hasBrowserBackend(problem.language), problem.slug).toBe(true);
        }
      }
    }
  });

  it("numbers orderIndex from zero inside every (bank, track, level) group", () => {
    const stamped = withOrderIndexes(problemCatalogue);
    const groups = new Map<string, number[]>();
    for (const problem of stamped) {
      const key = `${problem.isInterview}:${problem.track}:${problem.level}`;
      groups.set(key, [...(groups.get(key) ?? []), problem.orderIndex]);
    }
    for (const [key, indexes] of groups) {
      expect(indexes, key).toEqual(indexes.map((_, i) => i));
    }
  });
});
