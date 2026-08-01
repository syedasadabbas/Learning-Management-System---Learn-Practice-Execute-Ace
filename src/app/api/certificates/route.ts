// =============================================================================
// GET / POST /api/certificates — owned by the certificates stream.
// -----------------------------------------------------------------------------
// GET  : the CALLING student's own certificates.
// POST : issue the CALLING student's certificate, if they have earned it.
//
// SELF-ONLY, WITH NO TARGET PARAMETER AT ALL. Both handlers read the student id
// from the session (`gate.user.id`) and neither accepts a `studentId` in the body,
// the query string or the path. That is the same rule GET /api/me/dashboard states
// ("the id is read from the session, never from a query parameter") and it is the
// reason there is no authorization decision left to get wrong here: there is no
// way to express "someone else's certificate" in a request to this route.
//
// WHY POST IS NOT `"admin"`-GUARDED EVEN THOUGH IT WRITES. It writes exactly one
// row, for the caller, only if the progress read model says they finished the
// course, and a second call returns the first row. The interesting attack — issue
// a credential I have not earned — is not defended by the role check; it is
// defended by `issueCertificate` re-deriving eligibility in the write path. See
// its docstring.
//
// NOT IN `ROUTES` / `ROUTE_AUTH` (src/lib/contracts/api.ts). That map's own
// header records the convention: add-on routes are "declared here, once, by the
// contracts owner — NOT by the streams that implement them", and eight streams
// are editing files concurrently today. The guard level is therefore a local
// constant with the same value the map would carry.
// TODO(shared-contracts): add
//   "GET  /api/certificates": "certificates"                  -> "student"
//   "POST /api/certificates": "certificates"                  -> "student"
//   "GET  /api/certificates/:certificateId/pdf": "certificates" -> "student"
// so the Record<RouteKey, RouteAuth> exhaustiveness check covers them too.
// =============================================================================

import type { RouteAuth } from "@/lib/contracts/api";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { issueCertificate, listOwnCertificates } from "@/lib/certificates/store";
import { verificationPath } from "@/lib/certificates/verification";

/** "student" = any signed-in role, per ROLES_SATISFYING. */
const REQUIRED_AUTH: RouteAuth = "student";

// A certificate can come into existence the moment a student's last assignment is
// ingested, so a cached response here would tell them they have none.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Wire shape. Dates are ISO-8601 UTC strings, declared explicitly for the reason
 * `serialiseDashboard` gives: the payload a client compiles against should be the
 * truth (`string`), not a `Date` that never survives JSON.
 *
 * `scorePoints` IS included here and is NOT on the public verify surface. This
 * response goes only to the certificate's owner, who may of course see their own
 * marks — the privacy boundary is `PublicCertificate` in
 * src/lib/certificates/store.ts, not this type.
 */
interface CertificatePayload {
  id: number;
  courseTitle: string;
  recipientName: string;
  weeksCompleted: number;
  weeksTotal: number;
  scorePoints: number;
  maxScorePoints: number;
  completedAt: string;
  issuedAt: string;
  revokedAt: string | null;
  verificationCode: string;
  /** Origin-relative; see verificationPath for why. */
  verifyPath: string;
  /** Origin-relative download path for the PDF. */
  pdfPath: string;
}

function serialise(row: {
  id: number;
  courseTitle: string;
  recipientName: string;
  weeksCompleted: number;
  weeksTotal: number;
  scorePoints: number;
  maxScorePoints: number;
  completedAt: Date;
  issuedAt: Date;
  revokedAt: Date | null;
  verificationCode: string;
}): CertificatePayload {
  return {
    id: row.id,
    courseTitle: row.courseTitle,
    recipientName: row.recipientName,
    weeksCompleted: row.weeksCompleted,
    weeksTotal: row.weeksTotal,
    scorePoints: row.scorePoints,
    maxScorePoints: row.maxScorePoints,
    completedAt: row.completedAt.toISOString(),
    issuedAt: row.issuedAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    verificationCode: row.verificationCode,
    verifyPath: verificationPath(row.verificationCode),
    pdfPath: `/api/certificates/${row.id}/pdf`,
  };
}

export async function GET(): Promise<Response> {
  const gate = await apiGuard(REQUIRED_AUTH);
  if (!gate.ok) return gate.response;

  try {
    const rows = await listOwnCertificates(gate.user.id);
    return apiOk(rows.map(serialise));
  } catch (err) {
    // Log server-side, return a generic message: driver errors carry the
    // connection host and the failing SQL.
    console.error("[GET /api/certificates] failed", err);
    return apiError(500, "Could not load your certificates.", "certificates_read_failed");
  }
}

export async function POST(): Promise<Response> {
  const gate = await apiGuard(REQUIRED_AUTH);
  if (!gate.ok) return gate.response;

  try {
    const outcome = await issueCertificate({
      studentId: gate.user.id,
      recipientName: gate.user.name,
    });

    switch (outcome.status) {
      case "issued":
        return apiOk(serialise(outcome.certificate), 201);
      case "existing":
        // 200, not 409. The caller asked for their certificate and their
        // certificate is what they get; a double-clicked button is the normal
        // path here, not an error (same stance as `enqueueGradedNotification`'s
        // `created: false`).
        return apiOk(serialise(outcome.certificate));
      case "not_eligible":
        // 403 rather than 404: the resource is not hidden, the caller has not
        // earned it, and telling them exactly what is outstanding is the whole
        // point of the reason payload. Nothing here reveals another student.
        return apiError(
          403,
          outcome.eligibility.reason === "no_content"
            ? "No course content is published yet, so there is nothing to certify."
            : `Finish every week first — ${outcome.eligibility.outstandingWeekNumbers.length} still outstanding.`,
          "not_eligible",
        );
      case "no_course":
        return apiError(503, "No course is configured.", "no_course");
    }
  } catch (err) {
    console.error("[POST /api/certificates] failed", err);
    return apiError(500, "Could not issue your certificate.", "certificate_issue_failed");
  }
}
