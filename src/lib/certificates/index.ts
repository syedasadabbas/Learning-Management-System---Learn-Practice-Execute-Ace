// =============================================================================
// CERTIFICATES MODULE BARREL — owned by the certificates stream.
// -----------------------------------------------------------------------------
// `./pdf` IS DELIBERATELY NOT RE-EXPORTED HERE. It imports @react-pdf/renderer
// (and node:fs), so anything that touches this barrel would pull a PDF engine
// into its module graph — including the gallery page, which only needs to know
// whether a certificate exists. Importers of the document and the renderer say so
// explicitly: `import { renderCertificatePdf } from "@/lib/certificates/pdf"`.
//
// Layering, same shape as src/lib/progress/index.ts: `eligibility.ts` is pure
// except for its one db-backed entry point, `template.ts` and `verification.ts`
// are pure and import no database at all, and `store.ts` is the only file that
// talks to Postgres.
// =============================================================================

export {
  evaluateEligibility,
  getCertificateEligibility,
  completionDateFor,
  type CertificateEligibility,
  type IneligibilityReason,
} from "./eligibility";

export {
  RENDERABLE_FONTS,
  TEMPLATE_PLACEHOLDERS,
  DEFAULT_BODY_TEMPLATE,
  DEFAULT_TEMPLATE_NAME,
  assertHexColour,
  assertRenderableFont,
  builtInTemplate,
  formatCertificateDate,
  fromRow,
  renderTemplate,
  toCertificateView,
  type CertificateView,
  type RenderableFont,
  type RenderedBody,
  type ResolvedTemplate,
} from "./template";

export {
  VERIFICATION_CODE_BYTES,
  VERIFICATION_CODE_LENGTH,
  generateVerificationCode,
  isVerificationCodeShape,
  normaliseVerificationCode,
  verificationPath,
} from "./verification";

export {
  findByVerificationCode,
  getOwnCertificate,
  getOwnCertificateById,
  issueCertificate,
  listOwnCertificates,
  listTemplates,
  resolveActiveTemplate,
  resolveCertificateCourse,
  revokeCertificate,
  type CertificateCourse,
  type IssueOutcome,
  type PublicCertificate,
} from "./store";
