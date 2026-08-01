// =============================================================================
// CERTIFICATE PDF — the document, and the storage decision behind it.
// Owner: certificates stream.
// =============================================================================
//
// STORAGE DECISION: NOTHING IS STORED. THE PDF IS RENDERED PER REQUEST.
// -----------------------------------------------------------------------------
// IMPLEMENTATION_ROADMAP.md lists `@vercel/blob` as a dependency for this feature
// and gives `certificates.pdf_url` the comment "Vercel Blob URL" (line 150).
// Three options were weighed against FREE_STACK.md, which is the document that
// commits this project to a free tier, and the roadmap's option was REJECTED.
//
//   (A) VERCEL BLOB — REJECTED, and not on a hunch. FREE_STACK.md's rule is
//       explicit: "Every dependency below is free and (where possible) keyless.
//       Where a credential exists, it is the organization's OWN free account,
//       never a paid third-party API", and its "what this means for the code"
//       section states that ".env.example contains no paid keys — only your own
//       DB string, an app SMTP cred (optional), a Piston URL ... and a random
//       cron secret". Vercel Blob needs a provisioned store and a
//       BLOB_READ_WRITE_TOKEN, which is a fourth credential of exactly the kind
//       that list was written to exclude, tied to the hosting vendor, with a
//       free allowance that is a trial rather than a tier. It also adds an
//       external write to the issuance path — a new failure mode on the one
//       operation that must not half-succeed.
//
//   (B) BYTES IN POSTGRES (`bytea`) — REJECTED, though it is the closer call.
//       Size is not the objection: a one-page PDF at these settings is tens of
//       kB, so a 50-80 student cohort is single-digit MB against Neon's free
//       0.5 GB. The objection is that it creates a SECOND SOURCE OF TRUTH.
//       "What does this certificate say" would then be answerable two ways —
//       from the snapshot columns and from the stored bytes — and the moment an
//       admin edits a template, or a bug is fixed in this file, every stored
//       blob is stale in a way nothing detects. It would need a regeneration
//       job, i.e. cache invalidation, which is the whole cost of the option and
//       buys only CPU we are not short of.
//
//   (C) RENDER ON DEMAND, STORE ONLY THE FACTS — CHOSEN. The certificate IS the
//       row (src/db/schema.certificates.ts), whose snapshot columns freeze
//       everything the credential asserts. The bytes are a pure function of that
//       row plus a template, so they can be reproduced at any time and can never
//       disagree with the record. Issuance becomes a single INSERT with no
//       external I/O, and there is nothing to migrate, back up, garbage-collect
//       or regenerate.
//
// THE FAILURE MODE OF (C), STATED RATHER THAN DISCOVERED LATER:
//
//   1. CPU AND LATENCY PER DOWNLOAD. Every download re-renders. MEASURED, not
//      assumed: `npx vitest run src/lib/certificates/pdf.test.tsx` on this machine
//      renders this exact document in 68 ms and produces 3.4 kB (the test prints
//      both, and deliberately does not ASSERT the timing — a wall-clock assertion
//      on a machine running eight agents is a flaky test). For scale, one warm
//      Neon round trip on this deployment is ~245 ms, so a render costs
//      substantially less than the single query that reads the row. The realistic
//      worst case is the end of a cohort: ~80 students downloading once or twice
//      each, which is ~160 renders spread over hours, not a thundering herd. A
//      genuinely concurrent burst would be served by Vercel's per-request
//      isolation and cost only latency. If that ever stops being true the fix is
//      option (B) plus a regeneration job, NOT a blob store.
//
//   2. THE HOBBY-TIER EXECUTION LIMIT. A cold serverless invocation that has to
//      JIT this library could approach a 10 s ceiling. Mitigated structurally,
//      not by hope: the document uses only @react-pdf's four BUILT-IN fonts (see
//      RENDERABLE_FONTS in ./template.ts), so no font is fetched at render time,
//      and the logo is a local /public path rather than a URL. There is no
//      network I/O in this path at all — the only thing that can be slow is CPU.
//
//   3. A BUG HERE CHANGES THE APPEARANCE OF ALREADY-ISSUED CERTIFICATES.
//      Deliberate, and the reason the split between "facts" and "appearance"
//      matters: what the certificate ASSERTS is frozen in the row, so a re-render
//      can restyle a credential but cannot change who earned what. A verifier
//      compares the code against the verify page, not the layout.
//
//   4. NO OFFLINE ARCHIVE. If this app is switched off, the credentials are gone
//      with the database, whereas blobs on a CDN would outlive it. Accepted: the
//      verify link points at this app anyway, so a surviving blob would be an
//      unverifiable PDF. A student who wants a durable copy keeps the file they
//      downloaded, which is the same thing they would do with a paper one.
//
// NO QUEUE, AND WHY THAT IS CONSISTENT WITH src/lib/queue/**. The queue's own
// header (src/lib/queue/types.ts) sets the test for what belongs on it: external
// I/O, retryable, that a human is not waiting on. Rendering a PDF is none of
// those — it is local CPU, deterministic, and the download request IS the person
// waiting. Option (A) would have failed that test in the other direction (an
// external upload IS queue work), which is a further cost of the rejected option.
//
// UNITS: paper is millimetres, per the house metric rule. @react-pdf accepts "mm"
// natively, so no conversion to PDF points happens anywhere in this file.
// =============================================================================

