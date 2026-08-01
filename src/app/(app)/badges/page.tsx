// =============================================================================
// /badges — the student's achievements. Owner: badges stream.
// -----------------------------------------------------------------------------
// A server component that reads the database directly rather than fetching its own
// /api/me/badges route, for the reason src/app/(app)/leaderboard/page.tsx:4-9
// states: calling your own HTTP endpoint from a server component costs an extra
// round trip and forces the session cookie to be forwarded by hand. Both paths
// share `getBadgeView`, so they cannot drift.
//
// `requireRole("student")` means "signed in" — staff satisfy it too, per
// ROLES_SATISFYING in src/lib/contracts/api.ts. That is intended and it degrades
// honestly: an instructor has no submissions, no quiz attempts and no leaderboard
// row, so every criterion is false and they see the catalogue with nothing earned
// plus a note saying why. The alternative — refusing staff outright — would make a
// nav link that 403s for the person who can see it, which nav-links.ts:171-176
// already argues against.
//
// This page renders NO client JavaScript: every component below is a server
// component (see src/components/badges/AchievementCard.tsx:20-23).
// =============================================================================

import { AchievementGrid, AchievementSummary } from "@/components/badges";
import { EmptyState } from "@/components/ui";
import { getBadgeView } from "@/lib/badges";
import { requireRole } from "@/lib/guard";

// Per-session, and it changes the moment anything is graded. It also RE-EVALUATES
// the criteria on read (see getBadgeView's doc comment for why a GET may write),
// which a cached render would defeat entirely.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Achievements",
  description: "Badges you have earned, and the ones still available.",
};

export default async function BadgesPage() {
  const user = await requireRole("student", "/badges");

  // `evaluate` is true for a student looking at their OWN page — that is the
  // backfill path argued for in src/lib/badges/queries.ts:60-79. It is false for
  // staff: awarding badges to an instructor account as a side effect of them
  // opening a page would be surprising, and every criterion is false for them
  // anyway, so the write would be pure noise.
  const isStudent = user.role === "student";
  const view = await getBadgeView(user.id, { evaluate: isStudent });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Achievements</h1>
        <p className="text-sm text-ink-muted">
          {isStudent
            ? "Badges are awarded automatically as you work through the course. Each one is earned once."
            : "Instructors and admins earn no badges — this is the catalogue students see."}
        </p>
      </header>

      <AchievementSummary earnedCount={view.earnedCount} totalCount={view.totalCount} />

      {view.newlyAwarded.length > 0 && (
        // Only ever rendered on the ONE request that actually inserted the row,
        // because `newlyAwarded` is derived from Postgres's report of who won the
        // INSERT (src/lib/badges/award.ts:74-82). A refresh does not repeat it,
        // which is what makes it a genuine "just now" rather than a sticky banner.
        <p
          data-testid="badges-just-earned"
          className="rounded-lg border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-ink"
        >
          New{" "}
          {view.newlyAwarded.length === 1 ? "achievement" : "achievements"} unlocked:{" "}
          <strong>
            {view.newlyAwarded
              .map((type) => view.entries.find((e) => e.type === type)?.name ?? type)
              .join(", ")}
          </strong>
          .
        </p>
      )}

      {view.entries.length === 0 ? (
        // Defensive: the catalogue is a non-empty constant, so this is unreachable
        // today. It exists so that emptying the catalogue produces a sentence rather
        // than a blank page under a heading.
        <EmptyState
          title="No achievements are configured"
          description="Nothing to earn yet. This is a configuration state, not something you did."
          icon={<span className="text-3xl">✦</span>}
        />
      ) : (
        <AchievementGrid entries={view.entries} justEarned={view.newlyAwarded} />
      )}

      <p className="text-xs text-ink-muted">
        Badges carry no marks: they do not change your score, your rank or your
        grade. Awards are permanent — a badge is never taken away.
      </p>
    </main>
  );
}
