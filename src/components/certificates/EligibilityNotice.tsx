// =============================================================================
// ELIGIBILITY NOTICE — what a student who has NOT finished the course is told.
// Owner: certificates stream.
// -----------------------------------------------------------------------------
// THE NOT-YET-ELIGIBLE STATE IS THE PRIMARY CASE, NOT THE EDGE CASE, in exactly
// the sense src/app/(app)/dashboard/page.tsx says the zero-activity student is:
// for the whole of a four-week cohort every student sees this and nobody sees a
// certificate. So it has to say something useful, which means naming the weeks
// that are outstanding rather than rendering "not eligible".
//
// It deliberately does NOT show a points percentage or a "you need 100%" bar.
// Completion is delivery of every week, not a score threshold — see the
// EVALUATE-ELIGIBILITY docstring in @/lib/certificates/eligibility for why a
// points reading of "100% complete" is unreachable in this scoring model and
// would move after issuance.
// =============================================================================

import { Card, ProgressBar } from "@/components/ui";
import type { CertificateEligibility } from "@/lib/certificates/eligibility";

export interface EligibilityNoticeProps {
  eligibility: CertificateEligibility;
}

export function EligibilityNotice({ eligibility }: EligibilityNoticeProps) {
  const { weeksCompleted, weeksTotal, outstandingWeekNumbers, reason } = eligibility;

  // Guarded division: `weeksTotal` is 0 on a course with no content, which is a
  // real state (the `no_content` reason exists for it) and the one that produces
  // "NaN%" if the guard is left out.
  const percent = weeksTotal > 0 ? Math.round((weeksCompleted / weeksTotal) * 100) : 0;

  return (
    <Card
      data-testid="certificate-eligibility"
      data-reason={reason ?? "eligible"}
      title="Your certificate is not ready yet"
      subtitle={
        reason === "no_content"
          ? "No course content has been published yet."
          : `${weeksCompleted} of ${weeksTotal} weeks complete`
      }
    >
      {reason === "no_content" ? (
        <p className="text-sm text-ink-muted">
          There is nothing to certify until a course with weeks exists. Nothing is
          wrong with your account.
        </p>
      ) : (
        <>
          <ProgressBar percent={percent} label="Weeks complete" showValue />
          <p className="mt-4 text-sm text-ink-muted">
            A certificate is issued once every week is finished — its lectures, its
            quiz and its assignment delivered. It does not wait for your work to be
            marked.
          </p>
          {outstandingWeekNumbers.length > 0 && (
            <p className="mt-2 text-sm" data-testid="certificate-outstanding-weeks">
              Still outstanding:{" "}
              {outstandingWeekNumbers.map((n) => `Week ${n}`).join(", ")}.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
