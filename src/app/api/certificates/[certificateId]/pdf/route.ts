// =============================================================================
// GET /api/certificates/:certificateId/pdf — the private download.
// Owner: certificates stream.
// -----------------------------------------------------------------------------
// THIS IS THE ROUTE THE SECURITY REQUIREMENT IS ABOUT: it takes a SEQUENTIAL,
// GUESSABLE id from the URL, so "one student must never be able to fetch
// another student's certificate" is a property this file has to establish rather
// than inherit. Three layers, in order:
//
//   1. src/middleware.ts rejects an anonymous request at the edge on the
//      "/api/certificates" prefix. Fast, and NOT the decision — its own header
//      says so ("defence in depth, not the only defence").
//   2. `apiGuard("student")` here re-checks the session server-side and yields
//      the caller's id. This is the layer the documented rule in src/lib/guard.ts
//      exists for: middleware covers path PREFIXES, and a handler that trusted it
//      would be one routing change away from being open.
//   3. `getOwnCertificateById(id, gate.user.id)` puts the OWNERSHIP RULE IN THE
//      SQL. There is no fetch-by-id-then-compare here, because that pattern is
//      one forgotten `if` away from serving a credential to the wrong person.
//      See the header of src/lib/certificates/store.ts.
//
// A NON-OWNER GETS 404, NOT 403. Deliberate: 403 would confirm that certificate
// #7 exists, which — with sequential ids — tells an enumerating student exactly
// how many of their classmates have finished the course and when they did. "Not
// found" is also the honest answer to the question this route actually asks,
// which is "does the caller have a certificate with this id".
//
// STAFF ARE NOT EXEMPT. `ROLES_SATISFYING.student` admits instructors and admins,
// so layer 2 lets staff through — and layer 3 then refuses them, because a
// certificate is not theirs. That is a deliberate narrowing of the usual "staff
// satisfy student routes" rule: an instructor with a support question uses the
// PUBLIC verify page (/verify/:code), which is designed to be shown to third
// parties and reveals strictly less than this PDF. If staff ever need the file
// itself, that is a new admin-guarded route with an audit line, not a widening of
// this one.
// =============================================================================

import { appConfig } from "@/lib/config/app.config";
import { apiError, apiGuard } from "@/lib/guard";
import type { RouteAuth } from "@/lib/contracts/api";
import {
  certificateFilename,
  renderCertificatePdf,
  resolveLogoSrc,
} from "@/lib/certificates/pdf";
import { getOwnCertificateById, resolveActiveTemplate } from "@/lib/certificates/store";
import { toCertificateView } from "@/lib/certificates/template";
import { verificationPath } from "@/lib/certificates/verification";

const REQUIRED_AUTH: RouteAuth = "student";

/**
 * NODE RUNTIME, NOT EDGE. @react-pdf/renderer needs Node built-ins (streams,
 * zlib, node:fs for the optional logo). On the edge runtime this route fails at
 * import time, which is a build-or-first-request failure rather than something a
 * test would catch late.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ certificateId: string }> },
): Promise<Response> {
  const gate = await apiGuard(REQUIRED_AUTH);
  if (!gate.ok) return gate.response;

  const { certificateId } = await context.params;
  // Parsed and range-checked before it reaches SQL. A non-numeric segment is a
  // 404 rather than a 400: /api/certificates/abc/pdf is not a malformed request
  // for a resource, it is a request for a resource that cannot exist.
  const id = Number(certificateId);
  if (!Number.isInteger(id) || id <= 0) {
    return apiError(404, "No such certificate.", "not_found");
  }

  try {
    const certificate = await getOwnCertificateById(id, gate.user.id);
    if (!certificate) {
      // Covers three cases on purpose — no such row, someone else's row, and a
      // row whose owner was deleted — because distinguishing them is exactly the
      // information an enumerating caller wants.
      return apiError(404, "No such certificate.", "not_found");
    }

    if (certificate.revokedAt) {
      // A withdrawn credential must not keep producing a clean PDF. 410 Gone
      // rather than 404: the certificate DID exist and the holder is entitled to
      // know it was withdrawn rather than to think the link broke.
      return apiError(410, "This certificate has been revoked.", "revoked");
    }

    const template = await resolveActiveTemplate();

    // ORIGIN FROM THE REQUEST, not from an environment variable. The printed
    // verify URL must work on whatever origin the student is actually using —
    // localhost, 127.0.0.1, a Vercel preview, a custom domain — which is the
    // lesson of CHANGELOG.log 2026-07-31 15:40, where an origin baked in at seed
    // time dropped the session cookie and broke a whole e2e group. `_request.url`
    // is absolute in a route handler, so this needs no fallback.
    const origin = new URL(_request.url).origin;

    const view = toCertificateView(certificate, {
      organizationName: appConfig.branding.organizationName,
      verificationUrl: `${origin}${verificationPath(certificate.verificationCode)}`,
    });

    const bytes = await renderCertificatePdf({
      view,
      template,
      logoSrc: resolveLogoSrc(template.logoPath),
    });

    // Wrapped in a Blob rather than passed as a Uint8Array: `BodyInit` in this
    // TypeScript configuration does not admit a `Uint8Array<ArrayBufferLike>`
    // (it resolves the overload against URLSearchParams and fails to compile),
    // and a Blob states the media type in one place instead of relying on the
    // header alone.
    return new Response(new Blob([bytes], { type: "application/pdf" }), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // `attachment`, so a click downloads rather than opening a viewer that
        // some browsers then leave in a shared cache.
        "Content-Disposition": `attachment; filename="${certificateFilename(view)}"`,
        "Content-Length": String(bytes.byteLength),
        // PRIVATE and NO-STORE. This is a credential: `no-store` keeps it out of
        // shared proxy caches and out of the CDN, which is the one place a
        // per-user document must never land. It also means the re-render cost of
        // the on-demand storage decision is paid on every download — stated in
        // the STORAGE DECISION block in src/lib/certificates/pdf.tsx and accepted
        // there.
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error(`[GET /api/certificates/${certificateId}/pdf] failed`, err);
    return apiError(500, "Could not render your certificate.", "certificate_render_failed");
  }
}
