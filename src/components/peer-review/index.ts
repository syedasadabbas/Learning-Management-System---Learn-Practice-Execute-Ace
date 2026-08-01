// =============================================================================
// PEER REVIEW COMPONENT BARREL. Owner: the peer-review stream.
// -----------------------------------------------------------------------------
// Every component here composes the ui-shell primitives from "@/components/ui" and
// declares no colours of its own — the barrel's own header calls a second Button
// implementation "how a design system dies", and the same applies to a second star
// control. `StarRating` is reused for rubric scoring precisely because it is the
// control a student already recognises from their instructor's feedback.
// =============================================================================

export { PeerReviewForm } from "./PeerReviewForm";
export type { PeerReviewFormProps } from "./PeerReviewForm";

export { ReviewTaskList } from "./ReviewTaskList";
export type { ReviewTaskListProps } from "./ReviewTaskList";

export { ReceivedReviews } from "./ReceivedReviews";
export type { ReceivedReviewsProps } from "./ReceivedReviews";

export { RoundAdminPanel } from "./RoundAdminPanel";
export type { RoundAdminPanelProps } from "./RoundAdminPanel";
