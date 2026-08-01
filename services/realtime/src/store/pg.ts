// =============================================================================
// POSTGRES ADAPTER — the only file in this service that names a column.
// -----------------------------------------------------------------------------
// RECONCILED AGAINST THE REAL SCHEMA. Every statement below was previously
// written against `live_class_chat`, `live_class_qa`, `live_class_qa_upvotes` and
// `live_class_engagement` — FOUR TABLES THAT DO NOT EXIST. Nothing here had ever
// executed: the service's suites all run on ./memory.ts, so the whole adapter
// typechecked, passed CI and would have failed on the first production INSERT.
// The names below are now the ones in src/db/schema.live-classes.ts, verified
// against `information_schema.columns` in the live database.
//
// THE MAPPING, stated once so nobody has to reconstruct it from eleven queries.
// The wire names (../types.ts) and the column names differ, and they differ
// because the two were designed by different streams; renaming either side now
// would break a client or a migration for no gain, so the translation lives here:
//
//   ChatMessage.authorId    -> class_chat.sender_id
//   ChatMessage.authorName  -> users.name          (join; not stored on the row)
//   ChatMessage.authorRole  -> users.role          (join; class_chat has no role
//                              column — the ROW records who spoke, the USER record
//                              records what they are, and a role stored per message
//                              is a role that goes stale when someone is promoted)
//   ChatMessage.body        -> class_chat.message
//   ChatMessage.pinned      -> class_chat.is_pinned
//   ChatMessage.deletedAt   -> class_chat.deleted_at  (paired with is_deleted by a
//                              CHECK; both are written together, always)
//   ChatMessage.reactions   -> class_chat.reactions   (jsonb, emoji -> user ids)
//
//   QaQuestion.askerId      -> class_qa.student_id
//   QaQuestion.body         -> class_qa.question
//   QaQuestion.answerBody   -> class_qa.answer
//   QaQuestion.answeredById -> class_qa.instructor_id
//   QaQuestion.pinned       -> class_qa.is_pinned
//   QaQuestion.upvotes      -> class_qa.upvotes   (see the note above `upvote`)
//
//   EngagementRecord        -> class_attendance    (see the note above `flush`)
//
// PARAMETERISED SQL, NO INTERPOLATION, ANYWHERE. Every value below is a $n
// placeholder. That is not a style preference in a file whose inputs arrive from
// a WebSocket message.
//
// NO ORM. Importing the app's Drizzle schema would couple this package's install
// to the Next app's, which is the one thing the service is built to avoid. The
// cost is that this file must be re-read whenever schema.live-classes.ts changes,
// and ./pg.contract.test.ts is what makes that cost visible instead of silent.
// =============================================================================

import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { log } from "../log";
import type { ChatMessage, EngagementRecord, QaQuestion, RealtimeRole } from "../types";
import type { Store, StoreResult } from "./types";

/** Row shape returned by the chat SELECT list. Kept in one place. */
interface ChatRow extends QueryResultRow {
  id: string | number;
  class_id: string | number;
  sender_id: string | number;
  sender_name: string | null;
  sender_role: string | null;
  message: string;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
  is_pinned: boolean;
  reactions: Record<string, number[]> | null;
}

interface QaRow extends QueryResultRow {
  id: string | number;
  class_id: string | number;
  student_id: string | number;
  student_name: string | null;
  question: string;
  created_at: Date;
  answer: string | null;
  instructor_id: string | number | null;
  answered_at: Date | null;
  upvotes: string | number;
  is_pinned: boolean;
  resolved_at: Date | null;
}

/**
 * `bigint` and `numeric` come back from `pg` as STRINGS, not numbers.
 *
 * node-postgres does this deliberately — a 64-bit integer does not fit a
 * JavaScript number — and the consequence is that `row.id === 5` is false for
 * the row with id 5. These columns are `serial`/`integer` today and so arrive as
 * numbers, but a widening to `bigserial` would flip that silently, which is
 * exactly the class of bug this function exists to have already handled. Every id
 * crossing this boundary goes through here.
 */
