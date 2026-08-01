// =============================================================================
// /admin/certificates/templates — the certificate template surface.
// Owner: certificates stream.
// -----------------------------------------------------------------------------
// ADMIN ONLY, at two levels, exactly as /admin/videos does it: the `(staff)`
// layout already applied `requireRole("instructor")`, which admits instructors
// too (`ROLES_SATISFYING.instructor` is ["instructor","admin"]), so this page
// restates `requireRole("admin")` because the template appears on every student's
// credential. A page guard protects the render, not a mutation — there are no
// mutations here yet, and when there are, each server action must repeat the
// guard.
//
// THIS PAGE IS READ-ONLY, AND SAYING SO IS THE POINT.
// IMPLEMENTATION_ROADMAP.md line 178 asks for "template management". What ships
// here is the half that has a correct answer today:
//
//   * WHICH TEMPLATE IS IN FORCE, resolved by the same `resolveActiveTemplate`
//     the download path uses — so this screen cannot disagree with the PDF.
//   * WHETHER IT IS A DATABASE ROW OR THE BUILT-IN DEFAULT, which is the first
//     question an admin who edits a row and sees no change will have.
//   * THE EXACT PLACEHOLDER LIST, derived from `TEMPLATE_PLACEHOLDERS` rather
//     than retyped, so it cannot go stale.
//   * A LIVE PREVIEW of the compiled text against sample data, including whether
//     the template FAILED to compile and fell back — a broken template otherwise
//     shows up only as a subtly wrong PDF that a student receives.
//
// TODO(certificates): an EDIT form (name, body, accent colour, font, activate)
// behind a server action that repeats `requireRole("admin")`, plus a revoke
// control wired to `revokeCertificate`. Both are deliberately out of this change:
// the write side needs its own e2e coverage of the authorization boundary, and
// nothing about a credential should be editable through a screen whose negative
// paths have not been tested. Until then a template row is created by SQL or a
// seed script, and the built-in default is what every certificate uses.
// =============================================================================

import type { Metadata } from "next";

import { Badge, Card } from "@/components/ui";
import { appConfig } from "@/lib/config/app.config";
import { requireRole } from "@/lib/guard";
import { listTemplates, resolveActiveTemplate } from "@/lib/certificates/store";
import {
  RENDERABLE_FONTS,
  TEMPLATE_PLACEHOLDERS,
  formatCertificateDate,
  renderTemplate,
  type CertificateView,
} from "@/lib/certificates/template";

export const metadata: Metadata = {
  title: "Certificate templates",
};

export const dynamic = "force-dynamic";

/**
 * Sample data for the preview. Obviously fictitious — "Sample Student", a code of
 * all zeroes — because a preview populated with a REAL student's name and a real
 * verification code would put a live credential on an admin screen and into any
 * screenshot of it.
 */
function sampleView(now: Date): CertificateView {
  return {
    recipientName: "Sample Student",
    courseTitle: appConfig.course.title,
    organizationName: appConfig.branding.organizationName,
    completedOn: formatCertificateDate(now),
    issuedOn: formatCertificateDate(now),
    weeksCompleted: String(appConfig.course.durationWeeks),
    weeksTotal: String(appConfig.course.durationWeeks),
    verificationCode: "0".repeat(32),
    verificationUrl: `https://example.invalid/verify/${"0".repeat(32)}`,
  };
}

export default async function CertificateTemplatesPage() {
  await requireRole("admin", "/admin/certificates/templates");

  const [active, all] = await Promise.all([resolveActiveTemplate(), listTemplates()]);
  const preview = renderTemplate(active.bodyTemplate, sampleView(new Date()));

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6"
      data-testid="certificate-templates-page"
    >
      <header>
        <h1 className="text-2xl font-semibold">Certificate templates</h1>
        <p className="text-sm text-ink-muted">
          The template decides how a certificate LOOKS. What it asserts — the name,
          the course and the dates — is frozen on each certificate when it is
          issued, so editing a template never changes what an existing credential
          says.
        </p>
      </header>

      <Card
        data-testid="active-template"
        data-template-source={active.id === null ? "built-in" : "database"}
        title={active.name}
        subtitle={
          active.id === null
            ? "Built-in default — no row in certificate_templates is active"
            : `certificate_templates row #${active.id}`
        }
        action={<Badge tone={active.id === null ? "neutral" : "brand"}>In force</Badge>}
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Accent</dt>
            <dd className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block size-4 rounded border border-line"
                style={{ backgroundColor: active.accentColor }}
              />
              <span className="font-mono text-xs">{active.accentColor}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Font</dt>
            <dd>{active.fontFamily}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Logo</dt>
            {/* Named honestly: a stored SVG path is accepted by the column and
                ignored by the renderer, because @react-pdf's <Image> draws PNG and
                JPEG only. See resolveLogoSrc. */}
            <dd>{active.logoPath ?? "None (PNG or JPEG only)"}</dd>
          </div>
        </dl>

        <h2 className="mt-6 text-sm font-semibold">Preview, with sample data</h2>
        <pre
          className="mt-2 whitespace-pre-wrap rounded-md border border-line bg-surface p-3 text-sm"
          data-testid="template-preview"
        >
          {preview.text}
        </pre>
        {preview.usedFallback && (
          <p
            className="mt-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
            data-testid="template-compile-error"
          >
            This template failed to compile and the built-in default was used
            instead. Students still receive a correct certificate. Error:{" "}
            {preview.error}
          </p>
        )}
      </Card>

      <Card title="Placeholders a template may use" data-testid="template-placeholders">
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {TEMPLATE_PLACEHOLDERS.map((name) => (
            <li key={name} className="font-mono text-xs">{`{{${name}}}`}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-ink-muted">
          Anything else renders blank rather than raising an error — a visible gap
          is easier to spot on a proof than the word &quot;undefined&quot; printed
          on a credential. The body is plain text, not HTML: the PDF is drawn with
          @react-pdf/renderer, which has no HTML renderer, so markup would be
          printed literally.
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Fonts are limited to {RENDERABLE_FONTS.join(", ")} — the four compiled
          into the PDF library. Any other value falls back to Helvetica rather than
          fetching a font file over the network mid-download.
        </p>
      </Card>

      <Card title={`Stored templates (${all.length})`} data-testid="template-list">
        {all.length === 0 ? (
          <p className="text-sm text-ink-muted">
            None. Every certificate uses the built-in default, which is a supported
            state — a student&apos;s earned credential is never blocked on this
            screen having been visited. Editing is not implemented yet; see the
            TODO at the top of this file.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {all.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3">
                <span className="truncate">
                  #{t.id} {t.name}
                </span>
                {t.id === active.id ? <Badge tone="brand">Active</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
