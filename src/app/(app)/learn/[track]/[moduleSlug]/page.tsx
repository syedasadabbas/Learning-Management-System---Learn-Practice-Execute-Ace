// =============================================================================
// /learn/[track]/[moduleSlug] — the stepped module.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// THE PUBLISHED FILTER LIVES IN THE QUERY. `getModuleBySlug` refuses to return an
// unpublished module, so this page cannot render one even by mistake — there is no
// `if (published)` check here to forget, and the row never reaches the payload.
//
// The local is named `mod` rather than `module` throughout: `module` is a reserved
// identifier under @next/next/no-assign-module-variable.
// An unpublished slug and a nonexistent slug both produce the same 404, which is
// what keeps a draft curriculum from being enumerable by URL.
//
// THE TRACK SEGMENT IS VERIFIED AGAINST THE MODULE. `learning_modules.slug` is
// globally unique, so /learn/dbms/oop-objects-and-state would otherwise resolve and
// render an OOP module under a DBMS heading. Mismatch is a 404, not a redirect: the
// URL a student was given is wrong, and silently rewriting it hides the broken link
// that produced it.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";

import { ModuleRunner } from "@/components/learn";
import { Badge, buttonClasses } from "@/components/ui";
import { requireRole } from "@/lib/guard";
// NOTE: the loader is imported from src/lib/navigation/guards.ts, not from its own
// module. That wrapper is the shared React `cache()` memo, and the sibling
// layout.tsx guard calls the SAME one — which is what makes this route's 404
// correct (the guard runs above this route's loading.tsx boundary, where the HTTP
// status is still settable) without paying for the query twice at ~245 ms a round
// trip. See that file and src/components/nav/PageSkeleton.tsx.
import { loadModuleBySlug } from "@/lib/navigation/guards";
import { levelLabel, trackDisplay } from "@/lib/learn";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ track: string; moduleSlug: string }>;
}

export default async function LearnModulePage({ params }: PageProps) {
  const { track, moduleSlug } = await params;
  const user = await requireRole("student", `/learn/${track}/${moduleSlug}`);

  const mod = await loadModuleBySlug(moduleSlug, user.id);
  if (!mod) notFound();
  if (mod.track !== track) notFound();

  const display = trackDisplay(mod.track);

  return (
    <main
      className="mx-auto max-w-4xl space-y-6 p-6"
      data-testid="learn-module-page"
      data-module-slug={mod.slug}
    >
      <header className="space-y-3">
        <Link
          href={`/learn/${mod.track}`}
          className="inline-block text-sm text-brand underline underline-offset-2"
        >
          ← {display.title}
        </Link>
        <h1 className="text-2xl font-semibold text-ink">{mod.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral" size="md">
            {levelLabel(mod.level)}
          </Badge>
          {mod.estimatedMinutes ? (
            <Badge tone="neutral" size="md">
              about {mod.estimatedMinutes} minutes
            </Badge>
          ) : null}
          <span className="text-xs text-ink-muted">Self-paced · not marked</span>
        </div>
        {mod.summary && (
          <p className="max-w-prose text-sm text-ink-muted">{mod.summary}</p>
        )}
      </header>

      <ModuleRunner module={mod} />

      <p>
        <Link href={`/learn/${mod.track}`} className={buttonClasses("secondary", "sm")}>
          Back to {display.title}
        </Link>
      </p>
    </main>
  );
}
