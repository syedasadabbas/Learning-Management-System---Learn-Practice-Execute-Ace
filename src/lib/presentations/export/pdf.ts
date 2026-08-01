// =============================================================================
// PDF EXPORT
// -----------------------------------------------------------------------------
// WHICH PDF ROUTE, AND WHY.
//
// There were two candidates.
//
// (1) Reveal's `?print-pdf` route. It works by loading the deck with a special
//     stylesheet and asking the user to invoke the browser's own print dialog
//     and choose "Save as PDF". It is not an export function — it cannot be
//     called; it can only be *offered*. It also needs a real routed URL, which
//     this module (pure client-side logic, no routing) does not own, and it
//     produces nothing at all in Firefox's print pipeline without manual
//     margin fiddling. Rejected as the primary path.
//
// (2) `@react-pdf/renderer`, ALREADY a dependency of this repo (used elsewhere
//     for certificates). It builds a PDF from a component tree entirely in the
//     browser, synchronously produces a Blob, and needs no print dialog, no
//     server, and no route. Chosen.
//
// The cost of (2) is honest and worth stating: react-pdf renders its OWN
// primitives, not HTML, so this file re-expresses each slide variant in
// react-pdf's layout vocabulary. The PDF is therefore a faithful *document*
// rendering of the deck, not a pixel copy of the projected slides. For a
// handout — which is what students ask for — that is the better artefact.
//
// The pixel-perfect case is still served: the HTML export's print stylesheet
// puts one slide per page, so File > Print > Save as PDF from that file is the
// documented fallback (`PRINT_TO_PDF_INSTRUCTIONS` below).
// =============================================================================

