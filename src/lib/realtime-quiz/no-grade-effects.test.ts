// =============================================================================
// THE ALARM. A source scan over everything the realtime-quiz stream owns.
// -----------------------------------------------------------------------------
// Owner: realtime-quiz stream.
//
// WHY A SOURCE SCAN AND NOT ONLY BEHAVIOURAL TESTS
//
// The failure this stream must prevent is silent. If someone later wires the
// inline check into scoring — awarding a point, marking a week complete, firing a
// leaderboard event "for engagement" — every behavioural test still passes,
// because each of them would then be testing the new, wrong behaviour. The damage
// only shows up as wrong grades for a cohort, weeks later, with no failing test to
// point at.
//
// So the invariant is enforced at the level where it is actually decidable: the
// grading, progress, penalty and leaderboard machinery MAY NOT BE IMPORTED by any
// module in this stream, and the only schema tables it may name are the three it
// reads. You cannot fire an event you cannot import.
//
// Comments are stripped before scanning, because the prose in these files
// discusses every forbidden name at length — that discussion is the documentation
// and must not trip the test. Test files are excluded: ./service.test.ts
// deliberately mocks `db.insert` in order to assert it is never reached.
//
// If a future requirement genuinely needs one of these imports, that is a change
// to what the `realtime` kind MEANS. It belongs in a conversation with the
// shared-contracts owner, and this test is the tripwire that forces it.
// =============================================================================

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Everything this stream owns and may write. */
const OWNED_DIRS = [
  path.join(REPO_ROOT, "src", "lib", "realtime-quiz"),
  path.join(REPO_ROOT, "src", "components", "realtime-quiz"),
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // Tests are excluded: they mock the forbidden machinery in order to assert it
    // is never used, which necessarily means naming it.
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Remove block and line comments.
 *
 * Good enough for this corpus (no regex literals and no string containing "//"),
 * and the alternative — a real parser — would add a dependency to enforce a rule
 * about dependencies.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const FILES = OWNED_DIRS.flatMap(sourceFiles).map((file) => ({
  relative: path.relative(REPO_ROOT, file).replace(/\\/g, "/"),
  code: stripComments(readFileSync(file, "utf8")),
}));

describe("the stream has source files to scan at all", () => {
  it("found both owned directories", () => {
    // A rename that emptied one directory would make every test below pass
    // vacuously, which is the classic way a guard like this stops guarding.
    expect(FILES.length).toBeGreaterThanOrEqual(6);
    expect(FILES.some((f) => f.relative.startsWith("src/lib/realtime-quiz/"))).toBe(true);
    expect(FILES.some((f) => f.relative.startsWith("src/components/realtime-quiz/"))).toBe(true);
  });
});

describe("NEGATIVE: the grading machinery is not importable from this stream", () => {
  // Each entry is a module whose presence would mean marks, progress, penalties or
  // rankings had been wired into an ungraded check.
  const FORBIDDEN_MODULES = [
    "@/lib/quizzes",
    "@/lib/leaderboard",
    "@/lib/progress",
    "@/lib/penalties",
    "@/lib/submissions",
    "@/lib/attendance",
    "@/lib/contracts/scoring",
    "@/lib/contracts/events",
  ];

  it.each(FILES)("$relative imports none of them", ({ code }) => {
    const specifiers = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const specifier of specifiers) {
      for (const forbidden of FORBIDDEN_MODULES) {
        expect(
          specifier === forbidden || specifier.startsWith(`${forbidden}/`),
          `imports ${specifier}`,
        ).toBe(false);
      }
    }
  });
});

describe("NEGATIVE: no grade-affecting identifier appears in the code", () => {
  const FORBIDDEN_IDENTIFIERS = [
    "onScoringEvent",
    "quizPointsFromPercent",
    "shouldUnlockNextWeek",
    "assignmentPointsFor",
    "evaluatePenalties",
    "getWeekProgress",
    "rebuildLeaderboard",
    "submitQuizAttempt",
  ];

  it.each(FILES)("$relative names none of them", ({ code }) => {
    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      expect(code.includes(identifier), `mentions ${identifier}`).toBe(false);
    }
  });
});

describe("NEGATIVE: the stream never writes to the database", () => {
  // `queries.ts` is the only module here that imports @/db, and it is read-only.
  // These four are how a write would be spelled with Drizzle.
  const WRITE_CALLS = [".insert(", ".update(", ".delete(", ".transaction("];

  it.each(FILES)("$relative issues no write statement", ({ code }) => {
    for (const call of WRITE_CALLS) {
      expect(code.includes(call), `contains ${call}`).toBe(false);
    }
  });
});

describe("NEGATIVE: only the three read-only tables may be named", () => {
  // Naming `progress`, `quizAttempts`, `answers` or `penalties` is the precondition
  // for writing to them. Restricting the schema import to a whitelist is a tighter
  // guard than searching for table names, which appear as ordinary English words.
  const ALLOWED_TABLES = new Set(["quizzes", "questions", "options"]);

  it.each(FILES)("$relative imports only quizzes/questions/options from @/db/schema", ({ code }) => {
    const match = code.match(/import\s*\{([^}]*)\}\s*from\s*["']@\/db\/schema["']/);
    if (!match) return;
    const named = match[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      // `options as optionsTable` -> `options`
      .map((part) => part.split(/\s+as\s+/)[0].trim());
    for (const name of named) {
      expect(ALLOWED_TABLES.has(name), `imports table ${name}`).toBe(true);
    }
  });
});

describe("the server action is authorization-guarded", () => {
  it("actions.ts requires a signed-in user", () => {
    // A server action is a public POST target. Without this, walking question ids
    // would build an answer key for anyone, with no account.
    const action = FILES.find((f) => f.relative.endsWith("realtime-quiz/actions.ts"));
    expect(action, "actions.ts is present").toBeDefined();
    expect(action?.code).toContain("requireUser");
  });
});
