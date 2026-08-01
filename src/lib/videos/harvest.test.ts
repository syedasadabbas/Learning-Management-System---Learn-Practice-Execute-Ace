// =============================================================================
// HARVEST PIPELINE TESTS — idempotency, and "nothing unvalidated is stored".
// -----------------------------------------------------------------------------
// The writer is a fake that behaves like the real unique index: one row per
// (topic_key, youtube_id), and metadata refreshes never touch status or the review
// stamp. That is what makes the "re-run cannot un-approve" assertion meaningful
// here rather than something only a live database could show.
//
// No network: `fetch` is a parameter.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

import { harvest, mergeSources, type CandidateRow, type CandidateWriter } from "./harvest";
import type { FetchLike } from "./oembed";
import type { CuratedEntry } from "./sources";

const ID_A = "dQw4w9WgXcQ";
const ID_B = "aBcDeFgHiJk";
const ID_DEAD = "zzzzzzzzzzz";

function curated(
  topicKey: string,
  youtubeId: string,
  extra: Partial<CuratedEntry> = {},
): CuratedEntry {
  return { topicKey, youtubeId, durationSeconds: null, orderIndex: 0, ...extra };
}

/** oEmbed double: 200 for known ids, 404 for ID_DEAD. */
const fakeFetch: FetchLike = async (url) => {
  const found = url.includes(encodeURIComponent(ID_A)) || url.includes(encodeURIComponent(ID_B));
  return found
    ? { ok: true, status: 200, json: async () => ({ title: "A video", author_name: "A channel" }) }
    : { ok: false, status: 404, json: async () => ({}) };
};

/**
 * In-memory stand-in for `topic_videos`, enforcing the same unique index and the
 * same "never touch status/reviewed_*" rule the real writer follows.
 */
interface StoredRow extends CandidateRow {
  status: "candidate" | "approved" | "rejected";
  reviewedBy: number | null;
}

function fakeStore() {
  const rows = new Map<string, StoredRow>();
  const key = (r: { topicKey: string; youtubeId: string }) => `${r.topicKey} ${r.youtubeId}`;

  const writer: CandidateWriter = {
    async upsertCandidates(incoming) {
      let inserted = 0;
      let refreshed = 0;
      for (const row of incoming) {
        const existing = rows.get(key(row));
        if (!existing) {
          rows.set(key(row), { ...row, status: "candidate", reviewedBy: null });
          inserted += 1;
        } else {
          // Metadata only. status / reviewedBy deliberately untouched.
          existing.title = row.title;
          existing.channelTitle = row.channelTitle;
          existing.durationSeconds = row.durationSeconds ?? existing.durationSeconds;
          existing.orderIndex = row.orderIndex;
          refreshed += 1;
        }
      }
      return { inserted, refreshed };
    },
  };

  return { rows, writer, get: (topicKey: string, youtubeId: string) => rows.get(`${topicKey} ${youtubeId}`) };
}

describe("mergeSources", () => {
  it("collapses duplicate pairs and lets a curated row beat an RSS row", () => {
    const { rows, duplicatesCollapsed } = mergeSources(
      [curated("html-forms", ID_A, { durationSeconds: 742, orderIndex: 5 })],
      [{ topicKey: "html-forms", youtubeId: ID_A }],
    );
    expect(rows).toHaveLength(1);
    expect(duplicatesCollapsed).toBe(1);
    // Curated wins: it carries the human-supplied duration and order.
    expect(rows[0]).toMatchObject({ source: "curated", durationSeconds: 742, orderIndex: 5 });
  });

  it("keeps distinct pairs from both sources", () => {
    const { rows } = mergeSources(
      [curated("html-forms", ID_A)],
      [{ topicKey: "css-grid", youtubeId: ID_B }],
    );
    expect(rows).toHaveLength(2);
  });
});

