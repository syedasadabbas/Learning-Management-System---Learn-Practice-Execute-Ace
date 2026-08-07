// =============================================================================
// /assignments/ingest-status — THE OPERATOR SURFACE for Google Sheet ingestion.
// Owner: submissions stream. STAFF ONLY (instructor or admin).
// -----------------------------------------------------------------------------
// WHY THIS PAGE EXISTS
//
// Ingestion is unattended: daily Vercel cron (vercel.json) into
// `ingestAllAssignments`. It was already careful about failure — every transport
// problem, every unusable sheet and every dropped row is named with a closed-set
// reason and a human-readable detail — and it reported all of it to
// `console.info`, which on a serverless deployment is a platform log the
// instructor cannot open and the admin will not read.
//
// That is not a small gap. The single likeliest real misconfiguration is a
// response sheet published as a WEB PAGE instead of CSV: it returns 200 OK, it
// reports itself accurately every hour, and every student in the cohort silently
// appears not to have submitted. Nobody finds out until a student complains about
// a grade. A pipeline that fails invisibly is not made safer by adding more skip
// reasons to it; the reasons have to arrive somewhere a human looks.
//
// ROUTE PRECEDENCE, stated because it looks like a collision and is not:
// this static segment sits beside the dynamic `/assignments/[weekId]`. Next.js
// resolves a static segment BEFORE a dynamic sibling, so "ingest-status" reaches
// this page and never the week page — which would have rejected it anyway, since
// it calls notFound() on a non-numeric weekId.
//
// AUTHORIZATION: `requireRole("instructor")`, which ROLES_SATISFYING widens to
// instructor + admin. Not "admin": the instructor is the person who chases the
// student whose response did not arrive. A STUDENT must not reach it — the
// skipped-row samples carry other respondents' email addresses.
// =============================================================================

import Link from "next/link";

import { SyncSubmissionsButton } from "@/components/instructor";
import { Badge, Card, EmptyState } from "@/components/ui";
import { requireRole } from "@/lib/guard";
import { getIngestStatus } from "@/lib/submissions/ingest-log";
import { ageLabel, verdictFor } from "@/lib/submissions/ingest-status-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Submission ingest status" };

/** UTC and explicit, matching AssignmentCard — never a locale-dependent string. */
function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export default async function IngestStatusPage() {
  await requireRole("instructor", "/assignments/ingest-status");
  const status = await getIngestStatus();
  const now = new Date();

  const standInCount = status.rows.filter((r) => r.sheetIsStandIn).length;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6" data-testid="ingest-status-page">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Submission ingest status</h1>
          <p className="text-sm text-ink-muted">
            The last time each assignment&apos;s response sheet was read, and what came of it.
            Responses are swept on a schedule; the button below runs the sweep for every
            assignment now, and a single assignment can still be re-read with{" "}
            <code>POST /api/assignments/&lt;id&gt;/ingest</code>.
          </p>
        </div>
        <SyncSubmissionsButton label="Sync all response sheets now" />
      </header>

      {!status.available && (
        <div
          className="rounded-lg border border-line bg-surface p-4"
          data-testid="ingest-status-unavailable"
        >
          <Badge tone="danger">Report store unavailable</Badge>
          <p className="mt-2 text-sm text-ink-muted">
            The <code>submission_ingest_runs</code> table could not be read, so this page cannot
            say anything about past runs — including whether they happened. Ingestion itself is
            unaffected (recording a run is deliberately best-effort). Run{" "}
            <code>npx tsx scripts/migrate-ingest-runs.ts</code> if the table has not been created
            on this database.
          </p>
        </div>
      )}

      {standInCount > 0 && (
        <div className="rounded-lg border border-line bg-surface p-4" data-testid="ingest-stand-in-notice">
          <Badge tone="warning">
            {standInCount} of {status.rows.length} sheets are this app&apos;s own stand-in
          </Badge>
          <p className="mt-2 text-sm text-ink-muted">
            Google is not involved for those. The transport, parser, student matcher, lateness
            rule and upsert below are the real ones, but the respondent data is manufactured by
            this repository — see the header of <code>src/lib/submissions/stand-in.ts</code>. A
            green row here does NOT mean the Google pipeline works.
          </p>
        </div>
      )}

      {status.rows.length === 0 ? (
        <EmptyState
          title="No assignments"
          description="Ingest status appears here once assignments exist."
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {status.rows.map((row) => {
            const verdict = verdictFor(row, now);
            const run = row.lastRun;
            return (
              <li key={row.assignmentId}>
                {/*
                  The testid goes on the Card itself, not on a div inside it. Card
                  renders `title` in a header that is a SIBLING of its children, so
                  a testid on an inner wrapper would name an element that does not
                  contain its own title — which is exactly how a sibling stream's
                  12 course-card specs failed today.
                */}
                <Card
                  data-testid={`ingest-status-${row.assignmentId}`}
                  data-verdict={verdict.label}
                  title={`Week ${row.weekNumber}: ${row.assignmentTitle}`}
                  subtitle={
                    run
                      ? `Last run ${formatUtc(run.ranAt)} — ${ageLabel(run.ranAt, now)} (${run.triggeredBy}, sheet: ${run.sheetSource})`
                      : "No ingest run has ever been recorded for this assignment."
                  }
                  action={
                    <Badge tone={verdict.tone} data-testid="ingest-verdict">
                      {verdict.label}
                    </Badge>
                  }
                >
                  <div className="flex flex-col gap-3 text-sm">
                    <p className="text-ink-muted" data-testid="ingest-verdict-why">
                      {verdict.why}
                    </p>

                    {run && (
                      <>
                        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                          {(
                            [
                              ["Rows seen", run.rowsSeen],
                              ["Inserted", run.inserted],
                              ["Updated", run.updated],
                              ["Unchanged", run.unchanged],
                              ["Skipped", run.skippedCount],
                            ] as const
                          ).map(([label, value]) => (
                            <div key={label}>
                              <dt className="text-xs text-ink-muted">{label}</dt>
                              <dd
                                className="tabular-nums text-lg font-semibold"
                                data-testid={`ingest-${label.toLowerCase().replace(" ", "-")}`}
                              >
                                {value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                        {/* Milliseconds, per the house metric-units rule. */}
                        <p className="text-xs text-ink-muted">
                          Completed in {run.durationMs} ms.
                        </p>

                        {Object.keys(run.skipReasonCounts).length > 0 && (
                          <div data-testid="ingest-skip-reasons">
                            <h4 className="text-sm font-semibold">Why rows were skipped</h4>
                            <ul className="mt-1 flex flex-wrap gap-2">
                              {Object.entries(run.skipReasonCounts).map(([reason, n]) => (
                                <li key={reason}>
                                  <Badge
                                    tone={reason === "blank_row" ? "neutral" : "warning"}
                                    size="sm"
                                  >
                                    {reason} × {n}
                                  </Badge>
                                </li>
                              ))}
                            </ul>
                            {run.skippedSample.length > 0 && (
                              <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-muted">
                                {run.skippedSample.map((s, i) => (
                                  <li key={`${s.rowNumber}-${i}`}>
                                    Row {s.rowNumber}
                                    {s.email ? ` (${s.email})` : ""}: {s.detail}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Link href="/assignments" className="text-sm underline">
        Back to assignments
      </Link>
    </main>
  );
}
