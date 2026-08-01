// =============================================================================
// STORE INTERFACE — THE CONTRACT THE API/SCHEMA STREAM MUST SATISFY.
// -----------------------------------------------------------------------------
// This is the ONLY place in the service that describes persistence, and no file
// above it knows a table or a column name. That is not tidiness for its own
// sake: the live-classes schema is being written concurrently by another stream,
// so this service was built against a declared interface and one adapter
// (./pg.ts) that will need its column names reconciled exactly once.
//
// TWO IMPLEMENTATIONS, AND BOTH ARE REAL:
//   ./memory.ts — used by every test and by a boot with no DATABASE_URL. It is
//                 not a stub; it enforces the same invariants (one upvote per
//                 user, soft delete, ownership) so a test that passes against it
//                 is testing behaviour rather than mocks.
//   ./pg.ts     — `pg.Pool`, parameterised SQL, no ORM. An ORM here would mean
//                 importing the app's Drizzle schema, which is exactly the
//                 cross-package coupling this service exists without.
//
// EVERY METHOD RETURNS A RESULT OR NULL RATHER THAN THROWING for the "not found"
// and "not permitted" cases, because those are ordinary outcomes of a race (two
// tabs, one deletes) and an exception per race is noise in the log. Genuine
// infrastructure failures DO throw and are caught once, in ./handlers/*.
// =============================================================================

import type { ChatMessage, EngagementRecord, QaQuestion, RealtimeRole } from "../types";

/** Why a mutation did not happen. Discriminated so handlers branch without strings. */
export type StoreRejection = "not_found" | "not_permitted" | "already_deleted";

export type StoreResult<T> = { ok: true; value: T } | { ok: false; reason: StoreRejection };

export interface ChatStore {
  /**
   * Recent messages for a class, oldest first.
   *
   * Soft-deleted rows ARE returned, with `deletedAt` set, so the client can show
   * a "message deleted" tombstone in place rather than silently reflowing the
   * transcript around a gap — which is how a participant ends up unsure whether
   * they misread something.
   */
  history(classId: number, limit: number): Promise<ChatMessage[]>;

  create(input: {
    classId: number;
    authorId: number;
    authorRole: RealtimeRole;
    body: string;
  }): Promise<ChatMessage>;

  /** Ownership is checked INSIDE the store, against the persisted author id. */
  edit(input: {
    messageId: number;
    editorId: number;
    editorIsModerator: boolean;
    body: string;
  }): Promise<StoreResult<ChatMessage>>;

  /** SOFT delete. The row stays; `deletedAt` is stamped and the body is cleared. */
  softDelete(input: {
    messageId: number;
    actorId: number;
    actorIsModerator: boolean;
  }): Promise<StoreResult<ChatMessage>>;

  /** Moderator-only at the call site; the store does not re-check the role. */
  setPinned(input: { messageId: number; pinned: boolean }): Promise<StoreResult<ChatMessage>>;

  /**
   * Toggle one user's reaction. Idempotent in BOTH directions — adding twice is
   * one reaction, removing a reaction that is not there is a no-op — because the
   * client is a double-tappable button on a phone.
   */
  react(input: {
    messageId: number;
    userId: number;
    emoji: string;
    add: boolean;
  }): Promise<StoreResult<ChatMessage>>;
}

export interface QaStore {
  /** Open questions first, then by upvotes, then newest. Sorting is the store's. */
  list(classId: number, limit: number): Promise<QaQuestion[]>;

  ask(input: { classId: number; askerId: number; body: string }): Promise<QaQuestion>;

  answer(input: {
    questionId: number;
    answeredById: number;
    body: string;
  }): Promise<StoreResult<QaQuestion>>;

  /** One vote per user. A second call from the same user changes nothing. */
  upvote(input: { questionId: number; userId: number }): Promise<StoreResult<QaQuestion>>;

  setPinned(input: { questionId: number; pinned: boolean }): Promise<StoreResult<QaQuestion>>;

  setResolved(input: { questionId: number; resolved: boolean }): Promise<StoreResult<QaQuestion>>;
}

export interface EngagementStore {
  /**
   * Persist one user's counters for one class.
   *
   * MUST BE AN UPSERT THAT ADDS, not one that replaces. A user disconnects and
   * reconnects several times in a class (a dropped connection, a refreshed tab),
   * and each disconnect flushes the counters accumulated since the LAST flush.
   * A replacing upsert would make the final number "whatever happened after the
   * last reconnect", which is both wrong and quietly wrong.
   */
  flush(record: EngagementRecord): Promise<void>;
}

/**
 * The three stores plus lifecycle, so ./server.ts holds one object.
 *
 * COMPOSED, NOT EXTENDED. `interface Store extends ChatStore, QaStore` does not
 * compile: both declare `setPinned` with a different first argument, and more
 * importantly a flat surface with `create`, `ask`, `list` and `history` on one
 * object makes "which subsystem does this write to" unanswerable at the call
 * site. Nesting keeps `store.chat.setPinned` and `store.qa.setPinned` distinct
 * and self-describing.
 */
export interface Store {
  readonly kind: "memory" | "postgres";
  readonly chat: ChatStore;
  readonly qa: QaStore;
  readonly engagement: EngagementStore;
  /** Release connections. Called from the SIGTERM path; must be idempotent. */
  close(): Promise<void>;
}
