// =============================================================================
// HANDLER REGISTRY — kind -> consumer.
// Owner: the async-queues stream.
// -----------------------------------------------------------------------------
// `Record<JobKind, JobHandler>` is the whole point of the type: adding a member
// to JOB_KINDS in ./types.ts without adding a handler here is a COMPILE ERROR,
// not a job that dead-letters in production with "no handler registered".
//
// The reverse direction — a row in the database whose `kind` is a string this
// build has never heard of — is a real runtime possibility (an old row after a
// kind is removed, or a rolled-back deploy) and is handled in ./drain.ts by
// dead-lettering it on the first attempt. See UNKNOWN_KIND_ERROR in ./policy.ts.
// =============================================================================

import { handleNotificationEmail } from "./handlers/notification-email";
import { handleSubmissionGradedEmail } from "./handlers/submission-graded-email";
import { isJobKind, type JobHandler, type JobKind } from "./types";

const HANDLERS: Record<JobKind, JobHandler> = {
  submission_graded_email: handleSubmissionGradedEmail,
  // email-notifications stream. The generic notification sender: quiz submitted,
  // exam completed, penalty issued. See src/lib/notifications/types.ts for why
  // these three share one kind and the graded-submission mail does not join them.
  notification_email: handleNotificationEmail,
};

/** The handler for a kind read out of the database, or null if unroutable. */
export function resolveHandler(kind: string): JobHandler | null {
  if (!isJobKind(kind)) return null;
  return HANDLERS[kind];
}

/** Exposed so a test can assert every declared kind is routable. */
export function registeredKinds(): JobKind[] {
  return Object.keys(HANDLERS) as JobKind[];
}
