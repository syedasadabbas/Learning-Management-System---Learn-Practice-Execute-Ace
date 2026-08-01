// =============================================================================
// STUDENT-FACING READ MODEL — the approval barrier, in one place.
// -----------------------------------------------------------------------------
// Owner: video-ingestion stream.
//
// THE ONE PROPERTY THIS FILE ENFORCES: a `candidate` or `rejected` row can never
// reach a student. Every student-facing read goes through `selectApproved`, which
// is a pure function precisely so it can be asserted directly (read.test.ts),
// including after a JSON round-trip — the same barrier pattern
// `src/lib/quizzes/payload.test.ts` uses for answer keys.
//
// WHY A SEPARATE FILE FROM store.ts. store.ts serves the admin screen and must be
// able to see every status. If both audiences read through one function, a default
// parameter is the only thing standing between an unreviewed video and a cohort.
// A separate module with no "give me everything" export removes that risk: the
// student path has no way to ask for a candidate.
//
// WHAT THIS RETURNS, AND WHAT THE CALLER DOES WITH IT
// A bare `youtubeId`, which is exactly the shape
// `src/components/course/VideoEmbed.tsx` already accepts. This stream builds NO
// second embed: that component is nocookie-only, validates the id before it
// reaches the iframe src, and already renders the honest "Video coming soon"
// placeholder when handed null. Returning null here therefore *is* the
// no-candidate behaviour — nothing invents a fallback video.
// =============================================================================

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { topicVideos } from "@/db/schema";

/** The projection a lecture page may see. No status, no reviewer, by design. */
export interface StudentVideo {
  youtubeId: string;
  title: string | null;
  channelTitle: string | null;
  /** SECONDS (SI). Null when unknown — oEmbed does not report duration. */
  durationSeconds: number | null;
}

/** Anything with the fields the filter needs. Keeps the pure function testable. */
export interface ApprovableRow {
  youtubeId: string;
  title?: string | null;
  channelTitle?: string | null;
  durationSeconds?: number | null;
  status: string;
  orderIndex?: number;
}

/**
 * Keep only approved rows, lowest `orderIndex` first, and strip every
 * review-only field.
 *
 * PURE. No database, no session. The status comparison is `=== "approved"`, an
 * allow-list of one — a `!== "rejected"` check would silently start shipping any
 * future status somebody adds to the enum.
 */
export function selectApproved(rows: readonly ApprovableRow[]): StudentVideo[] {
  return rows
    .filter((row) => row.status === "approved")
    .slice()
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    .map((row) => ({
      youtubeId: row.youtubeId,
      title: row.title ?? null,
      channelTitle: row.channelTitle ?? null,
      durationSeconds: row.durationSeconds ?? null,
    }));
}

/**
 * The approved video for a topic, or null.
 *
 * Null is the normal, expected answer today: no curated list has been supplied
 * yet, so every topic has zero candidates. The caller renders the existing
 * placeholder. Never throws for a bad key — an empty or over-long `topicKey`
 * short-circuits to null rather than hitting the database.
 */
export async function getApprovedVideo(
  topicKey: string | null | undefined,
): Promise<StudentVideo | null> {
  if (typeof topicKey !== "string") return null;
  const key = topicKey.trim();
  if (key === "" || key.length > 120) return null;

  const rows = await db
    .select({
      youtubeId: topicVideos.youtubeId,
      title: topicVideos.title,
      channelTitle: topicVideos.channelTitle,
      durationSeconds: topicVideos.durationSeconds,
      status: topicVideos.status,
      orderIndex: topicVideos.orderIndex,
    })
    .from(topicVideos)
    // The status predicate is in SQL *and* in selectApproved. Belt and braces on
    // the one boundary where a mistake is visible to a whole cohort.
    .where(and(eq(topicVideos.topicKey, key), eq(topicVideos.status, "approved")))
    .orderBy(asc(topicVideos.orderIndex))
    .limit(5);

  return selectApproved(rows)[0] ?? null;
}

/**
 * Resolve the id a lecture should embed: an approved topic video if one exists,
 * otherwise whatever `lectures.youtube_url` already holds (usually null).
 *
 * PRECEDENCE, stated because it is a real decision: a reviewed topic video WINS
 * over the lecture column. The column is the legacy hand-entered field; an
 * approved row is the product of an explicit human review with an audit stamp.
 * If a lecture must pin a specific video regardless, reject the topic candidates
 * — that is what rejection is for.
 */
export async function resolveLectureVideo(input: {
  topicKey: string | null | undefined;
  fallbackSource: string | null | undefined;
}): Promise<{ source: string | null; approved: StudentVideo | null }> {
  const approved = await getApprovedVideo(input.topicKey);
  if (approved) return { source: approved.youtubeId, approved };
  return { source: input.fallbackSource ?? null, approved: null };
}

/**
 * Re-exported so existing server-side callers keep working unchanged. The
 * implementation lives in ./format.ts because THIS file imports `@/db`, and a
 * client component that imported one pure helper from here pulled `pg` into the
 * browser bundle and broke `next build`. See the header of ./format.ts.
 */
export { formatDuration } from "./format";
