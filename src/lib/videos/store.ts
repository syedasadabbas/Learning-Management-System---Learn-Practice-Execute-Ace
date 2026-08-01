// =============================================================================
// PERSISTENCE — the only file in this stream that talks to the database.
// -----------------------------------------------------------------------------
// Owner: video-ingestion stream.
//
// WHAT IT WRITES, AND WHAT IT REFUSES TO WRITE
//
//   * Insert: always `status = 'candidate'`. This layer has no code path that
//     inserts an approved row. Approval is a separate, admin-guarded act that
//     stamps `reviewed_by`/`reviewed_at` — so "who put this video in front of the
//     cohort" always has an answer.
//   * Upsert on the existing unique index `(topic_key, youtube_id)`: metadata
//     (title / channel / duration / order) is refreshed, and status and the review
//     stamp are NEVER touched. That is what makes a re-harvest safe on a reviewed
//     table: re-running the script cannot resurrect a rejected video or discard an
//     approval.
//
// INSERTED vs REFRESHED IS COUNTED BY READING FIRST. Postgres `ON CONFLICT` will
// not tell you which branch it took without an xmax trick that reads as a riddle
// in six months. A curated list is tens of rows, not millions, so one SELECT of
// the existing pairs is cheaper than the cleverness. The insert still goes through
// `ON CONFLICT DO NOTHING`, so a concurrent second harvester racing between the
// SELECT and the INSERT loses the race rather than erroring — the count may then
// be off by one, and a report count is the right thing to sacrifice.
// =============================================================================

import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { lectures, topicVideos, users } from "@/db/schema";
import type { CandidateRow, CandidateWriter, UpsertOutcome } from "./harvest";

/** `topic_videos.title` is varchar(500); `channel_title` is varchar(255). */
const TITLE_MAX = 500;
const CHANNEL_MAX = 255;

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/**
 * The DB-backed writer the harvester uses.
 *
 * Exposed as an object rather than a bare function so `harvest()` can be handed
 * an in-memory double in unit tests without importing this file (and therefore
 * without needing DATABASE_URL, which `@/db` throws on at import time).
 */
export const dbCandidateWriter: CandidateWriter = { upsertCandidates };

export async function upsertCandidates(
  rows: readonly CandidateRow[],
): Promise<UpsertOutcome> {
  if (rows.length === 0) return { inserted: 0, refreshed: 0 };

  const topicKeys = [...new Set(rows.map((r) => r.topicKey))];
  const existing = await db
    .select({ topicKey: topicVideos.topicKey, youtubeId: topicVideos.youtubeId })
    .from(topicVideos)
    .where(inArray(topicVideos.topicKey, topicKeys));

  const existingPairs = new Set(existing.map((e) => `${e.topicKey} ${e.youtubeId}`));
  const isNew = (row: CandidateRow) =>
    !existingPairs.has(`${row.topicKey} ${row.youtubeId}`);

  await db
    .insert(topicVideos)
    .values(
      rows.map((row) => ({
        topicKey: row.topicKey,
        youtubeId: row.youtubeId,
        title: clip(row.title, TITLE_MAX),
        channelTitle: clip(row.channelTitle, CHANNEL_MAX),
        durationSeconds: row.durationSeconds,
        source: row.source,
        orderIndex: row.orderIndex,
        // Explicit, not relying on the column default: the one property a reader
        // of this file must not have to look up is what status a harvest lands in.
        status: "candidate" as const,
      })),
    )
    .onConflictDoUpdate({
      target: [topicVideos.topicKey, topicVideos.youtubeId],
      set: {
        title: sql`excluded.title`,
        channelTitle: sql`excluded.channel_title`,
        // COALESCE: an RSS re-harvest of a curated row carries no duration, and
        // overwriting a staff-supplied length with NULL would lose information the
        // keyless stack cannot recover (oEmbed has no duration field).
        durationSeconds: sql`coalesce(excluded.duration_seconds, ${topicVideos.durationSeconds})`,
        orderIndex: sql`excluded.order_index`,
        // status / reviewed_by / reviewed_at are absent on purpose. See header.
      },
    });

  const inserted = rows.filter(isNew).length;
  return { inserted, refreshed: rows.length - inserted };
}

// ---------------------------------------------------------------------------
// Review queue (admin screen)
// ---------------------------------------------------------------------------

export type VideoStatus = "candidate" | "approved" | "rejected";

