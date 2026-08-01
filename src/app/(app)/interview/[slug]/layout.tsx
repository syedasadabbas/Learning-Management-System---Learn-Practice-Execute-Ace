// =============================================================================
// EXISTENCE GUARD for /interview/[slug].
// -----------------------------------------------------------------------------
// Owner: ui-shell (navigation) — the pattern; coding-problems — the query.
//
// Identical to ../../problems/[slug]/layout.tsx with the bank flipped, and the
// long version of every "why" is there. In short: this route gained a
// `loading.tsx`, a `loading.tsx` commits HTTP 200 when its fallback flushes, so
// the `notFound()` must be made in a layout above that boundary.
//
// THE BANK CHECK IS THE POINT OF THIS FILE, not a formality. `coding_problems.slug`
// is unique across both banks, so without it /interview/js-sum would resolve a
// PRACTICE problem and render it against the interview ladder — a different lock
// state for the same row. Same rule as BankPages.tsx:127.
//
// COST: shared with the page through the `cache()`d `loadProblem` in
// src/lib/problems/service.ts. Four round trips once, not twice.
// =============================================================================

import { notFound } from "next/navigation";

import { requireRole } from "@/lib/guard";
import { loadProblem } from "@/lib/problems/service";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function InterviewProblemLayout({ children, params }: LayoutProps) {
  const { slug } = await params;

  const user = await requireRole("student", `/interview/${slug}`);

  const result = await loadProblem(slug, user.id);
  if (!result || result.problem.bank !== "interview") notFound();

  return <>{children}</>;
}
