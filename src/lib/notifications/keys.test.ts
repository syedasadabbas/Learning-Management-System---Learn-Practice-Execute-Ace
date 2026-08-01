// =============================================================================
// KEY TESTS — the collision this stream had to design around.
// -----------------------------------------------------------------------------
// The valuable assertion here is NOT "the string looks right". It is that two
// different event types whose subject rows happen to share an id produce DIFFERENT
// keys. Three tables (`quiz_attempts`, `penalties`, and the exam attempts) have
// independent `serial` sequences, so id 41 exists in all three; because every
// notification shares ONE queue kind, a key built from the id alone would make a
// penalty notification look like a duplicate of a quiz notification and silently
// discard it. That is the failure the type segment exists to prevent, and it is
// asserted directly.
// =============================================================================

import { describe, expect, it } from "vitest";

import { IdempotencyKeyError, KEY_MAX_CHARS } from "@/lib/queue/keys";

import {
  examCompletedKey,
  notificationKey,
  penaltyIssuedKey,
  quizSubmittedKey,
} from "./keys";

describe("notification keys are namespaced by kind AND type", () => {
  it("prefixes every key with the single queue kind", () => {
    expect(quizSubmittedKey(41)).toBe("notification_email:quiz_submitted:41");
    expect(examCompletedKey(41)).toBe("notification_email:exam_completed:41");
    expect(penaltyIssuedKey(41)).toBe("notification_email:penalty_issued:41");
  });

  it("does NOT collide across types that share a subject id", () => {
    // The whole reason the type is a scope segment. Without it these three would be
    // one string and two of the three notifications would never be recorded.
    const keys = new Set([quizSubmittedKey(41), examCompletedKey(41), penaltyIssuedKey(41)]);
    expect(keys.size).toBe(3);
  });

  it("does not collide across ids within one type", () => {
    expect(quizSubmittedKey(41)).not.toBe(quizSubmittedKey(42));
  });

  it("stays inside the 200-character column even for an implausible id", () => {
    expect(quizSubmittedKey(Number.MAX_SAFE_INTEGER).length).toBeLessThanOrEqual(KEY_MAX_CHARS);
  });
});

describe("the underlying builder still refuses unusable ids", () => {
  // Delegated to src/lib/queue/keys.ts on purpose — these assertions prove the
  // delegation is real rather than re-implemented, which is the only way a caller
  // can rely on the guarantees that file argues for.
  it("refuses a non-integer id rather than stringifying it", () => {
    expect(() => quizSubmittedKey(4.5)).toThrow(IdempotencyKeyError);
  });

  it("refuses NaN", () => {
    expect(() => penaltyIssuedKey(Number.NaN)).toThrow(IdempotencyKeyError);
  });

  it("builds a key for any declared notification type", () => {
    expect(notificationKey("badge_earned", 7)).toBe("notification_email:badge_earned:7");
  });
});
