// =============================================================================
// CERTIFICATE COMPONENT BARREL — owned by the certificates stream.
// Import from "@/components/certificates", not from a file, for the reason
// src/components/ui/index.ts gives: a deep import is how a second copy of a
// component starts.
// =============================================================================

export { CertificateCard } from "./CertificateCard";
export type { CertificateCardProps } from "./CertificateCard";

export { EligibilityNotice } from "./EligibilityNotice";
export type { EligibilityNoticeProps } from "./EligibilityNotice";

export { VerificationPanel } from "./VerificationPanel";
export type { VerificationPanelProps } from "./VerificationPanel";
