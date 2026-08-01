// =============================================================================
// CHANNEL RSS — SOURCE (b) OF TWO, AND IT IS A SUPPLEMENT, NOT A SOLUTION.
// -----------------------------------------------------------------------------
// Owner: video-ingestion stream.
//
// STATE THE LIMIT BEFORE THE CODE, because the limit is the important part:
// `https://www.youtube.com/feeds/videos.xml?channel_id=…` returns a channel's
// ~15 MOST RECENT uploads and nothing else. There is no paging, no query, no
// date range, no search — those all lived behind the Data API key that
// FREE_STACK.md drops. A syllabus with 40+ topics therefore CANNOT be covered by
// RSS. It can, at best, surface whatever a partner channel published this month
// for review. Curated ids (sources.ts) are the primary path.
//
// A second consequence: an RSS entry has a title and an id but NO topic. Nothing
// in the feed says which syllabus topic a video belongs to. Two honest ways to
// resolve that, and this file implements both — never a fuzzy guess:
//
//   1. EXPLICIT (`--rss-topic-key=html-forms`): every entry in the feed lands as
//      a candidate for that one topic. The admin then picks from the pool.
//   2. STRICT KEYWORD MATCH: an entry attaches to a topic key only when EVERY
//      token of that key appears as a whole word in the video title. "html-forms"
//      matches "Learn HTML Forms in 20 Minutes"; it does not match "HTML Crash
//      Course". Unmatched entries are DROPPED and counted, not assigned to a
//      best guess. This is deliberately strict: a near-match that lands in the
//      review queue costs an admin time, and a near-match that gets waved
//      through costs a student the wrong lesson.
//
// Either way the row lands `candidate` and a human approves it. RSS never
// produces an approved row.
//
// PARSING: a hand-written regex reader, not an XML library. The feed shape we
// need is two fields (`yt:videoId`, `title`) inside `<entry>`, the repo has no
// XML dependency, and adding one for that is not a trade the free-stack rules
// invite. Every extracted id is still put through `isYouTubeVideoId` and then
// through oEmbed, so a malformed or hostile feed cannot smuggle a value into an
// iframe src.
// =============================================================================

import { isYouTubeVideoId } from "@/components/course/youtube";

import { isTopicKey } from "./sources";

/** One video as the feed describes it. */
export interface RssEntry {
  youtubeId: string;
  /** Feed title. Kept only for matching — the stored title comes from oEmbed. */
  title: string;
}

/** How many videos a channel feed returns, for the record. */
export const RSS_FEED_TYPICAL_ITEM_COUNT = 15;

/** Channel ids are `UC` + 22 URL-safe base64 characters. */
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

export function isChannelId(value: string): boolean {
  return CHANNEL_ID_PATTERN.test(value.trim());
}

/** The keyless feed URL for a channel. Throws on a malformed channel id, because
 * a mistyped id would otherwise be fetched as an unrelated URL. */
export function channelFeedUrl(channelId: string): string {
  const id = channelId.trim();
  if (!isChannelId(id)) {
    throw new Error(
      `"${channelId}" is not a YouTube channel id (expected UC + 22 characters).`,
    );
  }
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
}

const ENTRY_PATTERN = /<entry\b[\s\S]*?<\/entry>/g;
const VIDEO_ID_PATTERN = /<yt:videoId>\s*([^<\s]+)\s*<\/yt:videoId>/;
const TITLE_PATTERN = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/;

/** Minimal XML entity decode for the five predefined entities plus numerics. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Ampersand last: decoding it first would let "&amp;lt;" become "<".
    .replace(/&amp;/g, "&");
}

/**
 * Extract entries from a channel feed. Never throws — a truncated or non-XML
 * body yields an empty list, which the harvester reports as "0 entries" rather
 * than crashing a run that also has a curated list to process.
 */
export function parseChannelFeed(xml: string): RssEntry[] {
  const entries: RssEntry[] = [];
  const seen = new Set<string>();

  for (const block of xml.match(ENTRY_PATTERN) ?? []) {
    const idMatch = block.match(VIDEO_ID_PATTERN);
    if (!idMatch) continue;
    const youtubeId = idMatch[1].trim();
    if (!isYouTubeVideoId(youtubeId) || seen.has(youtubeId)) continue;

    const titleMatch = block.match(TITLE_PATTERN);
    const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : "";

    seen.add(youtubeId);
    entries.push({ youtubeId, title });
  }

  return entries;
}

/** Split a title into lowercase word tokens for matching. */
function tokenise(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t !== ""),
  );
}

/**
 * The single topic key whose every token appears in `title`, or null.
 *
 * Returns null when NOTHING matches and also when TWO OR MORE keys match, because
 * an ambiguous match is not a match — assigning the video to the longer key would
 * be exactly the kind of guess this stream refuses to make. Ties are broken only
 * by specificity: a key that is a strict token-subset of another matching key
 * loses to the more specific one (so "css" does not beat "css-grid" on the title
 * "CSS Grid in 10 Minutes"); genuinely unrelated co-matches return null.
 */
export function matchTopicKey(
  title: string,
  topicKeys: readonly string[],
): string | null {
  const words = tokenise(title);
  if (words.size === 0) return null;

  const matches = topicKeys
    .filter(isTopicKey)
    .map((key) => ({ key, tokens: key.split("-") }))
    .filter(({ tokens }) => tokens.every((t) => words.has(t)));

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].key;

  // Prefer a key none of whose competitors is more specific: keep only matches
  // that are not a strict token-subset of another match.
  const mostSpecific = matches.filter(
    (candidate) =>
      !matches.some(
        (other) =>
          other.key !== candidate.key &&
          candidate.tokens.every((t) => other.tokens.includes(t)),
      ),
  );

  return mostSpecific.length === 1 ? mostSpecific[0].key : null;
}

export interface RssAssignment {
  topicKey: string;
  youtubeId: string;
}

export interface RssAssignmentResult {
  assignments: RssAssignment[];
  /** Entries no topic claimed. Reported, never force-fitted. */
  unmatched: RssEntry[];
}

/**
 * Turn feed entries into (topicKey, youtubeId) pairs.
 *
 * `explicitTopicKey` implements mode 1 above; omitting it selects mode 2 and
 * requires `topicKeys` (normally every distinct `lectures.topic_key`).
 */
export function assignEntriesToTopics(
  entries: readonly RssEntry[],
  options: { explicitTopicKey?: string | null; topicKeys?: readonly string[] },
): RssAssignmentResult {
  const { explicitTopicKey, topicKeys = [] } = options;

  if (explicitTopicKey) {
    if (!isTopicKey(explicitTopicKey)) {
      throw new Error(`"${explicitTopicKey}" is not a valid topic key slug.`);
    }
    return {
      assignments: entries.map((e) => ({
        topicKey: explicitTopicKey,
        youtubeId: e.youtubeId,
      })),
      unmatched: [],
    };
  }

  const assignments: RssAssignment[] = [];
  const unmatched: RssEntry[] = [];

  for (const entry of entries) {
    const topicKey = matchTopicKey(entry.title, topicKeys);
    if (topicKey) assignments.push({ topicKey, youtubeId: entry.youtubeId });
    else unmatched.push(entry);
  }

  return { assignments, unmatched };
}
