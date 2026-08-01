// =============================================================================
// HARVEST VIDEO CANDIDATES — keyless, idempotent, review-gated.
// -----------------------------------------------------------------------------
// Owner: video-ingestion stream.
//
//   npx tsx scripts/harvest-videos.ts --curated=./videos.csv
//   npx tsx scripts/harvest-videos.ts --curated=./videos.json --dry-run
//   npx tsx scripts/harvest-videos.ts --channel-id=UC… --rss-topic-key=html-forms
//   npx tsx scripts/harvest-videos.ts --channel-id=UC…            (title matching)
//
// This file is DELIBERATELY THIN. Argument parsing, file reading and printing live
// here; every decision that could be wrong lives in `src/lib/videos/harvest.ts`
// behind an injected `fetch` and an injected writer, and is unit-tested there with
// no network and no database. A CLI is the one place tests cannot reach, so there
// is as little logic in it as possible.
//
// WHAT IT GUARANTEES
//   * Nothing is stored that oEmbed did not confirm resolves. A 404 is reported as
//     a rejection and no row is written — an unresolvable id would become an
//     iframe reading "Video unavailable" in front of a cohort.
//   * Every row lands `status = 'candidate'`. This script CANNOT approve anything;
//     approval happens at /admin/videos and records who did it.
//   * Re-running is safe. Input is de-duplicated on (topic_key, youtube_id) and
//     the write upserts on the unique index, refreshing cached metadata and never
//     touching status or the review stamp. Run it hourly if you like; an approved
//     video stays approved and a rejected one stays rejected.
//
// NO API KEY IS READ, and none is needed: oEmbed and the channel feed are both
// keyless (FREE_STACK.md). The only credential this script touches is
// DATABASE_URL, and `--dry-run` does not even need that.
//
// EXIT CODES: 0 = ran (even with some rejections — a curated list with one dead
// link is a normal Tuesday); 1 = could not run (bad arguments, unreadable file,
// database write failure).
// =============================================================================

import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  assignEntriesToTopics,
  channelFeedUrl,
  formatReport,
  harvest,
  parseCuratedSource,
  parseChannelFeed,
  RSS_FEED_TYPICAL_ITEM_COUNT,
  type CuratedEntry,
  type RssAssignment,
} from "../src/lib/videos";

const USAGE = `
Harvest YouTube video candidates for syllabus topics. No API key required.

  --curated=<path>          CSV or JSON list of topic_key -> video (PRIMARY path)
  --channel-id=<UC…>        also sweep a channel's RSS feed (SUPPLEMENT, ~${RSS_FEED_TYPICAL_ITEM_COUNT} items)
  --rss-topic-key=<slug>    attach every RSS entry to this topic key
                            (omit to match feed titles against lectures.topic_key)
  --dry-run                 validate and print; write nothing (no DATABASE_URL needed)
  --timeout-ms=<n>          per-request oEmbed timeout in milliseconds (default 10000)
  --help

Curated CSV (header row required, extra columns ignored):
  topic_key,video,duration_seconds,order_index
  html-forms,https://www.youtube.com/watch?v=XXXXXXXXXXX,742,0

Curated JSON (array, or { "videos": [ … ] }):
  [{ "topicKey": "html-forms", "video": "XXXXXXXXXXX", "durationSeconds": 742 }]

duration_seconds is OPTIONAL and is in SECONDS. It is the only source of a video's
length: the keyless oEmbed endpoint does not report duration. Omit it and the
review screen shows "Duration unknown" rather than a guess.
`.trim();

interface Args {
  curated?: string;
  channelId?: string;
  rssTopicKey?: string;
  dryRun: boolean;
  timeoutMs?: number;
  help: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { dryRun: false, help: false };

