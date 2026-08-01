// =============================================================================
// TEMPLATE TESTS — compilation, the two coercions, and the fallback path.
// -----------------------------------------------------------------------------
// The cases that matter here are the ones an admin can cause: a template that
// does not compile, a font that @react-pdf cannot draw, and a colour that is not
// a colour. All three must degrade to a correct certificate rather than to a
// failed download, because the person affected by an admin's typo is a student
// collecting a credential they have already earned.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  DEFAULT_BODY_TEMPLATE,
  TEMPLATE_PLACEHOLDERS,
  assertHexColour,
  assertRenderableFont,
  builtInTemplate,
  formatCertificateDate,
  renderTemplate,
  toCertificateView,
  type CertificateView,
} from "./template";

const VIEW: CertificateView = {
  recipientName: "Ayesha Advanced",
  courseTitle: "Web Development Internship",
  organizationName: "Code Queens Hub",
  completedOn: "2026-08-01",
  issuedOn: "2026-08-01",
  weeksCompleted: "4",
  weeksTotal: "4",
  verificationCode: "a".repeat(32),
  verificationUrl: `https://lms.example/verify/${"a".repeat(32)}`,
};

describe("renderTemplate", () => {
  it("substitutes every declared placeholder", () => {
    const source = TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join("|");
    const out = renderTemplate(source, VIEW);
    expect(out.usedFallback).toBe(false);
    // No placeholder survives, i.e. none is misspelled in the view type.
    expect(out.text).not.toContain("{{");
    expect(out.text).toContain("Ayesha Advanced");
    expect(out.text).toContain(VIEW.verificationCode);
  });

  it("does NOT html-escape, because the output is a PDF text node", () => {
    // The regression this protects against is a real one and it is visible on the
    // printed page: with handlebars' default escaping, O'Brien is rendered
    // "O&#x27;Brien" on the certificate.
    const out = renderTemplate("{{recipientName}}", { ...VIEW, recipientName: "Niamh O'Brien" });
    expect(out.text).toBe("Niamh O'Brien");
    expect(out.text).not.toContain("&#");
  });

  it("renders an unknown placeholder as a blank, not as 'undefined'", () => {
    const out = renderTemplate("Awarded to {{nobody}}.", VIEW);
    expect(out.text).toBe("Awarded to .");
    expect(out.text).not.toContain("undefined");
  });

  it("falls back to the built-in default when a template does not compile", () => {
    // An unclosed block is the realistic admin error. The student must still get a
    // correct certificate, and the admin screen must be able to say what broke.
    const out = renderTemplate("{{#if recipientName}}dangling", VIEW);
    expect(out.usedFallback).toBe(true);
    expect(out.error).toBeTruthy();
    expect(out.text).toContain("Ayesha Advanced");
    expect(out.text).toContain("Web Development Internship");
  });

  it("never throws, whatever it is handed", () => {
    // Belt and braces around the claim in the docstring: this function sits in the
    // download path, so a throw here is a 500 on a credential.
    for (const nasty of ["{{", "{{{", "{{#each}}", "{{> partialThatDoesNotExist}}", ""]) {
      expect(() => renderTemplate(nasty, VIEW)).not.toThrow();
    }
  });

  it("keeps the default template's line structure, which the PDF relies on", () => {
    // pdf.tsx splits on "\n" and emits one <Text> per line, because @react-pdf
    // does not honour newlines inside a single text node. A default template that
    // lost its line breaks would silently render as one long line.
    const out = renderTemplate(DEFAULT_BODY_TEMPLATE, VIEW);
    expect(out.text.split("\n").length).toBeGreaterThan(1);
  });
});

describe("assertRenderableFont", () => {
  it("accepts the four fonts compiled into @react-pdf", () => {
    for (const font of ["Helvetica", "Times-Roman", "Courier", "Symbol"]) {
      expect(assertRenderableFont(font)).toBe(font);
    }
  });

  it("falls back for 'Inter' — the roadmap's default, which needs a font fetch", () => {
    expect(assertRenderableFont("Inter")).toBe("Helvetica");
  });

  it("falls back for null and for nonsense", () => {
    expect(assertRenderableFont(null)).toBe("Helvetica");
    expect(assertRenderableFont("")).toBe("Helvetica");
    expect(assertRenderableFont("comic sans")).toBe("Helvetica");
  });
});

describe("assertHexColour", () => {
  it("accepts 3- and 6-digit hex in either case", () => {
    expect(assertHexColour("#abc")).toBe("#abc");
    expect(assertHexColour("#4F5BD5")).toBe("#4F5BD5");
  });

  it("rejects anything that is not hex, including CSS names and injection attempts", () => {
    for (const bad of ["red", "rgb(1,2,3)", "#12345", "4f5bd5", "#4f5bd5; }", null, undefined]) {
      expect(assertHexColour(bad as string | null)).toBe("#4f5bd5");
    }
  });
});

describe("builtInTemplate", () => {
  it("has no id, so a caller can tell it apart from a database row", () => {
    // `certificates.template_id` is nullable precisely because of this case, and
    // the admin screen keys its "built-in / database" label off it.
    expect(builtInTemplate({}).id).toBeNull();
  });

  it("draws NO logo by default", () => {
    // appConfig's logoPath is a TODO(decision) pointing at an SVG, and @react-pdf's
    // <Image> cannot draw SVG. A default that wired it up would break every
    // download the day the file appears.
    expect(builtInTemplate({}).logoPath).toBeNull();
  });

  it("coerces a bad accent colour rather than passing it to the renderer", () => {
    expect(builtInTemplate({ accentColor: "not-a-colour" }).accentColor).toBe("#4f5bd5");
  });
});

describe("formatCertificateDate", () => {
  it("is an ISO-8601 UTC date, with no local-timezone drift", () => {
    // A local-time formatter would print the day before for anyone west of UTC,
    // which on a certificate is a wrong completion date.
    expect(formatCertificateDate(new Date("2026-08-01T23:30:00.000Z"))).toBe("2026-08-01");
    expect(formatCertificateDate(new Date("2026-01-05T00:00:00.000Z"))).toBe("2026-01-05");
  });
});

describe("toCertificateView", () => {
  it("reads the FROZEN snapshot columns, not live data", () => {
    const view = toCertificateView(
      {
        recipientName: "Snapshot Name",
        courseTitle: "Snapshot Course",
        completedAt: new Date("2026-07-31T10:00:00.000Z"),
        issuedAt: new Date("2026-08-01T10:00:00.000Z"),
        weeksCompleted: 4,
        weeksTotal: 4,
        verificationCode: "b".repeat(32),
      },
      { organizationName: "Code Queens Hub", verificationUrl: "https://x.invalid/verify/bbb" },
    );
    expect(view.recipientName).toBe("Snapshot Name");
    expect(view.completedOn).toBe("2026-07-31");
    expect(view.issuedOn).toBe("2026-08-01");
    // Numbers become strings here so the template never has to think about types.
    expect(view.weeksTotal).toBe("4");
    // The URL is supplied by the caller (the request's origin), never derived.
    expect(view.verificationUrl).toBe("https://x.invalid/verify/bbb");
  });
});
