// =============================================================================
// IN-MEMORY STORE — the test double, and a legitimate runtime mode.
// -----------------------------------------------------------------------------
// It ENFORCES THE SAME INVARIANTS as the Postgres adapter: ownership on edit and
// delete, one upvote per user, soft delete that keeps the row, idempotent
// reaction toggling. That is what makes the handler tests worth running — a
// permissive fake would let an authorization bug pass every test and fail in
// production, which is the standard way a mocked test suite lies.
//
// It is also what the service runs on when DATABASE_URL is absent (see
// ./config.ts): the class works, nothing survives the process. Bounded per class
// so a long-running instance cannot grow without limit.
// =============================================================================

import type { ChatMessage, EngagementRecord, QaQuestion, RealtimeRole } from "../types";
import type { Store, StoreResult } from "./types";

/**
 * Messages retained per class in memory.
 *
 * 500 is about an hour of a busy class. The cap exists because this store is
 * also a runtime mode: without it, a service left running for a week with no
 * database accumulates every message ever sent. Dropping the OLDEST is correct
 * for a chat transcript — the recent end is the useful one.
 */
export const MEMORY_CHAT_CAP = 500;

interface StoredMessage extends ChatMessage {
  /** emoji -> user ids. A Set so a double-tap cannot produce two reactions. */
  reactionSets: Map<string, Set<number>>;
}

