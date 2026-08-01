// =============================================================================
// PURE VIDEO PRESENTATION HELPERS — safe to import from a client component.
// -----------------------------------------------------------------------------
// Owner: video-ingestion stream.
//
// WHY THIS FILE EXISTS AT ALL
// `formatDuration` used to live in ./read.ts, which imports `@/db`. The admin
// review screen (src/components/videos/ReviewQueue.tsx) is a "use client"
// component and imported that one pure function — which dragged `src/db/index.ts`
// and therefore `pg` into the browser bundle, and `next build` failed with
// "Module not found: Can't resolve 'fs' / 'dns' / 'net' / 'tls'".
//
// It broke the PRODUCTION BUILD ONLY. Typecheck, lint, 1509 unit tests and the
// dev server were all green, because none of them bundles for the browser. It was
// found by the first `CI=true` Playwright run, which builds before it serves.
//
// The rule this restores is one the other streams already state in their own
// barrels: a module a client component can reach must not touch the database.
// src/lib/instructor/rates.ts (split out of analytics.ts) and
// src/lib/instructor/grade-payload.ts (split out of grading.ts) exist for the
// same reason. Nothing here imports @/db, and nothing here ever should.
// =============================================================================

/**
 * Video length as a human reads it. Input SECONDS (SI, per house rule 5), output
 * "m:ss" or "h:mm:ss". Returns "Duration unknown" for null rather than "0:00",
 * because a confidently wrong 0:00 is worse than an admission — and duration is
 * the one field in the curated pool that oEmbed does not carry, so it is
 * genuinely often absent (see docs/research/CURATED_VIDEOS.md).
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "Duration unknown";
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
