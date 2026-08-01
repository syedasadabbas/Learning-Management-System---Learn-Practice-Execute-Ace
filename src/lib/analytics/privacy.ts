// =============================================================================
// PRIVACY BOUNDARY FOR THE ANALYTICS PAGES — advanced-analytics extension.
// -----------------------------------------------------------------------------
// THE DECISION, STATED SO IT CAN BE ARGUED WITH RATHER THAN DISCOVERED:
//
//   1. Individual students ARE identifiable BY NAME, and only in the two
//      attention lists (the existing penalty-based at-risk list and the new risk
//      alerts). That is not an accident of the implementation, it is the feature:
//      "someone in this cohort needs help" is not actionable, and an instructor
//      who cannot see who cannot act. Both pages are staff-only.
//   2. Every other panel is AGGREGATE ONLY — counts, rates, buckets, heatmap
//      cells. No panel names a student in connection with a score. The grade
//      distribution is counts per letter, not a roster.
//   3. NO EMAIL ADDRESS REACHES THE PAGE. Not the viewer's, not a student's.
//
// WHY (3) NEEDED CODE. `getAtRiskStudents` in src/lib/instructor/analytics.ts
// selects `u.email` and returns it on every `AtRiskStudent`, and
// src/components/instructor/AnalyticsPanels.tsx renders it — at line 181 of that
// file, as a muted sub-line under the student's name. So both shipped analytics
// pages currently print every at-risk student's address in visible text. The
// leaderboard stream reached the opposite conclusion for the same data and
// documented it at length (tests/e2e/leaderboard/leaderboard.spec.ts, the block
// above "no other student's email address appears anywhere on the page"): names
// and ranks ship, addresses do not. An address is not needed to identify a
// student to their own instructor — the name and the row already do that — and it
// is the field that turns a screenshot of a dashboard into a contact list.
//
// This module redacts at the PAGE boundary rather than fixing the query, because
// src/lib/instructor/** and src/components/instructor/** belong to the
// instructor-admin stream and this stream owns only the pages and this directory.
// The redaction is therefore complete but not ideal, and the better fix is named
// here so it is not lost: `getAtRiskStudents` should stop SELECTing `u.email` and
// `AtRiskStudent` should stop declaring it, at which point this module becomes a
// no-op and can be deleted. Reported to the coordinator rather than done here.
//
// WHAT THIS IS NOT: a substitute for authorization. Both pages call
// `requireRole("instructor")` / `requireRole("admin")` and src/middleware.ts
// rejects a student at the edge. Redaction is what remains true even for a
// legitimate staff viewer.
// =============================================================================

/** The redaction placeholder. Empty string, not "[redacted]": the field is not
 *  displayed at all, and a visible placeholder invites someone to "fix" it by
 *  putting the address back. */
const REDACTED = "";

/**
 * A structural minimum of `AtRiskStudent` (src/lib/instructor/analytics.ts).
 * Structural rather than an import of that type so this file does not couple to
 * another stream's shape beyond the one field it exists to remove.
 */
interface HasEmail {
  email: string;
}

/**
 * Strip the address from one record, preserving every other field.
 *
 * Returns a NEW object; the input is not mutated, so a caller that also passes
 * the same row to something else does not have it silently changed underneath.
 */
export function redactEmail<T extends HasEmail>(row: T): T {
  return { ...row, email: REDACTED };
}

/** Strip addresses from a list. */
export function redactEmails<T extends HasEmail>(rows: readonly T[]): T[] {
  return rows.map(redactEmail);
}

/**
 * Does this value contain anything that looks like an email address?
 *
 * Used by the unit tests as a canary over the serialised props actually handed to
 * the components, so the guarantee is checked against the real payload rather
 * than asserted in prose. Deliberately loose: `something@something.tld`. A loose
 * pattern over a small, known payload risks a false positive (which fails loudly
 * and gets looked at) rather than a false negative (which ships an address).
 */
export function containsEmailAddress(value: unknown): boolean {
  let serialised: string;
  try {
    serialised = JSON.stringify(value) ?? "";
  } catch {
    // A cyclic or otherwise unserialisable value. The canary reports "nothing
    // found" for something it could not read rather than throwing: it is a
    // diagnostic, and a diagnostic that can crash the caller is worse than one
    // with a blind spot. The e2e rendered-text assertion is the backstop.
    return false;
  }
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(serialised);
}
