import { describe, expect, it } from "vitest";

import { createMemoryStore, MEMORY_CHAT_CAP } from "./memory";

function store() {
  return createMemoryStore();
}

async function seedMessage(s: ReturnType<typeof store>, authorId = 1) {
  return s.chat.create({ classId: 10, authorId, authorRole: "student", body: "hello" });
}

describe("chat invariants", () => {
  it("lets an author edit their own message", async () => {
    const s = store();
    const message = await seedMessage(s, 1);
    const result = await s.chat.edit({
      messageId: message.id,
      editorId: 1,
      editorIsModerator: false,
      body: "corrected",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.body).toBe("corrected");
      expect(result.value.editedAt).not.toBeNull();
    }
  });

  it("refuses to let ANYONE ELSE edit a message, including a moderator", async () => {
    // Deliberately stricter than delete: putting words in a student's mouth
    // under their own name is a different act from removing them.
    const s = store();
    const message = await seedMessage(s, 1);

    expect(
      await s.chat.edit({ messageId: message.id, editorId: 2, editorIsModerator: false, body: "x" }),
    ).toEqual({ ok: false, reason: "not_permitted" });
    expect(
      await s.chat.edit({ messageId: message.id, editorId: 9, editorIsModerator: true, body: "x" }),
    ).toEqual({ ok: false, reason: "not_permitted" });
  });

  it("soft-deletes: the row survives, the body does not", async () => {
    const s = store();
    const message = await seedMessage(s, 1);
    const result = await s.chat.softDelete({
      messageId: message.id,
      actorId: 1,
      actorIsModerator: false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deletedAt).not.toBeNull();
      // Cleared, not merely flagged — a careless SELECT must not resurrect it.
      expect(result.value.body).toBe("");
    }

    const history = await s.chat.history(10, 50);
    expect(history).toHaveLength(1);
    expect(history[0]?.deletedAt).not.toBeNull();
  });

  it("lets a moderator delete somebody else's message but not a peer", async () => {
    const s = store();
    const a = await seedMessage(s, 1);
    const b = await seedMessage(s, 1);

    expect((await s.chat.softDelete({ messageId: a.id, actorId: 9, actorIsModerator: true })).ok).toBe(
      true,
    );
    expect(await s.chat.softDelete({ messageId: b.id, actorId: 2, actorIsModerator: false })).toEqual({
      ok: false,
      reason: "not_permitted",
    });
  });

  it("treats a repeated delete as success, because two tabs race", async () => {
    const s = store();
    const message = await seedMessage(s, 1);
    await s.chat.softDelete({ messageId: message.id, actorId: 1, actorIsModerator: false });
    expect(
      (await s.chat.softDelete({ messageId: message.id, actorId: 1, actorIsModerator: false })).ok,
    ).toBe(true);
  });

  it("unpins on delete, so a deleted message cannot stay at the top of the room", async () => {
    const s = store();
    const message = await seedMessage(s, 1);
    await s.chat.setPinned({ messageId: message.id, pinned: true });
    const result = await s.chat.softDelete({
      messageId: message.id,
      actorId: 1,
      actorIsModerator: true,
    });
    if (result.ok) expect(result.value.pinned).toBe(false);
  });

  it("makes reactions idempotent in both directions", async () => {
    // The client is a double-tappable button on a phone.
    const s = store();
    const message = await seedMessage(s, 1);

    await s.chat.react({ messageId: message.id, userId: 5, emoji: "👍", add: true });
    const twice = await s.chat.react({ messageId: message.id, userId: 5, emoji: "👍", add: true });
    if (twice.ok) expect(twice.value.reactions["👍"]).toEqual([5]);

    await s.chat.react({ messageId: message.id, userId: 5, emoji: "👍", add: false });
    const removedTwice = await s.chat.react({
      messageId: message.id,
      userId: 5,
      emoji: "👍",
      add: false,
    });
    if (removedTwice.ok) expect(removedTwice.value.reactions["👍"]).toBeUndefined();
  });

  it("never leaks the internal Map/Set state onto the wire object", async () => {
    // A spread projection would carry live Maps out to every client, where they
    // serialise as {} and quietly make the payload lie.
    const s = store();
    const message = await seedMessage(s, 1);
    expect(Object.keys(message)).not.toContain("reactionSets");
    const question = await s.qa.ask({ classId: 10, askerId: 1, body: "why?" });
    expect(Object.keys(question)).not.toContain("voters");
  });

  it("caps retained history so a database-less process cannot grow forever", async () => {
    const s = store();
    for (let i = 0; i < MEMORY_CHAT_CAP + 25; i += 1) {
      await s.chat.create({ classId: 10, authorId: 1, authorRole: "student", body: `m${i}` });
    }
    const history = await s.chat.history(10, MEMORY_CHAT_CAP + 100);
    expect(history).toHaveLength(MEMORY_CHAT_CAP);
    // The OLDEST are dropped: the recent end of a transcript is the useful one.
    expect(history[history.length - 1]?.body).toBe(`m${MEMORY_CHAT_CAP + 24}`);
  });

  it("keeps classes separate", async () => {
    const s = store();
    await s.chat.create({ classId: 10, authorId: 1, authorRole: "student", body: "a" });
    await s.chat.create({ classId: 11, authorId: 1, authorRole: "student", body: "b" });
    expect(await s.chat.history(10, 50)).toHaveLength(1);
  });
});

