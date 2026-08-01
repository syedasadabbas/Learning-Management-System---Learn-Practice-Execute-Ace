"use client";

// =============================================================================
// PAGE SKELETON — what a route paints while its server render is in flight.
// -----------------------------------------------------------------------------
// Owner: ui-shell stream (navigation).
//
// WHERE THIS IS MOUNTED, AND WHY THERE
//
// It is the fallback of every `loading.tsx` under src/app. Those files sit at the
// LEAF of a route, never at a route group, and the placement is the whole design.
// Three rules, each of which was learned by shipping the other thing first:
//
//   1. NO ROUTE-GROUP-LEVEL loading.tsx. `(app)/loading.tsx` and
//      `(staff)/loading.tsx` existed briefly and were removed in 7055ff7. A
//      loading.tsx is a Suspense boundary, and the moment its fallback flushes
//      the HTTP status line has already been sent as 200 — so every `notFound()`
//      below it rendered the not-found UI under a 200. Seven previously-passing
//      e2e specs caught it (2 interactive-exercises, 2 interactive-learning,
//      2 coding-problems, plus course-content's locked-week refusal). Content
//      never leaked; only the status was wrong, which still misleads monitoring,
//      crawlers and API clients.
//
//   2. THE BOUNDARY MUST BE AT THE LEAF OR IT NEVER FIRES. A group-level
//      boundary shows on first entry into the group, NOT when one child segment
//      swaps for a sibling — so clicking between sidebar destinations painted
//      nothing at all, which was the entire point of the feature. Its own specs
//      said so: the four exercising hard loads passed and the four exercising
//      nav clicks failed. A boundary at the leaf fires on sibling navigation.
//
//   3. A BOUNDARY COVERS ITS SEGMENT *AND EVERYTHING NESTED UNDER IT*, so a
//      404-capable child of a nav destination is back inside rule 1 unless
//      something is done about it. Two mechanisms, and both are in use:
//
//        a. An `(index)` ROUTE GROUP holds the destination's own page.tsx and
//           loading.tsx, e.g. src/app/(app)/weeks/(index)/. Route groups do not
//           appear in the URL, so /weeks still resolves — but /weeks/[weekId] is
//           a SIBLING of the group rather than a descendant of it, so the
//           boundary cannot cover it. This is what lets /weeks have a skeleton at
//           all: its 404-capable children could not have been guarded from above,
//           because a layout at /weeks is never handed a [weekId].
//
//        b. A sibling `layout.tsx` on each 404-capable route, which renders
//           ABOVE its own segment's boundary and so can still set the status.
//           That is where `notFound()` now lives for every dynamic route that has
//           its own loading.tsx. Piloted on /practice/[lectureId] (17/17 specs).
//
//      Every guard's loader is wrapped in React `cache()` so the layout's lookup
//      and the page's lookup are ONE query per request — a Neon round trip is
//      ~245 ms here (scripts/perf-roundtrips.ts), so the status-code fix would
//      otherwise have doubled the cost of the pages it protects. See
//      src/lib/navigation/guards.ts and src/components/course/data.ts:50.
//
// THE PROBLEM THIS SOLVES, WITH THE MEASUREMENTS
//
// Every page under (app) and (staff) is `export const dynamic = "force-dynamic"`
// and reads Neon on each request. Measured against the live instance
// (scripts/perf-roundtrips.ts, 2026-07-31):
//
//     /weeks                      2 statements, depth 1,  260 ms
//     /dashboard                  1 statement,  depth 1,  354 ms
//     /weeks/:weekId              3 statements, depth 2,  519 ms
//     /weeks/:id/lectures/:id     4 statements, depth 2,  512 ms
//     /leaderboard (per-week)     scripts/perf-probe.ts,  993 ms
//     /problems browse list       scripts/perf-probe.ts, 1002 ms
//
// With no loading boundary, a client-side navigation to a dynamic route has
// nothing to render until the full RSC payload arrives, so the browser holds the
// OLD page — fully interactive-looking — for 260-1000 ms after the click with no
// acknowledgement of any kind. That dead interval, not bundle size and not
// hydration, is what "slow" meant here; the DB work behind it was already tuned
// in 25fe2d2 and is close to the 240 ms warm round-trip floor recorded in
// docs/SUBJECT_SECTIONS.md.
//
// A loading.tsx does two distinct things, and the second is the larger win:
//   1. It paints immediately on click, so the wait becomes visible progress.
//   2. It gives Next's default Link prefetch something to cache. For a dynamic
//      route the default prefetch fetches only the static shell down to the
//      nearest loading boundary; with no boundary that prefetch yields nothing
//      reusable. Now the shell is in the router cache before the click, so the
//      skeleton comes from memory rather than from the network.
//
// WHY THIS IS A CLIENT COMPONENT
// loading.tsx is handed no props at all — no params, no pathname — so shape
// selection has to happen somewhere that can read the location. usePathname is
// already in the bundle (Sidebar uses it for active state) and the App Router
// commits the new URL at click time, so during the pending render this returns
// the DESTINATION path and the skeleton matches where we are going, not where
// we came from.
//
// REDUCED MOTION
// The bars are `SkeletonBar` from src/components/ui/Skeleton.tsx — ONE shimmer
// vocabulary for the whole product, after this file and that primitive were
// written independently and shipped two different treatments on one branch. The
// class is `ui-skeleton`, and globals.css turns it into `animation: none` plus
// `background-image: none` under `prefers-reduced-motion: reduce`: the bar keeps
// its size and its flat tint and simply stops moving. Same rule as
// src/lib/exercises/reduced-motion.ts — reduced motion degrades the
// presentation, it never removes information — and the announcement below
// (role="status" + aria-busy) is present in BOTH modes, so this never becomes a
// silent grey rectangle. A Tailwind `motion-safe:` variant, which is what this
// file used to carry, can stop an animation but cannot flatten the gradient it
// leaves half-drawn; that is why the token class is the vocabulary and not a
// utility string.
// =============================================================================

