// =============================================================================
// ONE ACHIEVEMENT, EARNED OR NOT. Owner: badges stream.
// -----------------------------------------------------------------------------
// NAMED "Achievement", NOT "Badge", AND THAT IS DELIBERATE.
//
// `Badge` already exists in this codebase as a shared UI primitive
// (src/components/ui/Badge.tsx) — a small coloured PILL used for status labels all
// over the app. This feature's "badge" is an AWARDED ACHIEVEMENT. Two entirely
// different concepts with the same English word, and a `BadgeCard` importing
// `Badge` would be a coin-flip for every future reader about which one it renders.
// So everything in this directory says Achievement, and the pill primitive is
// REUSED rather than reimplemented — the rule stated at
// src/components/ui/index.ts:4-6: "Do not deep-import a file and do not fork
// styles per page: a second Button implementation is how a design system dies."
//
// (IMPLEMENTATION_ROADMAP.md:264-265 asks for `BadgeCard.tsx` and
// `BadgePopover.tsx`. The name is the deviation; the card is the same thing. The
// popover is not built — see the note at the foot of this file.)
//
// A SERVER COMPONENT. No state, no effects, no event handlers: it is a
// presentational function of its props, so it ships no JavaScript to the browser
// at all. That matters on a page that renders the whole catalogue.
// =============================================================================

import * as React from "react";

import { Badge, Card, cn } from "@/components/ui";
import { RARITY_TONE, type BadgeViewEntry } from "@/lib/badges";

export interface AchievementCardProps {
  entry: BadgeViewEntry;
  /**
   * Highlights a badge awarded by the request that rendered this page, so a
   * student sees WHICH card is new rather than a grid that quietly gained one.
   */
  justEarned?: boolean;
  className?: string;
}

/** Metric, locale-aware, and stable between server and client render. */
function formatAwardedAt(value: Date | null): string | null {
  if (!value) return null;
  // `en-GB` + explicit parts rather than `toLocaleDateString()` with no locale:
  // the default depends on the runtime's locale, so a server-rendered string and a
  // client-rendered one can differ and React logs a hydration mismatch.
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

export function AchievementCard({ entry, justEarned = false, className }: AchievementCardProps) {
  const awardedAt = formatAwardedAt(entry.awardedAt);

  return (
    <Card
      data-testid="achievement-card"
      data-badge-type={entry.type}
      data-earned={entry.earned ? "true" : "false"}
      data-rarity={entry.rarity}
      className={cn(
        "flex h-full flex-col gap-2",
        // UNEARNED IS DIMMED, NOT HIDDEN. The grid's whole purpose is to show what
        // is still available with its threshold spelled out — see
        // src/lib/badges/queries.ts:15-21. Opacity rather than a grey palette so the
        // glyph and the rarity pill stay recognisable as the same badge once earned.
        !entry.earned && "opacity-60",
        justEarned && "outline outline-2 outline-offset-2 outline-brand",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          // Decorative: the badge's name is right next to it in text, so a screen
          // reader announcing the glyph would just repeat it as punctuation.
          aria-hidden="true"
          className="text-2xl leading-none"
        >
          {entry.glyph}
        </span>
        <Badge tone={entry.earned ? RARITY_TONE[entry.rarity] : "neutral"} size="sm">
          {entry.rarity}
        </Badge>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-ink">{entry.name}</p>
        <p className="text-xs text-ink-muted">
          {/* Earned: what you did. Unearned: what to do. Never both — a card that
              says "You scored 100%" above "Score 100% on any quiz" reads as a
              nag. */}
          {entry.earned ? entry.description : entry.criteria}
        </p>
      </div>

      <div className="mt-auto pt-1">
        {entry.earned ? (
          <p className="text-[11px] text-ink-muted">
            {/* The <time> element carries the machine-readable value; the visible
                text is the formatted one. */}
            Earned{" "}
            {entry.awardedAt ? (
              <time dateTime={entry.awardedAt.toISOString()}>{awardedAt}</time>
            ) : (
              "recently"
            )}
          </p>
        ) : (
          <p className="text-[11px] text-ink-muted">Not earned yet</p>
        )}
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// TODO(badges): the roadmap's `BadgePopover.tsx` (IMPLEMENTATION_ROADMAP.md:265).
// Not built, and the reason is that it would have to be a CLIENT component to
// manage open/closed state, which would put JavaScript on a page that currently
// ships none. The content it would show — the criteria and the `evidence` blob —
// is already on the card and in the API response, so the popover buys presentation
// only. Worth doing when the page gains a genuine interaction; not worth a
// hydration boundary before then.
// -----------------------------------------------------------------------------
