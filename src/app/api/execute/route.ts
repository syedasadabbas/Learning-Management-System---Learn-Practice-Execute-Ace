// =============================================================================
// POST /api/execute  —  server-side code execution via Piston.
// Owner: code-execution stream.
// -----------------------------------------------------------------------------
// AN UNLISTED ROUTE, ON PURPOSE, AND SAID OUT LOUD.
// `ROUTES` / `ROUTE_AUTH` in src/lib/contracts/api.ts are FROZEN this wave and
// carry no entry for this path, so it cannot be registered there without editing
// the seam. It is therefore guarded explicitly with `apiGuard("student")`, which
// is the same call the map would have produced for a `"student"` entry:
// signed-in users only (staff satisfy "student" too), never anonymous. Left
// public it would be an open, free, keyless remote-code-execution proxy on the
// internet, which is precisely the shape of thing that gets a shared Piston
// instance blocked. Flagged in the stream report for the contracts owner to add
// on the next seam thaw.
//
// WHY THIS HANDLER IS THIN.
// Everything interesting — the language allow-list, the timeout clamp, output
// truncation, the never-throw contract — lives in src/lib/execution and is unit
// tested there. The handler validates the envelope, applies the per-user limiter,
// and translates one `RunResult` into one HTTP response.
//
// WHY A FAILED RUN IS STILL HTTP 200.
// `{ ok: false, reason: "timeout" }` is a successful answer to "please run this":
// we ran it, it looped. Returning 5xx would make the browser's fetch layer and
// any retry logic treat a student's infinite loop as a server outage. The two
// exceptions are 429 (a real "come back later", which needs Retry-After) and a
// malformed request (400) — neither of which is a run result at all.
// =============================================================================

import { z } from "zod";

import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { resolveLanguage } from "@/lib/execution/languages";
import { runOnPiston } from "@/lib/execution/piston";
import { checkRunAllowance } from "@/lib/execution/rate-limit";
import { MAX_RUN_TIMEOUT_MS, MIN_RUN_TIMEOUT_MS } from "@/lib/execution/timeouts";
import { MAX_SOURCE_CHARS, MAX_STDIN_CHARS } from "@/lib/execution/truncate";

// Node runtime: `runOnPiston` reads process.env and uses AbortSignal.timeout.
export const runtime = "nodejs";
// Never cached — the same source with different stdin is a different run, and a
// cached run result during an exam would be a graded lie.
export const dynamic = "force-dynamic";

/**
 * Request envelope. Lengths are validated here as well as clipped in
 * truncate.ts: rejecting a 5 MB paste before it reaches the runner is cheaper,
 * and an explicit 400 tells the student the paste was too long instead of
 * silently running a fragment of it.
 */
const executeSchema = z.object({
  // Not an enum: an unlisted language must come back as `unsupported_language`
  // with the allow-list in the message, not as a generic Zod complaint that a
  // student cannot act on.
  language: z.string().min(1).max(40),
  source: z.string().max(MAX_SOURCE_CHARS),
  stdin: z.string().max(MAX_STDIN_CHARS).optional(),
  timeoutMs: z.number().int().min(MIN_RUN_TIMEOUT_MS).max(MAX_RUN_TIMEOUT_MS).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(400, "Request body must be JSON.", "invalid_json");
  }

  const parsed = executeSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(400, parsed.error.issues[0]?.message ?? "Invalid request.", "invalid_body");
  }

  // Reject an unlisted language before spending the rate-limit budget on it: a
  // typo in a lecture's exercise definition must not cost a student their runs.
  const language = resolveLanguage(parsed.data.language);
  if (!language) {
    return apiError(
      400,
      `"${parsed.data.language}" is not a language this platform can run.`,
      "unsupported_language",
    );
  }

  // Per-user limiting keyed on the SESSION user id, never on anything from the
  // body — a client-supplied identity would make the limiter opt-in.
  const allowance = checkRunAllowance(`user:${gate.user.id}`, Date.now());
  if (!allowance.allowed) {
    const response = apiError(429, allowance.message, "rate_limited");
    // Seconds, because that is the unit the HTTP header is defined in; the
    // millisecond value is the one the app reasons with. Rounded UP so a client
    // that obeys it exactly is not refused a second time.
    response.headers.set("retry-after", String(Math.ceil(allowance.retryAfterMs / 1000)));
    return response;
  }

  // `skipRateLimit`: the allowance above was already charged. Letting the runner
  // charge it again would halve every student's effective budget.
  const result = await runOnPiston(
    {
      language: parsed.data.language,
      source: parsed.data.source,
      stdin: parsed.data.stdin ?? "",
      timeoutMs: parsed.data.timeoutMs,
    },
    { userKey: `user:${gate.user.id}`, skipRateLimit: true },
  );

  // A `rate_limited` result here came from PISTON's own 429 rather than ours.
  // Surfaced as HTTP 429 so the browser and any intermediary see the same fact,
  // while the body still carries the full RunResult (including `reason`) so a
  // grader can defer the item instead of scoring it zero.
  if (!result.ok && result.reason === "rate_limited") {
    const response = apiOk(result, 429);
    response.headers.set("retry-after", "2");
    return response;
  }

  return apiOk(result);
}
