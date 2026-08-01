// =============================================================================
// EXISTENCE GUARD for /assignments/[weekId] and /assignments/[weekId]/submit.
// -----------------------------------------------------------------------------
// Owner: ui-shell (navigation) — the pattern; submissions — the read it calls.
//
// Both routes below this one gained a `loading.tsx`, and a `loading.tsx` is a
// Suspense boundary whose flushed fallback commits HTTP 200 before any
// `notFound()` under it can run. A layout renders above its own segment's
// boundary, so this is where the decision has to be made. Full account:
// src/components/nav/PageSkeleton.tsx.
//
// ONE GUARD FOR BOTH ROUTES, because they refuse on identical grounds — a week id
// that does not parse, or a week with no assignment. The `notFound()` calls in the
// two pages below are consequently unreachable now rather than wrong; they are
// left in place as defence in depth, so that moving a boundary later cannot
// silently remove the refusal.
//
// COST: one round trip for the guard, the brief page and the submit page
// together. `loadAssignmentForWeek` is the `cache()`d wrapper in
// src/lib/navigation/guards.ts and all three import it. Without that, a Neon
// round trip is ~245 ms (scripts/perf-roundtrips.ts) and this guard would simply
// have made every assignment page slower to buy a status code.
//
// `requireUser` HERE IS NOT THE ACCESS CONTROL, it is how the query gets a
// student id — src/middleware.ts:65 already gates the whole `/assignments`
// prefix at "student", so the redirect below is unreachable in practice. The
// callback path is the brief rather than the exact URL because a layout cannot
// tell which of its two children was asked for; the pages keep their own
// `requireUser` with the precise path, which is what runs when middleware is
// bypassed in a test harness.
// =============================================================================

import { notFound } from "next/navigation";

import { requireUser } from "@/lib/guard";
import { loadAssignmentForWeek } from "@/lib/navigation/guards";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ weekId: string }>;
}

export default async function WeekAssignmentLayout({ children, params }: LayoutProps) {
  const { weekId: rawWeekId } = await params;

  const weekId = Number(rawWeekId);
  if (!Number.isInteger(weekId) || weekId <= 0) notFound();

  const user = await requireUser(`/assignments/${weekId}`);

  const item = await loadAssignmentForWeek(weekId, user.id);
  if (!item) notFound();

  return <>{children}</>;
}
