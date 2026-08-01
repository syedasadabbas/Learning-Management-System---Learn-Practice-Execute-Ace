"use client";

// =============================================================================
// ROOT ERROR BOUNDARY — the catch-all for any segment without a closer one.
// -----------------------------------------------------------------------------
// Before this file existed, exactly ONE segment had a boundary
// (src/app/(app)/practice/error.tsx), so an unexpected throw anywhere else — a
// failed query on the dashboard, the leaderboard, a lecture page, the grading
// queue — fell through to Next.js's built-in error page: unstyled, unbranded, and
// with no route back into the app. On a platform where the audience is students
// who cannot read a stack trace and cannot redeploy, a dead end is the failure.
//
// SCOPE, and why the practice boundary stays: a boundary catches errors from its
// own subtree, and React uses the CLOSEST one. /practice keeps its own because it
// degrades the practice area alone and says so in its copy; this one is the floor
// under everything else. It renders inside src/app/layout.tsx (so tokens and
// @/components/ui both work here, unlike global-error.tsx, which replaces that
// layout and therefore cannot use either).
//
// NO `notFound()` INTERACTION. This is an error boundary, not a Suspense
// boundary — it does not buffer the response, so it cannot swallow a 404 status
// the way a stray loading.tsx does. That hazard is documented at length in
// src/lib/navigation/boundary-scope.test.ts and does not apply to this file.
// =============================================================================

import Link from "next/link";

import { Button, Card } from "@/components/ui";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <Card title="This page could not be loaded">
        <p className="text-sm text-ink">
          Something went wrong while loading this page. Nothing on this screen was saved
          or deleted, and the rest of the platform is unaffected.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-ink-muted">
            Reference for your instructor: {error.digest}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* `reset` re-renders the failed subtree, which is the right first try
              for a transient database error — by far the likeliest cause here. */}
          <Button variant="primary" size="sm" onClick={reset}>
            Try again
          </Button>
          {/* And a way OUT, because a reset that keeps failing is a trap. */}
          <Link href="/" className="text-sm font-medium underline">
            Back to your dashboard
          </Link>
        </div>
      </Card>
    </main>
  );
}
