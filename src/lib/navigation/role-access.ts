// =============================================================================
// WHERE EACH ROLE BELONGS, and which student surfaces redirect staff elsewhere.
// -----------------------------------------------------------------------------
// THE BUGS THIS EXISTS FOR, reported 2026-08-01:
//
//   1. An instructor or admin signing in landed on /dashboard — the STUDENT
//      dashboard. `AFTER_LOGIN_PATH` (src/lib/auth.ts:74) is one constant for
//      every role and nothing downstream corrected it.
//   2. An admin opening /assignments got the student's assignment list instead of
//      /admin/assignments.
//   3. There was no role -> home mapping anywhere in src/. The only thing that
//      knew an admin's home is /admin was one inline ternary in
//      src/app/(staff)/layout.tsx:37.
//
// Both 1 and 2 have the same cause: `ROLES_SATISFYING.student` is
// ["student","instructor","admin"], so "student" means "any signed-in role" and
// every student page admits staff. THAT TABLE IS NOT CHANGED HERE, for reasons
// set out under "what staff keep" below.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A SHORT EXPLICIT TABLE AND NOT A DERIVED RULE
//
// The first attempt derived the answer from NAV_LINKS: a staff role may open what
// its own sidebar offers it, nothing else. That is a tidier rule and it is WRONG
// here, in three ways that an inventory of the actual routes turned up:
//
//   * /assignments/ingest-status IS A STAFF PAGE living under the student
//     /assignments prefix (its own guard is requireRole("instructor")). Redirect
//     staff away from /assignments and they lose a page that is theirs.
//   * FORUM MODERATION IS SERVER ACTIONS THAT POST TO /forums/* PAGE PATHS. There
//     are no forum endpoints in the frozen ROUTES map; removing an offensive post
//     is a POST to the page itself. A redirect there breaks moderation outright.
//   * Staff deliberately USE several student pages, and specs assert it:
//     /leaderboard has a staff-only cohort picker; /courses returns a staff-bypass
//     verdict with `access-via=staff`; /badges is required to degrade with a note
//     rather than refuse, because "a nav link whose destination refuses the person
//     who can see it is worse than no link".
//
// So the redirect list is deliberately SMALL and enumerated. It covers the
// surfaces that have a real staff counterpart to go to, which is the reported
// complaint, and it leaves everything else alone.
//
// WHAT STAFF KEEP, and why that is not an oversight: an instructor moderating a
// forum, watching the cohort leaderboard, or reading a course catalogue is doing
// their job on a page whose data is the cohort's, not one student's. The rule that
// matters is narrower than "no role may see another's page" — it is that a staff
// member must never be shown a page that is ABOUT THEM AS A STUDENT (their
// progress, their assignments to submit), because they have no such data and the
// page is meaningless. Those are exactly the entries below.
//
// ---------------------------------------------------------------------------
// GET ONLY. `redirectForPage` is asked only about document navigations by its
// caller in src/middleware.ts. A server action is a POST to the page's own path,
// and redirecting one would silently discard the action — see the forum
// moderation note above. The method check lives at the call site so this module
// stays pure and testable.
//
// API ROUTES ARE NOT TOUCHED. An API caller must get the frozen ApiResult
// envelope with a real status code, never a redirect, and staff legitimately read
// student-scoped endpoints: the grading queue, the live-class room an instructor
// is running, and the author-then-read-back pairs in the learning-content routes
// all depend on it.
// =============================================================================

import { NAV_LINKS, type Role } from "@/components/nav/nav-links";

/**
 * Where a role belongs when it has no more specific destination.
 *
 * Derived from the FIRST nav row of each role rather than written out again, so it
 * cannot disagree with the sidebar: whatever a role's navigation leads with is its
 * home. That yields /dashboard, /instructor and /admin — the same values
 * src/app/(staff)/layout.tsx:37 carried inline.
 */
export const ROLE_HOME: Record<Role, string> = {
  student: NAV_LINKS.student[0]?.href ?? "/dashboard",
  instructor: NAV_LINKS.instructor[0]?.href ?? "/instructor",
  admin: NAV_LINKS.admin[0]?.href ?? "/admin",
};

