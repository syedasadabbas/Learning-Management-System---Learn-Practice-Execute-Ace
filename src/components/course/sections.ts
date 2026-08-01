// =============================================================================
// SUBJECT SECTIONS — pure derivation over appConfig.curriculumSections.
// No React, no database, no I/O. Unit-tested in sections.test.ts.
// -----------------------------------------------------------------------------
// Owner: course-content stream (same owner as lock-state.ts, which consumes it).
//
// WHAT THIS IS FOR
// The course is authored as a flat list of weeks. The owner needs it presented
// as SUBJECTS ("HTML5", "CSS3", ...) and needs subjects other than HTML closed
// to students regardless of how far they progress. That is a release decision,
// not a progression decision, so it is expressed as its own layer rather than by
// bending the quiz-unlock rule.
//
// FAIL CLOSED, TWICE OVER
// A week whose number appears in NO configured section is treated as belonging
// to no open subject and is LOCKED. That is deliberate: the alternative default
// ("unrecognised week => visible") means adding week 5 to the curriculum
// silently publishes it to every student before anyone writes a section for it.
// `unsectionedWeekNumbers` below exists so a test — and the /weeks page — can
// surface that state rather than leaving it as a silent lockout.
// =============================================================================

import { appConfig } from "@/lib/config/app.config";

/** One subject section as configured, with its member week numbers. */
export interface CurriculumSection {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  /** `weeks.week_number` values belonging to this subject. Never primary keys. */
  weekNumbers: readonly number[];
  /** False means the cohort has not been given this subject yet. */
  enabled: boolean;
}

/**
 * The configured sections, in the order the owner listed them.
 *
 * Read through this accessor rather than reaching into appConfig directly, so
 * that the `readonly`/literal types of the config object are widened in exactly
 * one place and a future move to a database-backed table changes one function.
 */
export function getCurriculumSections(): CurriculumSection[] {
  return appConfig.curriculumSections.map((s) => ({
    slug: s.slug,
    title: s.title,
    subtitle: s.subtitle,
    description: s.description,
    weekNumbers: [...s.weekNumbers],
    enabled: s.enabled,
  }));
}

/**
 * The section a week number belongs to, or null when no section claims it.
 *
 * Null is the "fail closed" signal — callers must treat it as NOT enabled. See
 * `isWeekNumberEnabled`, which is the check every gate should use.
 */
export function sectionForWeekNumber(
  weekNumber: number,
  sections: readonly CurriculumSection[] = getCurriculumSections(),
): CurriculumSection | null {
  return sections.find((s) => s.weekNumbers.includes(weekNumber)) ?? null;
}

/**
 * May a student reach week `weekNumber` at all, ignoring quiz progression?
 *
 * This is the release switch only. A `true` here does NOT mean the week is
 * readable — `deriveWeekLockStates` still applies the quiz-progression rule on
 * top. A `false` here is final.
 */
export function isWeekNumberEnabled(
  weekNumber: number,
  sections: readonly CurriculumSection[] = getCurriculumSections(),
): boolean {
  return sectionForWeekNumber(weekNumber, sections)?.enabled === true;
}

/**
 * The reason shown for a week closed by its section.
 *
 * A padlock with no explanation is a dead end (the rule lock-state.ts already
 * follows). This says which subject is closed and that progress is not the
 * blocker, so a student does not retake a quiz trying to open something no quiz
 * result can open.
 */
export function sectionLockReason(
  weekNumber: number,
  sections: readonly CurriculumSection[] = getCurriculumSections(),
): string {
  const section = sectionForWeekNumber(weekNumber, sections);
  if (!section) {
    // Unsectioned week: honest about the cause without inventing a subject name.
    return "This week is not part of a released subject yet. Contact your instructor.";
  }
  return `The ${section.title} section is not open yet. Your instructor will release it — it is not unlocked by quiz scores.`;
}

/** Week numbers claimed by no section. Empty in a correctly configured course. */
export function unsectionedWeekNumbers(
  weekNumbers: readonly number[],
  sections: readonly CurriculumSection[] = getCurriculumSections(),
): number[] {
  return weekNumbers.filter((n) => sectionForWeekNumber(n, sections) === null);
}

// ---------------------------------------------------------------------------
// Grouping for the /weeks page
// ---------------------------------------------------------------------------

/**
 * A section together with the week rows that belong to it.
 *
 * `TWeek` is generic so this works for both the plain `WeekSummary` and the
 * `WeekListItem` (summary + lock state) without this module importing either —
 * keeping it free of the database types that data.ts pulls in.
 */
export interface SectionGroup<TWeek> {
  section: CurriculumSection;
  weeks: TWeek[];
}

/**
 * Group week rows under their sections, preserving configured section order and
 * ascending week order within each section.
 *
 * Sections with no matching week row are DROPPED rather than rendered empty: a
 * cohort seeded with fewer weeks than the config describes should not show a
 * heading for a subject that has no content behind it.
 *
 * Weeks claimed by no section are returned separately in `unsectioned` instead
 * of being silently dropped — dropping them would hide content from the one
 * screen that is supposed to account for all of it.
 */
export function groupWeeksBySection<TWeek extends { weekNumber: number }>(
  weeks: readonly TWeek[],
  sections: readonly CurriculumSection[] = getCurriculumSections(),
): { groups: SectionGroup<TWeek>[]; unsectioned: TWeek[] } {
  const byNumber = new Map<number, TWeek[]>();
  for (const week of weeks) {
    const bucket = byNumber.get(week.weekNumber);
    if (bucket) bucket.push(week);
    else byNumber.set(week.weekNumber, [week]);
  }

  const claimed = new Set<TWeek>();
  const groups: SectionGroup<TWeek>[] = [];

  for (const section of sections) {
    const members: TWeek[] = [];
    for (const number of [...section.weekNumbers].sort((a, b) => a - b)) {
      for (const week of byNumber.get(number) ?? []) {
        members.push(week);
        claimed.add(week);
      }
    }
    if (members.length > 0) groups.push({ section, weeks: members });
  }

  const unsectioned = weeks.filter((w) => !claimed.has(w));
  return { groups, unsectioned };
}
