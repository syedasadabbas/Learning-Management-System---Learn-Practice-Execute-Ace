// =============================================================================
// /leaderboard — cohort standings. Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// A server component that reads the database directly rather than fetching its
// own /api/leaderboard route. Calling your own HTTP endpoint from a server
// component costs an extra round trip and forces the session cookie to be
// forwarded by hand; the API route exists for clients (and other services), and
// both paths share `getLeaderboardView` so they cannot drift.
//
// `requireRole("student")` means "signed in" — staff satisfy it too (see
// ROLES_SATISFYING in src/lib/contracts/api.ts), which is intended: an
// instructor viewing their cohort's standings is a listed use case. Staff have no
// standing of their own, so the summary card degrades to a note.
// =============================================================================

import {
  LeaderboardTable,
  StandingCard,
  ViewTabs,
  WeeklyLeaderboardTable,
  type LeaderboardLinkState,
} from "@/components/leaderboard";
import { requireRole } from "@/lib/guard";
import { getLeaderboardView } from "@/lib/leaderboard/queries";
import {
  defaultDirectionFor,
  parseDirection,
  parseSortKey,
} from "@/lib/leaderboard/sorting";
import type { LeaderboardScope } from "@/lib/leaderboard/types";

// Cohort- and session-dependent, and it changes on every grading event.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Leaderboard",
  description: "Cohort standings, overall and by week.",
};

/** Next 15 passes searchParams as a Promise. */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Positive integer or null — the same narrowing the API route applies. */
function intParam(value: string | string[] | undefined): number | null {
  const raw = first(value);
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireRole("student", "/leaderboard");
  const params = await searchParams;

  const scope: LeaderboardScope = first(params.scope) === "week" ? "week" : "overall";
  const sort = parseSortKey(first(params.sort));
  const requestedDirection = parseDirection(first(params.dir));

  const view = await getLeaderboardView(user, {
    scope,
    cohortId: intParam(params.cohortId),
    weekId: intParam(params.weekId),
    sort,
    direction: requestedDirection,
  });

  const state: LeaderboardLinkState = {
    scope: view.scope,
    weekId: view.weekId,
    // Only echo cohortId into links when the viewer may actually change it,
    // otherwise a student's URLs would carry a parameter that is ignored.
    cohortId: view.cohorts.length > 0 ? view.cohortId : null,
    sort: view.sort,
    direction: requestedDirection ?? defaultDirectionFor(view.sort),
  };

  const activeWeek = view.weeks.find((w) => w.weekId === view.weekId) ?? null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Leaderboard</h1>
        <p className="text-sm text-ink-muted">
          {view.cohortName
            ? `${view.cohortName} — ${view.studentCount} ranked ${
                view.studentCount === 1 ? "student" : "students"
              }.`
            : "Standings for students not yet assigned to a cohort."}
        </p>
      </header>

      <StandingCard
        standing={view.me}
        emptyNote={
          user.role === "student"
            ? "You have no standing yet. Your rank appears once your first quiz or assignment is graded."
            : "Instructors and admins are not ranked — the board below shows the cohort's students."
        }
      />

      <ViewTabs state={state} weeks={view.weeks} cohorts={view.cohorts} />

      {view.scope === "week" ? (
        <WeeklyLeaderboardTable
          entries={view.weeklyEntries}
          state={state}
          weekNumber={activeWeek?.weekNumber ?? null}
          weekTitle={activeWeek?.title ?? null}
        />
      ) : (
        <LeaderboardTable
          entries={view.entries}
          state={state}
          maxScore={view.maxScore}
          cohortName={view.cohortName}
        />
      )}

      <p className="text-xs text-ink-muted">
        Ranks are rebuilt automatically whenever a quiz or an assignment is graded.
        Ties are broken by average instructor rating, then final-project score,
        then earliest submission.
      </p>
    </main>
  );
}
