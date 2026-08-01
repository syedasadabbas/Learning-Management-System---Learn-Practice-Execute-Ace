"use client";

// =============================================================================
// NAV LINK ITEM — the sidebar row, with optimistic "you clicked me" feedback.
// -----------------------------------------------------------------------------
// Owner: ui-shell stream (navigation).
//
// WHY THIS EXISTS
//
// Extracted out of Sidebar.tsx for one reason: `useLinkStatus` (Next 15.3+,
// this repo is on 15.5.22) only reports anything when it is called from a
// DESCENDANT of the <Link> it belongs to. Sidebar mapped its links inline, so
// there was no component inside the Link to call the hook from.
//
// WHAT IT BUYS, IN MILLISECONDS
//
// The destination pages are `force-dynamic` and read Neon per request:
// /weeks 260 ms, /dashboard 354 ms, /weeks/:id 519 ms, /leaderboard per-week
// 993 ms, /problems 1002 ms (scripts/perf-roundtrips.ts and scripts/perf-probe.ts,
// measured 2026-07-31). Even with a loading.tsx now painting the destination,
// the row the user actually clicked is the thing their eye is on, and it used to
// change in no way whatsoever until the route swapped. `useLinkStatus.pending`
// flips in the same tick as the click, so the acknowledgement lands in one
// frame (~16 ms at 60 Hz) instead of after a round trip.
//
// It is also the honest indicator for the one case a skeleton cannot cover: a
// navigation whose prefetch has NOT completed (a cold mobile drawer, a
// throttled connection) still has to wait, and the pending row says so.
//
// REDUCED MOTION
// The spinner is `motion-safe:animate-spin`. Under prefers-reduced-motion the
// ring is still rendered and still swaps in for the glyph — the state remains
// visible, it simply does not rotate. Same rule as
// src/lib/exercises/reduced-motion.ts: degrade the motion, never the
// information. The colour/weight change on the row is not motion at all and
// applies in both cases, so the feedback never depends solely on animation.
//
// WHY NOT prefetch={true} ON THESE LINKS
// A "full" prefetch of a dynamic route makes the server RENDER it — which here
// means running its Neon queries — for every link that scrolls into view. The
// sidebar shows up to nine links at once, so every page load would fan out into
// nine speculative page renders against a pooled database sized `max: 5`
// (src/db/index.ts). The default is left in place: it fetches the shell down to
// the loading boundary that now exists, which is the cheap half and the half
// that removes the blank wait. Auth is unaffected either way — the links are
// already role-filtered by NAV_LINKS, src/middleware.ts still gates the
// prefetch request itself at the edge, and the shell carries no student data.
// =============================================================================

import * as React from "react";
import Link from "next/link";
import { useLinkStatus } from "next/link";

import { cn } from "@/components/ui";
import type { NavLink } from "./nav-links";

export interface NavLinkItemProps {
  link: NavLink;
  active: boolean;
  onNavigate?: () => void;
}

/**
 * Inner half of the row. Must be a separate component: `useLinkStatus` reads
 * the pending state from the Link above it via context and returns
 * `{ pending: false }` forever if it is called anywhere else.
 */
function NavLinkBody({ link, active }: { link: NavLink; active: boolean }) {
  const { pending } = useLinkStatus();

  return (
    <span
      data-pending={pending}
      className="flex min-w-0 flex-1 items-center gap-3"
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center text-base",
          active ? "text-brand" : "text-ink-muted",
        )}
      >
        {pending ? (
          // A ring with one transparent quadrant: recognisable as a spinner
          // even when it is not spinning, which is the reduced-motion case.
          <span
            data-testid="nav-link-spinner"
            className="size-4 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
          />
        ) : (
          link.glyph
        )}
      </span>
      <span className="truncate">{link.label}</span>
      {/* Politely announced, so a screen reader user learns the click was
          registered. Only rendered while pending, so it is not chatter. */}
      {pending && <span className="sr-only">Loading {link.label}…</span>}
    </span>
  );
}

export function NavLinkItem({ link, active, onNavigate }: NavLinkItemProps) {
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      data-testid="sidebar-link"
      data-active={active}
      title={link.description}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
        "transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        active
          ? "bg-brand/10 text-brand"
          : "text-ink-muted hover:bg-surface hover:text-ink",
      )}
    >
      <NavLinkBody link={link} active={active} />
    </Link>
  );
}
