// =============================================================================
// EXTERNAL PRACTICE LINKS (W3Schools "Try it Yourself" and friends).
// -----------------------------------------------------------------------------
// Owner: course-content stream.
//
// These are LINKS, never iframes. W3Schools sends X-Frame-Options and will not
// render inside a frame, so an embed attempt produces a blank box — the fact is
// recorded in the skill notes and re-stated here so nobody "fixes" it into an
// iframe. In-app live practice is the interactive-exercises stream's Sandpack
// editor, which is a different thing rendered elsewhere on the page.
//
// rel="noopener noreferrer" on every link: without `noopener` the opened tab
// receives a `window.opener` handle back into an authenticated LMS tab.
// =============================================================================

import * as React from "react";

import type { LinkResource } from "./resources";

export interface PracticeLinksProps {
  links: readonly LinkResource[];
  /** How many Sandpack exercises the interactive-exercises stream will render. */
  interactiveCount?: number;
}

export function PracticeLinks({ links, interactiveCount = 0 }: PracticeLinksProps) {
  if (links.length === 0) {
    return (
      <p data-testid="practice-links-empty" className="text-sm text-ink-muted italic">
        No external practice links for this lecture.
      </p>
    );
  }

  return (
    <div data-testid="practice-links">
      <ul className="grid gap-2 sm:grid-cols-2">
        {links.map((link) => (
          <li key={link.url}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="practice-link"
              data-host={link.host}
              className="flex h-full flex-col gap-1 rounded-lg border border-line bg-panel px-3 py-2 transition-shadow duration-150 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span className="text-sm font-medium text-ink">
                {link.title}
                {/* Screen readers get the warning that focus will move tabs. */}
                <span className="sr-only"> (opens in a new tab)</span>
              </span>
              <span className="text-xs text-ink-muted">
                {link.isW3Schools ? "W3Schools" : link.host} ↗
              </span>
            </a>
          </li>
        ))}
      </ul>

      {interactiveCount > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          This lecture also has {interactiveCount} in-browser exercise
          {interactiveCount === 1 ? "" : "s"}, shown in the practice editor.
        </p>
      )}
    </div>
  );
}
