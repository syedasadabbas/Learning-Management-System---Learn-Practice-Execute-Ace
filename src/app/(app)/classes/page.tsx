// =============================================================================
// /classes — upcoming live classes.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// FLAG FIRST, AUTH SECOND, and the order is the whole point.
// `requireFeature` runs before `requireRole` because a disabled feature must be
// a plain 404 to everyone — signed in or not, student or admin — and therefore
// indistinguishable from a page that was never built. Guarding auth first would
// bounce an anonymous visitor to /login, which advertises that the route
// exists. src/lib/feature-guard.ts states this rule for API handlers; it
// applies identically to pages.
//
// `requireRole("student")` means "signed in": staff satisfy it too (see
// ROLES_SATISFYING), which is intended — an instructor checking the schedule is
// a listed use case.
//
// The calendar is a CLIENT component that fetches for itself rather than a
// server component reading the database. That is a deliberate exception to the
// house idiom, and the reason is narrow: `GET /api/classes/upcoming` is the only
// implementation of the "next N days, ordered, windowed" query, this stream may
// not add a `src/lib/live-classes/queries.ts` to share with it, and duplicating
// that SQL here is exactly the drift the API/page split is meant to avoid.
// =============================================================================

import { ClassCalendar } from "@/components/live-classes";
import { requireFeature } from "@/lib/feature-guard";
import { requireRole } from "@/lib/guard";

// Session- and time-dependent: "the next fourteen days" is different on every
// request, so this must never be statically rendered.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Live classes",
  description: "Scheduled live sessions for your course.",
};

export default async function ClassesPage() {
  requireFeature("liveClasses");
  await requireRole("student");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
      <ClassCalendar />
    </main>
  );
}
