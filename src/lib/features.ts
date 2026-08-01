// =============================================================================
// FEATURE FLAGS — env-driven release switches for the add-on wave.
// -----------------------------------------------------------------------------
// Owner: orchestration. Read by every stream; edited by none of them without
// coordination.
//
// WHY THIS FILE EXISTS SEPARATELY FROM app.config.ts.
// `appConfig.subjects[].enabled` is the house idiom for "this cohort has not
// been given this content yet" — a product decision, edited in a commit and
// shipped through review. That is the right shape for curriculum.
//
// It is the WRONG shape for live classes. Live classes depend on a Socket.io
// service running on a host OUTSIDE Vercel (Railway/Fly/Render — see
// DEPLOYMENT_LIVE_CLASSES.md). That dependency can be down, unpaid, or not yet
// provisioned, and when it is, the correct response is to turn the feature off
// in seconds from the hosting dashboard — not to open a pull request. So the
// switch is an environment variable, and its default is OFF.
//
// THE DEFAULT IS OFF, AND THAT IS LOAD-BEARING.
// Every flag below is false unless the environment says exactly "true". A typo,
// an unset var, a new preview deployment that nobody configured, a `.env` that
// drifted — all of these fail CLOSED. The live-classes surface disappears and
// the rest of the LMS behaves exactly as it did before the feature existed.
// That property is the whole reason the feature was allowed to land on the same
// branch as the learning enhancements.
// =============================================================================

/**
 * Parse a flag from the environment.
 *
 * Deliberately strict: only the exact string `"true"` enables. Not `"1"`, not
 * `"TRUE"`, not `"yes"`. A permissive parser turns a half-remembered value into
 * a feature silently switching on in production, which is the failure this
 * whole module exists to prevent. Trimmed, because dashboard text inputs and
 * `.env` files both collect trailing whitespace and that is not the operator's
 * mistake to pay for.
 */
function isEnabled(raw: string | undefined): boolean {
  return raw?.trim() === "true";
}

// ---------------------------------------------------------------------------
// Server-side flags
// ---------------------------------------------------------------------------
// These are read in route handlers, server components and server actions. They
// are NOT prefixed `NEXT_PUBLIC_`, so Next.js will not inline them into the
// browser bundle — a client component reading `features.liveClasses` here would
// get `false` regardless of configuration. Client code must use
// `publicFeatures` below.

export const features = {
  /**
   * The live-classes feature as a whole: scheduling, the class room, the Jitsi
   * embed, attendance, chat and Q&A.
   *
   * When false, `src/lib/live-classes/guard.ts` makes every live-classes route
   * return 404 — not 403. 404 is correct because a disabled feature should be
   * indistinguishable from one that was never built; 403 advertises that the
   * endpoint exists and invites probing.
   */
  liveClasses: isEnabled(process.env.LIVE_CLASSES_ENABLED),

  /**
   * The presentation builder, viewer and export.
   *
   * Separate from `liveClasses` on purpose. Presentations are entirely
   * client-side (Reveal.js) and carry NO external-service dependency, so they
   * can ship while live classes stay dark. Bundling the two behind one flag
   * would hold a working feature hostage to an unprovisioned Railway service.
   */
  presentations: isEnabled(process.env.PRESENTATIONS_ENABLED),

  /**
   * Learning enhancements: sample implementations, practice problems,
   * interview questions, concept visualizations.
   *
   * Additive read-only surfaces over existing lectures and assignments. Flagged
   * for a staged rollout, not because they can break anything.
   */
  learningEnhancements: isEnabled(process.env.LEARNING_ENHANCEMENTS_ENABLED),
} as const;

// ---------------------------------------------------------------------------
// Client-side flags
// ---------------------------------------------------------------------------
// `process.env.NEXT_PUBLIC_*` is substituted at BUILD time by Next.js, which is
// why each one is written out as a full static member expression below rather
// than read through a variable or a loop. `process.env[name]` does not get
// inlined and evaluates to undefined in the browser. This is the single most
// common way a Next.js feature flag silently reads false in production.

export const publicFeatures = {
  liveClasses: isEnabled(process.env.NEXT_PUBLIC_LIVE_CLASSES_ENABLED),
  presentations: isEnabled(process.env.NEXT_PUBLIC_PRESENTATIONS_ENABLED),
  learningEnhancements: isEnabled(
    process.env.NEXT_PUBLIC_LEARNING_ENHANCEMENTS_ENABLED,
  ),
} as const;

// ---------------------------------------------------------------------------
// Live-classes runtime configuration
// ---------------------------------------------------------------------------

export const liveClassesConfig = {
  /**
   * Jitsi deployment serving the video plane.
   *
   * Defaults to the free public `meet.jit.si`. WHY NOT SELF-HOSTED ON RAILWAY:
   * Jitsi's videobridge needs UDP/10000 ingress for media, and Railway routes
   * HTTP and TCP only. Self-hosting therefore requires a VPS with a public UDP
   * port, which was out of scope for a zero-cost deployment. Swapping to a
   * self-hosted domain or to 8x8 JaaS later is a change to this ONE env var,
   * because nothing else in the codebase names a Jitsi host.
   *
   * Operational consequence to state plainly: `meet.jit.si` is shared public
   * infrastructure with no SLA and no retention guarantee. Do not treat a
   * session held on it as private or as durably recorded.
   */
  jitsiDomain: process.env.NEXT_PUBLIC_JITSI_DOMAIN?.trim() || "meet.jit.si",

  /**
   * Base URL of the standalone Socket.io service (`services/realtime`).
   *
   * Undefined is a SUPPORTED state, not a misconfiguration. When it is absent
   * the chat and Q&A panels render in a read-only mode backed by the REST
   * history endpoints, and the class still runs: video is Jitsi's, attendance
   * is written over HTTP on join and leave, and only the live text layer
   * degrades. A live class must not fail because a $0 hobby dyno slept.
   */
  realtimeUrl: process.env.NEXT_PUBLIC_REALTIME_URL?.trim() || undefined,
} as const;

/**
 * Whether the real-time text layer (chat, Q&A, reactions) can connect at all.
 *
 * Both conditions are required: the feature must be on AND a service URL must
 * be configured. Checking only the flag produces a client that retries a
 * connection to `undefined` forever.
 */
export function isRealtimeAvailable(): boolean {
  return publicFeatures.liveClasses && liveClassesConfig.realtimeUrl !== undefined;
}