import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

import {
  renderTemplate,
  type CertificateView,
  type ResolvedTemplate,
} from "./template";

/**
 * A4 LANDSCAPE — 297 mm x 210 mm.
 *
 * Landscape because a certificate is read on a wall and printed by a student on
 * whatever printer they own; A4 rather than US Letter because the cohort is not
 * in the United States and A4 is the ISO default everywhere else. @react-pdf's
 * own `size="A4"` constant is used so the dimensions come from the library rather
 * than from two numbers typed here.
 */
const PAGE_SIZE = "A4" as const;

const styles = StyleSheet.create({
  page: {
    // 18 mm of margin all round: comfortably inside the ~10 mm unprintable edge
    // of a domestic inkjet, so a home-printed copy does not clip the border.
    padding: "18mm",
    backgroundColor: "#ffffff",
  },
  // The accent border is drawn as a View rather than a page border because
  // @react-pdf applies page borders inside the padding box, which would put it
  // under the content.
  frame: {
    flexGrow: 1,
    borderWidth: "1.5mm",
    padding: "10mm",
    alignItems: "center",
    justifyContent: "space-between",
  },
  header: { alignItems: "center" },
  logo: { height: "14mm", marginBottom: "4mm", objectFit: "contain" },
  organization: { fontSize: 12, letterSpacing: 2, textTransform: "uppercase" },
  title: { fontSize: 30, marginTop: "6mm" },
  subtitle: { fontSize: 11, marginTop: "2mm", letterSpacing: 1 },
  recipient: { fontSize: 24, marginTop: "8mm", marginBottom: "6mm" },
  body: { fontSize: 13, textAlign: "center", lineHeight: 1.6, maxWidth: "200mm" },
  footer: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  footerBlock: { maxWidth: "110mm" },
  footerLabel: { fontSize: 8, letterSpacing: 1, textTransform: "uppercase" },
  footerValue: { fontSize: 9, marginTop: "1mm" },
  // The code is the one string a human may have to retype off paper, so it is
  // drawn in a monospaced face regardless of the template's body font: in
  // Helvetica a hex "0" and "O" are close enough to cost a support ticket, and
  // Courier is one of the four built-in families so this needs no font fetch.
  code: { fontSize: 10, fontFamily: "Courier", marginTop: "1mm" },
});

export interface CertificateDocumentProps {
  view: CertificateView;
  template: ResolvedTemplate;
  /**
   * Absolute filesystem path or /public-relative path of the logo, already
   * resolved by the caller. Null means draw no logo — see `builtInTemplate`.
   */
  logoSrc: string | null;
}

/**
 * The document. A pure function of its props: same row + same template = same
 * bytes, which is what makes option (C) above sound.
 */
