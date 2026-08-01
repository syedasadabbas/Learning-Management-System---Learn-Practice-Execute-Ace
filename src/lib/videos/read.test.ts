// =============================================================================
// THE APPROVAL BARRIER — a candidate must never reach a student payload.
// -----------------------------------------------------------------------------
// The stream's most important test. It asserts the pure half of read.ts:
// `selectApproved`, which every student-facing read funnels through. The
// database-backed halves (`getApprovedVideo`, `resolveLectureVideo`) are covered by
// the Playwright spec in tests/e2e/video-ingestion — tests/setup.ts forbids a unit
// test from reaching the real database.
//
// The JSON round-trip assertion mirrors src/lib/quizzes/payload.test.ts: a barrier
// that holds only in memory is not a barrier, because what a page ships to the
// browser is serialised.
// =============================================================================

import { describe, expect, it } from "vitest";

import { formatDuration, selectApproved, type ApprovableRow } from "./read";

const APPROVED: ApprovableRow = {
  youtubeId: "dQw4w9WgXcQ",
  title: "Approved video",
  channelTitle: "Channel",
  durationSeconds: 742,
  status: "approved",
  orderIndex: 1,
};
const CANDIDATE: ApprovableRow = { ...APPROVED, youtubeId: "aBcDeFgHiJk", status: "candidate" };
const REJECTED: ApprovableRow = { ...APPROVED, youtubeId: "zzzzzzzzzzz", status: "rejected" };

describe("selectApproved", () => {
  it("keeps approved rows only", () => {
    const out = selectApproved([CANDIDATE, APPROVED, REJECTED]);
    expect(out).toHaveLength(1);
    expect(out[0].youtubeId).toBe(APPROVED.youtubeId);
  });

  it("a candidate id does not survive a JSON round-trip of the student payload", () => {
    const serialised = JSON.stringify(selectApproved([CANDIDATE, REJECTED, APPROVED]));
    expect(serialised).not.toContain(CANDIDATE.youtubeId);
    expect(serialised).not.toContain(REJECTED.youtubeId);
    expect(serialised).toContain(APPROVED.youtubeId);
  });

  it("returns nothing when every row is still awaiting review", () => {
    // The real state today. The caller then renders the existing
    // "video coming soon" placeholder — no video is invented to fill the gap.
    expect(selectApproved([CANDIDATE, { ...CANDIDATE, youtubeId: "bbbbbbbbbbb" }])).toEqual([]);
  });

  it("returns nothing for an empty table", () => {
    expect(selectApproved([])).toEqual([]);
  });

  it("uses an allow-list of one, so a future status is not silently published", () => {
    // A `!== "rejected"` check would ship this row. `=== "approved"` does not.
    expect(selectApproved([{ ...APPROVED, status: "needs_second_opinion" }])).toEqual([]);
    expect(selectApproved([{ ...APPROVED, status: "APPROVED" }])).toEqual([]);
  });

  it("strips every review-only field from the projection", () => {
    const [row] = selectApproved([APPROVED]);
    expect(Object.keys(row).sort()).toEqual([
      "channelTitle",
      "durationSeconds",
      "title",
      "youtubeId",
    ]);
    expect(JSON.stringify(row)).not.toContain("status");
  });

  it("orders by orderIndex so the curated list's order is what students get", () => {
    const out = selectApproved([
      { ...APPROVED, youtubeId: "ccccccccccc", orderIndex: 2 },
      { ...APPROVED, youtubeId: "aaaaaaaaaaa", orderIndex: 0 },
      { ...APPROVED, youtubeId: "bbbbbbbbbbb", orderIndex: 1 },
    ]);
    expect(out.map((r) => r.youtubeId)).toEqual([
      "aaaaaaaaaaa",
      "bbbbbbbbbbb",
      "ccccccccccc",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const input = [
      { ...APPROVED, orderIndex: 5 },
      { ...APPROVED, youtubeId: "aaaaaaaaaaa", orderIndex: 1 },
    ];
    const before = input.map((r) => r.youtubeId);
    selectApproved(input);
    expect(input.map((r) => r.youtubeId)).toEqual(before);
  });
});

describe("formatDuration — input is SECONDS (SI)", () => {
  it("formats m:ss and h:mm:ss", () => {
    expect(formatDuration(742)).toBe("12:22");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("admits ignorance instead of printing a confident 0:00", () => {
    // oEmbed has no duration field, so null is the common case. "0:00" would be a
    // fabricated fact about a video nobody measured.
    expect(formatDuration(null)).toBe("Duration unknown");
    expect(formatDuration(undefined)).toBe("Duration unknown");
    expect(formatDuration(0)).toBe("Duration unknown");
    expect(formatDuration(-5)).toBe("Duration unknown");
    expect(formatDuration(Number.NaN)).toBe("Duration unknown");
  });
});
