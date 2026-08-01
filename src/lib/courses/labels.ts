// =============================================================================
// PURE PRESENTATION CONSTANTS for course access. NO IMPORTS, deliberately.
// -----------------------------------------------------------------------------
// Owner: courses / access-requests stream.
//
// WHY THIS FILE IS SEPARATE FROM policy.ts, WHICH LOOKS LIKE ITS HOME
//
// `policy.ts` imports `roleSatisfies` from `@/lib/guard`, and that file imports
// `@/lib/auth`, which pulls in `pg` (TCP sockets) and `bcryptjs`. A client
// component importing anything from policy.ts therefore drags a database driver
// into the browser bundle and breaks `next build` — this is not hypothetical,
// the video-ingestion stream hit exactly it and recorded the fix at
// src/components/videos/ReviewQueue.tsx:41 ("From the PURE module, never from
// ./read").
//
// So: anything a "use client" component needs lives here, with a zero-import
// rule that makes the hazard impossible rather than merely documented.
//
// The values are duplicated NOWHERE. policy.ts re-exports from here; it does not
// keep its own copy.
// =============================================================================

/**
 * Maximum length of a student's request note and of an admin's decision note.
 *
 * Mirrors `varchar(500)` on both `course_access_requests.message` and
 * `.decision_note` in src/db/schema.access.ts. The form sets `maxLength` from
 * this AND the server action truncates to it — a form attribute is presentation,
 * and the action is a plain HTTP POST target that no client-side attribute
 * protects.
 */
export const REQUEST_MESSAGE_MAX = 500;

export type AccessStatusLabelKey = "pending" | "approved" | "rejected" | "open" | "none";

/** Short status words, so the catalog and the admin queue cannot disagree. */
export const STATUS_LABEL: Record<AccessStatusLabelKey, string> = {
  pending: "Awaiting approval",
  approved: "Enrolled",
  rejected: "Declined",
  open: "Open to everyone",
  none: "Not enrolled",
};

/**
 * Badge tones. Values are the `BadgeTone` union from @/components/ui, typed as
 * plain strings here so this file keeps its zero-import rule — the components
 * that consume it are already typed against the real union, so a wrong value
 * fails to compile at the use site.
 */
export const STATUS_TONE: Record<AccessStatusLabelKey, "brand" | "success" | "warning" | "neutral"> = {
  pending: "warning",
  approved: "success",
  rejected: "neutral",
  open: "brand",
  none: "neutral",
};
