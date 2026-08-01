import { describe, expect, it } from "vitest";

import {
  CHAT_BODY_MAX_CHARS,
  QA_ANSWER_MAX_CHARS,
  QA_BODY_MAX_CHARS,
  REACTION_MAX_UNITS,
  validatePayload,
} from "./schemas";

describe("chat:send", () => {
  it("accepts an ordinary message and trims it", () => {
    const result = validatePayload("chat:send", { body: "  hello  " });
    expect(result).toEqual({ ok: true, data: { body: "hello" } });
  });

  it("rejects a whitespace-only message, because trim runs before the min check", () => {
    // Otherwise twelve spaces becomes a blank line in everybody's transcript.
    expect(validatePayload("chat:send", { body: "            " }).ok).toBe(false);
  });

  it("rejects an empty message", () => {
    expect(validatePayload("chat:send", { body: "" }).ok).toBe(false);
  });

  it("accepts a message at exactly the limit and rejects one character more", () => {
    expect(validatePayload("chat:send", { body: "x".repeat(CHAT_BODY_MAX_CHARS) }).ok).toBe(true);
    expect(validatePayload("chat:send", { body: "x".repeat(CHAT_BODY_MAX_CHARS + 1) }).ok).toBe(
      false,
    );
  });

  it("STRIPS a client-supplied userId rather than honouring it", () => {
    // The single most important assertion in this file. A payload that names its
    // own author must not be able to reach a handler with that field intact.
    const result = validatePayload("chat:send", { body: "hi", userId: 999, role: "instructor" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object payload", () => {
    for (const payload of [null, undefined, "hi", 42, []]) {
      expect(validatePayload("chat:send", payload).ok).toBe(false);
    }
  });

  it("carries clientRef through for optimistic rendering, but bounds it", () => {
    expect(validatePayload("chat:send", { body: "hi", clientRef: "abc" }).ok).toBe(true);
    expect(validatePayload("chat:send", { body: "hi", clientRef: "x".repeat(65) }).ok).toBe(false);
  });
});

describe("ids", () => {
  it("rejects zero, negatives and non-integers", () => {
    for (const messageId of [0, -1, 1.5, "3", null]) {
      expect(validatePayload("chat:delete", { messageId }).ok).toBe(false);
    }
    expect(validatePayload("chat:delete", { messageId: 3 }).ok).toBe(true);
  });
});

describe("chat:react", () => {
  it("accepts an emoji within the code-unit cap", () => {
    // A skin-toned emoji is several UTF-16 units; a cap of 1 would reject it.
    expect(validatePayload("chat:react", { messageId: 1, emoji: "👍🏽", add: true }).ok).toBe(true);
  });

  it("rejects a sentence smuggled in as a reaction", () => {
    const long = "a".repeat(REACTION_MAX_UNITS + 1);
    expect(validatePayload("chat:react", { messageId: 1, emoji: long, add: true }).ok).toBe(false);
  });

  it("requires an explicit toggle direction", () => {
    expect(validatePayload("chat:react", { messageId: 1, emoji: "👍" }).ok).toBe(false);
  });
});

describe("qa", () => {
  it("bounds a question and an answer at their own limits", () => {
    expect(validatePayload("qa:ask", { body: "x".repeat(QA_BODY_MAX_CHARS) }).ok).toBe(true);
    expect(validatePayload("qa:ask", { body: "x".repeat(QA_BODY_MAX_CHARS + 1) }).ok).toBe(false);
    expect(
      validatePayload("qa:answer", { questionId: 1, body: "x".repeat(QA_ANSWER_MAX_CHARS) }).ok,
    ).toBe(true);
    expect(
      validatePayload("qa:answer", { questionId: 1, body: "x".repeat(QA_ANSWER_MAX_CHARS + 1) }).ok,
    ).toBe(false);
  });

  it("gives an upvote no client-controlled tally", () => {
    expect(validatePayload("qa:upvote", { questionId: 1 }).ok).toBe(true);
    expect(validatePayload("qa:upvote", { questionId: 1, count: 500 }).ok).toBe(false);
  });
});

describe("presence", () => {
  it("takes nothing, because the token already fixes user and class", () => {
    expect(validatePayload("presence:join", {}).ok).toBe(true);
    expect(validatePayload("presence:join", { classId: 99 }).ok).toBe(false);
  });
});

describe("error messages", () => {
  it("names the field but does not echo the offending value back", () => {
    // Echoing an unexpected key would make the socket a small reflection
    // primitive, which is free to avoid.
    const result = validatePayload("chat:send", { body: "hi", evil: "<script>" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("script");
  });
});
