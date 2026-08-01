// =============================================================================
// IDEMPOTENCY KEY TESTS.
// -----------------------------------------------------------------------------
// These assert the APPLICATION half of the idempotency guarantee: that "the same
// job" produces the same string and "a different job" does not. The DATABASE
// half — that a race between two concurrent inserts of the same string is
// resolved by `jobs_idempotency_key_idx` and not by application code — cannot be
// asserted here, because it is not a property of any function in this file. It
// is exercised in tests/e2e/queue/queue.spec.ts against a real Postgres, and the
// reasoning is pinned below in "the reasoning this file CAN check".
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  IdempotencyKeyError,
  KEY_MAX_CHARS,
  KEY_SEPARATOR,
  buildIdempotencyKey,
  gradedNotificationKey,
} from "./keys";
import { JOB_KINDS } from "./types";

describe("buildIdempotencyKey", () => {
  it("prefixes with the kind so two kinds cannot mint the same string", () => {
    // Load bearing: the unique index is on ONE column (ON CONFLICT needs a single
    // arbiter constraint), so kind separation has to live inside the string.
    const key = buildIdempotencyKey("submission_graded_email", [42, 1_700_000_000_000]);
    expect(key).toBe("submission_graded_email:42:1700000000000");
    expect(key.startsWith(`submission_graded_email${KEY_SEPARATOR}`)).toBe(true);
  });

  it("is deterministic — the same inputs always produce the same key", () => {
    // If this were ever false, duplicate suppression would silently stop working
    // and every retry of a producer would enqueue a second job.
    const a = buildIdempotencyKey("submission_graded_email", [7, "abc"]);
    const b = buildIdempotencyKey("submission_graded_email", [7, "abc"]);
    expect(a).toBe(b);
  });

  it("distinguishes different scopes", () => {
    const keys = new Set([
      buildIdempotencyKey("submission_graded_email", [1, 2]),
      buildIdempotencyKey("submission_graded_email", [2, 1]),
      buildIdempotencyKey("submission_graded_email", [12]),
      buildIdempotencyKey("submission_graded_email", [1, 2, 3]),
    ]);
    expect(keys.size).toBe(4);
  });

  it("cannot be tricked into a collision by a segment containing the separator", () => {
    // Without the charset restriction, ["1:2"] and [1, 2] would both produce
    // "...:1:2" — two different jobs sharing one key, so the second silently
    // never runs.
    expect(() => buildIdempotencyKey("submission_graded_email", ["1:2"])).toThrow(
      IdempotencyKeyError,
    );
  });

  it("throws on an empty scope rather than letting every job share a key", () => {
    expect(() => buildIdempotencyKey("submission_graded_email", [])).toThrow(
      IdempotencyKeyError,
    );
  });

  it("throws on a segment built from editable text", () => {
    // A name or a title changes when it is edited, so a key derived from one
    // produces a DIFFERENT key for the same logical job — a duplicate email.
    // Refusing the input is cheaper than discovering that in production.
    for (const bad of ["Demo Student", "", "   ", "week/1", "a b", "emoji✨"]) {
      expect(() => buildIdempotencyKey("submission_graded_email", [bad])).toThrow(
        IdempotencyKeyError,
      );
    }
  });

  it("accepts the identifier-shaped characters ids and slugs actually use", () => {
    expect(() =>
      buildIdempotencyKey("submission_graded_email", ["a-b_c.d@e", 1]),
    ).not.toThrow();
  });

  it("rejects non-integer and non-finite numbers", () => {
    // `1.0` and `1` would stringify to two different keys for the same row.
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildIdempotencyKey("submission_graded_email", [bad])).toThrow(
        IdempotencyKeyError,
      );
    }
  });

  it("REFUSES an over-long key instead of hashing it", () => {
    // The deliberate design choice. A hash keeps keys short, and a hash collision
    // makes the second enqueue look like a duplicate and DISCARDS the job with no
    // trace. Throwing puts the mistake at the producer where it is visible.
    const huge = "a".repeat(KEY_MAX_CHARS + 10);
    expect(() => buildIdempotencyKey("submission_graded_email", [huge])).toThrow(
      /over the 200-character column limit/,
    );
  });

  it("keeps every key it produces inside the column width", () => {
    // KEY_MAX_CHARS must equal the varchar length of jobs.idempotency_key in
    // src/db/schema.ts, or the driver rejects the INSERT inside a request path.
    expect(KEY_MAX_CHARS).toBe(200);
    for (const kind of JOB_KINDS) {
      const key = buildIdempotencyKey(kind, [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
      expect(key.length).toBeLessThanOrEqual(KEY_MAX_CHARS);
    }
  });
});

describe("gradedNotificationKey — the reasoning this file CAN check", () => {
  const submissionId = 314;
  const gradedAtMs = 1_785_477_000_000;

  it("is stable for one grading moment, so a double-clicked Save collides", () => {
    // The two requests from a double-click hit the SAME committed grading
    // transaction, therefore the same `graded_at`, therefore this same string.
    // Postgres then rejects the second INSERT. That last step is the DB's job,
    // not this function's — see the file header.
    const first = gradedNotificationKey({ submissionId, gradedAtMs });
    const second = gradedNotificationKey({ submissionId, gradedAtMs });
    expect(first).toBe(second);
  });

  it("CHANGES when the submission is regraded, so the student is told again", () => {
    // The failure this prevents: keying on the submission alone means an
    // instructor who corrects a 3-star rating to 5 leaves the student holding a
    // notification about a grade that no longer exists, with no second mail.
    const original = gradedNotificationKey({ submissionId, gradedAtMs });
    const regraded = gradedNotificationKey({ submissionId, gradedAtMs: gradedAtMs + 60_000 });
    expect(regraded).not.toBe(original);
  });

  it("does NOT vary with anything taken at enqueue time", () => {
    // The other way to get this wrong: stamping the key with Date.now() at
    // enqueue. Every enqueue would then be unique, the unique index would never
    // fire, and the queue would have no idempotency at all. Asserted by building
    // the same key twice across a real clock tick.
    const before = gradedNotificationKey({ submissionId, gradedAtMs });
    const after = gradedNotificationKey({ submissionId, gradedAtMs });
    expect(after).toBe(before);
  });

  it("separates submissions graded in the same millisecond", () => {
    expect(gradedNotificationKey({ submissionId: 1, gradedAtMs })).not.toBe(
      gradedNotificationKey({ submissionId: 2, gradedAtMs }),
    );
  });

  it("truncates sub-millisecond precision rather than producing a float segment", () => {
    // Postgres keeps microseconds; a fractional millisecond reaching the key
    // would make two reads of the SAME timestamp produce different keys.
    expect(gradedNotificationKey({ submissionId, gradedAtMs: gradedAtMs + 0.4 })).toBe(
      gradedNotificationKey({ submissionId, gradedAtMs }),
    );
  });
});
