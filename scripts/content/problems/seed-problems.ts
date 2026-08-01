// =============================================================================
// CODING-PROBLEM SEEDER — idempotent. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
//   npx tsx scripts/content/problems/seed-problems.ts
//
// (There is no npm script for this: package.json is outside this stream's
// allowlist. The stream report asks the coordinator to add
// `"db:seed-problems": "tsx scripts/content/problems/seed-problems.ts"`.)
//
// VALIDATE BEFORE THE FIRST INSERT, exactly as scripts/seed-content.ts does. A
// half-seeded bank is worse than an unseeded one: a problem with no hidden test
// grades everybody as solved, and a problem whose language no runtime accepts is a
// Run button that can only fail. Both look like application bugs rather than content
// bugs, so they are refused here instead.
//
// IDEMPOTENT BY SLUG, and specifically by UPDATE rather than delete-and-recreate.
// `coding_attempts.problem_id` cascades on delete, so dropping a problem row to
// re-insert it would silently destroy every student's attempt history — and because
// completion is DERIVED from those rows (src/lib/problems/completion.ts), it would
// also un-solve problems students had already solved. Tests are replaced wholesale,
// which is safe: nothing references a test row.
//
// The script runs as a sequence of independent statements rather than one
// transaction, following the existing seed's reasoning: it is idempotent, so a
// partial failure is recovered by running it again.
// =============================================================================

import "dotenv/config";
import { eq } from "drizzle-orm";

import { db } from "../../../src/db";
import { codingProblems, codingProblemTests } from "../../../src/db/schema";
import {
  assertValidCatalogue,
  catalogueCounts,
  withOrderIndexes,
} from "../../../src/lib/problems/validate";

import { problemCatalogue } from "./index";

async function main(): Promise<void> {
  // ---- 1. Refuse invalid content -----------------------------------------
  assertValidCatalogue(problemCatalogue);
  const problems = withOrderIndexes(problemCatalogue);
  console.log(`Catalogue validated: ${problems.length} problems.`);

  let created = 0;
  let updated = 0;
  let testRows = 0;

  for (const problem of problems) {
    const values = {
      slug: problem.slug,
      title: problem.title,
      statement: problem.statement,
      track: problem.track,
      level: problem.level,
      isInterview: problem.isInterview,
      language: problem.language,
      starterCode: problem.starterCode,
      referenceSolution: problem.referenceSolution,
      hints: problem.hints,
      tags: problem.tags,
      execution: problem.execution,
      timeLimitMs: problem.timeLimitMs ?? 5000,
      // Seeded content is ready to read. An unpublished bank would render an empty
      // /problems page and look like a broken feature.
      published: true,
      orderIndex: problem.orderIndex,
    };

    const [existing] = await db
      .select({ id: codingProblems.id })
      .from(codingProblems)
      .where(eq(codingProblems.slug, problem.slug))
      .limit(1);

    let problemId: number;
    if (existing) {
      await db.update(codingProblems).set(values).where(eq(codingProblems.id, existing.id));
      problemId = existing.id;
      updated += 1;
    } else {
      const [inserted] = await db
        .insert(codingProblems)
        .values(values)
        .returning({ id: codingProblems.id });
      problemId = inserted.id;
      created += 1;
    }

    // ---- 2. Replace this problem's tests ---------------------------------
    // Wholesale replacement keeps the tests exactly in step with the catalogue,
    // including removals. Attempt rows do not reference tests, so nothing is lost.
    await db.delete(codingProblemTests).where(eq(codingProblemTests.problemId, problemId));

    if (problem.tests.length > 0) {
      await db.insert(codingProblemTests).values(
        problem.tests.map((test, index) => ({
          problemId,
          name: test.name,
          input: test.input ?? null,
          expectedOutput: test.expectedOutput,
          hidden: test.hidden,
          orderIndex: index,
        })),
      );
      testRows += problem.tests.length;
    }
  }

  // ---- 3. Report -----------------------------------------------------------
  console.log(`Problems: ${created} created, ${updated} updated. Tests written: ${testRows}.`);
  console.log("\nPer track and level (practice / interview):");
  const counts = [...catalogueCounts(problemCatalogue).entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [key, entry] of counts) {
    console.log(`  ${key.padEnd(28)} ${entry.practice} / ${entry.interview}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[seed-problems] failed:", error);
    process.exit(1);
  });
