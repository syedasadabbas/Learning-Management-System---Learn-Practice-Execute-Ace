// =============================================================================
// REQUEST ORIGIN — where the coarse network and client hints come from.
// Owner: activity-logs stream.
// -----------------------------------------------------------------------------
// Kept in its OWN module, apart from record.ts, because it is the only file in this
// stream that imports `next/headers`. That import makes a module unusable outside a
// request scope, including inside the vitest suite — so isolating it here is what
// keeps redact.ts, filter.ts, csv.ts and retention.ts's pure parts testable without
// a Next runtime. It is deliberately NOT re-exported from index.ts.
//
// -----------------------------------------------------------------------------
// THE HEADERS ARE CLIENT-SUPPLIED, AND THAT IS RECORDED HONESTLY.
//
// `x-forwarded-for` is set by whatever proxy handled the request, and a client can
// send its own. Vercel overwrites the header with the observed peer address, so in
// production the left-most entry is trustworthy; behind an arbitrary reverse proxy,
// or on localhost, it is not. This stream does not attempt to verify it, and the
// audit trail must not imply otherwise. Two consequences, both deliberate:
//
//   * `ip_prefix` is CORROBORATING evidence, never proof. It supports "two accounts
//     acted from the same network at the same minute, worth a look". It cannot
//     support "this person was at this address", and nothing in the admin UI
//     presents it as though it could.
//   * the value stored is a /24 or /48 prefix anyway (see redact.ts), so a forged
//     header buys an attacker the ability to sit in a different fake /24 — which
//     tells an investigator that the header is unreliable, which they already knew.
//
// The alternative — omitting the column because it can be forged — would discard
// the one signal that catches the ordinary, non-adversarial case: a student sitting
// an exam from someone else's connection, or two accounts driven from one laptop.
// =============================================================================

import { headers } from "next/headers";

import type { ActivityOrigin } from "./record";

/** Headers consulted, in priority order, for the peer address. */
const IP_HEADERS = [
  // Vercel sets this to the observed peer and overwrites any client value.
  "x-real-ip",
  // Standard proxy chain; the left-most entry is closest to the client.
  "x-forwarded-for",
  // Cloudflare, in case the app is ever fronted by it.
  "cf-connecting-ip",
];

/**
 * Origin hints from an incoming `Request` — the form for route handlers.
 *
 * Returns coarse RAW values; `recordActivity` runs them through redact.ts on the
 * way to the database, so no caller can accidentally bypass the truncation by
 * assembling an origin by hand.
 */
export function originFromRequest(request: Request): ActivityOrigin {
  const h = request.headers;
  const ip = IP_HEADERS.map((name) => h.get(name)).find((v) => v && v.trim() !== "") ?? null;
  return {
    ip,
    userAgent: h.get("user-agent"),
    // Vercel's per-request id. Lets an operator line a row up against the
    // platform's own request log instead of this table duplicating it.
    correlationId: h.get("x-vercel-id") ?? h.get("x-request-id"),
  };
}

/**
 * Origin hints inside a server component or server action, where there is no
 * `Request` object in scope.
 *
 * `headers()` is async in Next 15 and reading it opts the caller into dynamic
 * rendering. Every surface in this stream is already `dynamic = "force-dynamic"`
 * (an audit log must never be served from a cache), so that costs nothing here —
 * but it is the reason this helper must not be called from a component that is
 * meant to be static.
 */
export async function originFromHeaders(): Promise<ActivityOrigin> {
  const h = await headers();
  const ip = IP_HEADERS.map((name) => h.get(name)).find((v) => v && v.trim() !== "") ?? null;
  return {
    ip,
    userAgent: h.get("user-agent"),
    correlationId: h.get("x-vercel-id") ?? h.get("x-request-id"),
  };
}
