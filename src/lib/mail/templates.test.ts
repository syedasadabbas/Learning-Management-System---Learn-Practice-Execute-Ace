// =============================================================================
// MAIL TEMPLATE TESTS — the graded-submission notification.
// Added by the async-queues stream alongside the template itself.
// -----------------------------------------------------------------------------
// The reset template is exercised through src/lib/mail/index.test.ts and the
// account stream's specs; this file covers only the notification added for the
// queue, and concentrates on the two things that are easy to get wrong in an
// email: the length budget and the escaping of instructor-authored text.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  FEEDBACK_PREVIEW_CHARS,
  previewFeedback,
  renderSubmissionGradedMail,
} from "./templates";

const base = {
  name: "Demo Student",
  assignmentTitle: "Week 2 — Responsive Layout",
  stars: 4,
  score: 36,
  maxScore: 40,
  feedback: "Nice work.",
  url: "https://lms.example.test/assignments/2",
  appName: "Code Queens LMS",
};

describe("previewFeedback", () => {
  it("returns null for nothing to quote, so the block is omitted entirely", () => {
    expect(previewFeedback(null)).toBeNull();
    expect(previewFeedback("")).toBeNull();
    expect(previewFeedback("   \n  ")).toBeNull();
  });

  it("passes short feedback through, trimmed", () => {
    expect(previewFeedback("  good  ")).toBe("good");
  });

  it("caps long feedback at the budget and marks the elision", () => {
    // `gradeSubmissionSchema` permits 4000 characters. Quoting all of it makes
    // the message long and makes it look machine-generated to a spam filter,
    // while duplicating a source of truth the instructor can still edit.
    const long = "a".repeat(4_000);
    const out = previewFeedback(long)!;
    expect(out.length).toBe(FEEDBACK_PREVIEW_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not elide at exactly the limit", () => {
    const exact = "b".repeat(FEEDBACK_PREVIEW_CHARS);
    expect(previewFeedback(exact)).toBe(exact);
  });
});

describe("renderSubmissionGradedMail", () => {
  it("states the score against its maximum, so the number reads alone", () => {
    // "36" in an email means nothing without "/ 40".
    const mail = renderSubmissionGradedMail(base);
    expect(mail.text).toContain("36 / 40");
    expect(mail.html).toContain("36 / 40");
  });

  it("renders the star rating as filled and empty stars out of five", () => {
    const mail = renderSubmissionGradedMail({ ...base, stars: 3 });
    expect(mail.text).toContain("★★★☆☆ (3/5)");
  });

  it("survives a zero rating without producing a negative repeat count", () => {
    // `instructor_rating` is nullable and the handler clamps a null to 0; a naive
    // `"☆".repeat(5 - stars)` with stars > 5 would throw a RangeError inside a
    // job handler, which would be classified as a retry and fail forever.
    for (const stars of [0, 5]) {
      expect(() => renderSubmissionGradedMail({ ...base, stars })).not.toThrow();
    }
  });

  it("omits the quote block entirely when there is no feedback", () => {
    const mail = renderSubmissionGradedMail({ ...base, feedback: null });
    expect(mail.text).not.toContain("Instructor feedback:");
    expect(mail.html).not.toContain("<blockquote");
  });

  it("greets anonymously when the name is unknown", () => {
    const mail = renderSubmissionGradedMail({ ...base, name: null });
    expect(mail.text.startsWith("Hello,")).toBe(true);
  });

  it("escapes instructor-authored HTML in both the title and the feedback", () => {
    const mail = renderSubmissionGradedMail({
      ...base,
      assignmentTitle: "<script>x</script>",
      feedback: "<b>bold</b>",
    });
    expect(mail.html).not.toContain("<script");
    expect(mail.html).not.toContain("<b>bold");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("strips CR/LF from the subject — a header value is not markup, it is a header", () => {
    // Escaping does not help here: the subject is not HTML. An embedded CRLF in
    // a header value is a header-injection vector, and an instructor can paste
    // one into an assignment title.
    const mail = renderSubmissionGradedMail({
      ...base,
      assignmentTitle: "Week 2\r\nBcc: attacker@example.com",
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toContain("Week 2 Bcc: attacker@example.com");
  });

  it("carries the link in BOTH parts — a text-only client must still be usable", () => {
    const mail = renderSubmissionGradedMail(base);
    expect(mail.text).toContain(base.url);
    expect(mail.html).toContain(`href="${base.url}"`);
    // Repeated as visible text too, for clients that strip anchors.
    expect(mail.html.split(base.url).length - 1).toBeGreaterThanOrEqual(2);
  });
});
