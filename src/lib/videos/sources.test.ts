// =============================================================================
// CURATED SOURCE PARSING TESTS.
// -----------------------------------------------------------------------------
// The property that matters: a human-maintained spreadsheet with one bad row
// ingests every other row and reports the bad one by line number. A parser that
// throws on row 34 of 60 would make the primary ingestion path unusable in
// practice.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  normaliseTopicKey,
  parseCuratedCsv,
  parseCuratedJson,
  parseCuratedSource,
} from "./sources";

const ID_A = "dQw4w9WgXcQ";
const ID_B = "aBcDeFgHiJk";

describe("normaliseTopicKey", () => {
  it("slugifies spaces, underscores and case so one topic is not three", () => {
    expect(normaliseTopicKey("HTML Forms")).toBe("html-forms");
    expect(normaliseTopicKey("  html_forms ")).toBe("html-forms");
    expect(normaliseTopicKey("html--forms")).toBe("html-forms");
  });

  it("rejects what cannot be a slug", () => {
    expect(normaliseTopicKey("")).toBeNull();
    expect(normaliseTopicKey("héllo")).toBeNull();
    expect(normaliseTopicKey("a".repeat(121))).toBeNull(); // varchar(120)
    expect(normaliseTopicKey(42)).toBeNull();
  });
});

describe("parseCuratedCsv", () => {
  it("reads topic_key, video, duration_seconds and order_index", () => {
    const { entries, problems } = parseCuratedCsv(
      [
        "topic_key,video,duration_seconds,order_index",
        `html-forms,https://www.youtube.com/watch?v=${ID_A},742,0`,
        `css-grid,${ID_B},,3`,
      ].join("\n"),
    );

    expect(problems).toEqual([]);
    expect(entries).toEqual([
      { topicKey: "html-forms", youtubeId: ID_A, durationSeconds: 742, orderIndex: 0 },
      // Blank duration stays NULL. oEmbed cannot supply one, and a guess would be
      // shown to an admin as fact.
      { topicKey: "css-grid", youtubeId: ID_B, durationSeconds: null, orderIndex: 3 },
    ]);
  });

  it("tolerates extra columns, spare whitespace and header case", () => {
    const { entries, problems } = parseCuratedCsv(
      ["Topic_Key , VIDEO ,notes", `html-forms,${ID_A},chosen by AB`].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0].topicKey).toBe("html-forms");
  });

  it("skips a bad row, reports its line number, and keeps the good rows", () => {
    const { entries, problems } = parseCuratedCsv(
      [
        "topic_key,video",
        `html-forms,${ID_A}`,
        "css-grid,https://vimeo.com/12345", // wrong platform
        ",dQw4w9WgXcQ", // no topic key
        `js-events,${ID_B}`,
      ].join("\n"),
    );

    expect(entries.map((e) => e.topicKey)).toEqual(["html-forms", "js-events"]);
    expect(problems).toHaveLength(2);
    // Line numbers are as the operator sees them in the file: the header is line
    // 1, so the vimeo row is line 3 and the topic-less row is line 4.
    expect(problems[0].line).toBe(3);
    expect(problems[0].reason).toMatch(/not a YouTube id/);
    expect(problems[1].line).toBe(4);
    expect(problems[1].reason).toMatch(/topic_key/);
  });

  it("collapses a repeated (topic, video) pair, last occurrence winning", () => {
    const { entries } = parseCuratedCsv(
      [
        "topic_key,video,duration_seconds",
        `html-forms,${ID_A},100`,
        `html-forms,${ID_A},742`,
      ].join("\n"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].durationSeconds).toBe(742);
  });

  it("keeps the same video under two different topics — that is legitimate", () => {
    const { entries } = parseCuratedCsv(
      ["topic_key,video", `html-forms,${ID_A}`, `html-inputs,${ID_A}`].join("\n"),
    );
    expect(entries).toHaveLength(2);
  });

  it("defaults orderIndex to the row position when the column is absent", () => {
    const { entries } = parseCuratedCsv(
      ["topic_key,video", `html-forms,${ID_A}`, `html-forms,${ID_B}`].join("\n"),
    );
    expect(entries.map((e) => e.orderIndex)).toEqual([0, 1]);
  });

  it("ignores a nonsense duration rather than storing it", () => {
    const { entries } = parseCuratedCsv(
      ["topic_key,video,duration_seconds", `html-forms,${ID_A},-5`].join("\n"),
    );
    expect(entries[0].durationSeconds).toBeNull();
  });
});

describe("parseCuratedJson", () => {
  it("accepts a bare array with camelCase keys", () => {
    const { entries, problems } = parseCuratedJson(
      JSON.stringify([
        { topicKey: "html-forms", video: ID_A, durationSeconds: 742, orderIndex: 1 },
      ]),
    );
    expect(problems).toEqual([]);
    expect(entries[0]).toEqual({
      topicKey: "html-forms",
      youtubeId: ID_A,
      durationSeconds: 742,
      orderIndex: 1,
    });
  });

  it("accepts { videos: [...] }", () => {
    const { entries } = parseCuratedJson(
      JSON.stringify({ videos: [{ topic_key: "css-grid", youtube_id: ID_B }] }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].topicKey).toBe("css-grid");
  });

  it("reports invalid JSON as a problem instead of throwing", () => {
    const { entries, problems } = parseCuratedJson("{ nope");
    expect(entries).toEqual([]);
    expect(problems[0].reason).toMatch(/not valid JSON/);
  });

  it("reports a non-list document instead of throwing", () => {
    const { problems } = parseCuratedJson(JSON.stringify({ rows: [] }));
    expect(problems[0].reason).toMatch(/expected an array/);
  });
});

describe("parseCuratedSource", () => {
  it("dispatches on extension", () => {
    expect(parseCuratedSource(`[{"topicKey":"a","video":"${ID_A}"}]`, "x.json").entries)
      .toHaveLength(1);
    expect(parseCuratedSource(`topic_key,video\na,${ID_A}`, "x.csv").entries).toHaveLength(1);
  });

  it("sniffs the content when the filename is unknown", () => {
    expect(parseCuratedSource(`[{"topicKey":"a","video":"${ID_A}"}]`).entries).toHaveLength(1);
    expect(parseCuratedSource(`topic_key,video\na,${ID_A}`).entries).toHaveLength(1);
  });
});