export function CertificateDocument({
  view,
  template,
  logoSrc,
}: CertificateDocumentProps): React.ReactElement {
  const body = renderTemplate(template.bodyTemplate, view);

  return (
    <Document
      title={`Certificate of Completion — ${view.recipientName}`}
      author={view.organizationName}
      subject={view.courseTitle}
      // The verification code goes in the document KEYWORDS as well as on the
      // page, so a copy filed in a document system stays checkable even if the
      // printed text is cropped.
      keywords={`certificate, completion, ${view.verificationCode}`}
      creator={view.organizationName}
      producer={view.organizationName}
    >
      <Page size={PAGE_SIZE} orientation="landscape" style={styles.page}>
        <View style={[styles.frame, { borderColor: template.accentColor }]}>
          <View style={styles.header}>
            {/*
              eslint-disable-next-line jsx-a11y/alt-text --
              This is @react-pdf/renderer's <Image>, not an HTML <img>. It draws
              into a PDF content stream and has no `alt` prop at all — the rule is
              matching on the component NAME. Suppressed here rather than disabled
              for the file so a real <img> added later is still checked.
            */}
            {logoSrc ? <Image src={logoSrc} style={styles.logo} /> : null}
            <Text style={[styles.organization, { fontFamily: template.fontFamily }]}>
              {view.organizationName}
            </Text>
            <Text
              style={[
                styles.title,
                { fontFamily: template.fontFamily, color: template.accentColor },
              ]}
            >
              Certificate of Completion
            </Text>
            <Text style={[styles.subtitle, { fontFamily: template.fontFamily }]}>
              {view.courseTitle}
            </Text>
          </View>

          <View style={styles.header}>
            <Text style={[styles.recipient, { fontFamily: template.fontFamily }]}>
              {view.recipientName}
            </Text>
            {/* One <Text> per line: @react-pdf does not honour "\n" inside a
                single text node the way a browser's white-space rules would, so
                a multi-line template would otherwise render as one long line. */}
            {body.text.split("\n").map((line, i) => (
              <Text key={i} style={[styles.body, { fontFamily: template.fontFamily }]}>
                {line}
              </Text>
            ))}
          </View>

          <View style={styles.footer}>
            <View style={styles.footerBlock}>
              <Text style={[styles.footerLabel, { fontFamily: template.fontFamily }]}>
                Completed
              </Text>
              <Text style={[styles.footerValue, { fontFamily: template.fontFamily }]}>
                {view.completedOn}
              </Text>
            </View>
            <View style={styles.footerBlock}>
              <Text style={[styles.footerLabel, { fontFamily: template.fontFamily }]}>
                Verify at
              </Text>
              <Text style={[styles.footerValue, { fontFamily: template.fontFamily }]}>
                {view.verificationUrl}
              </Text>
              <Text style={styles.code}>{view.verificationCode}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Render the document to bytes.
 *
 * Returns a `Uint8Array` rather than a Node `Buffer` because the caller streams
 * it out of a Web `Response`, and a Buffer's `byteOffset` is not always 0 —
 * passing one straight to `new Response()` has silently truncated bodies
 * elsewhere in the ecosystem. One explicit copy at the boundary is cheaper than
 * that class of bug.
 */
export async function renderCertificatePdf(
  props: CertificateDocumentProps,
): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await renderToBuffer(<CertificateDocument {...props} />);
  // Allocated fresh and copied INTO, rather than `new Uint8Array(buffer.buffer)`:
  // a Node Buffer is a view into a pooled ArrayBuffer whose `byteOffset` is
  // usually non-zero, so wrapping its backing store hands out a window over other
  // allocations — a truncated body at best and a leak of unrelated memory at
  // worst. The explicit `Uint8Array<ArrayBuffer>` return type is also what makes
  // this usable as a `BlobPart`; a `SharedArrayBuffer`-backed view is not one.
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

/**
 * Turn a stored `logo_path` into something @react-pdf's <Image> can actually
 * draw, or null.
 *
 * FOUR WAYS THIS CAN GO WRONG, ALL OF THEM RETURNING NULL RATHER THAN THROWING,
 * because a missing logo is a cosmetic problem and a throw here is a student
 * unable to download a credential they earned:
 *
 *  1. @react-pdf's <Image> understands PNG and JPEG ONLY. It does NOT render SVG
 *     (that is <Svg>, a different component with its own element tree). This
 *     matters concretely: `appConfig.branding.logoPath` is "/logo.svg", so
 *     wiring the configured logo straight through would break every download the
 *     day somebody drops that file in. Only .png/.jpg/.jpeg are accepted.
 *  2. A serverless bundle is not the repository. The file must exist on disk at
 *     render time, so its presence is CHECKED rather than assumed.
 *  3. A stored path is admin input. It is forced to be relative to /public and
 *     any "..", absolute path or URL is refused, so this cannot be turned into a
 *     "read me an arbitrary file off the server" primitive.
 *  4. No remote URLs at all — see failure mode 2 in the file header. Fetching a
 *     logo would put network I/O back into the render path.
 */
export function resolveLogoSrc(logoPath: string | null | undefined): string | null {
  if (!logoPath) return null;
  if (!/^\/[^/\\]/.test(logoPath)) return null; // must be a single-rooted /public path
  if (logoPath.includes("..")) return null;
  if (!/\.(png|jpe?g)$/i.test(logoPath)) return null;

  const absolute = join(process.cwd(), "public", logoPath.replace(/^\//, ""));
  return existsSync(absolute) ? absolute : null;
}

/**
 * The filename a browser saves. ASCII-only and with every separator stripped.
 *
 * `Content-Disposition` is a header, so a name containing a quote or a newline is
 * a header-injection vector, and a name containing "/" or ".." is a path the
 * saving side may interpret. The recipient's name is the untrusted part here —
 * it comes from registration — so it is reduced to letters, digits and hyphens
 * rather than merely quoted.
 */
export function certificateFilename(view: Pick<CertificateView, "recipientName">): string {
  const slug = view.recipientName
    .normalize("NFKD")
    .replace(/[^\p{ASCII}]/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return `certificate-${slug || "student"}.pdf`;
}
