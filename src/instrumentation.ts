// =============================================================================
// SERVER BOOTSTRAP — runs ONCE per server start, before the first request.
// -----------------------------------------------------------------------------
// Next.js calls `register()` when the server process starts (and once per
// serverless cold start), which is the earliest point application code runs. That
// makes it the only place an environment check is worth putting: a check inside a
// route or a layout runs per request, so it reports the same misconfiguration
// hundreds of times and reports it as a failure of whatever page happened to be
// requested first — see src/lib/env.ts for the two-session incident that is.
//
// WHY THIS FAILS THE BOOT RATHER THAN DEGRADING.
//
// A server that starts without AUTH_SECRET is a server that serves its public
// pages perfectly and 500s every sign-in. On Vercel that is a GREEN deployment
// with a broken product, and the failure surfaces to a student rather than to
// whoever deployed it. Refusing to start turns it into a deploy that visibly did
// not go live, with the missing variable named in the log — the same fault, moved
// to the only audience who can fix it. src/db/index.ts:36 already took this
// decision for DATABASE_URL; this is that decision applied to the rest.
//
// THE EDGE RUNTIME IS SKIPPED. src/middleware.ts runs on the edge, where
// process.env carries only what is inlined at build time, so a check there would
// report a false absence. The Node.js server is the process that actually needs
// the values, and it is the one that gets checked.
// =============================================================================

export async function register(): Promise<void> {
  // NEXT_RUNTIME is "nodejs" | "edge". See the edge note in the header.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Imported dynamically so the edge bundle never pulls this module in at all.
  const { assertEnv } = await import("./lib/env");
  assertEnv();
}
