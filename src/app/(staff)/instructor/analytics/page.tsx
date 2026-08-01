// =============================================================================
// /instructor/analytics — pass rates, distribution, submission/completion rates.
// instructor-admin stream.
// -----------------------------------------------------------------------------
// Everything is aggregated in Postgres. Every rate on this page can legitimately
// have a zero denominator on a fresh cohort, and every one of them renders the
// words "no data" in that case — see RateText / RateTile.
//
// EXTENDED 2026-07-31 with Phase 2 feature 7 ("Advanced Analytics Dashboard",
// IMPLEMENTATION_ROADMAP.md). The roadmap proposed a SEPARATE
// `/instructor/analytics-v2` route. It was not created, and that is the most
// important decision on this page: two analytics surfaces over one cohort drift,
// and the day they quote different pass rates every number on both becomes
// unusable. Everything above `AdvancedAnalyticsSection` is unchanged and still
// comes from `getCohortAnalytics`; the new section adds only what that read model
// cannot answer (engagement, activity-by-hour, problem difficulty, grade
// distribution, forward-looking risk) — see src/lib/analytics/queries.ts, which
// lists the reason per metric.
//
// COST: the new section is ONE additional statement, issued in the same
// `Promise.all` as the three `getCohortAnalytics` already makes. Measured against
// live Neon with scripts/perf-probe.ts: a warm round trip is 242 ms, the new
// statement 248 ms on its own, and both read models together 254 ms — i.e. the
// extension is inside the round trip the page was already paying for. Written as
// five separate aggregates it would have been five more round trips (~1225 ms) and
// would have held all five of the pool's connections (src/db/index.ts:77).
//
// PRIVACY: no email address reaches this page. `getAtRiskStudents` selects
// `users.email` and `AtRiskList` renders it, so the rows are passed through
// `redactEmails` — see src/lib/analytics/privacy.ts for the argument and for the
// cleaner fix that belongs to the instructor-admin stream.
// =============================================================================

import { AdvancedAnalyticsSection } from "@/components/analytics";
import {
  AnalyticsSummary,
  AtRiskList,
  QuizDistribution,
  WeekAnalyticsTable,
} from "@/components/instructor";
import { getAdvancedAnalytics } from "@/lib/analytics";
import { requireRole } from "@/lib/guard";
import { getCohortAnalytics } from "@/lib/instructor/analytics";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ cohort?: string }>;
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  // Page-level re-check, not a duplicate of the edge guard. src/middleware.ts
  // rejects a student on the /instructor prefix at the edge and says in its own
  // header that this is defence in depth, not the only defence: a page that
  // forgets this call is a bug, because the matcher covers path prefixes and not
  // pages. requireRole("instructor") resolves through ROLES_SATISFYING, so an
  // admin passes and a student is redirected to /login.
  await requireRole("instructor");
  const params = await searchParams;

  const parsed = params.cohort === undefined ? null : Number(params.cohort);
  const cohortId = parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;

  // Both read models in ONE wave. Serial awaits here would cost a second round
  // trip (~245 ms) for nothing; two statements is also well inside the pool's
  // ceiling of 5, so this does not starve the rest of the app.
  const [analytics, advanced] = await Promise.all([
    getCohortAnalytics(cohortId),
    getAdvancedAnalytics(cohortId),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-ink-muted">
          {analytics.cohortId === null
            ? "All cohorts"
            : `Cohort ${analytics.cohortId}`}{" "}
          · aggregated in {analytics.computeMs} ms · rates with no records show
          &quot;no data&quot; rather than 0%.
        </p>
      </header>

      <AnalyticsSummary analytics={analytics} />
      <WeekAnalyticsTable weeks={analytics.weeks} />

      <div className="grid gap-4 lg:grid-cols-2">
        <QuizDistribution buckets={analytics.quizDistribution} />
        {/* No redaction wrapper: getAtRiskStudents no longer selects u.email, so
            there is no address in these rows to strip. Fixed at the query rather
            than here, because src/app/(staff)/instructor/page.tsx passed the same
            rows through UNREDACTED — a downstream guard has to be remembered at
            every call site and one of three had already been missed. */}
        <AtRiskList students={analytics.atRisk} />
      </div>

      <AdvancedAnalyticsSection advanced={advanced} weeks={analytics.weeks} />
    </div>
  );
}