import {
  createElement,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";

import type { Presentation, Slide } from "../types";
import { readableForeground } from "../theme";
import { appConfig } from "@/lib/config/app.config";

// ---------------------------------------------------------------------------
// The page model — pure, and the part that is unit-tested
// ---------------------------------------------------------------------------
// Separated from rendering because @react-pdf/renderer cannot run under jsdom
// (it needs a real font pipeline and stream support). Keeping the translation
// from slide to page structure in a pure function means the interesting logic
// is testable even though the final Blob generation is not.

export type PdfBlock =
  | { kind: "text"; text: string; emphasis?: "normal" | "muted" | "large" }
  | { kind: "bullets"; items: readonly string[] }
  | { kind: "code"; code: string; language: string }
  | { kind: "quote"; quote: string; attribution?: string }
  | { kind: "image"; src: string; alt: string };

export interface PdfPageModel {
  readonly slideNumber: number;
  readonly heading?: string;
  readonly blocks: readonly PdfBlock[];
  readonly speakerNotes?: string;
}

export interface PdfExportOptions {
  /** See the identical option on the HTML export — defaults to false for the
   *  same reason: notes are not for the audience. */
  includeSpeakerNotes?: boolean;
}

/** Translate one slide into the PDF page model. */
export function slideToPdfPage(
  slide: Slide,
  options: PdfExportOptions = {},
): PdfPageModel {
  const { includeSpeakerNotes = false } = options;
  const notes =
    includeSpeakerNotes && slide.speakerNotes !== undefined
      ? slide.speakerNotes
      : undefined;

  const blocks: PdfBlock[] = [];
  let heading: string | undefined;

  switch (slide.type) {
    case "title":
      heading = slide.title;
      if (slide.subtitle !== undefined)
        blocks.push({ kind: "text", text: slide.subtitle, emphasis: "large" });
      break;

    case "content":
      heading = slide.title;
      if (slide.body !== undefined)
        blocks.push({ kind: "text", text: slide.body });
      if (slide.bullets !== undefined && slide.bullets.length > 0)
        blocks.push({ kind: "bullets", items: slide.bullets });
      break;

    case "code":
      heading = slide.title;
      blocks.push({ kind: "code", code: slide.code, language: slide.language });
      if (slide.caption !== undefined)
        blocks.push({ kind: "text", text: slide.caption, emphasis: "muted" });
      break;

    case "image":
      heading = slide.title;
      blocks.push({ kind: "image", src: slide.src, alt: slide.alt });
      if (slide.caption !== undefined)
        blocks.push({ kind: "text", text: slide.caption, emphasis: "muted" });
      break;

    case "two-column":
      heading = slide.title;
      // Columns are FLATTENED, not preserved. Two 8 cm columns of prose on an
      // A4 page is worse to read than one 17 cm column, and a handout is read
      // linearly. The column headings survive as sub-headings so no structure
      // is lost.
      for (const column of [slide.left, slide.right]) {
        if (column.heading !== undefined)
          blocks.push({ kind: "text", text: column.heading, emphasis: "large" });
        if (column.body !== undefined)
          blocks.push({ kind: "text", text: column.body });
        if (column.bullets !== undefined && column.bullets.length > 0)
          blocks.push({ kind: "bullets", items: column.bullets });
      }
      break;

    case "quote":
      blocks.push({
        kind: "quote",
        quote: slide.quote,
        attribution: slide.attribution,
      });
      break;
  }

  return { slideNumber: slide.slideNumber, heading, blocks, speakerNotes: notes };
}

/** Translate a whole presentation into the PDF page model. */
export function presentationToPdfPages(
  presentation: Presentation,
  options: PdfExportOptions = {},
): readonly PdfPageModel[] {
  return presentation.deck.slides.map((slide) => slideToPdfPage(slide, options));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Page geometry in millimetres.
 *
 * A4 landscape: 297 mm x 210 mm. Landscape because slides are 16:9 and a
 * portrait handout wastes half the page on a title slide. react-pdf measures in
 * PostScript points, so the conversion factor is stated once here.
 */
export const PAGE_WIDTH_MM = 297;
export const PAGE_HEIGHT_MM = 210;
const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;
export const MARGIN_MM = 15;

export function millimetresToPoints(millimetres: number): number {
  return (millimetres / MM_PER_INCH) * POINTS_PER_INCH;
}

/**
 * Build the react-pdf element tree.
 *
 * Takes the react-pdf primitives as an argument instead of importing them, so
 * that this function stays testable and so that the heavy library is only
 * pulled into the bundle by the caller that actually exports (see
 * `exportPresentationToPdfBlob`, which imports it dynamically).
 */
// The `as unknown as` casts at the call site below are the price of this
// indirection. They are confined to one function and are narrowing a
// structurally-compatible component type, not erasing it to `any`.
export interface PdfPrimitives {
  Document: ComponentType<{ children?: ReactNode; title?: string }>;
  Page: ComponentType<{
    children?: ReactNode;
    size?: string;
    orientation?: "portrait" | "landscape";
    style?: Record<string, unknown>;
  }>;
  View: ComponentType<{
    children?: ReactNode;
    style?: Record<string, unknown>;
  }>;
  Text: ComponentType<{
    children?: ReactNode;
    style?: Record<string, unknown>;
  }>;
  Image: ComponentType<{ src: string; style?: Record<string, unknown> }>;
}

export function buildPdfDocument(
  primitives: PdfPrimitives,
  presentation: Presentation,
  options: PdfExportOptions = {},
): ReactElement {
  const { Document, Page, View, Text, Image } = primitives;
  const pages = presentationToPdfPages(presentation, options);
  const { primary, surface } = appConfig.branding.colors;
  const foreground = readableForeground(surface);
  const muted = foreground === "#000000" ? "#555555" : "#cccccc";

  const renderBlock = (block: PdfBlock, key: number): ReactElement => {
    switch (block.kind) {
      case "text":
        return createElement(
          Text,
          {
            key,
            style: {
              marginBottom: 8,
              fontSize: block.emphasis === "large" ? 16 : 12,
              color: block.emphasis === "muted" ? muted : foreground,
            },
          },
          block.text,
        );
      case "bullets":
        return createElement(
          View,
          { key, style: { marginBottom: 8 } },
          block.items.map((item, index) =>
            createElement(
              Text,
              {
                key: index,
                style: { fontSize: 12, marginBottom: 4, color: foreground },
              },
              // A literal bullet character rather than a list primitive:
              // react-pdf has no list element, and every "bullet" workaround is
              // this string with extra indirection.
              `• ${item}`,
            ),
          ),
        );
      case "code":
        return createElement(
          View,
          {
            key,
            style: { marginBottom: 8, padding: 8, backgroundColor: "#f2f2f2" },
          },
          createElement(
            Text,
            { style: { fontFamily: "Courier", fontSize: 10, color: "#111111" } },
            block.code,
          ),
        );
      case "quote":
        return createElement(
          View,
          { key, style: { marginBottom: 8 } },
          createElement(
            Text,
            { style: { fontSize: 16, color: foreground } },
            `“${block.quote}”`,
          ),
          block.attribution === undefined
            ? null
            : createElement(
                Text,
                { style: { fontSize: 11, marginTop: 6, color: muted } },
                `— ${block.attribution}`,
              ),
        );
      case "image":
        // No alt text: PDF image alternate text needs tagged-PDF support that
        // react-pdf does not emit. The alt is preserved as a visible caption
        // instead, which is the only way the information survives the format.
        return createElement(
          View,
          { key, style: { marginBottom: 8 } },
          createElement(Image, {
            src: block.src,
            style: { maxHeight: 260, objectFit: "contain" },
          }),
          createElement(
            Text,
            { style: { fontSize: 10, marginTop: 4, color: muted } },
            block.alt,
          ),
        );
    }
  };

  return createElement(
    Document,
    { title: presentation.title },
    pages.map((page) =>
      createElement(
        Page,
        {
          key: page.slideNumber,
          size: "A4",
          orientation: "landscape",
          style: {
            padding: millimetresToPoints(MARGIN_MM),
            backgroundColor: "#ffffff",
          },
        },
        page.heading === undefined
          ? null
          : createElement(
              Text,
              {
                style: {
                  fontSize: 20,
                  marginBottom: 12,
                  color: primary,
                },
              },
              page.heading,
            ),
        createElement(
          View,
          { style: { flexGrow: 1 } },
          page.blocks.map(renderBlock),
        ),
        page.speakerNotes === undefined
          ? null
          : createElement(
              Text,
              { style: { fontSize: 9, marginTop: 8, color: muted } },
              `Notes: ${page.speakerNotes}`,
            ),
        createElement(
          Text,
          {
            style: {
              position: "absolute",
              bottom: millimetresToPoints(8),
              right: millimetresToPoints(MARGIN_MM),
              fontSize: 9,
              color: muted,
            },
          },
          String(page.slideNumber),
        ),
      ),
    ),
  );
}

/**
 * Render the presentation to a PDF Blob in the browser.
 *
 * Async and dynamically imported: @react-pdf/renderer is roughly half a
 * megabyte of font machinery, and no page should pay for it until someone
 * clicks Export.
 */
export async function exportPresentationToPdfBlob(
  presentation: Presentation,
  options: PdfExportOptions = {},
): Promise<Blob> {
  const reactPdf = await import("@react-pdf/renderer");
  const primitives: PdfPrimitives = {
    Document: reactPdf.Document as unknown as PdfPrimitives["Document"],
    Page: reactPdf.Page as unknown as PdfPrimitives["Page"],
    View: reactPdf.View as unknown as PdfPrimitives["View"],
    Text: reactPdf.Text as unknown as PdfPrimitives["Text"],
    Image: reactPdf.Image as unknown as PdfPrimitives["Image"],
  };
  const document = buildPdfDocument(primitives, presentation, options);
  // react-pdf types its entry point as `ReactElement<DocumentProps>`, which the
  // primitive-injection indirection above deliberately erases. The narrowing is
  // to react-pdf's OWN parameter type, so it cannot drift from the library.
  return reactPdf
    .pdf(document as Parameters<typeof reactPdf.pdf>[0])
    .toBlob();
}

/**
 * The documented fallback for a pixel-faithful PDF.
 *
 * Surfaced in the export UI next to the PDF button rather than hidden in a
 * README, because a user who wants slide-shaped pages needs to know this route
 * exists at the moment they are choosing a format.
 */
export const PRINT_TO_PDF_INSTRUCTIONS = [
  "Export the presentation as HTML.",
  "Open the downloaded .html file in Chrome, Edge or Firefox.",
  "Choose File > Print, then Save as PDF.",
  "Set the layout to Landscape and margins to None for one slide per page.",
] as const;
