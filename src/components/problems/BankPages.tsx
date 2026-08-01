// =============================================================================
// BANK PAGE BODIES — shared by /problems and /interview.
// Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// The four route files under src/app/(app)/ are deliberately thin wrappers around
// these two async server components. /problems and /interview differ by ONE boolean
// (`coding_problems.is_interview`), so four independent page bodies would be four
// places for the guard, the filter parsing, the lock gate and the empty states to
// drift apart — and the guard is the one that must not.
//
// Each page calls `requireRole("student")` itself. src/middleware.ts already protects
// both prefixes at the edge, but middleware covers path PREFIXES and a page added
// under an unlisted one would slip through; the middleware header states that rule
// and every existing page follows it.
// =============================================================================

import { notFound } from "next/navigation";

import { EmptyState } from "@/components/ui";
import type { ProficiencyLevel } from "@/db/schema";
import { requireRole } from "@/lib/guard";
import {
  BANK_BASE_PATH,
  isLevel,
  isProblemTrack,
  type ProblemBank,
  type ProblemTrack,
} from "@/lib/problems";
import { listProblems, loadProblem } from "@/lib/problems/service";

import { ProblemBrowser } from "./ProblemBrowser";
import { ProblemView } from "./ProblemView";

/** Query values Next hands a page. Untrusted; narrowed before use. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Narrow a query-string filter, ignoring anything unrecognised.
 *
 * The PAGE ignores a bad value where the API route rejects it with a 400, and that
 * difference is intentional: a hand-edited URL should show the unfiltered list
 * rather than an error screen, while a programmatic caller needs to be told its
 * request was wrong instead of silently receiving something else.
 */
function parseFilters(params: RawSearchParams): {
  track: ProblemTrack | null;
  level: ProficiencyLevel | null;
} {
  const rawTrack = firstValue(params.track);
  const rawLevel = firstValue(params.level);
  return {
    track: isProblemTrack(rawTrack) ? rawTrack : null,
    level: isLevel(rawLevel) ? rawLevel : null,
  };
}

const BANK_COPY: Record<ProblemBank, { heading: string; blurb: string }> = {
  practice: {
    heading: "Practice problems",
    blurb:
      "Drills that follow the syllabus. Run against the examples as often as you like — nothing is recorded until you submit, and a problem counts as solved the moment one submission passes every test.",
  },
  interview: {
    heading: "Interview drills",
    blurb:
      "The same machinery, different intent: shorter statements, less scaffolding, and the patterns that come up in technical interviews. Solving three at a level opens the next one in that track.",
  },
};

export async function BankListPage({
  bank,
  searchParams,
}: {
  bank: ProblemBank;
  searchParams: RawSearchParams;
}) {
  const user = await requireRole("student", BANK_BASE_PATH[bank]);
  const { track, level } = parseFilters(searchParams);

  const result = await listProblems({ bank, studentId: user.id, track, level });
  const copy = BANK_COPY[bank];

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6" data-testid="problems-page" data-bank={bank}>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-ink">{copy.heading}</h1>
        <p className="max-w-prose text-sm text-ink-muted">{copy.blurb}</p>
      </header>

      {result.availableTracks.length === 0 ? (
        <EmptyState
          title="No problems have been published yet"
          description="The problem bank is seeded separately from the course content. Ask an instructor to run the problem seeder."
        />
      ) : (
        <ProblemBrowser
          bank={bank}
          problems={result.problems}
          tracks={result.tracks}
          availableTracks={result.availableTracks}
          activeTrack={track}
          activeLevel={level}
        />
      )}
    </main>
  );
}

export async function BankProblemPage({
  bank,
  slug,
}: {
  bank: ProblemBank;
  slug: string;
}) {
  const user = await requireRole("student", `${BANK_BASE_PATH[bank]}/${slug}`);

  const result = await loadProblem(slug, user.id);
  // An unknown slug and a slug belonging to the OTHER bank both 404: /interview/js-sum
  // must not quietly render a practice problem, because the level ladders are scoped
  // per bank and the page would then show the wrong lock state.
  if (!result || result.problem.bank !== bank) notFound();

  if (result.locked) {
    const state = result.levels.find((l) => l.level === result.problem.level);
    const needed = state ? Math.max(0, state.requiredBelow - state.solvedBelow) : 0;
    // NOT a 404. A locked problem the student can see in the list must explain
    // itself, or the lock is indistinguishable from a broken link.
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-6" data-testid="problem-locked-page">
        <EmptyState
          title={`${result.problem.level} is not open yet`}
          description={`Solve ${needed} more ${result.problem.level === "advanced" ? "intermediate" : "beginner"} problem${needed === 1 ? "" : "s"} in this track to unlock it. Progress is counted from your submissions, so a problem counts as soon as one submission passes every test.`}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <ProblemView problem={result.problem} />
    </main>
  );
}
