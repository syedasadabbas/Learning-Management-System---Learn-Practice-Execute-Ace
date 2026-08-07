"use client";

// =============================================================================
// MANUAL SUBMISSION SYNC BUTTON — instructor-admin stream.
// -----------------------------------------------------------------------------
// Google Sheet ingestion normally runs unattended (vercel.json cron). That is a
// long wait for an instructor who is looking at a submission a student says they
// made two minutes ago, and "the queue is empty" is indistinguishable from "the
// sheet is misconfigured" without a run to look at. This button forces the sweep
// and REPORTS WHAT IT FOUND, including the aborts — a silent no-op button would
// have reproduced the exact problem the operator surface was built to fix.
//
// It calls `syncSubmissionsAction` (staff-guarded server action), never the cron
// route: that endpoint takes CRON_SECRET only and refuses cookie-bearing requests
// on purpose. See the action's header.
//
// `router.refresh()` after a successful run re-renders the surrounding server
// component, so newly ingested rows appear without a reload. The action also
// revalidates the other affected paths.
// =============================================================================

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button, Toast } from "@/components/ui";
import { syncSubmissionsAction, type SyncSubmissionsSummary } from "@/lib/instructor/actions";

export interface SyncSubmissionsButtonProps {
  label?: string;
  /** `secondary` where the surface already has a primary action. */
  variant?: "primary" | "secondary";
}

/** One sentence an instructor can act on, built from the sweep counters. */
function describe(summary: SyncSubmissionsSummary): string {
  const written = summary.inserted + summary.updated;
  const head =
    written > 0
      ? `${summary.inserted} new, ${summary.updated} updated`
      : "No new responses";
  return (
    `${head} — ${summary.assignmentsConsidered} assignment(s) checked, ` +
    `${summary.unchanged} unchanged, ${summary.skippedRows} row(s) skipped, ` +
    `in ${summary.durationMs} ms.`
  );
}

export function SyncSubmissionsButton({
  label = "Sync submissions from Google Sheet",
  variant = "secondary",
}: SyncSubmissionsButtonProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [toast, setToast] = React.useState<
    { tone: "success" | "error" | "info"; message: string } | null
  >(null);
  const [problems, setProblems] = React.useState<SyncSubmissionsSummary["problems"]>([]);

  async function onClick() {
    setPending(true);
    setToast(null);
    setProblems([]);

    const result = await syncSubmissionsAction();
    setPending(false);

    if (!result.ok) {
      setToast({ tone: "error", message: result.error });
      return;
    }

    const summary = result.data;
    setProblems(summary.problems);
    setToast({
      // "info", not "success", when nothing landed: a green tick on a run that
      // ingested nothing reads as "your submission is here" and it is not.
      tone: summary.inserted + summary.updated > 0 ? "success" : "info",
      message: describe(summary),
    });

    router.refresh();
  }

  return (
    <div data-testid="sync-submissions">
      <Button
        onClick={onClick}
        loading={pending}
        disabled={pending}
        variant={variant}
        data-testid="sync-submissions-button"
      >
        {pending ? "Syncing…" : label}
      </Button>

      {toast && (
        <div className="mt-3">
          <Toast
            tone={toast.tone}
            message={toast.message}
            // Errors and no-op results stay put: they are the ones that need
            // reading. A successful ingest dismisses itself.
            autoDismissMs={toast.tone === "success" ? 8_000 : 0}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}

      {problems.length > 0 && (
        <ul
          className="mt-3 flex flex-col gap-2 text-sm"
          data-testid="sync-submissions-problems"
        >
          {problems.map((p) => (
            <li
              key={p.assignmentId}
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
            >
              <span className="font-semibold">{p.title}</span> did no work (
              <code>{p.reason}</code>). {p.advice}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
