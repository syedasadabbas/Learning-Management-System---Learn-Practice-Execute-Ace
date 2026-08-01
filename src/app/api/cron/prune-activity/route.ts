// =============================================================================
// POST /api/cron/prune-activity  —  auth level "cron"
// Owner: the activity-logs stream.
// -----------------------------------------------------------------------------
// "cron", i.e. the CRON_SECRET bearer token and NO user role — deliberately
// stricter than "admin", following the precedent and the reasoning of
// `POST /api/cron/drain-jobs` (src/lib/contracts/api.ts:202-208). A drain can mail
// the whole cohort from a browser; this can DELETE the audit trail from one. An
// admin session must not be able to trigger either.
//
// `requireCron` fails closed when CRON_SECRET is unset (src/lib/guard.ts:224-236),
// which for this endpoint means an unconfigured deployment cannot prune at all.
// That is the right failure direction: not pruning costs disk, and pruning wrongly
// costs evidence.
//
// TWO SAFETY GATES BEYOND AUTH, because there is no undo:
//
//   1. `confirm=exported` must be present. `pruneActivity` throws without it. There
//      is no cold-storage archive on this stack (see retention.ts), so a prune is a
//      permanent deletion and the caller has to assert the window was exported.
//      A schedule that omits the flag is loudly broken rather than quietly deleting.
//   2. `?dryRun=1` counts what would go and deletes nothing. The scheduled entry in
//      vercel.json runs the DRY RUN by default — see the note there. Turning on real
//      deletion is a deliberate edit by an operator who has read this file, not
//      something that starts happening because the feature shipped.
//
// The prune records itself as an `activity_pruned` event BEFORE deleting, so the one
// operation that removes rows from the audit trail is on the audit trail. Details in
// retention.ts.
// =============================================================================

import { apiError, apiOk, requireCron } from "@/lib/guard";
import { pruneActivity, retentionDays } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

/**
 * TRANSPORT NOTE — Vercel Cron issues a GET, not a POST, so the scheduled entry in
 * vercel.json would 405 against POST alone. Same guard and same body, matching the
 * pattern the other three cron routes already use
 * (src/app/api/cron/ingest-submissions/route.ts:91).
 *
 * That a GET performs a mutation is not ideal, and here it is nearly harmless: the
 * default path is a dry run, and the destructive path additionally requires
 * `confirm=exported`, which a Vercel cron cannot supply.
 */
export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

async function handle(request: Request): Promise<Response> {
  const denied = requireCron(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") !== "0";
  const confirmed = url.searchParams.get("confirm") === "exported";

  // Explicit days override, still clamped to MIN_RETENTION_DAYS inside the library.
  const daysRaw = url.searchParams.get("days");
  let days: number | undefined;
  if (daysRaw !== null && daysRaw !== "") {
    if (!/^\d+$/.test(daysRaw)) {
      return apiError(400, "days must be a whole number of days.", "invalid_days");
    }
    days = Number(daysRaw);
  }

  if (!dryRun && !confirmed) {
    return apiError(
      400,
      "A real prune requires confirm=exported. There is no cold-storage archive on " +
        "this stack, so deletion is permanent — export the window first (GET " +
        "/api/admin/activity/export) and then pass the flag.",
      "confirmation_required",
    );
  }

  try {
    const result = await pruneActivity({
      // A dry run performs no deletion, so the confirmation it would need does not
      // apply; passing true here keeps the library's single gate meaningful for the
      // path that actually deletes.
      confirmExported: true,
      dryRun,
      days,
      // NULL actor: a cron run has no user, which is exactly the case
      // activity_logs.actor_id is nullable for.
      actorId: null,
      actorRole: null,
    });

    return apiOk({
      ...result,
      effectiveRetentionDays: days ?? retentionDays(),
      note: dryRun
        ? "Dry run: nothing was deleted. Re-issue with ?dryRun=0&confirm=exported to prune."
        : "Rows were permanently deleted. The deletion is recorded as an activity_pruned event.",
    });
  } catch (error) {
    console.error("[activity] prune failed:", error);
    return apiError(
      500,
      error instanceof Error ? error.message : "The prune failed.",
      "prune_failed",
    );
  }
}
