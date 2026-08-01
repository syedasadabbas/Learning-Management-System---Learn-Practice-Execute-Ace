// =============================================================================
// EXISTENCE GUARD for /practice/concept/[conceptId].
// -----------------------------------------------------------------------------
// Owner: ui-shell (navigation) — the pattern; interactive-exercises — the lookup.
//
// Same mechanism as the sibling guard at ../../[lectureId]/layout.tsx, which
// piloted this pattern: the route has its own `loading.tsx`, that is a Suspense
// boundary, and once its fallback flushes the HTTP status is already 200 — so the
// `notFound()` has to happen in a layout, which renders above it. Full account in
// src/components/nav/PageSkeleton.tsx.
//
// THE CHEAPEST GUARD IN THE APP, and worth saying so because every other one
// needed a `cache()` wrapper to be free. `conceptById` reads the static registry
// in src/lib/exercises — no database, no round trip — so the page repeating the
// same lookup costs nothing and there is nothing to memoise.
// =============================================================================

import { notFound } from "next/navigation";

import { conceptById } from "@/lib/exercises";
import { requireRole } from "@/lib/guard";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ conceptId: string }>;
}

export default async function ConceptLayout({ children, params }: LayoutProps) {
  const { conceptId } = await params;

  // Above the boundary for the same reason as the 404: a redirect cannot be
  // issued once the response has begun.
  await requireRole("student", `/practice/concept/${conceptId}`);

  if (!conceptById(conceptId)) notFound();

  return <>{children}</>;
}