  for (const raw of argv) {
    const [flag, value = ""] = raw.split("=", 2);
    switch (flag) {
      case "--curated":
        args.curated = value;
        break;
      case "--channel-id":
        args.channelId = value;
        break;
      case "--rss-topic-key":
        args.rssTopicKey = value;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--timeout-ms":
        args.timeoutMs = Number(value);
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument "${raw}". Run with --help.`);
    }
  }

  return args;
}

/** node's fetch, adapted to the narrow `FetchLike` the library asks for. */
const nodeFetch = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) =>
  fetch(input, init);

async function loadCurated(file: string): Promise<CuratedEntry[]> {
  const resolved = path.resolve(process.cwd(), file);
  let text: string;
  try {
    text = await readFile(resolved, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read curated list at ${resolved}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const { entries, problems } = parseCuratedSource(text, resolved);

  if (problems.length > 0) {
    console.warn(`\n${problems.length} row(s) in the curated list were skipped:`);
    for (const problem of problems) {
      console.warn(`  line ${problem.line}: ${problem.reason}`);
    }
  }
  console.log(`curated list: ${entries.length} usable row(s) from ${path.basename(resolved)}`);
  return entries;
}

async function loadRss(channelId: string, explicitTopicKey?: string): Promise<RssAssignment[]> {
  const url = channelFeedUrl(channelId);
  console.log(`channel feed: ${url}`);

  const response = await fetch(url, { headers: { accept: "application/atom+xml" } });
  if (!response.ok) {
    // Not fatal: a curated list in the same run should still be processed.
    console.warn(`  feed request failed with HTTP ${response.status}; skipping RSS.`);
    return [];
  }

  const entries = parseChannelFeed(await response.text());
  console.log(
    `  ${entries.length} entry/entries in the feed (a channel feed returns only its ` +
      `~${RSS_FEED_TYPICAL_ITEM_COUNT} most recent uploads — it cannot cover a whole syllabus).`,
  );

  // Title matching needs the real topic keys. Imported lazily so --dry-run with a
  // curated file only never touches the database module (which throws at import
  // time when DATABASE_URL is unset).
  let topicKeys: string[] = [];
  if (!explicitTopicKey) {
    const { listLectureTopicKeys } = await import("../src/lib/videos/store");
    topicKeys = await listLectureTopicKeys();
    console.log(`  matching titles against ${topicKeys.length} lecture topic key(s).`);
    if (topicKeys.length === 0) {
      console.warn(
        "  no lecture has a topic_key set, so nothing can match. Pass --rss-topic-key " +
          "to attach the feed to one topic, or set lectures.topic_key first.",
      );
    }
  }

  const { assignments, unmatched } = assignEntriesToTopics(entries, {
    explicitTopicKey: explicitTopicKey ?? null,
    topicKeys,
  });

  if (unmatched.length > 0) {
    console.log(`  ${unmatched.length} entry/entries matched no topic and were DROPPED:`);
    for (const entry of unmatched) console.log(`    ${entry.youtubeId}  ${entry.title}`);
  }

  return assignments;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.curated && !args.channelId) {
    console.error("Nothing to harvest: pass --curated=<file> and/or --channel-id=<UC…>.\n");
    console.error(USAGE);
    return 1;
  }
  if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    console.error("--timeout-ms must be a positive number of milliseconds.");
    return 1;
  }

  const curated = args.curated ? await loadCurated(args.curated) : [];
  const rss = args.channelId ? await loadRss(args.channelId, args.rssTopicKey) : [];

  // The dry-run writer is why --dry-run needs no database at all: the pipeline
  // takes its writer as a parameter, so "write nothing" is a value, not a flag
  // threaded through the persistence layer.
  const writer = args.dryRun
    ? { upsertCandidates: async () => ({ inserted: 0, refreshed: 0 }) }
    : (await import("../src/lib/videos/store")).dbCandidateWriter;

  console.log(
    `\nvalidating through the keyless oEmbed endpoint${args.dryRun ? " (dry run — nothing will be written)" : ""}…`,
  );

  const report = await harvest({
    curated,
    rss,
    fetchImpl: nodeFetch,
    writer,
    timeoutMs: args.timeoutMs,
    onProgress: (message) => console.log(`  ${message}`),
  });

  console.log(`\n${formatReport(report)}`);

  const transient = report.rejected.filter((r) => r.transient);
  if (transient.length > 0) {
    console.log(
      `\n${transient.length} rejection(s) were network/HTTP failures, not bad ids. ` +
        "Re-run when connectivity is restored — the unique index makes that safe.",
    );
  }
  if (report.validated > 0 && !args.dryRun) {
    console.log(
      `\n${report.inserted} new candidate(s) are awaiting review at /admin/videos. ` +
        "Nothing is visible to a student until an admin approves it.",
    );
  }

  return 0;
}

main()
  .then(async (code) => {
    // Close the pool only if it was ever opened (a dry run never imports @/db).
    try {
      const { pool } = await import("../src/db");
      await pool.end();
    } catch {
      /* no pool to close */
    }
    process.exit(code);
  })
  .catch((error) => {
    console.error(`\nharvest failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