describe("harvest", () => {
  it("stores only ids oEmbed confirmed, and lands them as candidates", async () => {
    const store = fakeStore();
    const report = await harvest({
      curated: [curated("html-forms", ID_A), curated("css-grid", ID_DEAD)],
      fetchImpl: fakeFetch,
      writer: store.writer,
    });

    expect(report.validated).toBe(1);
    expect(report.inserted).toBe(1);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0]).toMatchObject({ youtubeId: ID_DEAD, reason: "not_found" });

    // The 404 left NO row behind. This is the assertion that keeps a dead embed
    // out of a lecture page.
    expect(store.rows.size).toBe(1);
    expect(store.get("css-grid", ID_DEAD)).toBeUndefined();
    expect(store.get("html-forms", ID_A)?.status).toBe("candidate");
  });

  it("caches oEmbed per id, so one video used by two topics costs one call", async () => {
    const spy = vi.fn(fakeFetch);
    const report = await harvest({
      curated: [curated("html-forms", ID_A), curated("html-inputs", ID_A)],
      fetchImpl: spy,
      writer: fakeStore().writer,
    });

    expect(report.considered).toBe(2);
    expect(report.oembedCalls).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("IS IDEMPOTENT: re-running yields no new rows", async () => {
    const store = fakeStore();
    const input = { curated: [curated("html-forms", ID_A), curated("css-grid", ID_B)] };

    const first = await harvest({ ...input, fetchImpl: fakeFetch, writer: store.writer });
    const second = await harvest({ ...input, fetchImpl: fakeFetch, writer: store.writer });
    const third = await harvest({ ...input, fetchImpl: fakeFetch, writer: store.writer });

    expect(first.inserted).toBe(2);
    expect(second.inserted).toBe(0);
    expect(second.refreshed).toBe(2);
    expect(third.inserted).toBe(0);
    expect(store.rows.size).toBe(2);
  });

  it("a re-run cannot un-approve or un-reject a reviewed video", async () => {
    const store = fakeStore();
    const input = { curated: [curated("html-forms", ID_A), curated("css-grid", ID_B)] };
    await harvest({ ...input, fetchImpl: fakeFetch, writer: store.writer });

    // An admin reviews both.
    store.get("html-forms", ID_A)!.status = "approved";
    store.get("html-forms", ID_A)!.reviewedBy = 7;
    store.get("css-grid", ID_B)!.status = "rejected";
    store.get("css-grid", ID_B)!.reviewedBy = 7;

    await harvest({ ...input, fetchImpl: fakeFetch, writer: store.writer });

    expect(store.get("html-forms", ID_A)).toMatchObject({ status: "approved", reviewedBy: 7 });
    expect(store.get("css-grid", ID_B)).toMatchObject({ status: "rejected", reviewedBy: 7 });
  });

  it("keeps a staff-supplied duration when a later RSS pass has none", async () => {
    const store = fakeStore();
    await harvest({
      curated: [curated("html-forms", ID_A, { durationSeconds: 742 })],
      fetchImpl: fakeFetch,
      writer: store.writer,
    });
    await harvest({
      rss: [{ topicKey: "html-forms", youtubeId: ID_A }],
      fetchImpl: fakeFetch,
      writer: store.writer,
    });
    // Seconds, and not lost: oEmbed cannot recover a duration.
    expect(store.get("html-forms", ID_A)?.durationSeconds).toBe(742);
  });

  it("writes nothing at all when a network outage rejects everything", async () => {
    const store = fakeStore();
    const upsert = vi.spyOn(store.writer, "upsertCandidates");

    const report = await harvest({
      curated: [curated("html-forms", ID_A)],
      fetchImpl: async () => {
        throw new Error("ENOTFOUND");
      },
      writer: store.writer,
    });

    expect(report.validated).toBe(0);
    expect(report.rejected[0]).toMatchObject({ reason: "network_error", transient: true });
    expect(upsert).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(0);
  });

  it("one bad row does not abort the others", async () => {
    const store = fakeStore();
    const report = await harvest({
      curated: [
        curated("a-one", ID_DEAD),
        curated("a-two", ID_A),
        curated("a-three", ID_DEAD),
        curated("a-four", ID_B),
      ],
      fetchImpl: fakeFetch,
      writer: store.writer,
    });
    expect(report.validated).toBe(2);
    expect(report.rejected).toHaveLength(2);
    expect(store.rows.size).toBe(2);
  });

  it("carries the oEmbed title and channel through to the stored row", async () => {
    const store = fakeStore();
    await harvest({
      curated: [curated("html-forms", ID_A)],
      fetchImpl: fakeFetch,
      writer: store.writer,
    });
    expect(store.get("html-forms", ID_A)).toMatchObject({
      title: "A video",
      channelTitle: "A channel",
      source: "curated",
    });
  });
});
