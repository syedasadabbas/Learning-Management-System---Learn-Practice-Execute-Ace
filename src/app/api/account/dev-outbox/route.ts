// =============================================================================
// GET / DELETE /api/account/dev-outbox — owned by the `account` stream.
// -----------------------------------------------------------------------------
// READS THE DEV MAIL TRANSPORT'S IN-MEMORY OUTBOX. This exists so the end-to-end
// reset spec can complete a real reset with no SMTP configured, which is the
// project's default state (FREE_STACK.md). Scraping the dev server's stdout from
// Playwright is not viable: the spec may run against a server that was already
// running, whose output goes somewhere the test cannot read.
//
// WHY THIS IS NOT A HOLE, and how it is kept from becoming one:
//   1. It 404s unless NODE_ENV is exactly "development". `next build` sets
//      "production", so the deployed app has no such endpoint — a 404 rather than
//      a 403 so it does not even confirm the route exists.
//   2. It 404s whenever SMTP is configured, because then no message ever reaches
//      the dev transport and a populated outbox would mean something is wrong.
//   3. It reads a bounded in-memory ring buffer (8 messages) that only ever holds
//      what the dev transport already printed to the server console in clear text.
//      It exposes nothing the operator of that console cannot already see.
//
// It is nonetheless a route that returns other people's reset links in
// development. Stated plainly rather than buried: do not run a development build
// on a host reachable by students. The alternative — no endpoint and an e2e spec
// that cannot verify the reset flow at all — was judged worse, because an untested
// reset flow is the more likely source of a real breach.
// =============================================================================

import { apiError, apiOk } from "@/lib/guard";
import { clearDevOutbox, readDevOutbox, smtpConfigFromEnv } from "@/lib/mail";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Both conditions must hold. See the header. */
function enabled(): boolean {
  return process.env.NODE_ENV === "development" && smtpConfigFromEnv() === null;
}

/** A 404 that reveals nothing about whether the route exists. */
function notFound(): Response {
  return apiError(404, "Not found.", "not_found");
}

export async function GET(): Promise<Response> {
  if (!enabled()) return notFound();
  return apiOk({ messages: readDevOutbox() });
}

export async function DELETE(): Promise<Response> {
  if (!enabled()) return notFound();
  clearDevOutbox();
  return apiOk({ cleared: true });
}
