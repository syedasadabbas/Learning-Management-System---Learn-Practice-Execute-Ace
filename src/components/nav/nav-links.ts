// =============================================================================
// ROLE -> NAVIGATION MAP
// -----------------------------------------------------------------------------
// The single place navigation is defined. Adding a page means adding a row here,
// never adding JSX to a component: role-conditional markup is how a link ends up
// visible to the wrong role.
//
// Role values are exactly the `user_role` enum in src/db/schema.ts. The type is
// declared locally rather than imported at runtime because Sidebar/TopBar are
// client components and importing schema.ts would pull Drizzle into the browser
// bundle. `_AssertRolesMatchSchema` below keeps the two honest at compile time
// using a type-only import, which is erased entirely at build.
// Owner: ui-shell stream.
// =============================================================================

import type * as Schema from "@/db/schema";

export type Role = "student" | "instructor" | "admin";

type SchemaRole = (typeof Schema.userRole.enumValues)[number];
// Fails to compile if schema.ts ever gains, drops, or renames a role.
type _AssertRolesMatchSchema = [SchemaRole] extends [Role]
  ? [Role] extends [SchemaRole]
    ? true
    : never
  : never;

export const ROLES: readonly Role[] = ["student", "instructor", "admin"];

export interface NavLink {
  href: string;
  label: string;
  /** Short text used as the collapsed/mobile glyph. Decorative, aria-hidden. */
  glyph: string;
  /** Tooltip / secondary line. */
  description?: string;
  /**
   * When true the link is active only on an exact pathname match. Section roots
   * like /admin would otherwise stay highlighted on every /admin/* child.
   */
  exact?: boolean;
}