import * as React from "react";
import { usePathname } from "next/navigation";

import { SkeletonBar, cn } from "@/components/ui";
import {
  loadingShapeFor,
  type LoadingShapeSpec,
} from "@/lib/navigation/loading-shape";

export interface PageSkeletonProps {
  /** Overrides the pathname used to pick a shape. Tests only. */
  pathnameOverride?: string;
  className?: string;
}

/**
 * One grey block of the page shape.
 *
 * A thin alias over the shared `SkeletonBar` primitive: the tint, the shimmer and
 * the reduced-motion behaviour all come from there, and only the SIZE is this
 * file's business. It stays a local name because every shape function below reads
 * better as `<Block className="h-4 w-1/3" />` than as the bare import, and
 * because if the shape table ever moves out of here the alias moves with it.
 */
function Block({ className }: { className?: string }) {
  return <SkeletonBar className={cn("rounded-md", className)} />;
}

function ProseSkeleton() {
  return (
    <div className="space-y-3">
      <Block className="h-4 w-full" />
      <Block className="h-4 w-11/12" />
      <Block className="h-4 w-4/5" />
      <Block className="h-4 w-9/12" />
    </div>
  );
}

function CardsSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="space-y-3 rounded-lg border border-line bg-panel p-4"
        >
          <Block className="h-4 w-1/3" />
          <Block className="h-5 w-3/4" />
          <Block className="h-3 w-full" />
          <Block className="h-2 w-full" />
        </div>
      ))}
    </div>
  );
}

function DashboardSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-line bg-panel p-4"
          >
            <Block className="h-3 w-2/3" />
            <Block className="h-7 w-1/2" />
          </div>
        ))}
      </div>
      <div className="space-y-2 rounded-lg border border-line bg-panel p-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Block key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}

function TableSkeleton({ count }: { count: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="border-b border-line p-3">
        <Block className="h-4 w-1/4" />
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Block className="size-8 shrink-0 rounded-full" />
            <Block className="h-4 flex-1" />
            <Block className="h-4 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ListSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-line bg-panel p-4"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Block className="h-4 w-1/2" />
            <Block className="h-3 w-3/4" />
          </div>
          <Block className="h-6 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function Body({ spec }: { spec: LoadingShapeSpec }) {
  switch (spec.shape) {
    case "cards":
      return <CardsSkeleton count={spec.count} />;
    case "dashboard":
      return <DashboardSkeleton count={spec.count} />;
    case "table":
      return <TableSkeleton count={spec.count} />;
    case "list":
      return <ListSkeleton count={spec.count} />;
    case "prose":
    default:
      return <ProseSkeleton />;
  }
}

/**
 * The fallback rendered by every loading.tsx in the app.
 *
 * ACCESSIBILITY: `role="status"` with `aria-busy` and a visually hidden
 * "Loading…" line, because a screen reader user gets nothing at all from grey
 * rectangles. `aria-hidden` on the blocks themselves stops the reader walking a
 * tree of empty divs. This is the announcement the old frozen-page behaviour
 * never made.
 */
export function PageSkeleton({
  pathnameOverride,
  className,
}: PageSkeletonProps) {
  const livePathname = usePathname();
  const pathname = pathnameOverride ?? livePathname;
  const spec = loadingShapeFor(pathname);

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid="page-skeleton"
      data-shape={spec.shape}
      className={cn("space-y-6", className)}
    >
      <span className="sr-only">Loading…</span>
      {/* No animation class on this wrapper. The shimmer belongs to each BAR
          (SkeletonBar), not to a container that would pulse whole cards
          including their borders — and the reduced-motion override in
          globals.css is written against the bar's class, not against a
          Tailwind variant here. */}
      <div aria-hidden="true" className="space-y-6">
        {/* Page heading placeholder — every page in the app has one. */}
        <div className="space-y-2">
          <Block className="h-7 w-1/3" />
          <Block className="h-4 w-1/2" />
        </div>
        <Body spec={spec} />
      </div>
    </div>
  );
}
