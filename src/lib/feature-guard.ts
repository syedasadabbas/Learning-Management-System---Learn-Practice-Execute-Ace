// =============================================================================
// FEATURE GUARDS — the enforcement half of src/lib/features.ts.
// -----------------------------------------------------------------------------
// Owner: orchestration. Composed with, never a replacement for, the auth guards
// in src/lib/guard.ts.
//
// A flag that is only consulted by the navigation menu is not a feature flag,
// it is a cosmetic one: the API routes stay reachable, and turning the feature
// "off" leaves every endpoint answering to anyone who kept the URL. These
// guards close that hole. Every route handler and every page under a flagged
// feature calls one of them FIRST, before its auth guard.
//
// ORDER MATTERS AND IT IS FLAG-THEN-AUTH.
// `apiGuard` returns 401/403, which tells an unauthenticated caller that the
// endpoint exists. If auth ran first, probing a disabled feature while signed
// out would still reveal the whole route map. Checking the flag first means a
// disabled feature is a uniform 404 to everyone — signed in or not, student or
// admin — and is therefore indistinguishable from a feature that was never
// built. See `featureGate` below.
// =============================================================================

import { notFound } from "next/navigation";

import { features } from "@/lib/features";

/** Flags that gate a user-facing surface. Keys of the server-side `features`. */
export type FeatureName = keyof typeof features;

/**
 * Gate an API route handler on a feature flag.
 *
 * Returns a 404 `Response` when the feature is off, or `null` when it is on.
 * The null-means-proceed shape mirrors `requireCron` in src/lib/guard.ts, so
 * route handlers in this repo already read this pattern:
 *
 * ```ts
 * export async function GET(req: Request) {
 *   const off = featureGate("liveClasses");
 *   if (off) return off;
 *   const gate = await apiGuard("student");
 *   if (!gate.ok) return gate.response;
 *   // ...
 * }
 * ```
 *
 * The body is the same shape Next.js serves for a genuinely unrouted path, and
 * carries no hint that a flag was involved — an error string like
 * "feature disabled" would defeat the point of answering 404 at all.
 */
export function featureGate(name: FeatureName): Response | null {
  if (features[name]) return null;

  return new Response(JSON.stringify({ error: "Not Found" }), {
    status: 404,
    headers: {
      "content-type": "application/json",
      // A disabled feature is a deployment-configuration fact, not a per-user
      // one. Marking it uncacheable keeps a CDN from pinning the 404 in front
      // of the feature for the window after an operator flips the flag on.
      "cache-control": "no-store",
    },
  });
}

/**
 * Gate a server component or page on a feature flag.
 *
 * Calls Next.js `notFound()`, which renders the app's 404 page and never
 * returns — hence the `never` return type, which lets callers use it as a
 * statement without TypeScript losing narrowing on the code that follows.
 */
export function requireFeature(name: FeatureName): void {
  if (!features[name]) notFound();
}