describe("Q&A invariants", () => {
  it("counts one upvote per user however many times they vote", async () => {
    const s = store();
    const question = await s.qa.ask({ classId: 10, askerId: 1, body: "why?" });

    await s.qa.upvote({ questionId: question.id, userId: 2 });
    await s.qa.upvote({ questionId: question.id, userId: 2 });
    const third = await s.qa.upvote({ questionId: question.id, userId: 3 });

    if (third.ok) expect(third.value.upvotes).toBe(2);
  });

  it("orders pinned first, then open, then most upvoted, then newest", async () => {
    const s = store();
    const old = await s.qa.ask({ classId: 10, askerId: 1, body: "old" });
    const popular = await s.qa.ask({ classId: 10, askerId: 1, body: "popular" });
    const answered = await s.qa.ask({ classId: 10, askerId: 1, body: "answered" });
    const pinned = await s.qa.ask({ classId: 10, askerId: 1, body: "pinned" });

    await s.qa.upvote({ questionId: popular.id, userId: 2 });
    await s.qa.upvote({ questionId: popular.id, userId: 3 });
    await s.qa.answer({ questionId: answered.id, answeredById: 9, body: "because" });
    await s.qa.setPinned({ questionId: pinned.id, pinned: true });

    const list = await s.qa.list(10, 50);
    expect(list.map((q) => q.body)).toEqual(["pinned", "popular", "old", "answered"]);
    expect(old.id).toBeLessThan(popular.id);
  });

  it("records who answered and when", async () => {
    const s = store();
    const question = await s.qa.ask({ classId: 10, askerId: 1, body: "why?" });
    const result = await s.qa.answer({ questionId: question.id, answeredById: 9, body: "because" });

    if (result.ok) {
      expect(result.value.answeredById).toBe(9);
      expect(result.value.answeredAt).not.toBeNull();
    }
  });

  it("can unresolve, because an instructor closes threads by mistake", async () => {
    const s = store();
    const question = await s.qa.ask({ classId: 10, askerId: 1, body: "why?" });
    await s.qa.setResolved({ questionId: question.id, resolved: true });
    const reopened = await s.qa.setResolved({ questionId: question.id, resolved: false });
    if (reopened.ok) expect(reopened.value.resolvedAt).toBeNull();
  });

  it("reports not_found for a question that does not exist", async () => {
    const s = store();
    expect(await s.qa.upvote({ questionId: 999, userId: 1 })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("engagement flush", () => {
  it("ADDS across repeated flushes rather than replacing", async () => {
    // A user reconnects several times per class; each disconnect flushes only
    // what accumulated since the last one.
    const s = store();
    await s.engagement.flush({
      userId: 1,
      classId: 10,
      messagesSent: 3,
      questionsAsked: 1,
      answersGiven: 0,
      upvotesCast: 0,
      reactionsAdded: 0,
      connectedMs: 60_000,
      score: 20,
    });
    await s.engagement.flush({
      userId: 1,
      classId: 10,
      messagesSent: 2,
      questionsAsked: 0,
      answersGiven: 0,
      upvotesCast: 0,
      reactionsAdded: 0,
      connectedMs: 30_000,
      score: 28,
    });

    const flushed = s.flushedEngagement();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toMatchObject({
      messagesSent: 5,
      questionsAsked: 1,
      connectedMs: 90_000,
      // score is REPLACED, not summed — it is derived over the running totals.
      score: 28,
    });
  });
});
