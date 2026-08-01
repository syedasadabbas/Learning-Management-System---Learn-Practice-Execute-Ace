// =============================================================================
// GET / POST /api/admin/jobs  —  auth level "admin"
// Owner: the async-queues stream.
// -----------------------------------------------------------------------------
// WHY THIS ROUTE EXISTS AT ALL. The requirement behind the dead-letter state is
// that "a job that fails forever must become visible, not silently vanish". A
// `status = 'dead'` column satisfies that only for somebody holding a psql
// prompt. This is the endpoint that makes it true for an operator: the counts,
// the dead list, and a way to put a dead job back after fixing whatever killed
// it.
//
// ADMIN, NOT INSTRUCTOR. `ROLES_SATISFYING.instructor` admits admins but not the
// reverse, and this endpoint exposes the queue's payloads — which name
// submission ids across the whole cohort — and can re-trigger emails to
// students. That is operations, not teaching.
//
// `ROUTE_AUTH["GET  /api/admin/jobs"]` and `["POST /api/admin/jobs"]` are both
// "admin". They were added to the contract at integration; the guard below took
// the level directly all along, so nothing about enforcement changed — what
// changed is that the map no longer omits two live routes and can therefore use
// its own exhaustiveness check to catch a route that forgot to authorize itself.
//
// PAYLOADS ARE RETURNED AS STORED. They are two integers today
// (src/lib/queue/handlers/submission-graded-email.ts) and contain no personal
// data — which is a property of the current handler, not a guarantee of this
// route. A future job kind whose payload carries anything sensitive must redact
// it here before this endpoint is the thing that leaked it.
// =============================================================================

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { JOB_STATUSES, listJobs, queueCounts, requeueDeadJobs } from "@/lib/queue";
import type { JobStatus } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseStatuses(raw: string | null): JobStatus[] | undefined {
  if (!raw) return undefined;
  const wanted = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const valid = wanted.filter((s): s is JobStatus =>
    (JOB_STATUSES as readonly string[]).includes(s),
  );
  // An entirely unrecognised filter returns nothing rather than silently
  // falling back to "everything": ?status=deadd must not quietly list the whole
  // queue and let an operator conclude there are no dead jobs.
  return valid.length === wanted.length ? valid : [];
}

/**
 * List jobs, newest activity first, plus the aggregate counts.
 *
 * `?status=dead` is the query this route was written for. `?limit=` is capped at
 * 200 inside `listJobs`, so a caller cannot ask for the whole table.
 */
export async function GET(request: Request): Promise<Response> {
  const gate = await apiGuard("admin");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const status = parseStatuses(url.searchParams.get("status"));
  const kind = url.searchParams.get("kind") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limitRaw && (!Number.isInteger(limit) || (limit ?? 0) <= 0)) {
    return apiError(400, "limit must be a positive integer.", "invalid_limit");
  }

  const [jobs, counts] = await Promise.all([
    listJobs({ status, kind, limit }),
    queueCounts(),
  ]);

  return apiOk({ counts, jobs });
}

/**
 * Requeue dead jobs — the repair action that makes the dead-letter list
 * actionable rather than merely readable.
 *
 * Body: `{ "action": "requeue", "ids": [1, 2] }`, or `{ "action": "requeue",
 * "kind": "submission_graded_email" }` to revive every dead job of one kind.
 *
 * `ids` is NOT optional-by-omission-meaning-all. Requiring either an explicit id
 * list or an explicit kind means "requeue everything dead in the system" is not
 * something an empty POST can do by accident, which for a queue whose one
 * handler sends email to students is worth the extra field.
 */
export async function POST(request: Request): Promise<Response> {
  const gate = await apiGuard("admin");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Request body must be JSON.", "invalid_json");
  }

  const input = (body ?? {}) as Record<string, unknown>;
  if (input.action !== "requeue") {
    return apiError(400, 'The only supported action is "requeue".', "unsupported_action");
  }

  const ids = Array.isArray(input.ids)
    ? input.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : undefined;
  const kind = typeof input.kind === "string" && input.kind.trim() ? input.kind.trim() : undefined;

  if (!ids?.length && !kind) {
    return apiError(
      400,
      "Provide either a non-empty `ids` array or a `kind`. Requeuing every dead job " +
        "must be asked for explicitly.",
      "target_required",
    );
  }

  const requeued = await requeueDeadJobs({
    ids,
    kind: kind as never,
  });

  return apiOk({ requeued });
}
