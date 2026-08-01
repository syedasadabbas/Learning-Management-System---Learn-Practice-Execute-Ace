// =============================================================================
// EXISTENCE GUARD for /learn/[track] and everything under it.
// -----------------------------------------------------------------------------
// Owner: ui-shell (navigation) — the pattern; interactive-learning — the query.
//
// This route and its module child both gained a `loading.tsx`. A `loading.tsx` is
// a Suspense boundary, and once its fallback flushes the status is already 200, so
// a `notFound()` below it cannot set 404. This layout renders above the boundary.
// Full account: src/components/nav/PageSkeleton.tsx.
//
// WHY THE 404 CONDITION IS "NO PUBLISHED MODULES" AND NOT "UNKNOWN SLUG". The
// published filter lives in the SQL, so a track whose modules are all drafts comes
// back empty and is answered exactly like a slug that never existed. That is the
// point: the response must not confirm the existence of unpublished content (see
// ./(index)/page.tsx). It also means the guard cannot ask a cheaper question than
// the page does — hence the memo below rather than a lighter existence probe.
//
// COST: one round trip for the guard and the page together, via the `cache()`d
// `loadTrackModules` in src/lib/navigation/guards.ts, which the page imports too.
// ~245 ms per Neon round trip (scripts/perf-roundtrips.ts).
//
// THE MODULE ROUTE BELOW IS NOT FALSELY 404'D BY THIS. A module can only be
// reached at /learn/[track]/[moduleSlug] if it is published, and a published
// module means its track has at least one — so the list is never empty on a URL
// that should resolve.
// =============================================================================

import { notFound } from "next/navigation";

import { requireRole } from "@/lib/guard";
import { loadTrackModules } from "@/lib/navigation/guards";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ track: string }>;
}

export default async function LearnTrackLayout({ children, params }: LayoutProps) {
  const { track } = await params;

  // Above the boundary for the same reason as the 404: a redirect cannot be
  // issued once the response has begun.
  const user = await requireRole("student", `/learn/${track}`);

  const modules = await loadTrackModules(track, user.id);
  if (modules.length === 0) notFound();

  return <>{children}</>;
}