export interface ReviewRow {
  id: number;
  topicKey: string;
  youtubeId: string;
  title: string | null;
  channelTitle: string | null;
  /** SECONDS, or null when staff supplied no length. Never guessed. */
  durationSeconds: number | null;
  status: VideoStatus;
  source: string;
  orderIndex: number;
  reviewedAt: Date | null;
  reviewerName: string | null;
  createdAt: Date;
  /** Whether any lecture currently claims this topic key. */
  lectureCount: number;
}

/**
 * Rows for /admin/videos, newest candidates first.
 *
 * `lectureCount` answers the question an admin actually has — "will approving
 * this make a video appear anywhere?" — because `topic_key` is not a foreign key
 * and a curated list can legitimately name a topic no lecture claims yet.
 */
export async function listReviewRows(status?: VideoStatus): Promise<ReviewRow[]> {
  const lectureCounts = db
    .select({
      topicKey: lectures.topicKey,
      count: sql<number>`count(*)::int`.as("lecture_count"),
    })
    .from(lectures)
    .where(isNotNull(lectures.topicKey))
    .groupBy(lectures.topicKey)
    .as("lecture_counts");

  const rows = await db
    .select({
      id: topicVideos.id,
      topicKey: topicVideos.topicKey,
      youtubeId: topicVideos.youtubeId,
      title: topicVideos.title,
      channelTitle: topicVideos.channelTitle,
      durationSeconds: topicVideos.durationSeconds,
      status: topicVideos.status,
      source: topicVideos.source,
      orderIndex: topicVideos.orderIndex,
      reviewedAt: topicVideos.reviewedAt,
      reviewerName: users.name,
      createdAt: topicVideos.createdAt,
      lectureCount: lectureCounts.count,
    })
    .from(topicVideos)
    .leftJoin(users, eq(users.id, topicVideos.reviewedBy))
    .leftJoin(lectureCounts, eq(lectureCounts.topicKey, topicVideos.topicKey))
    .where(status ? eq(topicVideos.status, status) : undefined)
    .orderBy(asc(topicVideos.topicKey), asc(topicVideos.orderIndex), desc(topicVideos.createdAt));

  return rows.map((r) => ({
    ...r,
    status: r.status as VideoStatus,
    lectureCount: r.lectureCount ?? 0,
  }));
}

export interface StatusCounts {
  candidate: number;
  approved: number;
  rejected: number;
}

export async function countByStatus(): Promise<StatusCounts> {
  const rows = await db
    .select({ status: topicVideos.status, count: sql<number>`count(*)::int` })
    .from(topicVideos)
    .groupBy(topicVideos.status);

  const counts: StatusCounts = { candidate: 0, approved: 0, rejected: 0 };
  for (const row of rows) counts[row.status as VideoStatus] = row.count;
  return counts;
}

/**
 * Record a review decision.
 *
 * `reviewed_by`/`reviewed_at` are written for BOTH outcomes: knowing who rejected
 * a video is as useful as knowing who approved one, and a rejected row is kept
 * rather than deleted so a re-harvest of the same curated list does not put it
 * back in the queue every week.
 *
 * Returns false when no row matched, so the caller can report "already gone"
 * instead of claiming success.
 */
export async function setVideoStatus(
  videoId: number,
  status: Extract<VideoStatus, "approved" | "rejected">,
  reviewerId: number,
): Promise<boolean> {
  const updated = await db
    .update(topicVideos)
    .set({ status, reviewedBy: reviewerId, reviewedAt: new Date() })
    .where(eq(topicVideos.id, videoId))
    .returning({ id: topicVideos.id });
  return updated.length > 0;
}

/** Return a decided row to the queue. Clears the stamp so it is not misleading. */
export async function resetVideoToCandidate(videoId: number): Promise<boolean> {
  const updated = await db
    .update(topicVideos)
    .set({ status: "candidate", reviewedBy: null, reviewedAt: null })
    .where(and(eq(topicVideos.id, videoId)))
    .returning({ id: topicVideos.id });
  return updated.length > 0;
}

/**
 * Every distinct non-null `lectures.topic_key`.
 *
 * Two callers: the admin screen (so it can show which topics have no candidate
 * at all) and the RSS keyword matcher, which must match against topics that
 * really exist rather than inventing keys.
 */
export async function listLectureTopicKeys(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ topicKey: lectures.topicKey })
    .from(lectures)
    .where(isNotNull(lectures.topicKey))
    .orderBy(asc(lectures.topicKey));
  return rows.map((r) => r.topicKey).filter((k): k is string => k !== null);
}
