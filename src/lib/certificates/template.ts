// =============================================================================
// CERTIFICATE TEMPLATES — handlebars -> plain text, plus the built-in default.
// Owner: certificates stream.
// -----------------------------------------------------------------------------
// HANDLEBARS COMPILES TO TEXT HERE, NOT TO HTML, and every decision below follows
// from that one fact. The roadmap names both `handlebars` and
// `@react-pdf/renderer` (IMPLEMENTATION_ROADMAP.md:161,173), and @react-pdf does
// not render HTML — it renders its own primitives (Document/Page/View/Text). See
// the comment on `certificate_templates.body_template` in
// src/db/schema.certificates.ts for the full argument; the short version is that
// an HTML template would either print its own tags onto the certificate or
// require headless Chromium, which the free hosting tier cannot run.
//
// THREE CONSEQUENCES WORTH STATING BEFORE THEY SURPRISE SOMEONE:
//
//  1. `noEscape: true`. Handlebars' default escapes for HTML, so a student named
//     O'Brien would appear on their own certificate as "O&#x27;Brien". The output
//     goes into a PDF text node, which has no markup semantics, so escaping is
//     not a safety measure here — it is a corruption. THE INJECTION QUESTION IS
//     ANSWERED ELSEWHERE: the only untrusted value is the recipient's name, and
//     it lands in a <Text> node that cannot execute anything. The TEMPLATE ITSELF
//     is admin-authored, i.e. trusted to the same degree as any other admin
//     content in this app.
//
//  2. A BROKEN TEMPLATE MUST NOT BREAK CREDENTIALS. `renderTemplate` catches
//     compile and evaluation failures and falls back to the built-in default,
//     because the alternative is that one admin typo makes every student's
//     download 500 at once. The failure is returned as a value (`usedFallback`)
//     so the admin screen can say so rather than silently looking fine.
//
//  3. UNKNOWN PLACEHOLDERS RESOLVE TO EMPTY, NOT TO "undefined". Handlebars'
//     default for a missing key is an empty string, which is the right behaviour
//     for a printed document: a blank is a visible gap an admin will notice,
//     whereas the literal word "undefined" printed on a credential looks like
//     data.
//
// All lengths in this file are millimetres where they describe paper, per the
// house metric rule; PDF points are converted at the one place they are used
// (see src/lib/certificates/pdf.tsx).
// =============================================================================

import Handlebars from "handlebars";

import type { Certificate, CertificateTemplate } from "@/db/schema.certificates";

/**
 * The fonts @react-pdf/renderer can draw with NO network access.
 *
 * The roadmap's default is 'Inter' (schema line 164), which @react-pdf can only
 * use after `Font.register` fetches a .ttf at render time. That would put an
 * external HTTP call inside the one code path a student is waiting on, on a stack
 * whose stated premise is no external services (FREE_STACK.md). These four are
 * compiled into the library.
 */
export const RENDERABLE_FONTS = ["Helvetica", "Times-Roman", "Courier", "Symbol"] as const;
export type RenderableFont = (typeof RENDERABLE_FONTS)[number];

/**
 * Coerce a stored font name to one @react-pdf can actually draw.
 *
 * Falls back rather than throwing: a bad value in one admin-editable column must
 * not make every certificate in the cohort undownloadable, which is what a throw
 * inside the render path would do.
 */
export function assertRenderableFont(value: string | null | undefined): RenderableFont {
  return (RENDERABLE_FONTS as readonly string[]).includes(value ?? "")
    ? (value as RenderableFont)
    : "Helvetica";
}

/** `#rrggbb` or `#rgb`. Anchored, lowercase-insensitive. */
const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Coerce a stored accent colour, same fallback reasoning as the font.
 *
 * A non-hex string reaching @react-pdf's style parser is not a caught error —
 * it is a silently mis-drawn page or a throw deep in a layout pass, neither of
 * which points at the column that caused it.
 */
export function assertHexColour(value: string | null | undefined, fallback = "#4f5bd5"): string {
  return value && HEX_COLOUR.test(value) ? value : fallback;
}

/**
 * EXACTLY the placeholders a template may use.
 *
 * Declared as a type rather than "whatever the row happens to have" so that the
 * admin screen can list them and so `describePlaceholders` cannot go stale. Every
 * one of these is a FROZEN SNAPSHOT column on the certificate row, never a live
 * join — see departure note 3 in src/db/schema.certificates.ts.
 */
export interface CertificateView {
  /** The recipient's name as it was at issuance. */
  recipientName: string;
  /** The course title as it was at issuance. */
  courseTitle: string;
  organizationName: string;
  /** Completion date, already formatted for display (ISO-8601 date, UTC). */
  completedOn: string;
  /** Issue date, same format. */
  issuedOn: string;
  weeksCompleted: string;
  weeksTotal: string;
  /** The public code, for printing under the verify line. */
  verificationCode: string;
  /** Absolute verify URL, because a printed page has no origin to resolve against. */
  verificationUrl: string;
}

/** Human-readable list for the admin screen. Derived from one source, not two. */
export const TEMPLATE_PLACEHOLDERS: ReadonlyArray<keyof CertificateView> = [
  "recipientName",
  "courseTitle",
  "organizationName",
  "completedOn",
  "issuedOn",
  "weeksCompleted",
  "weeksTotal",
  "verificationCode",
  "verificationUrl",
];

