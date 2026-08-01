// =============================================================================
// POST /api/presentations/:presentationId/export  —  "student" (visibility-scoped)
// Feature flag: presentations
// Owner: the API stream. Path fixed by ROUTES in src/lib/contracts/api.ts.
// -----------------------------------------------------------------------------
// TWO GATES, NOT ONE. Visibility says whether this caller may SEE the deck;
// `allow_export` says whether its author permits it to leave the app. A viewer
// who may read a published deck is not automatically entitled to a standalone
// copy of it, and the column exists precisely to express that. Both are checked,
// and the export gate is a 403 rather than a 404 because the caller can plainly
// see the deck — pretending it vanished would be confusing rather than discreet.
//
// SPEAKER NOTES ARE REFUSED TO NON-OWNERS EVEN WHEN REQUESTED. `includeSpeakerNotes`
// is an input, not an authorization: asking for the presenter's script does not
// grant it. For anyone but the creator and staff the flag is forced to false and
// the response says so, rather than silently ignoring it — a client that thinks
// it exported the notes and did not would ship an incomplete file to a student
// who is relying on it.
//
// NO PDF. The spec lists one (LIVE_CLASSES_..._SPEC.md:707) and it is not
// offered: PDF here is Reveal's print view rendered by the BROWSER, not
// something this server can produce, and advertising a format that always fails
// is worse than not listing it. `html` returns a self-contained document the
// client can save; `json` returns the validated deck for a re-import.
//
// THE EXPORTED HTML IS ESCAPED AT EVERY INTERPOLATION. A deck is student-authored
// content and the export is a standalone file someone opens from disk with NO
// CSP protecting them — which is exactly the scenario the canonical contract's
// URL rules cite. Escaping is therefore not defence in depth here; it is the
// only defence.
// =============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { presentations } from "@/db/schema.presentations";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { parseBody } from "@/lib/learning/schemas";
import { parseSlideDeck, slideLabel, type Slide, type SlideDeck } from "@/lib/presentations/types";
import { parsePositiveInt } from "@/lib/quizzes/params";

import { mayReadSpeakerNotes, readableFilter } from "../../_access";
import { exportSchema } from "../../_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ presentationId: string }> };

/**
 * Escape text for insertion into HTML element content or an attribute value.
 *
 * All five characters, including `'` and `"`, because the output is used in both
 * positions and a helper that is safe in only one of them is a helper somebody
 * will use in the other.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One slide as a Reveal `<section>`. Every interpolation is escaped. */
function renderSlide(slide: Slide, includeNotes: boolean): string {
  const parts: string[] = [];

  switch (slide.type) {
    case "title":
      parts.push(`<h1>${escapeHtml(slide.title)}</h1>`);
      if (slide.subtitle) parts.push(`<h3>${escapeHtml(slide.subtitle)}</h3>`);
      break;
    case "content":
      if (slide.title) parts.push(`<h2>${escapeHtml(slide.title)}</h2>`);
      if (slide.body) parts.push(`<p>${escapeHtml(slide.body)}</p>`);
      if (slide.bullets?.length) {
        parts.push(`<ul>${slide.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`);
      }
      break;
    case "code":
      if (slide.title) parts.push(`<h2>${escapeHtml(slide.title)}</h2>`);
      // `data-trim` is Reveal's; the language class is escaped even though the
      // schema bounds it, because "bounded" is not "safe in an attribute".
      parts.push(
        `<pre><code class="language-${escapeHtml(slide.language)}" data-trim>${escapeHtml(slide.code)}</code></pre>`,
      );
      if (slide.caption) parts.push(`<p>${escapeHtml(slide.caption)}</p>`);
      break;
    case "image":
      if (slide.title) parts.push(`<h2>${escapeHtml(slide.title)}</h2>`);
      // `src` passed through the contract's `externalUrlSchema` at write time,
      // so it is http(s) — never `javascript:` or `data:`. Escaped as well,
      // because the write-time guarantee protects the database and this protects
      // the file.
      parts.push(
        `<img src="${escapeHtml(slide.src)}" alt="${escapeHtml(slide.alt)}" style="max-width:100%">`,
      );
      if (slide.caption) parts.push(`<p>${escapeHtml(slide.caption)}</p>`);
      break;
    case "two-column": {
      if (slide.title) parts.push(`<h2>${escapeHtml(slide.title)}</h2>`);
      const column = (side: typeof slide.left) =>
        [
          side.heading ? `<h3>${escapeHtml(side.heading)}</h3>` : "",
          side.body ? `<p>${escapeHtml(side.body)}</p>` : "",
          side.bullets?.length
            ? `<ul>${side.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
            : "",
        ].join("");
      parts.push(
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;text-align:left">` +
          `<div>${column(slide.left)}</div><div>${column(slide.right)}</div></div>`,
      );
      break;
    }
    case "quote":
      parts.push(`<blockquote>${escapeHtml(slide.quote)}</blockquote>`);
      if (slide.attribution) parts.push(`<cite>${escapeHtml(slide.attribution)}</cite>`);
      break;
  }

  if (includeNotes && slide.speakerNotes) {
    parts.push(`<aside class="notes">${escapeHtml(slide.speakerNotes)}</aside>`);
  }

  const background = slide.backgroundColor
    ? ` data-background-color="${escapeHtml(slide.backgroundColor)}"`
    : "";

  return `<section${background}>${parts.join("")}</section>`;
}

