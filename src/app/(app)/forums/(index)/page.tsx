// =============================================================================
// /forums — the index: one row per week, with its discussion count.
// -----------------------------------------------------------------------------
// Owner: forums stream.
//
// WHY THIS ROUTE EXISTS AT ALL, given IMPLEMENTATION_ROADMAP.md:423 specifies
// `src/app/(app)/weeks/[weekId]/forum/page.tsx` and nothing else.
//
// Two reasons, both about what already exists rather than about preference:
//
//  1. NAVIGATION CANNOT LINK TO A DYNAMIC SEGMENT. The sidebar is data
//     (src/components/nav/nav-links.ts) and
//     tests/unit/cross-stream-contracts.test.ts walks src/app and fails any nav
//     href with no `page.tsx` behind it — a guard that exists because the
//     `/course`-vs-`/weeks` typo 404'd silently for every student. A forum
//     reachable only at /weeks/3/forum has no nav row it can legally have, so it
//     would be reachable only by typing a URL. The roadmap's own success metric
//     for this feature is "50+ posts per week"; a feature nobody can find does not
//     hit it.
//
//  2. `src/app/(app)/weeks/**` IS THE COURSE-CONTENT STREAM'S SEGMENT. Adding a
//     child route inside another stream's route tree in a wave where eight agents
//     are editing concurrently is the collision this wave is structured to avoid,
//     and the parent owns routing (layout.tsx/loading.tsx) under it.
//
// So the shape is `/forums`, `/forums/:weekId`, `/forums/:weekId/:topicId` — the
// spec's information architecture (week-scoped forums, per the schema's
// `week_id`), served from this stream's own segment. Stated as a deviation rather
// than left to be discovered.
//
// -----------------------------------------------------------------------------
// GUARDED HERE, NOT ONLY AT THE EDGE. `src/middleware.ts` gates the /forums
// prefix, but its own header (line 24) is explicit that middleware is "defence in
// depth, not the only defence" — it covers path prefixes, and a page under an
// unlisted prefix slips through the matcher. `requireForumUser()` below is the
// enforcement; the middleware row is the fast reject.
//
// QUERY BUDGET: 3 STATEMENTS, SEQUENTIAL DEPTH 1 (~245 ms).
// `getWeekList` is 2 statements issued concurrently inside itself
// (src/components/course/data.ts:290) and `countTopicsByWeek` is 1. Neither needs
// the other's result, so all three go on the wire together. The topic count for
// EVERY week arrives in that single aggregate — the N+1 shape here would have been
// one `count(*)` per week, growing with the curriculum. See
// src/lib/forums/store.ts PART 1 for the measured budget of all three pages.
// =============================================================================

import type { Metadata } from "next";
import Link from "next/link";

import { getWeekList } from "@/components/course/data";
import { Badge, EmptyState, LockBadge } from "@/components/ui";
import { requireForumUser } from "@/lib/forums/access";
import { countTopicsByWeek } from "@/lib/forums/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discussions",
};

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function ForumsIndexPage() {
  const user = await requireForumUser("/forums");

  // CONCURRENT, not sequential. At ~245 ms per Neon round trip
  // (docs/SUBJECT_SECTIONS.md appendix) a serial pair here would double the page's
  // latency for two reads that share no data dependency.
  const [{ course, items }, counts] = await Promise.all([
    getWeekList(user.id),
    countTopicsByWeek(),
  ]);

  if (!course) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <EmptyState
          title="No course is published yet"
          description="Discussions open once the course and its weeks exist."
        />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6" data-testid="forums-index">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-ink">Discussions</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          Ask about a week&apos;s material here instead of by email. Classmates and
          your instructor can answer, and the thread stays for the next person with
          the same question.
        </p>
      </header>

      <ul data-testid="forum-week-list" className="space-y-3">
        {items.map((week) => {
          // A week with no rows in the aggregate is a week with no discussions —
          // the LEFT JOIN produces the row with a zero count, but a defensive
          // default keeps this correct if a week was created after the read.
          const summary = counts.get(week.id) ?? {
            weekId: week.id,
            topicCount: 0,
            lastActivityAt: null,
          };

          // THE ACCESS DECISION IS `gateWeek`'S, ARRIVING AS `week.lock`. This page
          // re-derives nothing — see src/lib/forums/access.ts for why forum
          // visibility is the week's visibility rather than a fourth rule.
          if (week.lock.locked) {
            // NO ANCHOR AT ALL for a locked week, matching WeekCard.tsx — and the
            // route refuses the URL anyway (asserted by the direct-URL e2e spec),
            // because hiding a link is not access control.
            return (
              <li
                key={week.id}
                data-testid={`forum-week-${week.id}`}
                data-locked="true"
                className="rounded-lg border border-line bg-surface px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-muted">
                    Week {week.weekNumber}: {week.title}
                  </span>
                  <LockBadge
                    locked
                    size="sm"
                    reason={week.lock.reason ?? undefined}
                  />
                </div>
                {/* The lock REASON is safe to show on a page the student reached
                    legitimately — that is what LockedNotice does too — and
                    `lockedBy` is what stops this saying "pass the previous quiz"
                    for a withheld subject, which no quiz result opens
                    (docs/SUBJECT_SECTIONS.md). */}
                <p className="mt-1 text-sm text-ink-muted">
                  {week.lock.reason ?? "This week is not yet available."}
                </p>
              </li>
            );
          }

          return (
            <li
              key={week.id}
              data-testid={`forum-week-${week.id}`}
              data-locked="false"
              data-topic-count={summary.topicCount}
              className="rounded-lg border border-line bg-panel"
            >
              <Link
                href={`/forums/${week.id}`}
                className="block px-4 py-3 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">
                    Week {week.weekNumber}: {week.title}
                  </span>
                  <Badge tone={summary.topicCount > 0 ? "brand" : "neutral"} size="sm">
                    {summary.topicCount}{" "}
                    {summary.topicCount === 1 ? "discussion" : "discussions"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {summary.lastActivityAt
                    ? `Last activity ${formatWhen(summary.lastActivityAt)}`
                    : "No discussions yet — be the first to ask."}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
