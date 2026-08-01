// =============================================================================
// THE HARVEST PIPELINE — pure orchestration; every dependency is injected.
// -----------------------------------------------------------------------------
// Owner: video-ingestion stream.
//
// WHY THE PIPELINE IS NOT IN THE SCRIPT. `scripts/harvest-videos.ts` is a CLI: it
// reads argv, opens files, prints a report and closes the pool. None of that is
// testable. Everything that can be WRONG — which ids get validated, what a 404
// does, whether a second run duplicates rows — lives here behind an injected
// `fetch` and an injected writer, so `harvest.test.ts` covers it with no network
// and no database.
//
// THE TWO PROPERTIES THIS FILE EXISTS TO GUARANTEE
//
//   1. NOTHING IS STORED THAT oEMBED DID NOT CONFIRM. Validation happens before
//      the writer is ever called, and a 404 becomes a REJECTION COUNT, not a row.
//      An id that does not resolve would render an iframe reading "Video
//      unavailable" to a cohort — the failure mode that made earlier waves refuse
//      to invent ids in the first place.
//   2. RE-RUNNING IS IDEMPOTENT. Input is de-duplicated on (topicKey, youtubeId)
//      — the same pair the unique index covers — and the writer upserts on it.
//      Run the harvester five times with the same list and you get one row per
//      pair, with `status`, `reviewed_by` and `reviewed_at` untouched, so a second
//      run can never un-approve a video an admin already approved.
//
// ONE oEMBED CALL PER DISTINCT ID, not per row: the same lecture video legitimately
// serves two topic keys, and asking a public keyless endpoint the same question
// twice for no reason is how a free service stops being available to us.
// =============================================================================

import { isTransient, validateVideo, type FetchLike, type VideoRejectReason } from "./oembed";
import type { CuratedEntry } from "./sources";
import type { RssAssignment } from "./rss";

/** A validated row, ready for the writer. Always lands as `candidate`. */
export interface CandidateRow {
  topicKey: string;
  youtubeId: string;
  title: string;
  channelTitle: string;
  /** SECONDS, or null — oEmbed has no duration field, so only curated rows carry it. */
  durationSeconds: number | null;
  source: "curated" | "rss";
  orderIndex: number;
}

/** What the pipeline needs from persistence. The DB implementation is store.ts. */
export interface CandidateWriter {
  /**
   * Insert new (topic_key, youtube_id) pairs and refresh cached metadata on
   * existing ones. MUST NOT modify status/reviewed_by/reviewed_at — that is the
   * whole basis of the idempotency guarantee above.
   */
  upsertCandidates(rows: readonly CandidateRow[]): Promise<UpsertOutcome>;
}

export interface UpsertOutcome {
  inserted: number;
  /** Existing rows whose cached title/channel/duration were refreshed. */
  refreshed: number;
}

export interface RejectedVideo {
  topicKey: string;
  youtubeId: string;
  reason: VideoRejectReason;
  detail?: string;
  /** True for network/HTTP failures: not the id's fault, worth re-running. */
  transient: boolean;
}

export interface HarvestReport {
  /** Distinct (topicKey, youtubeId) pairs after de-duplication. */
  considered: number;
  /** Distinct ids actually sent to oEmbed. */
  oembedCalls: number;
  validated: number;
  inserted: number;
  refreshed: number;
  rejected: RejectedVideo[];
  /** Duplicate pairs collapsed before any work was done. */
  duplicatesCollapsed: number;
}

export interface HarvestOptions {
  curated?: readonly CuratedEntry[];
  rss?: readonly RssAssignment[];
  fetchImpl: FetchLike;
  writer: CandidateWriter;
  /** Per-request oEmbed timeout in MILLISECONDS. */
  timeoutMs?: number;
  /** Optional progress line per id, so a 60-row run is not a silent minute. */
  onProgress?: (message: string) => void;
}

interface PendingRow {
  topicKey: string;
  youtubeId: string;
  durationSeconds: number | null;
  source: "curated" | "rss";
  orderIndex: number;
}