/**
 * THE BUILT-IN DEFAULT, and the reason the feature works with zero rows in
 * `certificate_templates`.
 *
 * An admin-editable template that is REQUIRED would mean a student's earned
 * credential is blocked on somebody having visited a settings screen. This is
 * also what a fresh checkout and the e2e suite render, so the default is the
 * thing that is actually tested rather than a fixture nobody ships.
 *
 * Deliberately says nothing about marks. The certificate attests COMPLETION;
 * printing a score would turn a credential into a transcript, and
 * `scorePoints` is recorded on the row as evidence rather than published.
 */
export const DEFAULT_BODY_TEMPLATE = [
  "This certifies that {{recipientName}} has successfully completed",
  "all {{weeksTotal}} weeks of {{courseTitle}}, awarded by {{organizationName}}",
  "on {{completedOn}}.",
].join("\n");

export const DEFAULT_TEMPLATE_NAME = "Built-in default";

/**
 * A template as the renderer consumes it — a database row OR the built-in
 * default, flattened so the renderer never has to ask which it got.
 */
export interface ResolvedTemplate {
  /** Null when this is the built-in default and no row was involved. */
  id: number | null;
  name: string;
  bodyTemplate: string;
  logoPath: string | null;
  accentColor: string;
  fontFamily: RenderableFont;
}

/** The built-in default, with the app's own branding applied. */
export function builtInTemplate(branding: {
  logoPath?: string | null;
  accentColor?: string | null;
}): ResolvedTemplate {
  return {
    id: null,
    name: DEFAULT_TEMPLATE_NAME,
    bodyTemplate: DEFAULT_BODY_TEMPLATE,
    // Null rather than appConfig.branding.logoPath by default: the logo file is a
    // TODO(decision) in app.config.ts ("supply a logo file at /public/logo.svg
    // (yes/no pending)"), and @react-pdf throws on a missing image source. A
    // certificate with no logo is fine; a certificate that fails to render is not.
    logoPath: branding.logoPath ?? null,
    accentColor: assertHexColour(branding.accentColor),
    fontFamily: "Helvetica",
  };
}

/** Flatten a database row into the same shape, coercing the two risky columns. */
export function fromRow(row: CertificateTemplate): ResolvedTemplate {
  return {
    id: row.id,
    name: row.name,
    bodyTemplate: row.bodyTemplate,
    logoPath: row.logoPath,
    accentColor: assertHexColour(row.accentColor),
    fontFamily: assertRenderableFont(row.fontFamily),
  };
}

export interface RenderedBody {
  /** The compiled text, ready for a <Text> node. Lines are separated by "\n". */
  text: string;
  /** True when the supplied template failed and the default was used instead. */
  usedFallback: boolean;
  /** The compile/evaluation error, for the admin screen. Null on success. */
  error: string | null;
}

/**
 * Compile one template against one certificate's frozen facts.
 *
 * NEVER THROWS. See consequence 2 in the file header: the caller is a download
 * request for a credential the student has already earned, and a template error
 * is an admin's problem that must not become the student's.
 */
export function renderTemplate(bodyTemplate: string, view: CertificateView): RenderedBody {
  try {
    // `strict: false` (the default) is deliberate — see consequence 3. A missing
    // placeholder renders blank, which a proof-reader notices, rather than
    // throwing inside a download.
    const compiled = Handlebars.compile(bodyTemplate, { noEscape: true });
    return { text: compiled(view), usedFallback: false, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      const fallback = Handlebars.compile(DEFAULT_BODY_TEMPLATE, { noEscape: true });
      return { text: fallback(view), usedFallback: true, error: message };
    } catch {
      // The built-in default failing means the handlebars install itself is
      // broken. Emit the one sentence that still makes the PDF a valid credential
      // rather than returning empty text.
      return {
        text: `This certifies that ${view.recipientName} has completed ${view.courseTitle}.`,
        usedFallback: true,
        error: message,
      };
    }
  }
}

/** ISO-8601 date (YYYY-MM-DD) in UTC — the format every timestamp in this app uses. */
export function formatCertificateDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Certificate row + absolute verify URL -> the template's view model.
 *
 * `verificationUrl` is passed IN rather than built here because only the request
 * handler knows the origin it was reached on, and baking an origin into a stored
 * or derived value is the defect CHANGELOG.log records at 2026-07-31 15:40.
 */
export function toCertificateView(
  certificate: Pick<
    Certificate,
    | "recipientName"
    | "courseTitle"
    | "completedAt"
    | "issuedAt"
    | "weeksCompleted"
    | "weeksTotal"
    | "verificationCode"
  >,
  options: { organizationName: string; verificationUrl: string },
): CertificateView {
  return {
    recipientName: certificate.recipientName,
    courseTitle: certificate.courseTitle,
    organizationName: options.organizationName,
    completedOn: formatCertificateDate(certificate.completedAt),
    issuedOn: formatCertificateDate(certificate.issuedAt),
    weeksCompleted: String(certificate.weeksCompleted),
    weeksTotal: String(certificate.weeksTotal),
    verificationCode: certificate.verificationCode,
    verificationUrl: options.verificationUrl,
  };
}
