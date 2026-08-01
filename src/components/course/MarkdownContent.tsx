// =============================================================================
// LECTURE MARKDOWN RENDERER — react-markdown + remark-gfm.
// -----------------------------------------------------------------------------
// Owner: course-content stream.
//
// WHY AN EXPLICIT COMPONENT MAP INSTEAD OF `prose` CLASSES
// The project uses Tailwind v4 with @theme tokens and no typography plugin (see
// src/app/globals.css — there is no tailwind.config.js and no `prose`). Element
// styling therefore has to be stated, and stating it here means one place decides
// how a lecture heading or code block looks, using only design tokens.
//
// WHY THE CODE-BLOCK BRANCH MATTERS
// Every seeded lecture contains fenced blocks (```html, ```css, ```js). Rendered
// with default styles those collapse into an unreadable run of inline text with
// the newlines eaten. `pre` gets `overflow-x-auto` + `whitespace-pre` so a long
// line scrolls inside the block instead of stretching the page, and the language
// tag from the fence is surfaced as a small label.
//
// SAFETY: `rehype-raw` is deliberately NOT used. Without it react-markdown
// escapes embedded HTML, so a lecture body — authored by staff today but editable
// through the instructor-admin UI later — cannot inject script tags. The seeded
// content shows HTML by putting it inside fenced code blocks, which is exactly
// what we want to display as code anyway. Links are forced to open in a new tab
// with rel="noopener noreferrer".
// =============================================================================

import * as React from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Pull "html" out of react-markdown's `language-html` class on <code>. */
function languageOf(className: unknown): string | null {
  if (typeof className !== "string") return null;
  const match = /language-([\w+-]+)/.exec(className);
  return match ? match[1] : null;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-8 mb-3 text-2xl font-bold text-ink first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 mb-3 border-b border-line pb-1 text-xl font-bold text-ink first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 text-lg font-semibold text-ink first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-5 mb-2 text-base font-semibold text-ink first:mt-0">{children}</h4>
  ),
  p: ({ children }) => <p className="my-3 leading-7 text-ink">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1 pl-6 leading-7 text-ink">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1 pl-6 leading-7 text-ink">{children}</ol>
  ),
  li: ({ children }) => <li className="marker:text-ink-muted">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-brand/40 bg-surface py-1 pl-4 text-ink-muted italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-line" />,

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),

  // Fenced blocks: react-markdown nests <code class="language-x"> inside <pre>.
  // The wrapper handles scrolling and the language label; `code` below therefore
  // only has to distinguish inline from block.
  pre: ({ children }) => {
    // Read the language off the single <code> child without recursing.
    const child = React.Children.toArray(children)[0];
    const language =
      React.isValidElement<{ className?: string }>(child)
        ? languageOf(child.props.className)
        : null;

    return (
      <div
        data-testid="code-block"
        data-language={language ?? undefined}
        className="my-4 overflow-hidden rounded-lg border border-line bg-ink"
      >
        {language && (
          <div className="border-b border-white/10 px-3 py-1 font-mono text-[11px] tracking-wide text-white/60 uppercase">
            {language}
          </div>
        )}
        <pre className="overflow-x-auto p-3 text-sm leading-6 whitespace-pre text-white">
          {children}
        </pre>
      </div>
    );
  },

  code: ({ className, children }) => {
    const isBlock = languageOf(className) !== null;
    if (isBlock) {
      // Inside <pre>: no extra chrome, the wrapper above owns the look.
      return <code className="font-mono">{children}</code>;
    }
    return (
      <code className="rounded border border-line bg-surface px-1 py-0.5 font-mono text-[0.9em] text-ink">
        {children}
      </code>
    );
  },

  // GFM tables — remark-gfm is what makes these appear at all.
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line bg-surface px-3 py-2 font-semibold text-ink">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-line px-3 py-2 align-top text-ink">{children}</td>
  ),
};

export interface MarkdownContentProps {
  /** Raw markdown from `lectures.content`. Null/empty renders a short notice. */
  markdown: string | null | undefined;
  className?: string;
}

export function MarkdownContent({ markdown, className }: MarkdownContentProps) {
  if (!markdown || markdown.trim() === "") {
    return (
      <p data-testid="lecture-content-empty" className="text-sm text-ink-muted italic">
        Written notes for this lecture have not been published yet.
      </p>
    );
  }

  return (
    <div data-testid="lecture-content" className={className}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </Markdown>
    </div>
  );
}
