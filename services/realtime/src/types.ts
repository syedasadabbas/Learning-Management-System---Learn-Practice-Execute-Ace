// =============================================================================
// WIRE AND STORAGE CONTRACTS.
// -----------------------------------------------------------------------------
// THIS FILE IS THE SEAM. The database schema for live classes is being written
// concurrently by another stream, and this service does not import it — it
// cannot, because it deploys to a different host with its own dependency tree
// and no Drizzle. So the shapes this service needs are DECLARED here, and the
// SQL in ./store/pg.ts is written against them.
//
// Every column name this service expects is named in ./store/pg.ts beside a
// TODO. If the schema that lands differs, the fix is confined to that one file:
// nothing above the store layer knows a column name.
//
// All durations are milliseconds and all sizes are kB (house rule: metric).
// =============================================================================

/**
 * Roles the service has authorization rules for.
 *
 * MUST stay identical to `REALTIME_ROLES` in
 * `src/lib/live-classes/realtime-token.ts`. Duplicated rather than imported for
 * the reason in ./auth/token.ts: the two packages install separately.
 */
export const REALTIME_ROLES = ["student", "instructor", "admin"] as const;
export type RealtimeRole = (typeof REALTIME_ROLES)[number];

/**
 * What the handshake token proved. Attached to the socket at connect time and
 * treated as the ONLY source of identity for the socket's whole lifetime.
 *
 * Nothing in a client payload may contribute to these. That rule is enforced by
 * the zod schemas in ./schemas.ts, which do not accept a `userId` field at all —
 * a client that sends one has it stripped, not honoured.
 */
export interface SocketIdentity {
  userId: number;
  role: RealtimeRole;
  classId: number;
  /** Token expiry, retained for the disconnect log only. Not re-checked. */
  tokenExpiresAtMs: number;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/**
 * One chat message as it travels to clients.
 *
 * `authorName` is denormalised onto the message because the client has no user
 * directory: the socket carries no session, so it cannot resolve an id to a
 * name. The store fills it from a join.
 */
export interface ChatMessage {
  id: number;
  classId: number;
  authorId: number;
  authorName: string | null;
  authorRole: RealtimeRole;
  body: string;
  /** ISO 8601. Server clock, never the client's — see ./handlers/chat.ts. */
  createdAt: string;
  /** Set when the author has edited the message at least once. */
  editedAt: string | null;
  /** SOFT delete. The row survives so the audit trail and reply chains survive. */
  deletedAt: string | null;
  pinned: boolean;
  /** emoji -> the user ids that reacted with it. */
  reactions: Record<string, number[]>;
}

// ---------------------------------------------------------------------------
// Q&A
// ---------------------------------------------------------------------------

export interface QaQuestion {
  id: number;
  classId: number;
  askerId: number;
  askerName: string | null;
  body: string;
  createdAt: string;
  /** Instructor's answer text, null until answered. */
  answerBody: string | null;
  answeredById: number | null;
  answeredAt: string | null;
  /** Distinct upvoters. One vote per user, enforced in the store. */
  upvotes: number;
  pinned: boolean;
  /** An instructor closing a thread. Distinct from "has an answer". */
  resolvedAt: string | null;
}

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

/**
 * Per-user, per-class counters accumulated in memory for the duration of a class
 * and flushed on disconnect and on class end.
 *
 * IN MEMORY ON PURPOSE. A chat message already costs one INSERT; incrementing a
 * counter row on the same path would double the write rate of the busiest thing
 * this service does, to produce a number nobody reads until the class is over.
 *
 * WHAT IT COSTS, stated plainly: if the process dies mid-class the unflushed
 * portion of these counters is lost. That is acceptable because the underlying
 * events are NOT lost — the chat and Q&A rows are already in Postgres — so
 * engagement can be recomputed from them by a backfill. Losing a derived
 * statistic is recoverable; losing a student's question is not, which is why the
 * message write is synchronous and this is not.
 */
export interface EngagementCounters {
  userId: number;
  classId: number;
  messagesSent: number;
  questionsAsked: number;
  answersGiven: number;
  upvotesCast: number;
  reactionsAdded: number;
  /** Total connected time across all of this user's sockets, deduplicated. */
  connectedMs: number;
}

/** What the store persists at flush time: the counters plus the derived score. */
export interface EngagementRecord extends EngagementCounters {
  /** 0-100, see ./engagement.ts for the formula and why it is capped. */
  score: number;
}
