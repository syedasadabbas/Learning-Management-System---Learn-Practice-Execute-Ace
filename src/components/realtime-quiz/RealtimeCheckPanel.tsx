// =============================================================================
// REALTIME CHECK PANEL — the one-line mount point for a lecture page.
// -----------------------------------------------------------------------------
// Owner: realtime-quiz stream.
//
// An async SERVER component. It exists so the consuming page (the lecture view,
// owned by the course-content stream) needs exactly one import and one element,
// with no knowledge of the service, the payload barrier or the server action:
//
//     <RealtimeCheckPanel weekId={week.id} />
//
// WHY the load happens here and not in the client component: the answer key must
// be stripped server-side (src/lib/realtime-quiz/payload.ts), so the read has to
// run on the server. Doing it in the page instead would force every consumer to
// repeat it and give each of them a chance to pass the raw rows through.
//
// WHY the server action is passed as a prop: it keeps InlineKnowledgeCheck a pure
// client component that can be unit-tested with a fake checker, and keeps the
// "use server" module out of the browser bundle graph.
//
// FAILS QUIET. A week with no realtime quiz — the normal case — renders null, and
// a read failure also renders null rather than propagating: an ungraded extra
// must never be able to take down the lecture a student came to read. The error
// is logged for the operator instead.
// =============================================================================

import { InlineKnowledgeCheck } from "./InlineKnowledgeCheck";
import { checkInlineAnswerAction } from "@/lib/realtime-quiz/actions";
import { loadInlineCheckForWeek } from "@/lib/realtime-quiz/service";

export interface RealtimeCheckPanelProps {
  /**
   * The week whose realtime check to show.
   *
   * Week-scoped, not lecture-scoped, because `quizzes` has no `lecture_id`
   * column and the seam is frozen. `pick` selects positionally among a week's
   * realtime checks; see the hand-off note in the stream report for the options.
   */
  weekId: number;
  /** Zero-based index among the week's realtime checks. Out of range renders null. */
  pick?: number;
  /** Overrides the quiz title as the section heading. */
  heading?: string;
  className?: string;
}

export async function RealtimeCheckPanel({
  weekId,
  pick = 0,
  heading,
  className,
}: RealtimeCheckPanelProps) {
  let check = null;
  try {
    check = await loadInlineCheckForWeek(weekId, pick);
  } catch (err) {
    console.error("[realtime-quiz] could not load the inline check; rendering nothing.", err);
    return null;
  }

  if (!check) return null;

  return (
    <InlineKnowledgeCheck
      check={check}
      onCheckAnswer={checkInlineAnswerAction}
      {...(heading ? { heading } : {})}
      {...(className ? { className } : {})}
    />
  );
}
