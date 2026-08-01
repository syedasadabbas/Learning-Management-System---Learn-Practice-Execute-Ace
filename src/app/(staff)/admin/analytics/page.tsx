// =============================================================================
// /admin/analytics — the same analytics, per cohort. instructor-admin stream.
// ADMIN ONLY (the instructor view lives at /instructor/analytics).
// -----------------------------------------------------------------------------
// Adds a cohort switcher on top of the instructor view. Zero-denominator handling
// is identical because the same components render it: an empty cohort shows
// "no data", never 0% and never NaN%.
//
// EXTENDED 2026-07-31 with Phase 2 feature 7, and this page and
// /instructor/analytics render the SAME `AdvancedAnalyticsSection` for the same
// reason they already share the four panels above it: the admin view differs from
// the instructor view by a cohort switcher and by nothing else. Composing the six
// new panels separately in each page is how the two would come to show different
// things, which is precisely the failure the roadmap's proposed second
// `analytics-v2` route would have guaranteed. See the header of
// src/components/analytics/AdvancedAnalyticsSection.tsx.
// =============================================================================

import Link from "next/link";

import { AdvancedAnalyticsSection } from "@/components/analytics";
import {
  AnalyticsSummary,
  AtRiskList,
  QuizDistribution,
  WeekAnalyticsTable,
} from "@/components/instructor";
import { buttonClasses } from "@/components/ui";
import { getAdvancedAnalytics } from "@/lib/analytics";
import { requireRole } from "@/lib/guard";
import { getCohortAnalytics } from "@/lib/instructor/analytics";
import { listCohorts } from "@/lib/instructor/admin";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ cohort?: string }>;
}

export default async function AdminAnalyticsPage({ searchParams }: PageProps) {
  // "admin", not "instructor": ROLES_SATISFYING.admin is ["admin"] alone, so an
  // instructor is redirected here even though they may read
  // /instructor/analytics. Page-level re-check for the reason src/middleware.ts
  // states — the edge guard covers a path prefix, this covers this page.
  await requireRole("admin");
  const params = await searchParams;

  const parsed = params.cohort === undefined ? null : Number(params.cohort);
  const cohortId = parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;

  // Three read models, one wave — and the round-trip arithmetic is worth stating
  // because it is the one place this feature comes close to a limit.
  // `getCohortAnalytics` issues 3 statements, `listCohorts` 1, and the new
  // `getAdvancedAnalytics` exactly 1: five concurrent, against a pool of `max: 5`
  // (src/db/index.ts:77). That is AT the ceiling, so for the duration of this page
  // load an unlucky concurrent request queues behind it.
  //
  // TRADE-OFF, stated rather than hidden (house rule 7). The alternative is to
  // await the new statement after the wave, which costs a guaranteed extra round
  // trip — ~245 ms measured, src/db/index.ts:56 — on every load of this page to
  // avoid a transient queue that only bites when an admin opens analytics at the
  // same moment as other traffic. The instructor page, which is the one actually
  // visited during a class, issues only 4. If the pool is ever raised or this page
  // gains a sixth read, revisit this in one place: it is one Promise.all.
  // Measured for the two analytics read models together: 254 ms
  // (scripts/perf-probe.ts, live Neon, 2026-07-31).
  const [analytics, advanced, cohorts] = await Promise.all([
    getCohortAnalytics(cohortId),
    getAdvancedAnalytics(cohortId),
    listCohorts(),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/analytics"
            aria-current={cohortId === null ? "page" : undefined}
            className={buttonClasses(cohortId === null ? "primary" : "secondary", "sm")}
          >
            All cohorts
          </Link>
          {cohorts.map((c) => (
            <Link
              key={c.id}
              href={`/admin/analytics?cohort=${c.id}`}
              aria-current={cohortId === c.id ? "page" : undefined}
              className={buttonClasses(cohortId === c.id ? "primary" : "secondary", "sm")}
              data-testid={`cohort-filter-${c.id}`}
            >
              {c.name}
            </Link>
          ))}
        </div>
        <p className="text-sm text-ink-muted">Aggregated in {analytics.computeMs} ms.</p>
      </header>

      <AnalyticsSummary analytics={analytics} />
      <WeekAnalyticsTable weeks={analytics.weeks} />

      <div className="grid gap-4 lg:grid-cols-2">
        <QuizDistribution buckets={analytics.quizDistribution} />
        {/* Addresses stripped at the page boundary — src/lib/analytics/privacy.ts. */}
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
