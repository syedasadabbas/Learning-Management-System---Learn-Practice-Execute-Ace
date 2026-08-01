// =============================================================================
// STUDENT CERTIFICATE GALLERY — /certificates. Owner: certificates stream.
// -----------------------------------------------------------------------------
// Server component. No client JavaScript at all: the download and verify actions
// are plain links (see CertificateCard) and issuance happens on this render.
//
// ROUTE PROTECTION, three layers, and the middle one is the decision:
//   1. src/middleware.ts gates the "/certificates" prefix at the edge.
//   2. `requireRole("student")` here — which is what src/lib/guard.ts's header
//      calls the real second line of defence, because middleware covers path
//      PREFIXES and a page under an unlisted prefix slips through its matcher.
//   3. Every read is keyed on `user.id` from the session. There is no
//      `?studentId=` to honour and no path parameter, so this page cannot be
//      pointed at another student.
//
// WHY ISSUANCE HAPPENS ON A PAGE READ ("automatic", per IMPLEMENTATION_ROADMAP.md
// line 135), AND WHY THAT IS NOT THE GET-THAT-WRITES ANTI-PATTERN.
//
// The roadmap's suggested trigger is the week-unlock path (line 207), which this
// stream does not own — and a trigger there would fire on a WRITE by a different
// stream's code, coupling certificate issuance to the quizzes and submissions
// transactions. FREE_STACK.md already establishes the alternative this project
// prefers: "lazy finalize on state-read ... so the scheduler is only a safety
// net", which is how the grand-quiz stream finalizes an abandoned attempt.
//
// The usual objection to writing during a GET is that a third party can trigger
// it with an <img src> — the exact argument CHANGELOG.log 2026-07-31 16:00 makes
// against a re-ingest button on a GET. It does not apply here, and the difference
// is worth being precise about: that write acts on OTHER PEOPLE'S data and is
// therefore worth forging. This one creates, at most, the caller's OWN certificate
// for a course the caller has already finished. It is idempotent (one row per
// student per course, enforced by a unique index), it is invisible to the
// attacker, and "I tricked a student into claiming the credential they earned" is
// not an attack. The eligibility decision is re-derived inside
// `issueCertificate`, never trusted from this page.
//
// COST: 1 round trip for eligibility (the same aggregate the dashboard runs), 1
// to read the existing certificate, and — on the single render where the
// certificate first comes into existence — 2 more inside `issueCertificate`.
// =============================================================================

import type { Metadata } from "next";

import { CertificateCard, EligibilityNotice } from "@/components/certificates";
import { appConfig } from "@/lib/config/app.config";
import { requireRole } from "@/lib/guard";
import { getCertificateEligibility } from "@/lib/certificates/eligibility";
import { issueCertificate, listOwnCertificates } from "@/lib/certificates/store";
import { formatCertificateDate } from "@/lib/certificates/template";
import { verificationPath } from "@/lib/certificates/verification";

export const metadata: Metadata = {
  title: `Certificates — ${appConfig.branding.appName}`,
  description: "Your certificates of completion and their public verification links.",
};

// A certificate can come into existence on the very render that follows a final
// submission, so a cached page would tell a student they have none.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CertificatesPage() {
  const user = await requireRole("student", "/certificates");

  const eligibility = await getCertificateEligibility(user.id);

  // Issue only when eligible. `issueCertificate` re-checks anyway — this branch
  // exists to avoid spending a write path's round trips on the ~100% of renders
  // during a live cohort where nobody has finished yet.
  if (eligibility.eligible) {
    const outcome = await issueCertificate({ studentId: user.id, recipientName: user.name });
    if (outcome.status === "no_course") {
      // Only reachable if the course row vanished between the two reads. Nothing
      // to render and nothing the student can do; the eligibility notice is the
      // honest fallback.
      console.error("[certificates] eligible student but no course row", { userId: user.id });
    }
  }

  const held = await listOwnCertificates(user.id);

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6"
      data-testid="certificates-page"
    >
      <header>
        <h1 className="text-2xl font-semibold">Certificates</h1>
        <p className="text-sm text-ink-muted">{appConfig.course.title}</p>
      </header>

      {held.length === 0 ? (
        <EligibilityNotice eligibility={eligibility} />
      ) : (
        <section aria-labelledby="held-heading" className="flex flex-col gap-4">
          <h2 id="held-heading" className="text-lg font-semibold">
            Your credentials
          </h2>
          {held.map((certificate) => (
            <CertificateCard
              key={certificate.id}
              certificateId={certificate.id}
              recipientName={certificate.recipientName}
              courseTitle={certificate.courseTitle}
              completedOn={formatCertificateDate(certificate.completedAt)}
              weeksCompleted={certificate.weeksCompleted}
              weeksTotal={certificate.weeksTotal}
              verificationCode={certificate.verificationCode}
              verifyPath={verificationPath(certificate.verificationCode)}
              pdfPath={`/api/certificates/${certificate.id}/pdf`}
              revoked={certificate.revokedAt !== null}
            />
          ))}
          <p className="text-sm text-ink-muted">
            Anyone you send the verification link to can confirm this certificate
            without signing in. The link does not reveal your email address or your
            marks.
          </p>
        </section>
      )}
    </main>
  );
}
