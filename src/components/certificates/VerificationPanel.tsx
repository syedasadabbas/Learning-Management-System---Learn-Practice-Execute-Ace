// =============================================================================
// VERIFICATION PANEL — what an anonymous third party is shown for a code.
// Owner: certificates stream.
// -----------------------------------------------------------------------------
// THIS COMPONENT IS A PRIVACY BOUNDARY, so its props are a hand-written field
// list and it accepts NO certificate row. It cannot leak a column it was never
// given: the email, the student id, the cohort, the row id and the marks are not
// parameters here, and the projection that feeds it (`PublicCertificate` in
// src/lib/certificates/store.ts) does not select them either. Two layers, both
// explicit, because "remember not to render that field" is not a control.
//
// THE THREE OUTCOMES ARE DISTINCT AND ALL THREE ARE STATED PLAINLY:
//   valid    — issued and in force.
//   revoked  — issued and withdrawn. NOT the same as unknown, and conflating them
//              would let a withdrawn credential read as a forgery and a forgery
//              read as an admin error.
//   unknown  — no certificate has this code. Says nothing about how many exist.
// =============================================================================

import { Badge, Card } from "@/components/ui";

export interface VerificationPanelProps {
  outcome: "valid" | "revoked" | "unknown";
  /** Present for "valid" and "revoked"; absent for "unknown". */
  certificate?: {
    recipientName: string;
    courseTitle: string;
    weeksCompleted: number;
    weeksTotal: number;
    /** Formatted YYYY-MM-DD, UTC. */
    completedOn: string;
    issuedOn: string;
    /** Formatted date, or null when the credential does not expire. */
    expiresOn: string | null;
    revokedOn: string | null;
    revocationReason: string | null;
  };
  /** The code that was looked up, echoed so a verifier can compare it by eye. */
  code: string;
  organizationName: string;
}

export function VerificationPanel({
  outcome,
  certificate,
  code,
  organizationName,
}: VerificationPanelProps) {
  if (outcome === "unknown" || !certificate) {
    return (
      <Card
        data-testid="verification-panel"
        data-outcome="unknown"
        title="No certificate matches this code"
        action={<Badge tone="danger">Not verified</Badge>}
      >
        <p className="text-sm text-ink-muted">
          {organizationName} has not issued a certificate with this verification
          code. Check the code for a typo — it is 32 characters, digits and the
          letters a to f.
        </p>
        <p className="mt-3 font-mono text-xs break-all" data-testid="verification-code">
          {code}
        </p>
      </Card>
    );
  }

  const revoked = outcome === "revoked";

  return (
    <Card
      data-testid="verification-panel"
      data-outcome={revoked ? "revoked" : "valid"}
      title={revoked ? "This certificate has been withdrawn" : "Certificate verified"}
      subtitle={`Issued by ${organizationName}`}
      action={
        revoked ? <Badge tone="warning">Withdrawn</Badge> : <Badge tone="success">Valid</Badge>
      }
    >
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Awarded to</dt>
          <dd className="text-base font-semibold" data-testid="verification-recipient">
            {certificate.recipientName}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">For completing</dt>
          <dd data-testid="verification-course">
            {certificate.courseTitle} — all {certificate.weeksTotal} weeks
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Completed</dt>
          <dd data-testid="verification-completed-on">{certificate.completedOn}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Issued</dt>
          <dd>{certificate.issuedOn}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-muted">Expires</dt>
          {/* "Does not expire" rather than a blank: an empty field reads as
              missing data on a document whose whole job is to be checked. This is
              also the only reader of `certificates.expires_at`, which nothing in
              the repository sets — see the column comment. */}
          <dd>{certificate.expiresOn ?? "Does not expire"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-ink-muted">
            Verification code
          </dt>
          <dd className="font-mono text-xs break-all" data-testid="verification-code">
            {code}
          </dd>
        </div>
      </dl>

      {revoked && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p data-testid="verification-revoked-note">
            Withdrawn on {certificate.revokedOn}. This credential should no longer
            be relied on.
          </p>
          {certificate.revocationReason && (
            <p className="mt-1">Reason given: {certificate.revocationReason}</p>
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-ink-muted">
        This page shows only what is needed to check the credential. It does not
        reveal the holder&apos;s contact details, their marks, or any other
        certificate.
      </p>
    </Card>
  );
}
