// =============================================================================
// EXISTENCE GUARD for /problems/[slug].
// -----------------------------------------------------------------------------
// Owner: ui-shell (navigation) — the pattern; coding-problems — the query.
//
// The route gained a `loading.tsx`, which is a Suspense boundary; once its
// fallback flushes the status is already 200, so the `notFound()` has to be made
// here, above it. Full account: src/components/nav/PageSkeleton.tsx.
//
// THE GUARD IS A COPY OF ONE LINE, NOT OF THE POLICY. The refusal condition is
// exactly the one in src/components/problems/BankPages.tsx:127 — no published
// problem with this slug, OR a problem belonging to the OTHER bank, because
// /problems/js-interview-two-sum must not quietly render an interview drill whose
// level ladder is scored differently. Everything else that page decides stays
// there. That file belongs to the coding-problems stream, so the duplicated line
// is deliberate and minimal: it exists only because a `notFound()` inside a
// component below a boundary cannot set a status code.
//
// A LOCKED PROBLEM IS NOT GUARDED HERE, on purpose. `loadProblem` returns a locked
// problem with `locked: true` and the ladder that explains it, and the page
// renders that explanation at 200 — a bare 404 for a locked problem is
// indistinguishable from a typo.
//
// COST: one `loadProblem` for the guard and the page together. That function is
// four sequential round trips (the problem row, its tests, its whole track, the
// student's attempts) at ~245 ms each (scripts/perf-roundtrips.ts), so it is
// `cache()`d at its source — src/lib/problems/service.ts — rather than through
// src/lib/navigation/guards.ts, because `cache()` keys on function identity and
// the other caller is BankPages.tsx, a file this stream may not edit.
// =============================================================================

import { notFound } from "next/navigation";

import { requireRole } from "@/lib/guard";
import { loadProblem } from "@/lib/problems/service";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function PracticeProblemLayout({ children, params }: LayoutProps) {
  const { slug } = await params;

  const user = await requireRole("student", `/problems/${slug}`);

  const result = await loadProblem(slug, user.id);
  if (!result || result.problem.bank !== "practice") notFound();

  return <>{children}</>;
}
