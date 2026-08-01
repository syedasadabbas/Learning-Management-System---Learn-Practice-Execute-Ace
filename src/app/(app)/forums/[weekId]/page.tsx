// =============================================================================
// /forums/[weekId] — the thread list for one week.
// -----------------------------------------------------------------------------
// Owner: forums stream.
//
// GATED SERVER-SIDE, and the refusal is the same one /weeks/[weekId] gives. A week
// id that is not part of the active course produces `notFound()` — deliberately
// indistinguishable from a nonexistent id, so the URL cannot enumerate the weeks of
// courses the student is not enrolled in. A week that exists but is LOCKED renders
// `LockedNotice`, not the threads.
//
// THIS IS THE CONTROL, NOT THE AFFORDANCE. /forums renders no anchor for a locked
// week, but that is presentation; this page refuses the typed URL. "Hiding a link
// is not access control" (src/components/course/data.ts:13), and the direct-URL
// case is asserted in tests/e2e/forums/forums.spec.ts.
//
// QUERY BUDGET: 3 STATEMENTS, SEQUENTIAL DEPTH 1 (~245 ms), FOR ANY NUMBER OF
// THREADS. `getWeekList` (2, internally concurrent) and `listTopics` (1) are issued
// together: `listTopics` needs only the weekId, which is a ROUTE PARAMETER and not
// derived from the gate, so there is no dependency to serialise on. Per-thread reply
// counts, last-activity times and solved flags are aggregates inside that single
// statement.
//
// THE N+1 THIS AVOIDS, in numbers: one `SELECT count(*) FROM forum_posts WHERE
// topic_id = $1` per row would be 1 + N statements. Commit 25fe2d2 measured a warm
// Neon round trip at ~245 ms, so a 20-thread page would take ~5.1 SECONDS. It stays
// 3 statements at 20 threads and 3 at 200.
//
// ISSUING `listTopics` CONCURRENTLY WITH THE GATE DOES NOT WEAKEN THE GATE — the
// rows are discarded unread when the gate refuses, and nothing is sent to the
// browser before the refusal. Same argument, same shape, as `gateLecture`
// (src/components/course/data.ts:395).
// =============================================================================

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LockedNotice } from "@/components/course/LockedNotice";
import { getWeekList } from "@/components/course/data";
import { ForumTopicList, NewTopicComposer } from "@/components/forums";
import { gateForumWeek, requireForumUser } from "@/lib/forums/access";
import { listTopics } from "@/lib/forums/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Week discussions",
};

interface PageProps {
  // Next.js 15: dynamic route params are a Promise.
  params: Promise<{ weekId: string }>;
}

export default async function WeekForumPage({ params }: PageProps) {
  const { weekId: rawWeekId } = await params;
  const weekId = Number(rawWeekId);

  const user = await requireForumUser(`/forums/${rawWeekId}`);

  // A non-numeric or non-positive segment can never match a serial primary key.
  // Refused before it reaches a query, so `/forums/abc` is a 404 rather than a
  // statement with a NaN parameter.
  if (!Number.isInteger(weekId) || weekId <= 0) notFound();

  const [gate, topics] = await Promise.all([
    gateForumWeek(user.id, weekId),
    listTopics(weekId),
  ]);

  if (!gate.ok && gate.kind === "not_found") notFound();

  if (!gate.ok) {
    // Locked. `topics` is discarded here — it was fetched concurrently and is
    // never rendered, which is the whole point of the note in the header.
    const { items } = await getWeekList(user.id);
    const previous = items.find((w) => w.weekNumber === gate.lock.weekNumber - 1);

    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <LockedNotice
          weekNumber={gate.lock.weekNumber}
          title={gate.lock.title}
          reason={gate.lock.reason ?? "This week is not yet available."}
          previousWeekId={previous?.id}
        />
      </main>
    );
  }

  const { week } = gate;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6" data-testid="forum-week-page">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm">
        <Link href="/forums" className="text-brand underline underline-offset-2">
          All discussions
        </Link>
      </nav>

      <header className="mb-5">
        <h1 data-testid="forum-week-title" className="text-2xl font-bold text-ink">
          Week {week.weekNumber} discussions
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{week.title}</p>
      </header>

      <div className="mb-5">
        {/* Any signed-in user who may READ this week may open a thread in it —
            there is no separate "may post" privilege. See
            src/lib/forums/actions.ts#createTopicAction. */}
        <NewTopicComposer weekId={week.id} />
      </div>

      <ForumTopicList weekId={week.id} topics={topics} viewerId={user.id} />
    </main>
  );
}
