// =============================================================================
// SHARED TEST FIXTURE — subject-section configurations.
// -----------------------------------------------------------------------------
// Not a test. Imported by the unit tests that need to pin which subjects are
// open while they exercise something else.
//
// WHY THIS EXISTS
// Two independent derivations decide whether a week is open — the content gate
// (src/components/course/lock-state.ts) and the dashboard read model
// (src/lib/progress/unlock.ts) — and BOTH now consult the subject-release switch
// first. That means every pre-existing test of the quiz-PROGRESSION rule would,
// left alone, pass for the wrong reason: the week it expects to be shut is shut
// because its subject is closed, not because the previous quiz was failed. Such
// a test keeps reporting green after the rule it names has been broken.
//
// Injecting ALL_OPEN restores those tests to testing what their names claim.
// HTML_ONLY is the shipped policy, asserted explicitly where that is the point.
//
// Defined once, here, rather than copied into four test files: four copies drift,
// and a fixture that disagrees with the one next door is how a test suite starts
// describing a system nobody built.
// =============================================================================

import type { CurriculumSection } from "@/components/course/sections";

/** Build a section, defaulting every field a given test does not care about. */
export function testSection(
  overrides: Partial<CurriculumSection> & Pick<CurriculumSection, "slug">,
): CurriculumSection {
  return {
    title: overrides.slug,
    subtitle: "",
    description: "",
    weekNumbers: [],
    enabled: true,
    ...overrides,
  };
}

/**
 * Every week of the seeded four-week course in an OPEN subject.
 *
 * Use this in any test whose subject is the progression chain, completion
 * arithmetic, ordering, or anything else that is not the release switch itself.
 */
export const ALL_OPEN_SECTIONS: CurriculumSection[] = [
  testSection({ slug: "html", title: "HTML5", weekNumbers: [1] }),
  testSection({ slug: "css", title: "CSS3", weekNumbers: [2] }),
  testSection({ slug: "javascript", title: "JavaScript", weekNumbers: [3] }),
  testSection({ slug: "git-deployment", title: "Git & Deployment", weekNumbers: [4] }),
];

/**
 * The shipped policy: HTML open, every other subject withheld.
 *
 * Kept as an explicit fixture rather than reading appConfig, so a test that
 * asserts "only HTML is open" still means that after someone edits the config —
 * it will then fail, which is the point. The config itself is asserted directly
 * in src/components/course/sections.test.ts.
 */
export const HTML_ONLY_SECTIONS: CurriculumSection[] = [
  testSection({ slug: "html", title: "HTML5", weekNumbers: [1] }),
  testSection({ slug: "css", title: "CSS3", weekNumbers: [2], enabled: false }),
  testSection({ slug: "javascript", title: "JavaScript", weekNumbers: [3], enabled: false }),
  testSection({
    slug: "git-deployment",
    title: "Git & Deployment",
    weekNumbers: [4],
    enabled: false,
  }),
];
