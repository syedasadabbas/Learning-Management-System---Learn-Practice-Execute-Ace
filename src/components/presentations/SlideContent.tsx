"use client";

// =============================================================================
// SLIDE BODY RENDERER
// -----------------------------------------------------------------------------
// One React component per slide variant, selected by the discriminated union.
//
// WHY JSX RATHER THAN `dangerouslySetInnerHTML`: slide content is authored by
// students and instructors and stored in a database, so it is untrusted input
// that will later be shown to other users — including, via the standalone HTML
// export, in a file opened from disk where no CSP applies. Rendering through
// JSX means React escapes every interpolation and there is no injection path to
// reason about. The cost is that the export path needs its own escaping
// serializer (src/lib/presentations/export/html.ts); that is the cheaper half
// of the trade.
// =============================================================================

import { cn } from "@/components/ui/cn";
import type { Slide, SlideColumn } from "@/lib/presentations/types";

interface SlideContentProps {
  slide: Slide;
  /**
   * Thumbnail rendering. Only scales type down — it must NOT change which
   * elements are present, because the editor's thumbnail pane and the live
   * slide have to agree about what is on the slide.
   */
  compact?: boolean;
}

/**
 * Heading level is h2, not h1.
 *
 * The page that hosts the deck owns the h1. A slide emitting its own h1 would
 * give a screen-reader user two top-level headings on one page and break the
 * document outline that our focus management relies on.
 */
function SlideHeading({
  children,
  compact,
}: {
  children: string;
  compact?: boolean;
}) {
  return (
    <h2
      className={cn(
        "font-semibold tracking-tight text-[var(--rp-fg)]",
        compact ? "text-base" : "text-3xl sm:text-4xl",
      )}
    >
      {children}
    </h2>
  );
}

function Bullets({
  items,
  compact,
}: {
  items: readonly string[];
  compact?: boolean;
}) {
  return (
    <ul
      className={cn(
        "list-disc space-y-2 pl-6 text-left text-[var(--rp-fg)]",
        compact ? "text-xs" : "text-lg sm:text-xl",
      )}
    >
      {items.map((item, index) => (
        // Bullet text is free-form and may repeat ("..."), so the index is the
        // only stable key available. Bullets are never reordered in place —
        // the editor replaces the whole array — so this cannot desync.
        <li key={`${index}-${item.slice(0, 16)}`}>{item}</li>
      ))}
    </ul>
  );
}

function Column({ column, compact }: { column: SlideColumn; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-3 text-left">
      {column.heading !== undefined && (
        <h3
          className={cn(
            "font-semibold text-[var(--rp-primary)]",
            compact ? "text-sm" : "text-xl sm:text-2xl",
          )}
        >
          {column.heading}
        </h3>
      )}
      {column.body !== undefined && (
        <p
          className={cn(
            "whitespace-pre-line text-[var(--rp-fg)]",
            compact ? "text-xs" : "text-base sm:text-lg",
          )}
        >
          {column.body}
        </p>
      )}
      {column.bullets !== undefined && (
        <Bullets items={column.bullets} compact={compact} />
      )}
    </div>
  );
}

export function SlideContent({ slide, compact = false }: SlideContentProps) {
  switch (slide.type) {
    case "title":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <h2
            className={cn(
              "font-bold tracking-tight text-[var(--rp-fg)]",
              compact ? "text-lg" : "text-4xl sm:text-6xl",
            )}
          >
            {slide.title}
          </h2>
          {slide.subtitle !== undefined && (
            <p
              className={cn(
                "text-[var(--rp-muted)]",
                compact ? "text-xs" : "text-xl sm:text-2xl",
              )}
            >
              {slide.subtitle}
            </p>
          )}
        </div>
      );

    case "content":
      return (
        <div className="flex h-full flex-col gap-4 text-left">
          {slide.title !== undefined && (
            <SlideHeading compact={compact}>{slide.title}</SlideHeading>
          )}
          {slide.body !== undefined && (
            <p
              className={cn(
                "whitespace-pre-line text-[var(--rp-fg)]",
                compact ? "text-xs" : "text-lg sm:text-xl",
              )}
            >
              {slide.body}
            </p>
          )}
          {slide.bullets !== undefined && (
            <Bullets items={slide.bullets} compact={compact} />
          )}
        </div>
      );

    case "code":
      return (
        <div className="flex h-full flex-col gap-4 text-left">
          {slide.title !== undefined && (
            <SlideHeading compact={compact}>{slide.title}</SlideHeading>
          )}
          <pre
            // `overflow-auto` and not `overflow-hidden`: a long line on a
            // projector is a legibility problem, but silently clipping code a
            // student is being asked to read is a correctness problem.
            className={cn(
              "overflow-auto rounded-lg bg-[var(--rp-code-bg)] p-4 text-left font-mono text-[var(--rp-fg)]",
              compact ? "text-[0.6rem] leading-tight" : "text-sm sm:text-base",
            )}
            data-language={slide.language}
          >
            <code>{slide.code}</code>
          </pre>
          {slide.caption !== undefined && (
            <p className="text-sm text-[var(--rp-muted)]">{slide.caption}</p>
          )}
        </div>
      );

    case "image":
      return (
        <figure className="flex h-full flex-col items-center justify-center gap-3">
          {slide.title !== undefined && (
            <SlideHeading compact={compact}>{slide.title}</SlideHeading>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- slide images
              are arbitrary author-supplied external URLs; next/image requires
              every host to be allow-listed in next.config.ts, which cannot be
              done for user input, and the optimizer is pointless for an asset
              shown once at full width. */}
          <img
            src={slide.src}
            alt={slide.alt}
            className="max-h-[70%] max-w-full rounded-lg object-contain"
          />
          {slide.caption !== undefined && (
            <figcaption className="text-sm text-[var(--rp-muted)]">
              {slide.caption}
            </figcaption>
          )}
        </figure>
      );

    case "two-column":
      return (
        <div className="flex h-full flex-col gap-4">
          {slide.title !== undefined && (
            <SlideHeading compact={compact}>{slide.title}</SlideHeading>
          )}
          {/* Single column below the sm breakpoint: two columns of prose at
              360 px wide are unreadable, so the layout stacks rather than
              shrinks. */}
          <div className="grid flex-1 grid-cols-1 gap-6 sm:grid-cols-2">
            <Column column={slide.left} compact={compact} />
            <Column column={slide.right} compact={compact} />
          </div>
        </div>
      );

    case "quote":
      return (
        <blockquote className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <p
            className={cn(
              "font-medium italic text-[var(--rp-fg)]",
              compact ? "text-sm" : "text-2xl sm:text-4xl",
            )}
          >
            {`“${slide.quote}”`}
          </p>
          {slide.attribution !== undefined && (
            <footer className="text-[var(--rp-muted)]">
              {`— ${slide.attribution}`}
            </footer>
          )}
        </blockquote>
      );
  }
}