function toNumber(value: string | number | null): number {
  if (value === null) return 0;
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Narrow the joined `users.role` onto the service's own role union.
 *
 * The app's role enum is a superset the service does not track, and it can grow
 * without this package being redeployed. Defaulting to the LEAST privileged value
 * is the only safe direction: a role this service does not recognise must not be
 * handed to a client as something it might treat as staff.
 */
function toRole(value: string | null): RealtimeRole {
  return value === "instructor" || value === "admin" ? value : "student";
}

function chatFromRow(row: ChatRow): ChatMessage {
  return {
    id: toNumber(row.id),
    classId: toNumber(row.class_id),
    authorId: toNumber(row.sender_id),
    authorName: row.sender_name,
    authorRole: toRole(row.sender_role),
    body: row.message,
    createdAt: row.created_at.toISOString(),
    editedAt: toIso(row.edited_at),
    deletedAt: toIso(row.deleted_at),
    pinned: row.is_pinned,
    reactions: row.reactions ?? {},
  };
}

function qaFromRow(row: QaRow): QaQuestion {
  return {
    id: toNumber(row.id),
    classId: toNumber(row.class_id),
    askerId: toNumber(row.student_id),
    askerName: row.student_name,
    body: row.question,
    createdAt: row.created_at.toISOString(),
    answerBody: row.answer,
    answeredById: row.instructor_id === null ? null : toNumber(row.instructor_id),
    answeredAt: toIso(row.answered_at),
    upvotes: toNumber(row.upvotes),
    pinned: row.is_pinned,
    resolvedAt: toIso(row.resolved_at),
  };
}

/**
 * The chat projection. `users` is INNER-joinable in practice (`sender_id` is a
 * NOT NULL FK with ON DELETE CASCADE, so an orphan row cannot exist) but the join
 * is LEFT anyway: a transcript that vanishes because one account was deleted
 * mid-query is a worse failure than a message attributed to a null name.
 */
const CHAT_COLUMNS = `
  m.id, m.class_id, m.sender_id, u.name AS sender_name, u.role AS sender_role,
  m.message, m.created_at, m.edited_at, m.deleted_at, m.is_pinned, m.reactions
`;

/**
 * The Q&A projection.
 *
 * `upvotes` IS THE DENORMALIZED COLUMN AND NOT `count(*)` OVER class_qa_votes,
 * which is the opposite of what this file said before the ledger existed. The
 * ledger is still the source of truth for the DECISION ("may this user vote?" is
 * answered by its primary key), but the DISPLAY number comes from the counter,
 * for two reasons: `class_qa_class_unanswered_idx` is `(class_id, is_answered,
 * upvotes)` and serves the instructor's continuously polled queue, which a
 * correlated subquery in the ORDER BY would take off the index; and the REST read
 * model (src/app/api/classes/[classId]/qa/) returns the same column, so a
 * subquery here would let the two surfaces disagree by a row for no benefit.
 * `upvote` below keeps the counter in step inside the same transaction as the
 * ledger insert, and increments it ONLY when a row was actually inserted.
 */
const QA_COLUMNS = `
  q.id, q.class_id, q.student_id, u.name AS student_name, q.question, q.created_at,
  q.answer, q.instructor_id, q.answered_at, q.is_pinned, q.resolved_at, q.upvotes
`;

export function createPgStore(connectionString: string): Store {
  const pool = new Pool({
    connectionString,
    // SMALL ON PURPOSE. This is a single long-lived process, and the classes it
    // serves are chatty but tiny per query. A large pool against Neon's
    // connection limits (shared with the Next app's serverless functions, which
    // open connections unpredictably) is how the APP starts failing because the
    // CHAT service is idle-holding sockets.
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // A pool error with no listener is an UNCAUGHT EXCEPTION that kills the
  // process. Neon closes idle connections routinely, so this is not a rare path.
  pool.on("error", (error) => {
    log.error("postgres pool error on an idle client", { error });
  });

  async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      // In `finally`, always: a release skipped on the throwing path exhausts
      // the pool after `max` failures and the service then hangs rather than
      // erroring, which is far harder to diagnose.
      client.release();
    }
  }

  /**
   * Run `fn` inside a transaction, rolling back on any throw.
   *
   * Used only where two rows must move together — the vote ledger and the counter
   * it feeds. A ROLLBACK that itself throws (the connection died) is swallowed:
   * the original error is the one worth reporting, and `client.release()` in the
   * `finally` above discards a broken connection either way.
   */
  async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          log.warn("ROLLBACK failed; the connection is being discarded", { rollbackError });
        }
        throw error;
      }
    });
  }

  async function readChat(messageId: number): Promise<ChatMessage | null> {
    const { rows } = await pool.query<ChatRow>(
      `SELECT ${CHAT_COLUMNS} FROM class_chat m
         LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.id = $1`,
      [messageId],
    );
    const row = rows[0];
    return row ? chatFromRow(row) : null;
  }

  async function readQa(questionId: number): Promise<QaQuestion | null> {
    const { rows } = await pool.query<QaRow>(
      `SELECT ${QA_COLUMNS} FROM class_qa q
         LEFT JOIN users u ON u.id = q.student_id
        WHERE q.id = $1`,
      [questionId],
    );
    const row = rows[0];
    return row ? qaFromRow(row) : null;
  }

  return {
    kind: "postgres",

    async close(): Promise<void> {
      // Idempotent by contract (see ./types.ts). `pool.end()` on an already-ended
      // pool rejects, and this runs from the SIGTERM path where a rejection
      // would replace a clean exit with a crash.
      try {
        await pool.end();
      } catch (error) {
        log.warn("postgres pool was already closed", { error });
      }
    },

    chat: {
      async history(classId: number, limit: number): Promise<ChatMessage[]> {
        // ORDER BY created_at DESC ... LIMIT then reverse in JS, rather than ASC
        // with an OFFSET: this reads the newest N off `class_chat_class_created_idx`
        // — which is exactly `(class_id, created_at)` — and stops. Ascending would
        // scan the whole class's history to find the tail. `id DESC` is the
        // tie-break, because two messages can share a millisecond and a transcript
        // whose order changes between two identical requests is unusable.
        const { rows } = await pool.query<ChatRow>(
          `SELECT ${CHAT_COLUMNS} FROM class_chat m
             LEFT JOIN users u ON u.id = m.sender_id
            WHERE m.class_id = $1
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT $2`,
          [classId, limit],
        );
        return rows.map(chatFromRow).reverse();
      },

      async create(input): Promise<ChatMessage> {
        // created_at is DEFAULT now() — the DATABASE's clock, not this process's
        // and certainly not the client's. Two participants' transcripts must
        // order identically, and only one clock can decide that.
        //
        // `authorRole` from the token is NOT written: class_chat has no role
        // column by design (see the mapping in the header) and the row is read
        // back with the role the users table currently holds.
        const { rows } = await pool.query<{ id: string | number }>(
          `INSERT INTO class_chat (class_id, sender_id, message)
           VALUES ($1, $2, $3) RETURNING id`,
          [input.classId, input.authorId, input.body],
        );
        const inserted = rows[0];
        if (!inserted) throw new Error("INSERT INTO class_chat returned no row");
        const message = await readChat(toNumber(inserted.id));
        if (!message) throw new Error("inserted chat message could not be read back");
        return message;
      },

      async edit(input): Promise<StoreResult<ChatMessage>> {
        // OWNERSHIP IS IN THE WHERE CLAUSE, not in a read-then-write. A separate
        // SELECT to check the author is a TOCTOU window; here the database
        // refuses the UPDATE atomically and rowCount tells us which case it was.
        // Note `editorIsModerator` is accepted and NOT used: a moderator may
        // delete but not rewrite somebody's words (see ./memory.ts).
        const { rows } = await pool.query<{ id: string | number }>(
          `UPDATE class_chat
              SET message = $1, edited_at = now()
            WHERE id = $2 AND sender_id = $3 AND is_deleted = false
            RETURNING id`,
          [input.body, input.messageId, input.editorId],
        );
        if (rows.length === 0) return await classifyChatMiss(input.messageId);
        const message = await readChat(input.messageId);
        return message ? { ok: true, value: message } : { ok: false, reason: "not_found" };
      },

      async softDelete(input): Promise<StoreResult<ChatMessage>> {
        // BOTH HALVES OF THE TOMBSTONE IN ONE STATEMENT. `class_chat` carries a
        // flag AND a timestamp under a CHECK that they agree
        // (`class_chat_deleted_consistent`), because the REST read model branches
        // on the flag while this service's wire type carries the timestamp.
        // Writing one without the other is refused by the database rather than
        // producing a message one reader shows and the other hides.
        //
        // The message text is overwritten with '' rather than merely flagged, so
        // a careless SELECT elsewhere cannot resurrect it. The column is NOT NULL,
        // so '' and not NULL; the REST layer maps it to `message: null` on the way
        // out, which is the shape its clients already consume.
        const { rows } = await pool.query<{ id: string | number }>(
          `UPDATE class_chat
              SET is_deleted = true, deleted_at = now(), message = '', is_pinned = false
            WHERE id = $1
              AND is_deleted = false
              AND ($2::boolean OR sender_id = $3)
            RETURNING id`,
          [input.messageId, input.actorIsModerator, input.actorId],
        );
        if (rows.length === 0) {
          const existing = await readChat(input.messageId);
          if (!existing) return { ok: false, reason: "not_found" };
          // Already deleted is SUCCESS, not an error: two tabs, one delete.
          if (existing.deletedAt) return { ok: true, value: existing };
          return { ok: false, reason: "not_permitted" };
        }
        const message = await readChat(input.messageId);
        return message ? { ok: true, value: message } : { ok: false, reason: "not_found" };
      },

      async setPinned(input): Promise<StoreResult<ChatMessage>> {
        const { rows } = await pool.query<{ id: string | number }>(
          `UPDATE class_chat SET is_pinned = $1
            WHERE id = $2 AND is_deleted = false RETURNING id`,
          [input.pinned, input.messageId],
        );
        if (rows.length === 0) return await classifyChatMiss(input.messageId);
        const message = await readChat(input.messageId);
        return message ? { ok: true, value: message } : { ok: false, reason: "not_found" };
      },

      async react(input): Promise<StoreResult<ChatMessage>> {
        // The whole toggle is ONE statement against the jsonb column so two
        // simultaneous reactions cannot read-modify-write over each other.
        // `jsonb_agg(DISTINCT ...)` on add is what makes a double-tap idempotent
        // without a unique index; an array minus on remove.
        const sql = input.add
          ? `UPDATE class_chat
                SET reactions = jsonb_set(
                      reactions, ARRAY[$2::text],
                      (SELECT jsonb_agg(DISTINCT e) FROM jsonb_array_elements(
                         COALESCE(reactions -> $2, '[]'::jsonb) || to_jsonb($3::bigint)) AS e),
                      true)
              WHERE id = $1 AND is_deleted = false RETURNING id`
          : `UPDATE class_chat
                SET reactions = jsonb_set(
                      reactions, ARRAY[$2::text],
                      COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(
                         COALESCE(reactions -> $2, '[]'::jsonb)) AS e
                        WHERE e <> to_jsonb($3::bigint)), '[]'::jsonb),
                      true)
              WHERE id = $1 AND is_deleted = false RETURNING id`;

        const { rows } = await pool.query<{ id: string | number }>(sql, [
          input.messageId,
          input.emoji,
          input.userId,
        ]);
        if (rows.length === 0) return await classifyChatMiss(input.messageId);
        const message = await readChat(input.messageId);
        return message ? { ok: true, value: message } : { ok: false, reason: "not_found" };
      },
    },

    qa: {
      async list(classId: number, limit: number): Promise<QaQuestion[]> {
        // Ordering mirrors ./memory.ts exactly — pinned, open, most upvoted,
        // newest — because a test that passes against the memory store and a
        // production that orders differently is worse than no test. "Open" is
        // `answered_at IS NULL AND resolved_at IS NULL`: a question can be
        // answered and still open (follow-ups), and closed without an answer.
        const { rows } = await pool.query<QaRow>(
          `SELECT ${QA_COLUMNS} FROM class_qa q
             LEFT JOIN users u ON u.id = q.student_id
            WHERE q.class_id = $1
            ORDER BY q.is_pinned DESC,
                     (q.answered_at IS NULL AND q.resolved_at IS NULL) DESC,
                     q.upvotes DESC,
                     q.id DESC
            LIMIT $2`,
          [classId, limit],
        );
        return rows.map(qaFromRow);
      },

      async ask(input): Promise<QaQuestion> {
        const { rows } = await pool.query<{ id: string | number }>(
          `INSERT INTO class_qa (class_id, student_id, question)
           VALUES ($1, $2, $3) RETURNING id`,
          [input.classId, input.askerId, input.body],
        );
        const inserted = rows[0];
        if (!inserted) throw new Error("INSERT INTO class_qa returned no row");
        const question = await readQa(toNumber(inserted.id));
        if (!question) throw new Error("inserted question could not be read back");
        return question;
      },

      async answer(input): Promise<StoreResult<QaQuestion>> {
        // `is_answered` IS SET ALONGSIDE `answered_at`, not instead of it. The
        // table CHECKs `(answered_at IS NOT NULL) = is_answered`, so a statement
        // that stamps only the timestamp — which is what this file did before the
        // reconciliation — is rejected outright by the database.
        const { rows } = await pool.query<{ id: string | number }>(
          `UPDATE class_qa
              SET answer = $1, instructor_id = $2, answered_at = now(), is_answered = true
            WHERE id = $3 RETURNING id`,
          [input.body, input.answeredById, input.questionId],
        );
        if (rows.length === 0) return { ok: false, reason: "not_found" };
        const question = await readQa(input.questionId);
        return question ? { ok: true, value: question } : { ok: false, reason: "not_found" };
      },

      async upvote(input): Promise<StoreResult<QaQuestion>> {
        // ONE VOTE PER USER IS THE PRIMARY KEY OF `class_qa_votes`. ON CONFLICT DO
        // NOTHING against it IS the rule — no read, no race, and a second call
        // from the same account is a no-op however many tabs fire it at once.
        //
        // The INSERT selects from `class_qa` rather than taking the id as a bare
        // value so that "no such question" comes back as zero rows instead of a
        // foreign-key violation surfacing as a 500. Zero rows is therefore
        // ambiguous — either the question is gone or the user already voted — and
        // the read-back below distinguishes them.
        //
        // TRANSACTIONAL because the denormalized counter moves with the ledger.
        // The UPDATE runs only when the INSERT actually inserted, which is what
        // keeps `class_qa.upvotes` equal to `count(*)` over the ledger instead of
        // drifting upward by one per repeated press.
        await inTransaction(async (client) => {
          const { rows } = await client.query<{ question_id: string | number }>(
            `INSERT INTO class_qa_votes (question_id, user_id)
             SELECT q.id, $2 FROM class_qa q WHERE q.id = $1
             ON CONFLICT (question_id, user_id) DO NOTHING
             RETURNING question_id`,
            [input.questionId, input.userId],
          );
          if (rows.length === 0) return;
          await client.query(`UPDATE class_qa SET upvotes = upvotes + 1 WHERE id = $1`, [
            input.questionId,
          ]);
        });

        const question = await readQa(input.questionId);
        if (!question) return { ok: false, reason: "not_found" };
        // A repeat vote is SUCCESS with an UNCHANGED total, matching ./memory.ts:
        // the caller asked for this question to carry this user's vote, and after
        // the call it does. Whether the row was new is not surfaced through the
        // Store interface — the handler broadcasts the total and the client's
        // button state follows from it, so a second return value would only give
        // callers something new to get wrong.
        return { ok: true, value: question };
      },

      async setPinned(input): Promise<StoreResult<QaQuestion>> {
        const { rows } = await pool.query<{ id: string | number }>(
          `UPDATE class_qa SET is_pinned = $1 WHERE id = $2 RETURNING id`,
          [input.pinned, input.questionId],
        );
        if (rows.length === 0) return { ok: false, reason: "not_found" };
        const question = await readQa(input.questionId);
        return question ? { ok: true, value: question } : { ok: false, reason: "not_found" };
      },

      async setResolved(input): Promise<StoreResult<QaQuestion>> {
        // RESOLVED IS NOT ANSWERED, and this statement deliberately leaves
        // `is_answered`/`answered_at` alone. Closing a thread that was answered
        // verbally is the common case; folding the two would trip the
        // `class_qa_answered_consistent` CHECK and would also hide the question
        // from the "answered" filter with no answer text to show.
        const { rows } = await pool.query<{ id: string | number }>(
          `UPDATE class_qa SET resolved_at = CASE WHEN $1::boolean THEN now() ELSE NULL END
            WHERE id = $2 RETURNING id`,
          [input.resolved, input.questionId],
        );
        if (rows.length === 0) return { ok: false, reason: "not_found" };
        const question = await readQa(input.questionId);
        return question ? { ok: true, value: question } : { ok: false, reason: "not_found" };
      },
    },

    engagement: {
      async flush(record: EngagementRecord): Promise<void> {
        // `class_attendance` IS THE ENGAGEMENT STORE. There is no separate
        // engagement table and one was NOT created: this table already carries
        // `messages_sent`, `questions_asked`, `screen_share_count`,
        // `time_present_minutes` and `participation_score` under
        // UNIQUE(class_id, student_id), which is precisely the grain a flush
        // writes at. A second table holding the same counters is a second answer
        // to "how engaged was this student", and the two would diverge the first
        // time one writer was updated and the other was not.
        //
        // ADDITIVE UPSERT — `= class_attendance.x + EXCLUDED.x`, never
        // `= EXCLUDED.x`. A user reconnects several times per class and each
        // disconnect flushes only what accumulated since the last one; a replacing
        // upsert would silently record the last fragment as the whole class's
        // participation. `participation_score` is the exception and IS replaced:
        // it is a derived 0-100 value over the running totals (../engagement.ts),
        // so adding two scores would be meaningless and would also breach the
        // table's 0-100 CHECK.
        //
        // WHAT IS LOST, said plainly: `answers_given`, `upvotes_cast` and
        // `reactions_added` have no column here. They are not dropped from the
        // model — ../engagement.ts folds all three into `score`, which IS stored —
        // but their individual totals are not persisted. That is the accepted
        // price of not inventing a fifth table for three integers nothing reads
        // separately, and it is recoverable: `class_qa`, `class_qa_votes` and the
        // `reactions` jsonb are all durable, so a backfill can recompute them.
        //
        // MINUTES, NOT MILLISECONDS. The service counts connected time in ms
        // (house rule inside this package) and the column is minutes (house rule
        // in the schema). Rounding DOWN: crediting a partial minute of presence is
        // a small, systematic gift to whoever reconnects most often.
        const connectedMinutes = Math.floor(record.connectedMs / 60_000);
        await pool.query(
          `INSERT INTO class_attendance
             (class_id, student_id, messages_sent, questions_asked,
              time_present_minutes, participation_score)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (class_id, student_id) DO UPDATE SET
             messages_sent        = class_attendance.messages_sent   + EXCLUDED.messages_sent,
             questions_asked      = class_attendance.questions_asked + EXCLUDED.questions_asked,
             time_present_minutes = COALESCE(class_attendance.time_present_minutes, 0)
                                    + COALESCE(EXCLUDED.time_present_minutes, 0),
             participation_score  = EXCLUDED.participation_score`,
          [
            record.classId,
            record.userId,
            record.messagesSent,
            record.questionsAsked,
            connectedMinutes,
            record.score,
          ],
        );
      },
    },
  };

  /**
   * Distinguish "no such message" from "you may not touch it" AFTER a
   * conditional UPDATE affected nothing.
   *
   * The extra read happens only on the failure path, so the common case pays
   * nothing for the better error.
   */
  async function classifyChatMiss(messageId: number): Promise<StoreResult<ChatMessage>> {
    const existing = await readChat(messageId);
    if (!existing) return { ok: false, reason: "not_found" };
    if (existing.deletedAt) return { ok: false, reason: "already_deleted" };
    return { ok: false, reason: "not_permitted" };
  }
}