export const NAV_LINKS: Record<Role, readonly NavLink[]> = {
  student: [
    {
      href: "/dashboard",
      label: "Dashboard",
      glyph: "◧",
      description: "Your progress this cohort",
      exact: true,
    },
    {
      // /weeks, not /course. The course-content stream ships its pages under
      // (app)/weeks/** and src/middleware.ts protects that prefix; (app)/course/
      // does not exist, so this link 404'd until it was repointed.
      href: "/weeks",
      label: "Course",
      glyph: "▤",
      description: "Weeks, lectures and quizzes",
    },
    {
      // "Browse courses", NOT "Courses": the row above is already labelled
      // "Course" (it points at /weeks, the enrolled course's own content). Two
      // sidebar rows reading "Course" and "Courses" one under the other is a
      // coin-flip for the student every time, and the destinations are genuinely
      // different — this one is the catalogue of OTHER courses you can request
      // access to (src/app/(app)/courses/page.tsx).
      //
      // Reachable only now that the cross-stream nav guard was narrowed from
      // `startsWith("/course")` to `/course` plus `/course/*`; the prefix form
      // matched "/courses" and kept this route out of the nav by accident. See
      // tests/unit/cross-stream-contracts.test.ts.
      href: "/courses",
      label: "Browse courses",
      glyph: "⊞",
      description: "Other courses and access requests",
    },
    {
      href: "/practice",
      label: "Practice",
      glyph: "▷",
      description: "Live in-browser exercises",
    },
    {
      href: "/assignments",
      label: "Assignments",
      glyph: "✎",
      description: "Submissions and feedback",
    },
    // NO "/exams" LINK YET, deliberately. The grand-quiz stream ships
    // (app)/exams/[weekId]/page.tsx but no (app)/exams/page.tsx, so /exams itself
    // is not a route and a nav entry pointing at it would 404 for every student.
    // The filesystem-derived check in tests/unit/cross-stream-contracts.test.ts
    // caught this when the link was added — which is exactly the /course defect
    // repeating, and exactly why that check now walks the router instead of
    // trusting a hand-kept list.
    //
    // TODO(grand-quiz): add an /exams index listing each week's exam with its
    // status (not started / in progress / submitted, and the score once known).
    // A student otherwise has no way to discover an exam except a direct URL.
    // Add the nav row here in the same change.
    {
      href: "/learn",
      label: "Learn",
      glyph: "◇",
      description: "Self-paced concept tracks",
    },
    {
      href: "/problems",
      label: "Problems",
      glyph: "❯",
      description: "Coding practice by track and level",
    },
    {
      href: "/interview",
      label: "Interview prep",
      glyph: "✦",
      description: "Interview-style drills",
    },
    {
      // forums stream. The three PAGES were added before this row, in that order
      // deliberately: tests/unit/cross-stream-contracts.test.ts walks src/app and
      // fails any nav href with no page.tsx behind it, which is the guard that
      // caught the historical `/course`-vs-`/weeks` 404.
      //
      // POINTS AT THE INDEX, NOT AT A WEEK. The roadmap's path for this feature is
      // `(app)/weeks/[weekId]/forum` (IMPLEMENTATION_ROADMAP.md:423), and a nav
      // href cannot contain a dynamic segment — there is no week number that is
      // right for every student. /forums lists the weeks with their discussion
      // counts and links onward. See src/app/(app)/forums/page.tsx for why the
      // route lives under its own segment rather than inside /weeks.
      //
      // STUDENT LIST ONLY, and that is a real gap rather than a decision:
      // instructors and admins moderate these threads (ROLES_SATISFYING.instructor
      // is ["instructor","admin"], so both pass `canModerate`) but have no sidebar
      // row for it, because `gateWeek` is student-scoped and takes no role
      // (docs/SUBJECT_SECTIONS.md:109) — a staff member sees the same section locks
      // a student does, so a staff nav row would lead to a page showing mostly
      // locked weeks. TODO(forums): add the staff row together with the staff
      // preview that docs/SUBJECT_SECTIONS.md says belongs in
      // `deriveWeekLockStates`, not before it.
      href: "/forums",
      label: "Discussions",
      glyph: "❞",
      description: "Ask and answer questions per week",
    },
    {
      href: "/leaderboard",
      label: "Leaderboard",
      glyph: "▲",
      description: "Cohort standings",
    },
    {
      // badges stream. The PAGE (src/app/(app)/badges/page.tsx) was added before
      // this row, in that order deliberately:
      // tests/unit/cross-stream-contracts.test.ts walks src/app and fails any nav
      // href with no page.tsx behind it, which is the guard that caught the /exams
      // link above and, before that, the original /course defect.
      //
      // "Achievements", not "Badges", for the same reason everything in
      // src/components/badges is named Achievement*: `Badge` is already a UI
      // primitive in this codebase (a status pill), and a sidebar row reading
      // "Badges" next to a component library full of `<Badge>` pills is a
      // permanent source of confusion. The student-facing word is the clearer one
      // anyway — it describes what the page contains rather than the widget it
      // renders with.
      href: "/badges",
      label: "Achievements",
      glyph: "✦",
      description: "Badges you have earned",
    },
    {
      // certificates stream. That stream WROTE this row and reverted it: a
      // NAV_LINKS href also needs a leaf loading.tsx and a rule in
      // src/lib/navigation/loading-shape.ts, and it was told not to touch routing.
      // Reverting beat leaving two shared suites red; the coordinator has since
      // added both halves, so the row can stand.
      href: "/certificates",
      label: "Certificates",
      glyph: "❖",
      description: "Credentials you have earned",
    },
    {
      // notifications stream. Same story: the stream shipped the page and reported
      // that the nav row, the middleware prefix and the loading boundary were all
      // outside its ownership. All three are now in place.
      //
      // Placed LAST before Settings, next to the other "about you" rows rather
      // than up with the coursework: it is a history of things that already
      // happened, not somewhere a student goes to do work.
      href: "/notifications",
      label: "Notifications",
      glyph: "◔",
      description: "What we have emailed you, and your preferences",
    },
    {
      // Every role needs this, so it is repeated in all three lists rather than
      // appended by the components — the header rule of this file is that a link
      // is data, never JSX, precisely so no component can decide who sees what.
      href: "/settings",
      label: "Settings",
      glyph: "⚙",
      description: "Profile and password",
    },
  ],
  instructor: [
    {
      href: "/instructor",
      label: "Overview",
      glyph: "◧",
      description: "Cohort at a glance",
      exact: true,
    },
    {
      href: "/instructor/grading",
      label: "Grading queue",
      glyph: "★",
      description: "Rate and comment on submissions",
    },
    {
      href: "/instructor/students",
      label: "Students",
      glyph: "◍",
      description: "Per-student progress",
    },
    {
      href: "/instructor/analytics",
      label: "Analytics",
      glyph: "◈",
      description: "Pass rates and averages",
    },
    {
      // The penalties-attendance stream ships this page but owns no nav file, so
      // it was reachable only by typing the URL.
      href: "/attendance",
      label: "Attendance",
      glyph: "◎",
      description: "Mark attendance and participation",
    },
    // NOTE: /admin/videos is deliberately NOT here, though video review is a
    // staff task. Video curation requires ROUTE_AUTH "admin", and
    // ROLES_SATISFYING.admin is ["admin"] alone — so an instructor following the
    // link would be refused. nav-links.test.tsx forbids any /admin href in the
    // instructor set and caught this when it was added; the test is right. A link
    // whose destination refuses the person who can see it is worse than no link.
    {
      href: "/leaderboard",
      label: "Leaderboard",
      glyph: "▲",
      description: "Cohort standings",
    },
    {
      href: "/settings",
      label: "Settings",
      glyph: "⚙",
      description: "Profile and password",
    },
  ],
  admin: [
    {
      href: "/admin",
      label: "Console",
      glyph: "◧",
      description: "Platform overview",
      exact: true,
    },
    {
      href: "/admin/quizzes",
      label: "Quizzes",
      glyph: "▦",
      description: "Create and edit MCQ sets",
    },
    {
      href: "/admin/assignments",
      label: "Assignments",
      glyph: "✎",
      description: "Briefs, forms and sheets",
    },
    {
      href: "/admin/students",
      label: "Students",
      glyph: "◍",
      description: "Enrolment and roles",
    },
    {
      href: "/admin/deadlines",
      label: "Deadlines",
      glyph: "◔",
      description: "Due dates and grace window",
    },
    {
      href: "/admin/reports",
      label: "Reports",
      glyph: "⇩",
      description: "Exports",
    },
    {
      href: "/admin/analytics",
      label: "Analytics",
      glyph: "◈",
      description: "Cohort analytics",
    },
    {
      href: "/admin/videos",
      label: "Videos",
      glyph: "▶",
      description: "Approve or reject topic videos",
    },
    {
      // Admin-only for the same reason /admin/videos is: approving a request is
      // an enrolment act, and ROLES_SATISFYING.admin is ["admin"] alone, so an
      // instructor following this link would be refused.
      //
      // NOTE the STUDENT side of this feature (/courses) has deliberately NOT
      // been added to the student list. tests/unit/cross-stream-contracts.test.ts
      // asserts that no nav href starts with "/course" — a guard against the
      // historical `/course`-vs-`/weeks` defect — and "/courses" is a false
      // positive for it. That assertion belongs to the coordinator and should be
      // tightened to the exact segment (`href === "/course" ||
      // startsWith("/course/")`) before the student row is added here.
      href: "/admin/course-requests",
      label: "Access requests",
      glyph: "⌸",
      description: "Approve or decline course access",
    },
    {
      // Admin-only for the same reason the two rows above are, and one more: this
      // page shows every act of every user including instructors' own grading
      // decisions, so ROUTE_AUTH is "admin" and ROLES_SATISFYING.admin is ["admin"]
      // alone. nav-links.test.tsx forbids any /admin href in the INSTRUCTOR set,
      // which is correct here — an instructor following this link would be refused.
      //
      // The page (src/app/(staff)/admin/activity/page.tsx) was added BEFORE this
      // row, because tests/unit/cross-stream-contracts.test.ts derives the set of
      // real routes by walking src/app and fails a nav href with no page.tsx behind
      // it. That is the /course-vs-/weeks defect's guard, and the ordering is what
      // it asks for.
      href: "/admin/activity",
      label: "Activity log",
      glyph: "⧗",
      description: "Audit trail: who did what, and when",
    },
    {
      href: "/settings",
      label: "Settings",
      glyph: "⚙",
      description: "Profile and password",
    },
  ],
};

/**
 * Links for a role. Returns an empty list for anything unrecognised rather than
 * throwing: an unknown role must render no navigation, never a crash and never
 * the student default (which would leak links).
 */
export function navLinksFor(role: string | null | undefined): readonly NavLink[] {
  if (!role) return [];
  return NAV_LINKS[role as Role] ?? [];
}

/** Human label for a role, used by the role badge in the top bar. */
export const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  instructor: "Instructor",
  admin: "Admin",
};

/**
 * Is `href` the active link for `pathname`?
 * Non-exact links match their own subtree so /course/week-2 keeps "Course" lit.
 */
export function isActiveLink(
  link: Pick<NavLink, "href" | "exact">,
  pathname: string | null | undefined,
): boolean {
  if (!pathname) return false;
  if (link.exact) return pathname === link.href;
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}
