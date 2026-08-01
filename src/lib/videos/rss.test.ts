// =============================================================================
// CHANNEL RSS TESTS — including the test that documents the coverage limit.
// -----------------------------------------------------------------------------
// The matching tests are the interesting ones. A near-match that is force-fitted
// to a topic puts the wrong lesson in front of a student, so `matchTopicKey`
// returns null for anything ambiguous and these tests pin that down.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  assignEntriesToTopics,
  channelFeedUrl,
  isChannelId,
  matchTopicKey,
  parseChannelFeed,
  RSS_FEED_TYPICAL_ITEM_COUNT,
} from "./rss";

const CHANNEL = "UC8butISFwT-Wl7EV0hUK0BQ"; // freeCodeCamp's public channel id.

function feed(entries: Array<{ id: string; title: string }>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <title>Channel title</title>
  ${entries
    .map(
      (e) => `<entry>
    <yt:videoId>${e.id}</yt:videoId>
    <title>${e.title}</title>
  </entry>`,
    )
    .join("\n")}
</feed>`;
}

describe("channelFeedUrl", () => {
  it("builds the keyless feed url", () => {
    expect(channelFeedUrl(CHANNEL)).toBe(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`,
    );
  });

  it("refuses a mistyped channel id rather than fetching a wrong url", () => {
    expect(isChannelId("nope")).toBe(false);
    expect(() => channelFeedUrl("nope")).toThrow(/channel id/);
  });
});

describe("parseChannelFeed", () => {
  it("extracts ids and titles, decoding XML entities", () => {
    const entries = parseChannelFeed(
      feed([
        { id: "dQw4w9WgXcQ", title: "HTML Forms &amp; Validation" },
        { id: "aBcDeFgHiJk", title: "CSS Grid in 10 Minutes" },
      ]),
    );
    expect(entries).toEqual([
      { youtubeId: "dQw4w9WgXcQ", title: "HTML Forms & Validation" },
      { youtubeId: "aBcDeFgHiJk", title: "CSS Grid in 10 Minutes" },
    ]);
  });

  it("drops an entry whose videoId is not a valid id — a hostile feed proves nothing", () => {
    const entries = parseChannelFeed(
      feed([{ id: "../../etc/passwd", title: "Bad" }, { id: "dQw4w9WgXcQ", title: "Good" }]),
    );
    expect(entries.map((e) => e.youtubeId)).toEqual(["dQw4w9WgXcQ"]);
  });

  it("returns an empty list for a non-XML or truncated body instead of throwing", () => {
    expect(parseChannelFeed("")).toEqual([]);
    expect(parseChannelFeed("<html>404</html>")).toEqual([]);
    expect(parseChannelFeed("<feed><entry><yt:videoId>dQw")).toEqual([]);
  });

  it("de-duplicates repeated ids", () => {
    const entries = parseChannelFeed(
      feed([
        { id: "dQw4w9WgXcQ", title: "One" },
        { id: "dQw4w9WgXcQ", title: "One again" },
      ]),
    );
    expect(entries).toHaveLength(1);
  });
});

describe("matchTopicKey — strict, and null when unsure", () => {
  const keys = ["html-forms", "css-grid", "css", "javascript-events"];

  it("matches when every token of the key is a whole word in the title", () => {
    expect(matchTopicKey("Learn HTML Forms in 20 Minutes", keys)).toBe("html-forms");
    expect(matchTopicKey("javascript events, explained", keys)).toBe("javascript-events");
  });

  it("prefers the more specific key over a key that is a subset of it", () => {
    expect(matchTopicKey("CSS Grid in 10 Minutes", keys)).toBe("css-grid");
  });

  it("returns null when only part of the key appears", () => {
    expect(matchTopicKey("HTML Crash Course", keys)).toBeNull();
  });

  it("returns null when two unrelated keys both match — ambiguity is not a match", () => {
    expect(matchTopicKey("HTML Forms and JavaScript Events", keys)).toBeNull();
  });

  it("returns null for an empty title and ignores non-slug keys", () => {
    expect(matchTopicKey("", keys)).toBeNull();
    expect(matchTopicKey("HTML Forms", ["HTML Forms"])).toBeNull();
  });
});

describe("assignEntriesToTopics", () => {
  const entries = [
    { youtubeId: "dQw4w9WgXcQ", title: "HTML Forms deep dive" },
    { youtubeId: "aBcDeFgHiJk", title: "Vlog: my desk setup" },
  ];

  it("explicit mode attaches every entry to the one given topic", () => {
    const result = assignEntriesToTopics(entries, { explicitTopicKey: "html-forms" });
    expect(result.assignments).toEqual([
      { topicKey: "html-forms", youtubeId: "dQw4w9WgXcQ" },
      { topicKey: "html-forms", youtubeId: "aBcDeFgHiJk" },
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it("matching mode DROPS what it cannot match and reports it", () => {
    const result = assignEntriesToTopics(entries, { topicKeys: ["html-forms"] });
    expect(result.assignments).toEqual([
      { topicKey: "html-forms", youtubeId: "dQw4w9WgXcQ" },
    ]);
    expect(result.unmatched.map((e) => e.youtubeId)).toEqual(["aBcDeFgHiJk"]);
  });

  it("matches nothing when no lecture has a topic key", () => {
    const result = assignEntriesToTopics(entries, { topicKeys: [] });
    expect(result.assignments).toEqual([]);
    expect(result.unmatched).toHaveLength(2);
  });

  it("refuses an invalid explicit topic key", () => {
    expect(() => assignEntriesToTopics(entries, { explicitTopicKey: "Not A Slug" })).toThrow();
  });

  it("documents the coverage limit: a feed cannot cover a 40-topic syllabus", () => {
    // A channel feed returns ~15 most recent uploads, full stop — there is no
    // paging or search without the paid-key Data API. Even in explicit mode, one
    // feed can only ever produce candidates for as many videos as it contains.
    const fifteen = Array.from({ length: RSS_FEED_TYPICAL_ITEM_COUNT }, (_, i) => ({
      // Exactly 11 characters, which is what a real YouTube id is.
      youtubeId: `id${String(i).padStart(9, "0")}`,
      title: `Video ${i}`,
    }));
    const parsed = parseChannelFeed(
      feed(fifteen.map((e) => ({ id: e.youtubeId, title: e.title }))),
    );
    expect(parsed.length).toBeLessThanOrEqual(RSS_FEED_TYPICAL_ITEM_COUNT);
    expect(RSS_FEED_TYPICAL_ITEM_COUNT).toBeLessThan(40);
  });
});
