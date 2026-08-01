// =============================================================================
// EXISTENCE GUARD for /learn/[track]/[moduleSlug].
// -----------------------------------------------------------------------------
// Owner: ui-shell (navigation) — the pattern; interactive-learning — the query.
//
// Same mechanism as ../layout.tsx: this route has its own `loading.tsx`, so the
// only place a `notFound()` can still set the status is above that boundary. See
// src/components/nav/PageSkeleton.tsx.
//
// TWO REFUSALS, BOTH 404, BOTH DELIBERATE:
//   1. No published module with this slug. `getModuleBySlug` refuses to return an
//      unpublished row, so a draft and a typo are indistinguishable — which is
//      what keeps a draft curriculum from being enumerable by URL.
//   2. The module exists but belongs to a different track. `learning_modules.slug`
//      is globally UNIQUE, so /learn/dbms/oop-objects-and-state would otherwise
//      resolve and render an OOP module under a DBMS heading. A 404 rather than a
//      redirect, because the URL a student was given is wrong and silently
//      rewriting it hides the broken link that produced it.
//
// COST: one round trip for the guard and the page together, via the `cache()`d
// `loadModuleBySlug` in src/lib/navigation/guards.ts.
// =============================================================================

import { notFound } from "next/navigation";

import { requireRole } from "@/lib/guard";
import { loadModuleBySlug } from "@/lib/navigation/guards";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ track: string; moduleSlug: string }>;
}

export default async function LearnModuleLayout({ children, params }: LayoutProps) {
  const { track, moduleSlug } = await params;

  const user = await requireRole("student", `/learn/${track}/${moduleSlug}`);

  // `mod`, not `module`: the latter is reserved under
  // @next/next/no-assign-module-variable, the same reason the page renames it.
  const mod = await loadModuleBySlug(moduleSlug, user.id);
  if (!mod) notFound();
  if (mod.track !== track) notFound();

  return <>{children}</>;
}
