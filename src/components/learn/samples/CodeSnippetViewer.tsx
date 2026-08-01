"use client";

// =============================================================================
// <CodeSnippetViewer /> — code with line numbers, emphasis and per-line notes.
// Spec: TECHNICAL_SPECIFICATION.md §3.1.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// WHAT THIS DOES NOT DO, STATED FIRST BECAUSE THE SPEC ASKS FOR IT.
//
// THERE IS NO SYNTAX HIGHLIGHTING. The spec's feature list opens with it. This
// component renders plain, monospaced, correctly-escaped text instead, and the
// reason is a constraint rather than an oversight: no highlighter is a
// dependency of this project (`package.json` has no shiki, prism or
// highlight.js), and this stream is not permitted to add one. reveal.js ships a
// bundled highlight.js, but reaching into `reveal.js/plugin/highlight` from
// outside a Reveal deck couples every code block in the LMS to a presentation
// library's internal file layout, which is a worse trade than monochrome code.
//
// The consequence is honest and bounded: colour was never the accessible
// carrier of meaning anyway (WCAG 1.4.1 — and highlighted-line emphasis below
// is deliberately NOT colour-only for exactly that reason). When a highlighter
// is added to the project, the single change is to replace the `<code>` child
// with its output; the line-numbering, emphasis and note plumbing here is
// independent of it.
//
// WHY THE CODE IS SPLIT INTO LINES IN THE DOM AT ALL.
// Line numbers rendered as text inside the `<pre>` are copied along with the
// code, which makes the copy button produce something that does not run. A
// grid of `<span aria-hidden>` gutters beside `<code>` keeps the copyable text
// clean, and the copy button copies the ORIGINAL string, never the DOM.
// =============================================================================

import * as React from "react";

import { Badge, Button, cn } from "@/components/ui";

export type SnippetLanguage = "html" | "css" | "javascript" | "python" | (string & {});

export interface CodeSnippetViewerProps {
  filename: string;
  language: SnippetLanguage;
  code: string;
  explanation?: string;
  /** 1-based line numbers to emphasise. */
  highlightedLines?: number[];
  /** 1-based line number -> prose. Keys may be numbers or numeric strings. */
  lineExplanations?: Record<number | string, string>;
  copyable?: boolean;
  lineNumbers?: boolean;
  className?: string;
}

/** How long the "Copied" confirmation stays up, in milliseconds. */
const COPIED_FEEDBACK_MS = 2_000;

/**
 * Split without losing a trailing blank line's meaning but without inventing
 * one either: a file ending in `\n` has N lines, not N+1, and an extra empty
 * numbered row at the bottom of every snippet reads as a bug.
 */
