// =============================================================================
// Unit tests for exercise draft persistence.
// -----------------------------------------------------------------------------
// The behaviours that matter here are the REJECTIONS. Storing and reading back a
// draft is the easy path; what protects a student is that a corrupt entry, a
// draft made against a since-edited exercise, or a full localStorage all
// degrade to "use the starter" instead of throwing inside the editor they are
// typing into.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DRAFT_LIMITS,
  clearDraft,
  fingerprintFiles,
  loadDraft,
  pruneStaleDrafts,
  saveDraft,
} from "./persistence";

const STARTER = { "/index.html": "<h1>hi</h1>", "/app.js": "// todo" };
const FP = fingerprintFiles(STARTER);

beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

describe("fingerprintFiles", () => {
  it("is stable across key order", () => {
    expect(fingerprintFiles({ a: "1", b: "2" })).toBe(fingerprintFiles({ b: "2", a: "1" }));
  });

  it("changes when any file's content changes", () => {
    expect(fingerprintFiles({ a: "1" })).not.toBe(fingerprintFiles({ a: "2" }));
  });

  it("changes when a file is added or removed", () => {
    expect(fingerprintFiles({ a: "1" })).not.toBe(fingerprintFiles({ a: "1", b: "" }));
  });

  it("does not confuse a path/content split — 'ab' + '' is not 'a' + 'b'", () => {
    // A naive concatenation without a separator collides here. The collision
    // would silently keep a stale draft, so it is worth an explicit test.
    expect(fingerprintFiles({ ab: "" })).not.toBe(fingerprintFiles({ a: "b" }));
  });

  it("handles an empty file map without throwing", () => {
    expect(typeof fingerprintFiles({})).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

describe("saveDraft / loadDraft", () => {
  it("returns null when nothing was saved", () => {
    expect(loadDraft("1-0", FP)).toBeNull();
  });

  it("round-trips files and the active tab", () => {
    const files = { "/index.html": "<h1>edited</h1>", "/app.js": "count++" };
    expect(saveDraft("1-0", { files, activeFile: "/app.js", starterFingerprint: FP })).toBe(true);

    const draft = loadDraft("1-0", FP);
    expect(draft?.files).toEqual(files);
    // The whole point of the bug report: the JS tab must come back, not HTML.
    expect(draft?.activeFile).toBe("/app.js");
  });

  it("keeps drafts for different exercises separate", () => {
    saveDraft("1-0", { files: { a: "one" }, activeFile: "a", starterFingerprint: FP });
    saveDraft("1-1", { files: { a: "two" }, activeFile: "a", starterFingerprint: FP });
    expect(loadDraft("1-0", FP)?.files).toEqual({ a: "one" });
    expect(loadDraft("1-1", FP)?.files).toEqual({ a: "two" });
  });

  it("clearDraft removes only the named exercise", () => {
    saveDraft("1-0", { files: { a: "one" }, activeFile: "a", starterFingerprint: FP });
    saveDraft("1-1", { files: { a: "two" }, activeFile: "a", starterFingerprint: FP });
    clearDraft("1-0");
    expect(loadDraft("1-0", FP)).toBeNull();
    expect(loadDraft("1-1", FP)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rejections — the part that protects the student
// ---------------------------------------------------------------------------

describe("loadDraft rejects a draft it must not use", () => {
  it("discards a draft whose starter has since changed", () => {
    // An instructor edits the exercise. Returning the old draft would leave the
    // student on content that no longer exists, with nothing to explain why.
    saveDraft("1-0", { files: { a: "mine" }, activeFile: "a", starterFingerprint: FP });
    const editedStarter = fingerprintFiles({ ...STARTER, "/app.js": "// rewritten" });
    expect(loadDraft("1-0", editedStarter)).toBeNull();
  });

  it("deletes the stale entry rather than re-reading it every mount", () => {
    saveDraft("1-0", { files: { a: "mine" }, activeFile: "a", starterFingerprint: FP });
    loadDraft("1-0", "a-different-fingerprint");
    expect(window.localStorage.getItem(`${DRAFT_LIMITS.STORAGE_PREFIX}1-0`)).toBeNull();
  });

  it("discards corrupt JSON and removes it", () => {
    window.localStorage.setItem(`${DRAFT_LIMITS.STORAGE_PREFIX}1-0`, "{not json");
    expect(loadDraft("1-0", FP)).toBeNull();
    expect(window.localStorage.getItem(`${DRAFT_LIMITS.STORAGE_PREFIX}1-0`)).toBeNull();
  });

  it("discards a draft whose files are not all strings", () => {
    // A nested object would reach Sandpack as a file whose `code` is not source,
    // blanking the preview with no explanation.
    window.localStorage.setItem(
      `${DRAFT_LIMITS.STORAGE_PREFIX}1-0`,
      JSON.stringify({
        files: { "/a.js": { nested: true } },
        activeFile: "/a.js",
        starterFingerprint: FP,
        savedAt: Date.now(),
      }),
    );
    expect(loadDraft("1-0", FP)).toBeNull();
  });

  it("discards a draft missing required fields", () => {
    window.localStorage.setItem(
      `${DRAFT_LIMITS.STORAGE_PREFIX}1-0`,
      JSON.stringify({ files: { a: "x" } }),
    );
    expect(loadDraft("1-0", FP)).toBeNull();
  });

  it("discards a draft older than the TTL", () => {
    window.localStorage.setItem(
      `${DRAFT_LIMITS.STORAGE_PREFIX}1-0`,
      JSON.stringify({
        files: { a: "x" },
        activeFile: "a",
        starterFingerprint: FP,
        savedAt: Date.now() - DRAFT_LIMITS.DRAFT_TTL_MS - 1,
      }),
    );
    expect(loadDraft("1-0", FP)).toBeNull();
  });
});

describe("saveDraft degrades instead of throwing", () => {
  it("declines an oversized draft rather than evicting other work", () => {
    const huge = "x".repeat(DRAFT_LIMITS.MAX_DRAFT_CHARS + 1);
    expect(
      saveDraft("1-0", { files: { a: huge }, activeFile: "a", starterFingerprint: FP }),
    ).toBe(false);
    expect(loadDraft("1-0", FP)).toBeNull();
  });

  it("returns false, not an exception, when the store throws on write", () => {
    // A student with a full localStorage must keep editing; only persistence is
    // lost. An exception here would unmount the editor mid-keystroke.
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() =>
      saveDraft("1-0", { files: { a: "x" }, activeFile: "a", starterFingerprint: FP }),
    ).not.toThrow();
    expect(
      saveDraft("1-0", { files: { a: "x" }, activeFile: "a", starterFingerprint: FP }),
    ).toBe(false);
    spy.mockRestore();
  });

  it("returns false, not an exception, when the store throws on read", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    expect(() => loadDraft("1-0", FP)).not.toThrow();
    expect(loadDraft("1-0", FP)).toBeNull();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

describe("pruneStaleDrafts", () => {
  it("removes expired drafts and keeps fresh ones", () => {
    saveDraft("fresh", { files: { a: "x" }, activeFile: "a", starterFingerprint: FP });
    window.localStorage.setItem(
      `${DRAFT_LIMITS.STORAGE_PREFIX}old`,
      JSON.stringify({
        files: { a: "x" },
        activeFile: "a",
        starterFingerprint: FP,
        savedAt: Date.now() - DRAFT_LIMITS.DRAFT_TTL_MS - 1,
      }),
    );

    expect(pruneStaleDrafts()).toBe(1);
    expect(loadDraft("fresh", FP)).not.toBeNull();
    expect(window.localStorage.getItem(`${DRAFT_LIMITS.STORAGE_PREFIX}old`)).toBeNull();
  });

  it("never touches keys belonging to anything else", () => {
    // Clearing the store wholesale would take the Auth.js session with it.
    window.localStorage.setItem("some-other-app-key", "keep me");
    window.localStorage.setItem(`${DRAFT_LIMITS.STORAGE_PREFIX}junk`, "{corrupt");
    pruneStaleDrafts();
    expect(window.localStorage.getItem("some-other-app-key")).toBe("keep me");
    expect(window.localStorage.getItem(`${DRAFT_LIMITS.STORAGE_PREFIX}junk`)).toBeNull();
  });

  it("removes every expired draft, not every other one", () => {
    // Deleting while iterating localStorage reindexes it and skips entries; this
    // fails if the implementation does that.
    for (let i = 0; i < 6; i++) {
      window.localStorage.setItem(
        `${DRAFT_LIMITS.STORAGE_PREFIX}old-${i}`,
        JSON.stringify({
          files: { a: "x" },
          activeFile: "a",
          starterFingerprint: FP,
          savedAt: Date.now() - DRAFT_LIMITS.DRAFT_TTL_MS - 1,
        }),
      );
    }
    expect(pruneStaleDrafts()).toBe(6);
    expect(
      Object.keys(window.localStorage).filter((k) =>
        k.startsWith(DRAFT_LIMITS.STORAGE_PREFIX),
      ),
    ).toEqual([]);
  });
});