/**
 * Assemble a standalone Reveal document.
 *
 * Reveal's own CSS and JS are referenced from a CDN rather than inlined: this
 * server has no copy of them to embed, and a 300 KB base64 blob per exported
 * deck would be a worse trade than a file that needs a network on first open.
 * Stated so nobody is surprised that the export is not fully offline.
 */
function renderDeck(title: string, deck: SlideDeck, includeNotes: boolean): string {
  const sections = deck.slides.map((slide) => renderSlide(slide, includeNotes)).join("\n");
  const theme = escapeHtml(deck.metadata.theme);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reset.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/${theme}.css">
</head>
<body>
<div class="reveal"><div class="slides">
${sections}
</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
<script>Reveal.initialize({ width: ${deck.metadata.width}, height: ${deck.metadata.height}, transition: ${JSON.stringify(deck.metadata.transition)} });</script>
</body>
</html>`;
}

/**
 * Export a deck as a standalone HTML file or as its validated JSON document.
 *
 * @param request JSON body `{ format: "html" | "json", includeSpeakerNotes? }`
 * @param ctx     path: `presentationId`
 * @returns 200 `{ format, filename, content, slideCount, speakerNotesIncluded }`.
 *          The content is returned INSIDE the API envelope rather than as a
 *          `text/html` body with `Content-Disposition`, because every other
 *          endpoint in this app answers in that envelope and a client that
 *          special-cases one route's response shape is a client that will get it
 *          wrong. The browser saves the string.
 * @throws 404 flag off, no such deck, or a deck this caller may not see
 * @throws 401 not signed in
 * @throws 403 the author has turned export off for this deck
 * @throws 422 body fails validation, or the stored document is malformed and
 *          therefore cannot be rendered — a 422 rather than a 500 because the
 *          request is asking for something that genuinely cannot be produced
 * @throws 400 `presentationId` is not a positive integer
 */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("presentations");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const presentationId = parsePositiveInt((await ctx.params).presentationId);
  if (presentationId === null) {
    return apiError(400, "presentationId must be a positive integer.", "invalid_id");
  }

  const body = await parseBody(request, exportSchema);
  if (!body.ok) return apiError(422, body.error, "validation_failed");

  const [row] = await db
    .select({
      id: presentations.id,
      creatorId: presentations.creatorId,
      title: presentations.title,
      slidesJson: presentations.slidesJson,
      allowExport: presentations.allowExport,
    })
    .from(presentations)
    .where(and(eq(presentations.id, presentationId), readableFilter(gate.user)))
    .limit(1);

  if (!row) return apiError(404, "Presentation not found.", "not_found");

  // The second gate. Its own status, because the caller can see the deck.
  if (!row.allowExport && row.creatorId !== gate.user.id) {
    return apiError(403, "The author has disabled export for this deck.", "export_disabled");
  }

  const deck = parseSlideDeck(row.slidesJson);
  if (!deck.ok) {
    return apiError(
      422,
      `This deck's document is malformed and cannot be exported: ${deck.errors.join("; ")}`,
      "corrupt_document",
    );
  }

  // Requesting the notes does not grant them.
  const includeNotes =
    body.value.includeSpeakerNotes && mayReadSpeakerNotes(gate.user, row.creatorId);

  // A filename derived from the title, reduced to characters that are safe on
  // every filesystem. Not escaped-and-kept: a title containing `/` or a
  // directory traversal sequence must not survive into a filename at all.
  const safeTitle = row.title.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "presentation";

  if (body.value.format === "json") {
    return apiOk({
      format: "json" as const,
      filename: `${safeTitle}.json`,
      // The PARSED deck, not the raw column: what leaves is what validated.
      content: includeNotes
        ? deck.value
        : {
            ...deck.value,
            slides: deck.value.slides.map(({ speakerNotes: _notes, ...rest }) => rest),
          },
      slideCount: deck.value.slides.length,
      speakerNotesIncluded: includeNotes,
    });
  }

  return apiOk({
    format: "html" as const,
    filename: `${safeTitle}.html`,
    content: renderDeck(row.title, deck.value, includeNotes),
    slideCount: deck.value.slides.length,
    speakerNotesIncluded: includeNotes,
    // The outline, so a client can show "exported 12 slides: Title, Intro, ..."
    // without re-parsing the HTML it was just handed.
    outline: deck.value.slides.map(slideLabel),
  });
}