export function toLines(code: string): string[] {
  const lines = code.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Normalise the two shapes a line-explanation map arrives in. */
export function normaliseLineNotes(
  notes: Record<number | string, string> | undefined,
): Map<number, string> {
  const map = new Map<number, string>();
  if (!notes) return map;
  for (const [key, value] of Object.entries(notes)) {
    const line = Number(key);
    if (Number.isInteger(line) && line > 0 && typeof value === "string" && value.length > 0) {
      map.set(line, value);
    }
  }
  return map;
}

export function CodeSnippetViewer({
  filename,
  language,
  code,
  explanation,
  highlightedLines,
  lineExplanations,
  copyable = true,
  lineNumbers = true,
  className,
}: CodeSnippetViewerProps) {
  const [copied, setCopied] = React.useState(false);
  const [copyFailed, setCopyFailed] = React.useState(false);

  const lines = React.useMemo(() => toLines(code), [code]);
  const highlighted = React.useMemo(
    () => new Set(highlightedLines ?? []),
    [highlightedLines],
  );
  const notes = React.useMemo(() => normaliseLineNotes(lineExplanations), [lineExplanations]);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(): Promise<void> {
    setCopyFailed(false);
    // `navigator.clipboard` is undefined on http origins and in jsdom. Guarding
    // rather than try/catching alone, because the absence is not an exception.
    if (!navigator.clipboard?.writeText) {
      setCopyFailed(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // A denied clipboard permission is a normal browser state, not a fault.
      // Telling the student to select the code themselves is the useful reply.
      setCopyFailed(true);
    }
  }

  const noteEntries = [...notes.entries()].sort((a, b) => a[0] - b[0]);
  const regionId = React.useId();

  return (
    <figure
      className={cn("flex flex-col gap-2", className)}
      data-testid="code-snippet"
      aria-labelledby={`${regionId}-caption`}
    >
      <figcaption
        id={`${regionId}-caption`}
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-ink">{filename}</span>
          <Badge tone="neutral" size="sm">
            {language}
          </Badge>
        </span>
        {copyable && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void copy()}
            // The button's own name changes rather than relying on a colour or
            // an icon swap, so the confirmation reaches a screen reader.
            aria-label={copied ? `${filename} copied to clipboard` : `Copy ${filename}`}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
      </figcaption>

      {explanation && <p className="text-sm text-ink-muted">{explanation}</p>}

      {/*
        tabIndex=0 on the scroll container: a region that scrolls must be
        reachable by keyboard, or a keyboard-only user cannot read code wider
        than the viewport (WCAG 2.1.1). role="group" plus the label gives the
        stop a name so it is not announced as an anonymous scrollable.
      */}
      <div
        role="group"
        aria-label={`${filename} source`}
        tabIndex={0}
        className={cn(
          "max-h-96 overflow-auto rounded-lg border border-line bg-panel",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        )}
        data-testid="code-snippet-scroll"
      >
        <pre className="m-0 p-0 text-sm leading-6">
          <code className="block font-mono">
            {lines.map((line, index) => {
              const number = index + 1;
              const isHighlighted = highlighted.has(number);
              return (
                <span
                  key={number}
                  data-line={number}
                  data-highlighted={isHighlighted || undefined}
                  className={cn(
                    "flex gap-3 px-3",
                    // Emphasis is a left border AND a background tint, never a
                    // tint alone: a background difference at the contrast ratio
                    // a code block can tolerate is not perceivable to every
                    // reader, and WCAG 1.4.1 forbids colour as the only carrier.
                    isHighlighted && "border-l-4 border-brand bg-brand/10",
                    !isHighlighted && "border-l-4 border-transparent",
                  )}
                >
                  {lineNumbers && (
                    <span
                      // aria-hidden and user-select-none together: the number is
                      // visual scaffolding and must not enter a copy or a
                      // screen-reader's reading of the code.
                      aria-hidden="true"
                      className="w-8 shrink-0 select-none text-right text-ink-muted"
                    >
                      {number}
                    </span>
                  )}
                  <span className="whitespace-pre">{line === "" ? " " : line}</span>
                </span>
              );
            })}
          </code>
        </pre>
      </div>

      {copyFailed && (
        <p role="status" className="text-sm text-ink-muted" data-testid="code-copy-failed">
          Your browser would not let this page use the clipboard. Select the code above and
          copy it yourself.
        </p>
      )}

      {noteEntries.length > 0 && (
        // A definition list rather than tooltips. The spec says "tooltip", but a
        // tooltip is unreachable by touch, disappears on the keyboard focus move
        // that a screen reader performs, and cannot be read alongside the line
        // it describes. A visible list is the accessible form of the same
        // information and is the divergence this stream is choosing on purpose.
        <dl className="rounded-lg border border-line bg-panel p-3 text-sm" data-testid="line-notes">
          <p className="mb-2 font-semibold text-ink">Line by line</p>
          {noteEntries.map(([line, note]) => (
            <div key={line} className="mb-1 flex gap-2 last:mb-0">
              <dt className="shrink-0 font-mono font-semibold text-ink">Line {line}</dt>
              <dd className="m-0 text-ink-muted">{note}</dd>
            </div>
          ))}
        </dl>
      )}
    </figure>
  );
}
