// =============================================================================
// THE STORE CONTRACT SUITE — one set of assertions, run against EVERY Store.
// -----------------------------------------------------------------------------
// WHY THIS FILE EXISTS, stated bluntly because the reason is a defect that
// shipped: ./pg.ts had ZERO test coverage. Every one of this service's suites ran
// against ./memory.ts, so the Postgres adapter could — and did — name four tables
// that do not exist in the database. It typechecked. It passed CI. It had never
// executed a single statement. A green suite that only ever exercises the test
// double is not evidence about production; it is evidence about the double.
//
// So the assertions live here, parameterised by a harness, and ./contract.test.ts
// runs them TWICE: once against the in-memory store and once against Postgres.
// What the two implementations must agree on is BEHAVIOUR, and only behaviour —
// this file therefore asserts nothing about ids being small, names being present,
// or ordering within a tie, because those legitimately differ between a Map and a
// table and pinning them would make the suite a description of the memory store
// wearing a contract's clothes.
//
// It is a plain `.ts` and not a `.test.ts` on purpose: vitest.config.ts includes
// `src/**/*.test.ts`, so a suite defined here would otherwise be collected once on
// its own with no harness.
// =============================================================================

import { describe, expect, it } from "vitest";

import type { Store } from "./types";

/** What one flushed engagement record looks like once read back from a store. */
export interface EngagementSnapshot {
  messagesSent: number;
  questionsAsked: number;
  timePresentMinutes: number;
  score: number;
}

/**
 * Everything a contract test needs that the `Store` interface does not provide.
 *
 * IDS COME FROM THE HARNESS because Postgres has foreign keys and the memory
 * store does not: a class id and two user ids must be real rows there and can be
 * any integers here. A suite that hard-coded `classId = 10` would pass in memory
 * and fail on an FK violation against the database, which is the exact shape of
 * the bug this file exists to catch.
 */
export interface StoreHarness {
  readonly store: Store;
  /** A class both users may participate in. Distinct per test. */
  readonly classId: number;
  /** Two distinct participants. `userB` is never the author of `userA`'s rows. */
  readonly userA: number;
  readonly userB: number;
  /** Read back what `engagement.flush` persisted. Not on the Store interface. */
  readEngagement(classId: number, userId: number): Promise<EngagementSnapshot | null>;
}

export interface ContractOptions {
  /** Build a harness for ONE test. Called per test so no test sees another's rows. */
  setup(): Promise<StoreHarness>;
  /** Release whatever `setup` acquired. Called even when the test failed. */
  teardown?(harness: StoreHarness): Promise<void>;
}

/**
 * Run the whole contract against one implementation.
 *
 * @param label how this implementation is named in test output
 */