/** The home for a role, tolerating an unknown value from a stale JWT. */
export function homeFor(role: string | null | undefined): string {
  if (role === "student" || role === "instructor" || role === "admin") {
    return ROLE_HOME[role];
  }
  // Not a role this build knows. Send it to the public page rather than guess a
  // surface — the caller's own auth check will already have refused the request.
  return "/";
}

/** The two roles this module redirects. Students are never redirected. */
type StaffRole = "instructor" | "admin";

/** Is this a role this module redirects? Students are never redirected. */
export function isStaffRole(role: string | null | undefined): role is StaffRole {
  return role === "instructor" || role === "admin";
}

/**
 * Student surfaces that mean nothing to a staff member, and where each staff role
 * should be sent instead.
 *
 * KEYED BY THE STUDENT PREFIX, longest match first at lookup time so a more
 * specific entry can override a broader one. Every target is a page that exists
 * and that the role's own guard admits — `redirectForPage` re-checks against
 * EXEMPT below and never returns a path that would itself redirect.
 *
 * Kept to surfaces that are ABOUT THE VIEWER AS A STUDENT. /dashboard is their
 * own progress; /assignments is work they submit; /quizzes is a quiz they sit;
 * /practice, /badges and /certificates are their own record. A staff member has
 * none of these, so the page is not merely unauthorised, it is empty.
 */
const STAFF_REDIRECTS: Record<StaffRole, Readonly<Record<string, string>>> = {
  admin: {
    "/dashboard": "/admin",
    "/assignments": "/admin/assignments",
    "/quizzes": "/admin/quizzes",
  },
  instructor: {
    "/dashboard": "/instructor",
    // An instructor's view of assignment work is the grading queue.
    "/assignments": "/instructor/grading",
    "/quizzes": "/instructor",
  },
};

/**
 * Paths that must NEVER be redirected even though they sit under a prefix above.
 *
 * /assignments/ingest-status is the one that matters and the one that would have
 * been broken: it lives under the student /assignments prefix but its own guard is
 * `requireRole("instructor")`. It is a STAFF page, and redirecting staff away from
 * it would take a working screen away to fix a cosmetic one.
 */
const EXEMPT: readonly string[] = ["/assignments/ingest-status"];

/** Does `pathname` sit at or below `prefix`? */
function matches(pathname: string, prefix: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Where to send `role` when it has asked for a page that is not for it, or null
 * when the page is fine as it is.
 *
 * A REDIRECT AND NOT A REFUSAL, which is the point of the report. An admin typing
 * /assignments has not done anything wrong — they asked for "assignments" and the
 * answer they want is /admin/assignments. A 403 there would be correct and
 * useless.
 *
 * Returns null for: students (never redirected), unknown roles, /api paths, and
 * any exempt path.
 */
export function redirectForPage(
  role: string | null | undefined,
  pathname: string,
): string | null {
  if (!isStaffRole(role)) return null;
  if (pathname.startsWith("/api/")) return null;
  if (EXEMPT.some((exempt) => matches(pathname, exempt))) return null;

  const table = STAFF_REDIRECTS[role];
  // Longest prefix first, so a specific entry beats a broader one regardless of
  // the order they happen to be declared in.
  const prefixes = Object.keys(table).sort((a, b) => b.length - a.length);

  for (const prefix of prefixes) {
    if (!matches(pathname, prefix)) continue;
    const target = table[prefix];
    // A target that would itself redirect is a loop. Fall back to the role's home,
    // which by construction never redirects.
    if (redirectWouldLoop(role, target)) return homeFor(role);
    return target;
  }
  return null;
}

/** Would sending `role` to `target` produce another redirect? */
function redirectWouldLoop(role: StaffRole, target: string): boolean {
  if (EXEMPT.some((exempt) => matches(target, exempt))) return false;
  const table = STAFF_REDIRECTS[role];
  return Object.keys(table).some((prefix) => matches(target, prefix));
}
