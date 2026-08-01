// =============================================================================
// oEMBED VALIDATION TESTS — no network, by construction.
// -----------------------------------------------------------------------------
// `fetch` is a parameter, so every branch (200, 404, 403, malformed JSON, DNS
// failure, timeout) is reachable from a plain object. The highest-value assertion
// in this file is the 404 one: a 404 must REJECT, never store, because a stored
// unresolvable id becomes an iframe reading "Video unavailable" in front of a
// cohort — the failure earlier waves refused to risk by inventing ids.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

import {
  isTransient,
  oembedUrl,
  thumbnailUrlFor,
  validateVideo,
  type FetchLike,
} from "./oembed";

/** A syntactically valid id. Never requested from the network in this file. */
const ID = "dQw4w9WgXcQ";

function jsonFetch(status: number, body: unknown): FetchLike {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

const OK_BODY = { title: "HTML Forms in 20 Minutes", author_name: "Some Channel" };

describe("oembedUrl", () => {
  it("targets the keyless endpoint with an encoded watch url and format=json", () => {
    const url = oembedUrl(ID);
    expect(url.startsWith("https://www.youtube.com/oembed?url=")).toBe(true);
    expect(url).toContain(encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`));
    expect(url).toContain("format=json");
    // No key parameter of any kind: the Data API is dropped (FREE_STACK.md).
    expect(url).not.toMatch(/[?&]key=/);
  });
});

describe("validateVideo", () => {
  it("accepts a 200 and returns the title and channel for the review screen", async () => {
    const result = await validateVideo(ID, jsonFetch(200, OK_BODY));
    expect(result).toEqual({
      ok: true,
      metadata: {
        youtubeId: ID,
        title: "HTML Forms in 20 Minutes",
        channelTitle: "Some Channel",
        thumbnailUrl: thumbnailUrlFor(ID),
      },
    });
  });

  it("REJECTS a 404 — the id does not resolve, so it must not be stored", async () => {
    const result = await validateVideo(ID, jsonFetch(404, {}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
    // A permanent verdict: the id is wrong, re-running will not help.
    expect(isTransient(result.reason)).toBe(false);
  });

  it("REJECTS a 400 the same way — that is what YouTube really answers", async () => {
    // Measured against the live endpoint on 2026-07-30: the nonexistent ids
    // "zzzzzzzzzzz" and "aaaaaaaaaaa" both came back 400 Bad Request, not 404. If
    // 400 were classed as a server problem, every dead link in a curated list
    // would be reported as "retry later" forever and never flagged for fixing.
    const result = await validateVideo(ID, jsonFetch(400, {}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
    expect(isTransient(result.reason)).toBe(false);
  });

  it("REJECTS 401/403 permanently — an unplayable embed is worth no more than a dead one", async () => {
    for (const status of [401, 403]) {
      const result = await validateVideo(ID, jsonFetch(status, {}));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe("unavailable");
      expect(isTransient(result.reason)).toBe(false);
    }
  });

  it("accepts a full watch URL and a youtu.be URL, normalising to the bare id", async () => {
    const fetchImpl = vi.fn(jsonFetch(200, OK_BODY));
    const fromWatch = await validateVideo(
      `https://www.youtube.com/watch?v=${ID}&t=30s`,
      fetchImpl,
    );
    const fromShort = await validateVideo(`https://youtu.be/${ID}`, fetchImpl);

    expect(fromWatch.ok && fromWatch.metadata.youtubeId).toBe(ID);
    expect(fromShort.ok && fromShort.metadata.youtubeId).toBe(ID);
  });

  it("refuses a malformed id without making any request at all", async () => {
    const fetchImpl = vi.fn(jsonFetch(200, OK_BODY));
    const result = await validateVideo("not-a-video-id", fetchImpl);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_id");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a non-YouTube host even when it carries a v= parameter", async () => {
    const fetchImpl = vi.fn(jsonFetch(200, OK_BODY));
    const result = await validateVideo(`https://evil.example/watch?v=${ID}`, fetchImpl);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_id");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats 429 and 5xx as TRANSIENT — YouTube's problem, not the id's", async () => {
    // Marking these permanent would let one outage bin an operator's whole
    // curated list.
    for (const status of [429, 500, 502, 503]) {
      const result = await validateVideo(ID, jsonFetch(status, {}));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe("server_error");
      expect(isTransient(result.reason)).toBe(true);
    }
  });

  it("treats a thrown fetch (offline machine, DNS failure) as network_error", async () => {
    const result = await validateVideo(ID, async () => {
      throw new Error("getaddrinfo ENOTFOUND www.youtube.com");
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("network_error");
    expect(isTransient(result.reason)).toBe(true);
  });

  it("refuses a 200 whose body is not JSON", async () => {
    const result = await validateVideo(ID, async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_payload");
  });

  it("refuses a 200 with no title — an admin cannot review a blank row", async () => {
    const result = await validateVideo(ID, jsonFetch(200, { author_name: "Chan" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_payload");
  });

  it("derives the thumbnail from the id, ignoring thumbnail_url in the payload", async () => {
    // The payload is remote input and the value lands in an <img src>. Trusting it
    // would let a poisoned response point the review screen at any origin.
    const result = await validateVideo(
      ID,
      jsonFetch(200, { ...OK_BODY, thumbnail_url: "https://evil.example/track.gif" }),
    );
    expect(result.ok && result.metadata.thumbnailUrl).toBe(
      `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
    );
  });

  it("passes an abort signal so one hung request cannot stall a whole run", async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: { signal?: AbortSignal }) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return { ok: true, status: 200, json: async () => OK_BODY };
    });
    await validateVideo(ID, fetchImpl as unknown as FetchLike, { timeoutMs: 50 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
