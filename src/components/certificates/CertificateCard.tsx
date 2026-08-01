// =============================================================================
// CERTIFICATE CARD — one issued credential, as the holder sees it.
// Owner: certificates stream.
// -----------------------------------------------------------------------------
// A SERVER COMPONENT WITH NO CLIENT JAVASCRIPT. Both actions are plain <a>
// elements: the download is a GET to the PDF route and the verify link is a GET
// to a public page. Neither needs state, so neither needs "use client" — and a
// credential that renders without JavaScript is a credential that still works in
// a locked-down browser or a print view.
//
// THE TESTID SITS ON THE `Card` ELEMENT ITSELF, not on an inner div. `Card`
// renders `title` in a header that is a SIBLING of `children`
// (src/components/ui/Card.tsx), so a testid placed on a wrapper inside `children`
// scopes assertions to a subtree that excludes the heading. That is how a sibling
// stream lost 12 course-card specs today — see CHANGELOG.log 2026-07-31 15:20.
// =============================================================================

import { Badge, Card } from "@/components/ui";

export interface CertificateCardProps {
  certificateId: number;
  recipientName: string;
  courseTitle: string;
  /** ISO-8601 date, already formatted for display (YYYY-MM-DD, UTC). */
  completedOn: string;
  weeksCompleted: number;
  weeksTotal: number;
  verificationCode: string;
  /** Origin-relative. See verificationPath in @/lib/certificates/verification. */
  verifyPath: string;
  pdfPath: string;
  revoked: boolean;
}

export function CertificateCard({
  certificateId,
  recipientName,
  courseTitle,
  completedOn,
  weeksCompleted,
  weeksTotal,
  verificationCode,
  verifyPath,
  pdfPath,
  revoked,
}: CertificateCardProps) {
  return (
    <Card
      data-testid="certificate-card"
      data-certificate-id={certificateId}
      title={courseTitle}
      subtitle={`Awarded to ${recipientName}`}
      action={
        revoked ? (
          <Badge tone="danger">Revoked</Badge>
        ) : (
          <Badge tone="success">Completed</Badge>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Completed</dt>
          <dd data-testid="certificate-completed-on">{completedOn}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Weeks</dt>
          <dd>
            {weeksCompleted} of {weeksTotal}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            Verification code
          </dt>
          {/* Monospaced for the same reason the PDF uses Courier for it: this is
              the one string a human may retype off paper, and hex "0" against
              "O" in a proportional face is a support ticket. */}
          <dd className="font-mono text-xs break-all" data-testid="certificate-code">
            {verificationCode}
          </dd>
        </div>
      </dl>

      {revoked ? (
        <p className="mt-4 text-sm text-ink-muted" data-testid="certificate-revoked-note">
          This certificate has been withdrawn, so it can no longer be downloaded.
          The verification link still works and reports the withdrawal.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          {/*
            A plain link, not a fetch + blob dance. The route answers with
            Content-Disposition: attachment, so the browser saves the file and the
            page never has to hold a credential in memory.

            `download` is NOT set: the filename comes from the response header,
            which is the server's business, and a client-side hint would silently
            win over it.
          */}
          <a
            href={pdfPath}
            data-testid="certificate-download"
            className="inline-flex items-center rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Download PDF
          </a>
          <a
            href={verifyPath}
            data-testid="certificate-verify-link"
            className="inline-flex items-center rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-surface"
          >
            Open the public verification page
          </a>
        </div>
      )}
    </Card>
  );
}
