// =============================================================================
// STANDALONE HTML EXPORT
// -----------------------------------------------------------------------------
// Produces ONE self-contained .html file: no script tags, no CDN links, no
// external stylesheets. Open it from a USB stick on a machine with no network
// and it renders.
//
// WHY NOT EXPORT A REVEAL DECK.
// The obvious export is "the same deck, but standalone", which means shipping
// reveal.js and reveal.css inside the file. Two problems. First, this module is
// pure logic with no bundler asset access, so it cannot read those files as
// strings without a build-time inlining step that does not exist here; the
// alternative — <script src="https://cdn..."> — makes the "standalone" file
// silently blank on an offline machine, which is worse than not offering it.
// Second, an exported deck's purpose is reading and printing, not presenting;
// the recipient wants to scroll it and Ctrl-P it. So the export is a plain
// semantic document — one <section> per slide, one slide per printed page —
// which is smaller, accessible, and prints correctly in every browser.
//
// XSS: every interpolated value goes through `escapeHtml`. Slide content is
// author-supplied and the exported file is opened from the filesystem, where no
// Content-Security-Policy protects the reader.
// =============================================================================

import { presentationThemeCss } from "../theme";
import type { Presentation, Slide, SlideColumn } from "../types";

/**
 * Escape the five characters that can break out of HTML text or an attribute.
 *
 * `&` first — escaping it after the others would double-escape the entities
 * they produce.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function bulletsHtml(bullets: readonly string[] | undefined): string {
  if (bullets === undefined || bullets.length === 0) return "";
  const items = bullets
    .map((bullet) => `<li>${escapeHtml(bullet)}</li>`)
    .join("");
  return `<ul>${items}</ul>`;
}

function columnHtml(column: SlideColumn): string {
  const parts: string[] = [];
  if (column.heading !== undefined)
    parts.push(`<h3>${escapeHtml(column.heading)}</h3>`);
  if (column.body !== undefined) parts.push(`<p>${escapeHtml(column.body)}</p>`);
  parts.push(bulletsHtml(column.bullets));
  return `<div class="col">${parts.join("")}</div>`;
}

/** The body of one slide. Exported for unit testing of individual variants. */
export function slideBodyHtml(slide: Slide): string {
  switch (slide.type) {
    case "title":
      return [
        `<h2 class="title">${escapeHtml(slide.title)}</h2>`,
        slide.subtitle === undefined
          ? ""
          : `<p class="subtitle">${escapeHtml(slide.subtitle)}</p>`,
      ].join("");

    case "content":
      return [
        slide.title === undefined ? "" : `<h2>${escapeHtml(slide.title)}</h2>`,
        slide.body === undefined ? "" : `<p>${escapeHtml(slide.body)}</p>`,
        bulletsHtml(slide.bullets),
      ].join("");

    case "code":
      return [
        slide.title === undefined ? "" : `<h2>${escapeHtml(slide.title)}</h2>`,
        `<pre data-language="${escapeHtml(slide.language)}"><code>${escapeHtml(
          slide.code,
        )}</code></pre>`,
        slide.caption === undefined
          ? ""
          : `<p class="muted">${escapeHtml(slide.caption)}</p>`,
      ].join("");

    case "image":
      return [
        slide.title === undefined ? "" : `<h2>${escapeHtml(slide.title)}</h2>`,
        `<figure><img src="${escapeHtml(slide.src)}" alt="${escapeHtml(
          slide.alt,
        )}" />`,
        slide.caption === undefined
          ? ""
          : `<figcaption>${escapeHtml(slide.caption)}</figcaption>`,
        `</figure>`,
      ].join("");

    case "two-column":
      return [
        slide.title === undefined ? "" : `<h2>${escapeHtml(slide.title)}</h2>`,
        `<div class="cols">${columnHtml(slide.left)}${columnHtml(
          slide.right,
        )}</div>`,
      ].join("");

    case "quote":
      return [
        `<blockquote><p>${escapeHtml(slide.quote)}</p>`,
        slide.attribution === undefined
          ? ""
          : `<footer>${escapeHtml(slide.attribution)}</footer>`,
        `</blockquote>`,
      ].join("");
  }
}