/**
 * Collapse both sources into one list of distinct pairs.
 *
 * CURATED WINS over RSS for the same pair: a curated row carries a
 * human-supplied duration and a deliberate order index, and an RSS hit for the
 * same video carries neither. Exported for its own test.
 */
export function mergeSources(
  curated: readonly CuratedEntry[],
  rss: readonly RssAssignment[],
): { rows: PendingRow[]; duplicatesCollapsed: number } {
  const byPair = new Map<string, PendingRow>();
  let seen = 0;

  const key = (topicKey: string, youtubeId: string) => `${topicKey} ${youtubeId}`;

  rss.forEach((entry, index) => {
    seen += 1;
    byPair.set(key(entry.topicKey, entry.youtubeId), {
      topicKey: entry.topicKey,
      youtubeId: entry.youtubeId,
      durationSeconds: null,
      source: "rss",
      orderIndex: index,
    });
  });

  for (const entry of curated) {
    seen += 1;
    byPair.set(key(entry.topicKey, entry.youtubeId), {
      topicKey: entry.topicKey,
      youtubeId: entry.youtubeId,
      durationSeconds: entry.durationSeconds,
      source: "curated",
      orderIndex: entry.orderIndex,
    });
  }

  return { rows: [...byPair.values()], duplicatesCollapsed: seen - byPair.size };
}

/**
 * Validate everything, then write what survived.
 *
 * Never throws for a bad row: a curated list is a human artefact and one dead
 * link must not cost the operator the other fifty-nine. A writer failure DOES
 * propagate — that is a real fault the operator must see.
 */
export async function harvest(options: HarvestOptions): Promise<HarvestReport> {
  const {
    curated = [],
    rss = [],
    fetchImpl,
    writer,
    timeoutMs,
    onProgress,
  } = options;

  const { rows, duplicatesCollapsed } = mergeSources(curated, rss);

  // id -> validation result, so an id used by two topics costs one HTTP call.
  const validationCache = new Map<
    string,
    Awaited<ReturnType<typeof validateVideo>>
  >();

  const accepted: CandidateRow[] = [];
  const rejected: RejectedVideo[] = [];

  for (const row of rows) {
    let result = validationCache.get(row.youtubeId);
    if (!result) {
      result = await validateVideo(row.youtubeId, fetchImpl, { timeoutMs });
      validationCache.set(row.youtubeId, result);
    }

    if (!result.ok) {
      rejected.push({
        topicKey: row.topicKey,
        youtubeId: row.youtubeId,
        reason: result.reason,
        detail: result.detail,
        transient: isTransient(result.reason),
      });
      onProgress?.(`reject ${row.topicKey} ${row.youtubeId} — ${result.reason}`);
      continue;
    }

    accepted.push({
      topicKey: row.topicKey,
      youtubeId: row.youtubeId,
      title: result.metadata.title,
      channelTitle: result.metadata.channelTitle,
      durationSeconds: row.durationSeconds,
      source: row.source,
      orderIndex: row.orderIndex,
    });
    onProgress?.(`ok     ${row.topicKey} ${row.youtubeId} — ${result.metadata.title}`);
  }

  const outcome =
    accepted.length > 0
      ? await writer.upsertCandidates(accepted)
      : { inserted: 0, refreshed: 0 };

  return {
    considered: rows.length,
    oembedCalls: validationCache.size,
    validated: accepted.length,
    inserted: outcome.inserted,
    refreshed: outcome.refreshed,
    rejected,
    duplicatesCollapsed,
  };
}

/** Human-readable summary. Shared by the CLI and any future admin trigger. */
export function formatReport(report: HarvestReport): string {
  const transient = report.rejected.filter((r) => r.transient).length;
  const permanent = report.rejected.length - transient;
  return [
    `considered ${report.considered} pair(s) (${report.duplicatesCollapsed} duplicate(s) collapsed)`,
    `oEmbed calls ${report.oembedCalls}`,
    `validated ${report.validated}`,
    `inserted ${report.inserted}, metadata refreshed ${report.refreshed}`,
    `rejected ${report.rejected.length} (${permanent} permanent, ${transient} transient/retryable)`,
  ].join("\n");
}