export function runStoreContract(label: string, options: ContractOptions): void {
  /**
   * Wrap a test body so teardown runs on the failure path too.
   *
   * `afterEach` with a module-level harness variable would work and is the usual
   * shape; it is avoided here because `fileParallelism: false` does not make
   * `describe` bodies sequential across the two implementations, and a shared
   * mutable harness between two parameterised suites is a source of cross-talk
   * that presents as an intermittent failure in whichever ran second.
   */
  async function withHarness(body: (h: StoreHarness) => Promise<void>): Promise<void> {
    const harness = await options.setup();
    try {
      await body(harness);
    } finally {
      await options.teardown?.(harness);
    }
  }

  describe(`store contract [${label}] — chat`, () => {
    it("returns a created message from history, oldest first", async () => {
      await withHarness(async (h) => {
        const first = await h.store.chat.create({
          classId: h.classId,
          authorId: h.userA,
          authorRole: "student",
          body: "first",
        });
        const second = await h.store.chat.create({
          classId: h.classId,
          authorId: h.userB,
          authorRole: "student",
          body: "second",
        });

        const history = await h.store.chat.history(h.classId, 50);
        expect(history.map((m) => m.id)).toEqual([first.id, second.id]);
        expect(history.map((m) => m.body)).toEqual(["first", "second"]);
      });
    });

    it("lets the author edit, and refuses everyone else including a moderator", async () => {
      await withHarness(async (h) => {
        const message = await h.store.chat.create({
          classId: h.classId,
          authorId: h.userA,
          authorRole: "student",
          body: "hello",
        });

        const own = await h.store.chat.edit({
          messageId: message.id,
          editorId: h.userA,
          editorIsModerator: false,
          body: "corrected",
        });
        expect(own.ok).toBe(true);
        if (own.ok) {
          expect(own.value.body).toBe("corrected");
          expect(own.value.editedAt).not.toBeNull();
        }

        // Deliberately stricter than delete: putting words in someone's mouth
        // under their own name is a different act from removing them.
        expect(
          await h.store.chat.edit({
            messageId: message.id,
            editorId: h.userB,
            editorIsModerator: true,
            body: "not yours",
          }),
        ).toEqual({ ok: false, reason: "not_permitted" });
      });
    });

    it("soft-deletes as a tombstone: the row survives, the text does not", async () => {
      await withHarness(async (h) => {
        const message = await h.store.chat.create({
          classId: h.classId,
          authorId: h.userA,
          authorRole: "student",
          body: "regrettable",
        });

        const deleted = await h.store.chat.softDelete({
          messageId: message.id,
          actorId: h.userA,
          actorIsModerator: false,
        });
        expect(deleted.ok).toBe(true);
        if (deleted.ok) {
          expect(deleted.value.deletedAt).not.toBeNull();
          expect(deleted.value.body).toBe("");
        }

        // STILL IN HISTORY. A transcript that reflows around a gap leaves
        // participants unsure whether they misread something.
        const history = await h.store.chat.history(h.classId, 50);
        expect(history.map((m) => m.id)).toContain(message.id);
      });
    });

    it("treats deleting an already-deleted message as success, not an error", async () => {
      await withHarness(async (h) => {
        const message = await h.store.chat.create({
          classId: h.classId,
          authorId: h.userA,
          authorRole: "student",
          body: "double tap",
        });
        const input = { messageId: message.id, actorId: h.userA, actorIsModerator: false };

        expect((await h.store.chat.softDelete(input)).ok).toBe(true);
        // Two tabs, one delete. A 'not found' on the second is a lie about a
        // message that is, in fact, gone.
        expect((await h.store.chat.softDelete(input)).ok).toBe(true);
      });
    });

    it("lets a moderator delete somebody else's message", async () => {
      await withHarness(async (h) => {
        const message = await h.store.chat.create({
          classId: h.classId,
          authorId: h.userA,
          authorRole: "student",
          body: "moderated",
        });
        const result = await h.store.chat.softDelete({
          messageId: message.id,
          actorId: h.userB,
          actorIsModerator: true,
        });
        expect(result.ok).toBe(true);
      });
    });

    it("makes a repeated reaction idempotent in both directions", async () => {
      await withHarness(async (h) => {
        const message = await h.store.chat.create({
          classId: h.classId,
          authorId: h.userA,
          authorRole: "student",
          body: "react to me",
        });
        const react = (userId: number, add: boolean) =>
          h.store.chat.react({ messageId: message.id, userId, emoji: "clap", add });

        await react(h.userA, true);
        const twice = await react(h.userA, true);
        expect(twice.ok).toBe(true);
        // THE POINT: a double-tapped button on a phone is one reaction.
        if (twice.ok) expect(twice.value.reactions.clap).toEqual([h.userA]);

        const both = await react(h.userB, true);
        if (both.ok) expect([...(both.value.reactions.clap ?? [])].sort()).toEqual(
          [h.userA, h.userB].sort(),
        );

        const removed = await react(h.userA, false);
        if (removed.ok) expect(removed.value.reactions.clap ?? []).toEqual([h.userB]);

        // Removing a reaction that is not there changes nothing and does not fail.
        const removedAgain = await react(h.userA, false);
        expect(removedAgain.ok).toBe(true);
      });
    });

    it("reports not_found for a message that does not exist", async () => {
      await withHarness(async (h) => {
        expect(
          await h.store.chat.setPinned({ messageId: 2_000_000_000, pinned: true }),
        ).toEqual({ ok: false, reason: "not_found" });
      });
    });
  });

  describe(`store contract [${label}] — Q&A`, () => {
    it("counts the SAME USER upvoting twice exactly once", async () => {
      // THE REGRESSION TEST FOR THE ACTUAL BUG. Before `class_qa_votes` existed
      // this passed in memory (a Set of voters) and could not pass against
      // Postgres, because there was nowhere to record who had voted — the REST
      // route incremented a bare counter and said so in its own header. A student
      // could therefore climb the instructor's queue with their own question by
      // pressing one button. If this test ever fails against the pg store, the
      // ledger table or its primary key has gone.
      await withHarness(async (h) => {
        const question = await h.store.qa.ask({
          classId: h.classId,
          askerId: h.userA,
          body: "why?",
        });

        const first = await h.store.qa.upvote({ questionId: question.id, userId: h.userB });
        expect(first.ok).toBe(true);
        if (first.ok) expect(first.value.upvotes).toBe(1);

        const second = await h.store.qa.upvote({ questionId: question.id, userId: h.userB });
        // SUCCESS with an UNCHANGED total. The caller asked for this question to
        // carry this user's vote; after the call it does.
        expect(second.ok).toBe(true);
        if (second.ok) expect(second.value.upvotes).toBe(1);

        // And it is not merely the returned value that is right — the stored one is.
        const [listed] = (await h.store.qa.list(h.classId, 50)).filter(
          (q) => q.id === question.id,
        );
        expect(listed?.upvotes).toBe(1);
      });
    });

    it("counts two DIFFERENT users as two upvotes", async () => {
      await withHarness(async (h) => {
        const question = await h.store.qa.ask({
          classId: h.classId,
          askerId: h.userA,
          body: "how?",
        });
        await h.store.qa.upvote({ questionId: question.id, userId: h.userA });
        const result = await h.store.qa.upvote({ questionId: question.id, userId: h.userB });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.upvotes).toBe(2);
      });
    });

    it("reports not_found when upvoting a question that does not exist", async () => {
      await withHarness(async (h) => {
        expect(
          await h.store.qa.upvote({ questionId: 2_000_000_000, userId: h.userB }),
        ).toEqual({ ok: false, reason: "not_found" });
      });
    });

    it("records an answer with its author and time", async () => {
      await withHarness(async (h) => {
        const question = await h.store.qa.ask({
          classId: h.classId,
          askerId: h.userA,
          body: "when?",
        });
        const answered = await h.store.qa.answer({
          questionId: question.id,
          answeredById: h.userB,
          body: "next week",
        });
        expect(answered.ok).toBe(true);
        if (answered.ok) {
          expect(answered.value.answerBody).toBe("next week");
          expect(answered.value.answeredById).toBe(h.userB);
          expect(answered.value.answeredAt).not.toBeNull();
        }
      });
    });

    it("treats resolving as distinct from answering, and is reversible", async () => {
      await withHarness(async (h) => {
        const question = await h.store.qa.ask({
          classId: h.classId,
          askerId: h.userA,
          body: "closed?",
        });

        const resolved = await h.store.qa.setResolved({ questionId: question.id, resolved: true });
        expect(resolved.ok).toBe(true);
        if (resolved.ok) {
          expect(resolved.value.resolvedAt).not.toBeNull();
          // Resolving a question answered verbally must not fabricate an answer.
          expect(resolved.value.answeredAt).toBeNull();
          expect(resolved.value.answerBody).toBeNull();
        }

        const reopened = await h.store.qa.setResolved({
          questionId: question.id,
          resolved: false,
        });
        if (reopened.ok) expect(reopened.value.resolvedAt).toBeNull();
      });
    });

    it("orders pinned first, then open, then most upvoted", async () => {
      await withHarness(async (h) => {
        const quiet = await h.store.qa.ask({ classId: h.classId, askerId: h.userA, body: "q1" });
        const popular = await h.store.qa.ask({ classId: h.classId, askerId: h.userA, body: "q2" });
        const pinned = await h.store.qa.ask({ classId: h.classId, askerId: h.userA, body: "q3" });

        await h.store.qa.upvote({ questionId: popular.id, userId: h.userB });
        await h.store.qa.setPinned({ questionId: pinned.id, pinned: true });
        await h.store.qa.setResolved({ questionId: quiet.id, resolved: true });

        const ids = (await h.store.qa.list(h.classId, 50)).map((q) => q.id);
        expect(ids[0]).toBe(pinned.id);
        // Open-and-upvoted beats closed. The default view serves the instructor
        // scanning for what still needs them.
        expect(ids.indexOf(popular.id)).toBeLessThan(ids.indexOf(quiet.id));
      });
    });
  });

  describe(`store contract [${label}] — engagement`, () => {
    it("ADDS across two disconnects rather than replacing", async () => {
      // THE OTHER REGRESSION TEST. A user drops and rejoins several times in one
      // class, and each disconnect flushes only what accumulated since the last
      // one. A replacing upsert makes the stored total "whatever happened after
      // the final reconnect" — wrong, and quietly wrong, because nothing about
      // the number looks broken.
      await withHarness(async (h) => {
        const base = {
          classId: h.classId,
          userId: h.userA,
          answersGiven: 0,
          upvotesCast: 0,
          reactionsAdded: 0,
        };

        await h.store.engagement.flush({
          ...base,
          messagesSent: 3,
          questionsAsked: 1,
          connectedMs: 600_000, // 10 minutes
          score: 20,
        });
        await h.store.engagement.flush({
          ...base,
          messagesSent: 2,
          questionsAsked: 4,
          connectedMs: 300_000, // 5 more minutes
          score: 45,
        });

        const stored = await h.readEngagement(h.classId, h.userA);
        expect(stored).not.toBeNull();
        expect(stored?.messagesSent).toBe(5);
        expect(stored?.questionsAsked).toBe(5);
        expect(stored?.timePresentMinutes).toBe(15);
        // The SCORE is replaced, not summed: it is a derived 0-100 value over the
        // running totals, so 20 + 45 would be meaningless (and out of range at
        // the top end).
        expect(stored?.score).toBe(45);
      });
    });

    it("keeps two users in one class separate", async () => {
      await withHarness(async (h) => {
        const base = {
          classId: h.classId,
          answersGiven: 0,
          upvotesCast: 0,
          reactionsAdded: 0,
          questionsAsked: 0,
          connectedMs: 0,
          score: 10,
        };
        await h.store.engagement.flush({ ...base, userId: h.userA, messagesSent: 7 });
        await h.store.engagement.flush({ ...base, userId: h.userB, messagesSent: 1 });

        expect((await h.readEngagement(h.classId, h.userA))?.messagesSent).toBe(7);
        expect((await h.readEngagement(h.classId, h.userB))?.messagesSent).toBe(1);
      });
    });
  });
}
