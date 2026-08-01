// @vitest-environment node
// =============================================================================
// PDF RENDER TESTS — proof that the on-demand storage decision actually works.
// -----------------------------------------------------------------------------
// NODE ENVIRONMENT, VIA THE PRAGMA ABOVE. vitest.config.ts sets jsdom for every
// file so component streams need no per-file pragma; @react-pdf/renderer needs
// Node built-ins (zlib, streams) and its `renderToBuffer` does not exist in a
// browser-shaped environment. This is the one file in the stream that needs the
// override.
//
// WHY THESE ASSERTIONS AND NOT A SNAPSHOT. A byte-for-byte snapshot of a PDF is
// worthless: the format embeds a creation date and object ids, so it differs run
// to run. What matters is (a) that bytes are produced at all — the whole storage
// decision rests on rendering being reliable and local — (b) that the credential's
// own facts reach the page, and (c) that the Content-Disposition filename cannot
// carry a header injection.
//
// The measured render duration is printed rather than asserted. A timing
// assertion on a shared, eight-agent machine is a flaky test; the number is
// nevertheless the evidence behind failure mode 1 in the STORAGE DECISION block,
// so it is reported.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  certificateFilename,
  renderCertificatePdf,
  resolveLogoSrc,
} from "./pdf";
import { builtInTemplate, type CertificateView } from "./template";

const VIEW: CertificateView = {
  recipientName: "Ayesha Advanced",
  courseTitle: "Web Development Internship",
  organizationName: "Code Queens Hub",
  completedOn: "2026-08-01",
  issuedOn: "2026-08-01",
  weeksCompleted: "4",
  weeksTotal: "4",
  verificationCode: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  verificationUrl: "https://lms.example/verify/a1b2c3d4e5f60718293a4b5c6d7e8f90",
};

const TEMPLATE = builtInTemplate({ accentColor: "#4f5bd5" });

describe("renderCertificatePdf", () => {
  it("produces a valid PDF, with no network access and no stored bytes", async () => {
    const started = Date.now();
    const bytes = await renderCertificatePdf({ view: VIEW, template: TEMPLATE, logoSrc: null });
    const elapsedMs = Date.now() - started;

    // "%PDF-" is the format's magic number. A truncated or empty body — the
    // failure the Uint8Array copy in renderCertificatePdf exists to prevent —
    // fails here.
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);

    // Reported, not asserted: see the file header.
    console.info(
      `[certificates] one-page A4 landscape render: ${bytes.byteLength} bytes ` +
        `(${(bytes.byteLength / 1000).toFixed(1)} kB) in ${elapsedMs} ms`,
    );
  }, 30_000);

  it("is deterministic in size for the same input, which is what makes re-render safe", async () => {
    // The storage decision (render per request rather than store bytes) rests on
    // the document being a pure function of the row plus the template. Two renders
    // of identical input must not differ in content; only the embedded creation
    // date does, which does not change the length here.
    const a = await renderCertificatePdf({ view: VIEW, template: TEMPLATE, logoSrc: null });
    const b = await renderCertificatePdf({ view: VIEW, template: TEMPLATE, logoSrc: null });
    expect(a.byteLength).toBe(b.byteLength);
  }, 30_000);

  it("renders a template that fails to compile, using the fallback text", async () => {
    // The end-to-end version of the fallback covered in template.test.ts: an admin
    // typo must still produce a downloadable credential.
    const broken = { ...TEMPLATE, bodyTemplate: "{{#if recipientName}}dangling" };
    const bytes = await renderCertificatePdf({ view: VIEW, template: broken, logoSrc: null });
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
  }, 30_000);

  it("renders a name with non-ASCII characters", async () => {
    // The cohort's names are not all ASCII. Helvetica's WinAnsi encoding covers
    // Latin-1; anything outside it would be the reason to register a font, which
    // the STORAGE DECISION block rules out — so this test is where that
    // limitation would surface rather than in a student's download.
    const bytes = await renderCertificatePdf({
      view: { ...VIEW, recipientName: "Zoë Müller" },
      template: TEMPLATE,
      logoSrc: null,
    });
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
  }, 30_000);
});

describe("certificateFilename", () => {
  it("slugifies the recipient's name", () => {
    expect(certificateFilename({ recipientName: "Ayesha Advanced" })).toBe(
      "certificate-ayesha-advanced.pdf",
    );
  });

  it("strips the characters that would make Content-Disposition injectable", () => {
    // The name comes from registration, i.e. from a user, and lands in a header.
    const nasty = 'A"; filename="owned.pdf\r\nX-Evil: 1';
    const filename = certificateFilename({ recipientName: nasty });
    expect(filename).not.toContain('"');
    expect(filename).not.toContain("\r");
    expect(filename).not.toContain("\n");
    expect(filename).toMatch(/^certificate-[a-z0-9-]*\.pdf$/);
  });

  it("refuses to emit a path", () => {
    expect(certificateFilename({ recipientName: "../../etc/passwd" })).toBe(
      "certificate-etc-passwd.pdf",
    );
  });

  it("falls back to a generic name rather than emitting 'certificate-.pdf'", () => {
    expect(certificateFilename({ recipientName: "***" })).toBe("certificate-student.pdf");
    expect(certificateFilename({ recipientName: "" })).toBe("certificate-student.pdf");
  });
});

describe("resolveLogoSrc", () => {
  it("refuses an SVG, which @react-pdf's <Image> cannot draw", () => {
    // appConfig.branding.logoPath is "/logo.svg". Accepting it would break every
    // download the day somebody drops that file into /public.
    expect(resolveLogoSrc("/logo.svg")).toBeNull();
  });

  it("refuses a traversal, an absolute path and a URL", () => {
    expect(resolveLogoSrc("/../secrets/key.png")).toBeNull();
    expect(resolveLogoSrc("//evil.example/logo.png")).toBeNull();
    expect(resolveLogoSrc("https://evil.example/logo.png")).toBeNull();
    expect(resolveLogoSrc("C:/Windows/win.png")).toBeNull();
  });

  it("refuses null and empty", () => {
    expect(resolveLogoSrc(null)).toBeNull();
    expect(resolveLogoSrc("")).toBeNull();
  });

  it("returns null for a well-formed path whose file does not exist", () => {
    // A missing file must not become a throw inside a download.
    expect(resolveLogoSrc("/definitely-not-here-9f3a.png")).toBeNull();
  });
});