export interface HtmlExportOptions {
  /**
   * Include speaker notes in the exported file.
   *
   * Defaults to FALSE, and that default is load-bearing: notes routinely
   * contain things the speaker would not put on screen, and an export shared
   * with students should not leak them by accident. Opting in is a decision the
   * exporter makes explicitly.
   */
  includeSpeakerNotes?: boolean;
}

/** Serialise a whole presentation to a standalone HTML document. */
export function exportDeckToHtml(
  presentation: Presentation,
  options: HtmlExportOptions = {},
): string {
  const { includeSpeakerNotes = false } = options;

  const sections = presentation.deck.slides
    .map((slide) => {
      const notes =
        includeSpeakerNotes && slide.speakerNotes !== undefined
          ? `<aside class="notes"><strong>Notes:</strong> ${escapeHtml(
              slide.speakerNotes,
            )}</aside>`
          : "";
      const background =
        slide.backgroundColor === undefined
          ? ""
          : ` style="background:${escapeHtml(slide.backgroundColor)}"`;
      return [
        `<section class="slide" data-type="${escapeHtml(slide.type)}"`,
        ` aria-label="Slide ${slide.slideNumber}"${background}>`,
        slideBodyHtml(slide),
        notes,
        `</section>`,
      ].join("");
    })
    .join("\n");

  const emptyNotice =
    presentation.deck.slides.length === 0
      ? `<p class="muted">This presentation has no slides.</p>`
      : "";

  // `lang="en"` is a WCAG 2.1 AA requirement (3.1.1) and the exported file has
  // no surrounding document to inherit it from.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(presentation.title)}</title>
<style>
:root {
${presentationThemeCss()}
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem 1rem;
  background: var(--rp-bg);
  color: var(--rp-fg);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.5;
}
main { margin: 0 auto; max-width: 60rem; }
h1 { font-size: 1.75rem; }
.slide {
  margin: 0 0 2rem;
  padding: 1.5rem;
  border: 1px solid var(--rp-muted);
  border-radius: 0.5rem;
}
.slide h2 { margin-top: 0; }
.title { font-size: 2rem; }
.subtitle, .muted, figcaption { color: var(--rp-muted); }
pre {
  overflow-x: auto;
  padding: 1rem;
  border-radius: 0.5rem;
  background: var(--rp-code-bg);
}
img { max-width: 100%; height: auto; }
blockquote { margin: 0; font-style: italic; font-size: 1.25rem; }
.cols { display: grid; gap: 1.5rem; grid-template-columns: 1fr; }
.notes {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--rp-muted);
  color: var(--rp-muted);
  font-size: 0.9rem;
}
/* Two columns only where there is room; at 360 px they stack. */
@media (min-width: 40rem) { .cols { grid-template-columns: 1fr 1fr; } }
/* Print-to-PDF path: one slide per page, no page-internal breaks. */
@media print {
  body { padding: 0; background: #ffffff; color: #000000; }
  .slide { page-break-after: always; break-inside: avoid; border: none; }
}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(presentation.title)}</h1>
${
  presentation.description === undefined
    ? ""
    : `<p class="muted">${escapeHtml(presentation.description)}</p>`
}
${emptyNotice}
${sections}
</main>
</body>
</html>
`;
}

/**
 * The same document as a Blob, ready for a download anchor.
 *
 * `charset=utf-8` in the type because slide text routinely contains curly
 * quotes and em dashes, and a downloaded file with no charset is interpreted as
 * the reader's system codepage.
 */
export function htmlExportBlob(
  presentation: Presentation,
  options?: HtmlExportOptions,
): Blob {
  return new Blob([exportDeckToHtml(presentation, options)], {
    type: "text/html;charset=utf-8",
  });
}
