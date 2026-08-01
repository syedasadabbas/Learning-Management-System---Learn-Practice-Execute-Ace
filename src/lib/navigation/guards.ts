// =============================================================================
// EXISTENCE-GUARD LOADERS — the request-scoped memos the route layouts share
// with their pages.
// -----------------------------------------------------------------------------
// Owner: ui-shell stream (navigation). SERVER ONLY: everything re-exported here
// reaches Drizzle, so this module must never be imported from a client
// component. It is deliberately a separate file from ./loading-shape.ts, which
// PageSkeleton (a client component) does import — one accidental barrel between
// the two would pull the database driver into the browser bundle.
//
// WHY THIS FILE EXISTS
//
// Every route that can `notFound()` and also has its own `loading.tsx` now
// carries a sibling `layout.tsx` that makes the existence decision. That is
// forced by the App Router: a `loading.tsx` is a Suspense boundary, and once its
// fallback flushes the HTTP status line has already gone out as 200, so a
// `notFound()` reached below it renders the not-found UI under a 200. A layout
// renders ABOVE its own segment's boundary, so the decision made there still
// sets 404. Full account, with the seven specs that caught it, in
// src/components/nav/PageSkeleton.tsx.
//
// THE COST THAT HAD TO BE AVOIDED. The guard and the page resolve the SAME row.
// A Neon round trip measures ~245 ms warm on this connection
// (scripts/perf-roundtrips.ts, 2026-07-31) and these pages are all
// `force-dynamic`, so a naive guard would simply double every protected page's
// query count to buy a status code. React's `cache()` memoises per request, so
// the layout's lookup and the page's lookup are ONE query — as long as BOTH call
// the same wrapped function, which is why the pages were edited to import from
// here rather than the guards quietly calling the underlying loader.
//
// WHY THE WRAPPERS LIVE HERE AND NOT AT EACH LOADER'S SOURCE. `cache()` keys on
// function identity, so the wrapper has to be shared, not re-created per call
// site. The obvious home would be each loader's own module — but
// src/lib/submissions/**, src/components/learn/** and src/components/problems/**
// belong to other streams and are being edited concurrently. Wrapping here
// touches nothing they own and reads identically at the call site. The ONE
// exception is `loadProblem`, which had to be memoised at its source
// (src/lib/problems/service.ts) because its second caller is
// src/components/problems/BankPages.tsx — a file this stream may not edit, so a
// wrapper here could not have been put in front of it.
//
// House pattern for all of this: src/components/course/data.ts:50.
// =============================================================================

import { cache } from "react";

import { gateLecture } from "@/components/course/data";
import { getModuleBySlug, listTrackModules } from "@/lib/learn/query";
import { getAssignmentForWeek } from "@/lib/submissions/history";

/**
 * One lecture, gated for one student — memoised for the request.
 *
 * `gateWeek` deliberately has NO wrapper here even though /weeks/[weekId] is
 * guarded the same way: its only read is `getWeekList`, which is ALREADY
 * `cache()`d at src/components/course/data.ts:290. Calling `gateWeek` twice in a
 * request therefore costs zero extra round trips, and adding a second memo layer
 * would only give a future reader two things to keep in step.
 *
 * `gateLecture` is different — it issues its own `SELECT` against `lectures`
 * alongside the cached week list, so an unmemoised second call is a real 245 ms.
 */
export const loadLectureGate = cache(gateLecture);

/**
 * One week's assignment for one student — memoised for the request.
 *
 * Shared by three files: the guard at /assignments/[weekId]/layout.tsx, the brief
 * page under it, and the stand-in submit page one level deeper. Three calls, one
 * query.
 */
export const loadAssignmentForWeek = cache(getAssignmentForWeek);

/**
 * A learning track's published modules — memoised for the request.
 *
 * The guard needs this because "the track exists" is not a separate fact from
 * "the track has published modules": /learn/[track] 404s precisely when the list
 * is empty, which is what keeps an unpublished curriculum from being enumerable
 * by URL (see that page's header). So the guard cannot ask a cheaper question
 * than the page does, and memoisation is the only way it is free.
 */
export const loadTrackModules = cache(listTrackModules);

/** One published module by slug — memoised for the request. */
export const loadModuleBySlug = cache(getModuleBySlug);
