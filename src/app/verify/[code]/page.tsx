// =============================================================================
// PUBLIC CERTIFICATE VERIFICATION — /verify/:code. Owner: certificates stream.
// -----------------------------------------------------------------------------
// WHY THIS PAGE IS AT /verify AND NOT AT /certificates/verify.
//
// This is the ONE surface of this feature that must work with no session, and it
// lives at its own top-level path so that "/certificates" can be protected
// WITHOUT A HOLE IN IT. Nesting the public page under the private prefix would
// have meant adding an exemption to src/middleware.ts's ALWAYS_ALLOWED — the
// mechanism that already exists for /api/account/reset-request, and which that
// file's comment describes as a deliberate, reviewed weakening of a protected
// prefix. Each exemption is a place where a future prefix rule silently stops
// applying. Two disjoint paths need no exemption at all: /certificates is
// entirely private and /verify is entirely public.
//
// WHAT THE SHARED LINK DOES AND DOES NOT REVEAL — the requirement to state this
// plainly. The identifier is 32 hex characters of `crypto.randomBytes` entropy
// (128 bits, src/lib/certificates/verification.ts), so it cannot be guessed and
// carries no information about its holder: it is not derived from the student id,
// the email or the date.
//
//   REVEALS, to anyone holding the link: the recipient's NAME (without which a
//   credential cannot be checked at all), the course title, the number of weeks,
//   the completion and issue dates, the expiry if any, and whether it has been
//   withdrawn and why.
//
//   DOES NOT REVEAL: the holder's email address, their user id, their cohort, any
//   marks or score, the certificate's row id, or the existence of any other
//   certificate. Enforced twice — `findByVerificationCode` selects a narrow
//   projection (it never does `select()`), and `VerificationPanel` takes a
//   hand-written prop list rather than a row. Neither layer can leak a field the
//   other forgot.
//
//   DOES NOT REVEAL BY OMISSION EITHER: an unknown code and a code belonging to a
//   student who has since been deleted both render the same "no certificate
//   matches this code", and no response distinguishes "wrong code" from "no
//   certificates exist".
//
// THE HOLDER CAN NOT UN-SHARE IT. Stated rather than glossed: anyone the student
// forwards the link to keeps it, and a search engine that indexes a code on a
// public CV makes the page findable. That is the nature of a verifiable
// credential — the alternative (require a login to verify) makes it useless to
// the employers it exists for. `robots` below asks crawlers not to index the page
// itself, which is a request and not a control.
//
// NO DATABASE WRITE HAPPENS HERE. See departure note 4 in
// src/db/schema.certificates.ts: the roadmap's `verified_at` column would have
// made this unauthenticated GET mutate a credential row, so any crawler
// following a shared link would edit it.
// =============================================================================

import type { Metadata } from "next";

import { VerificationPanel } from "@/components/certificates";
import { appConfig } from "@/lib/config/app.config";
import { findByVerificationCode } from "@/lib/certificates/store";
import { formatCertificateDate } from "@/lib/certificates/template";
import {
  isVerificationCodeShape,
  normaliseVerificationCode,
} from "@/lib/certificates/verification";

export const metadata: Metadata = {
  title: `Verify a certificate — ${appConfig.branding.appName}`,
  description: "Check whether a certificate of completion was issued and is still valid.",
  // A request, not a control — see the header. The page is reachable either way.
  robots: { index: false, follow: false },
};

// A revocation must take effect immediately. A cached verification page would go
// on asserting a withdrawn credential is valid, which is the one stale answer this
// page must never give.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: raw } = await params;
  const code = normaliseVerificationCode(decodeURIComponent(raw));

  // SHAPE CHECKED BEFORE ANY QUERY. Not a security boundary — a well-formed code
  // that matches nothing is still "not found" — but it is what stops a crawler
  // walking /verify/1, /verify/2, ... from costing a database round trip each on a
  // route that is open to the internet.
  const certificate = isVerificationCodeShape(code) ? await findByVerificationCode(code) : null;

  const outcome = !certificate ? "unknown" : certificate.revokedAt ? "revoked" : "valid";

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-8"
      data-testid="verify-page"
    >
      <header>
        <h1 className="text-2xl font-semibold">Certificate verification</h1>
        <p className="text-sm text-ink-muted">{appConfig.branding.organizationName}</p>
      </header>

      <VerificationPanel
        outcome={outcome}
        code={code}
        organizationName={appConfig.branding.organizationName}
        certificate={
          certificate
            ? {
                recipientName: certificate.recipientName,
                courseTitle: certificate.courseTitle,
                weeksCompleted: certificate.weeksCompleted,
                weeksTotal: certificate.weeksTotal,
                completedOn: formatCertificateDate(certificate.completedAt),
                issuedOn: formatCertificateDate(certificate.issuedAt),
                expiresOn: certificate.expiresAt
                  ? formatCertificateDate(certificate.expiresAt)
                  : null,
                revokedOn: certificate.revokedAt
                  ? formatCertificateDate(certificate.revokedAt)
                  : null,
                revocationReason: certificate.revocationReason,
              }
            : undefined
        }
      />
    </main>
  );
}
