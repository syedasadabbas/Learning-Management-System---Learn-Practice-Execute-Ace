// =============================================================================
// EXISTENCE GUARD for /weeks/[weekId] and everything under it.
// -----------------------------------------------------------------------------
// Owner: ui-shell (navigation) — the pattern; course-content — the gate it calls.
//
// WHY A LAYOUT THAT RENDERS NOTHING BUT ITS CHILDREN
//
// This route and its lecture child both gained a `loading.tsx`, and a
// `loading.tsx` is a Suspense boundary: the moment its fallback flushes, the HTTP
// status line has already been sent as 200, so a `notFound()` reached below it
// renders the not-found UI under a 200. A layout renders ABOVE its own segment's
// boundary, so the decision made here still sets 404. That is the whole trick;
// the full account, with the seven e2e specs that caught it going wrong, is in
// src/components/nav/PageSkeleton.tsx.
//
// ONE GUARD FOR THE WHOLE SUBTREE. This layout sits above BOTH
// ./(index)/loading.tsx and ./lectures/[lectureId]/loading.tsx, so the week's
// existence is decided once for the week page and the lecture page alike. The
// lecture route adds its own layout for its own id, which is the only fact this
// one cannot see.
//
// LOCKED IS NOT MISSING, and the distinction is preserved. `gateWeek` returns
// `not_found` for a week that is not part of the course (deliberately
// indistinguishable from a nonexistent id, so URLs cannot enumerate weeks) and
// `locked` for one that exists but is not yet earned. Only the first is a 404
// here. A locked week must keep rendering LockedNotice at 200, because the
// refusal has to explain itself — turning it into a 404 was one of the seven
// regressions this pattern exists to prevent.
//
// COST: ZERO extra round trips, and no `cache()` wrapper of its own. `gateWeek`'s
// only read is `getWeekList`, which is already `cache()`d at
// src/components/course/data.ts:290, so this call and the page's call resolve
// from one request-scoped memo. A Neon round trip is ~245 ms here
// (scripts/perf-roundtrips.ts), which is what made checking that worth doing
// before writing the guard rather than after.
// =============================================================================

import { notFound } from "next/navigation";

import { gateWeek } from "@/components/course/data";
import { requireUser } from "@/lib/guard";

interface LayoutProps {
  children: React.ReactNode;
  // Next.js 15: route params are async.
  params: Promise<{ weekId: string }>;
}

export default async function WeekLayout({ children, params }: LayoutProps) {
  const { weekId: rawWeekId } = await params;

  // The session check stays here as well as on the pages below, for the same
  // reason the 404 does: a redirect cannot be issued once the response has begun.
  const user = await requireUser(`/weeks/${rawWeekId}`);

  // `Number()` on a path segment can be NaN, a float or negative. `gateWeek`
  // rejects all three as not_found, so parsing here only decides what to hand it.
  const gate = await gateWeek(user.id, Number(rawWeekId));
  if (!gate.ok && gate.kind === "not_found") notFound();

  return <>{children}</>;
}