interface StoredQuestion extends QaQuestion {
  /** Distinct upvoters. The `upvotes` number is derived from this, never set. */
  voters: Set<number>;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createMemoryStore(): Store & {
  /** Test-only read of what was flushed. Not part of the Store interface. */
  flushedEngagement(): EngagementRecord[];
} {
  const messages = new Map<number, StoredMessage>();
  const questions = new Map<number, StoredQuestion>();
  const flushed: EngagementRecord[] = [];
  let nextId = 1;

  // Both projections build a NEW object field by field rather than spreading and
  // deleting. Spreading would carry `reactionSets`/`voters` — live Maps and Sets
  // holding internal state — out over the wire to every client, where they
  // serialise as `{}` and quietly make the payload lie.
  function toWire(message: StoredMessage): ChatMessage {
    const reactions: Record<string, number[]> = {};
    for (const [emoji, users] of message.reactionSets) {
      if (users.size > 0) reactions[emoji] = [...users].sort((a, b) => a - b);
    }
    return {
      id: message.id,
      classId: message.classId,
      authorId: message.authorId,
      authorName: message.authorName,
      authorRole: message.authorRole,
      body: message.body,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
      pinned: message.pinned,
      reactions,
    };
  }

  function toWireQuestion(question: StoredQuestion): QaQuestion {
    return {
      id: question.id,
      classId: question.classId,
      askerId: question.askerId,
      askerName: question.askerName,
      body: question.body,
      createdAt: question.createdAt,
      answerBody: question.answerBody,
      answeredById: question.answeredById,
      answeredAt: question.answeredAt,
      upvotes: question.voters.size,
      pinned: question.pinned,
      resolvedAt: question.resolvedAt,
    };
  }

  function trim(classId: number): void {
    const forClass = [...messages.values()].filter((m) => m.classId === classId);
    if (forClass.length <= MEMORY_CHAT_CAP) return;
    forClass
      .sort((a, b) => a.id - b.id)
      .slice(0, forClass.length - MEMORY_CHAT_CAP)
      .forEach((m) => messages.delete(m.id));
  }

  return {
    kind: "memory",

    async close(): Promise<void> {
      messages.clear();
      questions.clear();
    },

    // -- chat ---------------------------------------------------------------

    chat: {
    async history(classId: number, limit: number): Promise<ChatMessage[]> {
      return [...messages.values()]
        .filter((m) => m.classId === classId)
        .sort((a, b) => a.id - b.id)
        .slice(-limit)
        .map(toWire);
    },

    async create(input: {
      classId: number;
      authorId: number;
      authorRole: RealtimeRole;
      body: string;
    }): Promise<ChatMessage> {
      const message: StoredMessage = {
        id: nextId++,
        classId: input.classId,
        authorId: input.authorId,
        authorName: null,
        authorRole: input.authorRole,
        body: input.body,
        createdAt: nowIso(),
        editedAt: null,
        deletedAt: null,
        pinned: false,
        reactions: {},
        reactionSets: new Map(),
      };
      messages.set(message.id, message);
      trim(input.classId);
      return toWire(message);
    },

    async edit(input: {
      messageId: number;
      editorId: number;
      editorIsModerator: boolean;
      body: string;
    }): Promise<StoreResult<ChatMessage>> {
      const message = messages.get(input.messageId);
      if (!message) return { ok: false, reason: "not_found" };
      if (message.deletedAt) return { ok: false, reason: "already_deleted" };
      // A MODERATOR MAY NOT EDIT SOMEBODY ELSE'S WORDS. Deliberately stricter
      // than delete: putting words in a student's mouth under their name is a
      // different act from removing them, and no moderation need requires it.
      if (message.authorId !== input.editorId) return { ok: false, reason: "not_permitted" };

      message.body = input.body;
      message.editedAt = nowIso();
      return { ok: true, value: toWire(message) };
    },

    async softDelete(input: {
      messageId: number;
      actorId: number;
      actorIsModerator: boolean;
    }): Promise<StoreResult<ChatMessage>> {
      const message = messages.get(input.messageId);
      if (!message) return { ok: false, reason: "not_found" };
      if (message.deletedAt) return { ok: true, value: toWire(message) }; // idempotent
      if (!input.actorIsModerator && message.authorId !== input.actorId) {
        return { ok: false, reason: "not_permitted" };
      }

      message.deletedAt = nowIso();
      // The body is CLEARED, not merely flagged. A soft delete that leaves the
      // text in the row means the next careless SELECT * puts it back on screen.
      message.body = "";
      message.pinned = false;
      return { ok: true, value: toWire(message) };
    },

    async setPinned(input: { messageId: number; pinned: boolean }): Promise<StoreResult<ChatMessage>> {
      const message = messages.get(input.messageId);
      if (!message) return { ok: false, reason: "not_found" };
      if (message.deletedAt) return { ok: false, reason: "already_deleted" };
      message.pinned = input.pinned;
      return { ok: true, value: toWire(message) };
    },

    async react(input: {
      messageId: number;
      userId: number;
      emoji: string;
      add: boolean;
    }): Promise<StoreResult<ChatMessage>> {
      const message = messages.get(input.messageId);
      if (!message) return { ok: false, reason: "not_found" };
      if (message.deletedAt) return { ok: false, reason: "already_deleted" };

      const users = message.reactionSets.get(input.emoji) ?? new Set<number>();
      if (input.add) users.add(input.userId);
      else users.delete(input.userId);

      if (users.size === 0) message.reactionSets.delete(input.emoji);
      else message.reactionSets.set(input.emoji, users);

      return { ok: true, value: toWire(message) };
    },
    },

    // -- Q&A ----------------------------------------------------------------

    qa: {
    async list(classId: number, limit: number): Promise<QaQuestion[]> {
      return [...questions.values()]
        .filter((q) => q.classId === classId)
        .sort(compareQuestions)
        .slice(0, limit)
        .map(toWireQuestion);
    },

    async ask(input: { classId: number; askerId: number; body: string }): Promise<QaQuestion> {
      const question: StoredQuestion = {
        id: nextId++,
        classId: input.classId,
        askerId: input.askerId,
        askerName: null,
        body: input.body,
        createdAt: nowIso(),
        answerBody: null,
        answeredById: null,
        answeredAt: null,
        upvotes: 0,
        pinned: false,
        resolvedAt: null,
        voters: new Set(),
      };
      questions.set(question.id, question);
      return toWireQuestion(question);
    },

    async answer(input: {
      questionId: number;
      answeredById: number;
      body: string;
    }): Promise<StoreResult<QaQuestion>> {
      const question = questions.get(input.questionId);
      if (!question) return { ok: false, reason: "not_found" };
      question.answerBody = input.body;
      question.answeredById = input.answeredById;
      question.answeredAt = nowIso();
      return { ok: true, value: toWireQuestion(question) };
    },

    async upvote(input: { questionId: number; userId: number }): Promise<StoreResult<QaQuestion>> {
      const question = questions.get(input.questionId);
      if (!question) return { ok: false, reason: "not_found" };
      question.voters.add(input.userId);
      return { ok: true, value: toWireQuestion(question) };
    },

    async setPinned(input: { questionId: number; pinned: boolean }): Promise<StoreResult<QaQuestion>> {
      const question = questions.get(input.questionId);
      if (!question) return { ok: false, reason: "not_found" };
      question.pinned = input.pinned;
      return { ok: true, value: toWireQuestion(question) };
    },

    async setResolved(input: {
      questionId: number;
      resolved: boolean;
    }): Promise<StoreResult<QaQuestion>> {
      const question = questions.get(input.questionId);
      if (!question) return { ok: false, reason: "not_found" };
      question.resolvedAt = input.resolved ? nowIso() : null;
      return { ok: true, value: toWireQuestion(question) };
    },
    },

    // -- engagement ---------------------------------------------------------

    engagement: {
    async flush(record: EngagementRecord): Promise<void> {
      // ADDITIVE, mirroring the Postgres upsert: a reconnect during one class
      // produces several flushes and they must sum.
      const existing = flushed.find(
        (r) => r.userId === record.userId && r.classId === record.classId,
      );
      if (!existing) {
        flushed.push({ ...record });
        return;
      }
      existing.messagesSent += record.messagesSent;
      existing.questionsAsked += record.questionsAsked;
      existing.answersGiven += record.answersGiven;
      existing.upvotesCast += record.upvotesCast;
      existing.reactionsAdded += record.reactionsAdded;
      existing.connectedMs += record.connectedMs;
      existing.score = record.score;
    },
    },

    flushedEngagement(): EngagementRecord[] {
      return flushed.map((r) => ({ ...r }));
    },
  };
}

/**
 * Q&A ordering: pinned, then unanswered, then most upvoted, then newest.
 *
 * UNANSWERED BEFORE ANSWERED is the choice worth defending. The brief asked for
 * three sort modes; this is the DEFAULT, and the default should serve the
 * instructor scanning for what still needs them. Sorting purely by upvotes puts
 * a well-answered popular question at the top of the list for the rest of the
 * class, which is exactly the wrong thing to look at.
 */
function compareQuestions(a: StoredQuestion, b: StoredQuestion): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const aOpen = a.answeredAt === null && a.resolvedAt === null;
  const bOpen = b.answeredAt === null && b.resolvedAt === null;
  if (aOpen !== bOpen) return aOpen ? -1 : 1;
  if (a.voters.size !== b.voters.size) return b.voters.size - a.voters.size;
  return b.id - a.id;
}
