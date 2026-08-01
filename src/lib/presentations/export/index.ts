// =============================================================================
// EXPORT SURFACE
// -----------------------------------------------------------------------------
// One place for the UI to import from, and one place that knows which formats
// exist. `downloadBlob` lives here rather than in a generic util because the
// filename rules (sanitised deck title, correct extension) are export policy,
// not a generic browser helper.
// =============================================================================

export {
  escapeHtml,
  exportDeckToHtml,
  htmlExportBlob,
  slideBodyHtml,
  type HtmlExportOptions,
} from "./html";

export {
  buildPdfDocument,
  exportPresentationToPdfBlob,
  millimetresToPoints,
  presentationToPdfPages,
  slideToPdfPage,
  MARGIN_MM,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  PRINT_TO_PDF_INSTRUCTIONS,
  type PdfBlock,
  type PdfExportOptions,
  type PdfPageModel,
  type PdfPrimitives,
} from "./pdf";

export const EXPORT_FORMATS = ["html", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Turn a deck title into a safe filename stem.
 *
 * Windows rejects `\ / : * ? " < > |` outright and a download with one of those
 * in the name fails silently in Edge, so the set is stripped rather than
 * escaped. Truncated to 80 characters because some filesystems cap the
 * component at 255 bytes and a UTF-8 title can be three bytes per character.
 */
export function exportFilename(title: string, format: ExportFormat): string {
  const stem =
    title
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "presentation";
  return `${stem}.${format}`;
}

/**
 * Trigger a browser download for an already-built Blob.
 *
 * The object URL is revoked on the next macrotask rather than immediately:
 * Safari cancels an in-flight download if the URL is revoked in the same tick
 * as the click.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
