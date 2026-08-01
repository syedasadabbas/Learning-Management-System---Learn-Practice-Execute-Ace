// =============================================================================
// SHEET ROW REF — the idempotency key for Google Sheet ingestion.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// `submissions_row_ref_idx` is a UNIQUE index on (assignment_id, sheet_row_ref)
// in src/db/schema.ts. It is the only thing stopping the hourly cron from
// re-inserting every row of the sheet on every run, so the value we put in that
// column has to be derived from something the sheet will still say tomorrow.
//
// WHAT WE KEY ON, AND WHY NOT THE ALTERNATIVES
//
//   CHOSEN: sha256(normalised email + "|" + submission timestamp to the second).
//     A Google Form stamps every response with the server time it was received.
//     For a given respondent that pair is unique — the same person cannot file
//     two responses in the same second through a web form — and it is a property
//     of the RESPONSE, so it survives anything staff do to the sheet afterwards.
//
//   REJECTED: the row's position in the CSV (row 1, row 2, ...).
//     A published sheet can be sorted, filtered, or have a header row inserted.
//     Any of those renumbers every row and the next run inserts the whole sheet
//     again under fresh refs. Position is presentation, not identity.
//
//   REJECTED: the email alone.
//     Then a student who resubmits can never have their new response seen at all,
//     because the ref already exists.
//
//   REJECTED: hashing the entire row.
//     A staff member fixing a typo in a student's notes column would change the
//     hash and produce a duplicate submission.
//
// The hash is truncated to 32 hex characters (128 bits). `sheet_row_ref` is
// varchar(120); the prefixed value is 35 characters, leaving room for a future
// "v2:" scheme without a schema change. 128 bits is far past any collision risk
// at a few hundred rows per assignment, and truncation is safe here because the
// value is an identity key, not a security token.
// =============================================================================

import { createHash } from "node:crypto";

import type { SkipReason } from "./types";

/** Scheme marker. Bump if the derivation ever changes — see the note below. */
export const ROW_REF_VERSION = "v1";

export type RowRefResult =
  | { ok: true; rowRef: string }
  | { ok: false; reason: Extract<SkipReason, "missing_email" | "no_row_ref"> };

/**
 * Lowercase and trim an email for matching and for hashing.
 *
 * Gmail addresses are case-insensitive and the Form's own "Email Address"
 * capture preserves whatever the respondent typed, so `Ada@x.test` and
 * `ada@x.test` are the same person and must hash to the same ref — otherwise a
 * student who capitalised their address once gets two submission rows.
 *
 * Deliberately does NOT strip dots or `+tags`: those are provider-specific
 * aliasing rules, and applying them would make two genuinely distinct addresses
 * in `users.email` collide.
 */
export function normaliseEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Derive the stable row ref for one Sheet response.
 *
 * Truncated to whole seconds before hashing. Google's own CSV export renders the
 * timestamp at second resolution, so keeping sub-second precision from a Date
 * would let a re-parse of the same cell produce a different ref.
 *
 * Returns a failure rather than a fallback value. There is no safe fallback: a
 * NULL or empty `sheet_row_ref` is NOT constrained by the unique index, because
 * Postgres treats NULLs as distinct, so a row without a real ref duplicates on
 * every run forever. Callers must skip such a row.
 */
export function deriveRowRef(input: {
  email: string | null | undefined;
  submittedAt: Date;
}): RowRefResult {
  const email = normaliseEmail(input.email);
  if (!email) return { ok: false, reason: "missing_email" };

  const ms = input.submittedAt.getTime();
  if (!Number.isFinite(ms)) return { ok: false, reason: "no_row_ref" };

  // Whole seconds, in UTC. `toISOString` is always UTC, so the ref does not
  // change if the server's local timezone does.
  const seconds = Math.floor(ms / 1000);
  const isoSeconds = new Date(seconds * 1000).toISOString();

  const digest = createHash("sha256").update(`${email}|${isoSeconds}`).digest("hex").slice(0, 32);

  return { ok: true, rowRef: `${ROW_REF_VERSION}:${digest}` };
}

/**
 * Maximum length of `submissions.sheet_row_ref` (varchar(120) in the schema).
 * Duplicated as a constant here only to assert against it; the schema is frozen.
 */
export const ROW_REF_MAX_LENGTH = 120;

/**
 * Last line of defence before an INSERT.
 *
 * The unique index cannot protect us from a NULL or empty ref, so this throws
 * instead of letting one reach the database. An earlier revision of this stream
 * defaulted a missing ref to `""` — which Postgres happily stored once per run
 * because `''` collided, but a NULL would not have. Making it loud means the
 * failure shows up in an ingestion report, not as slow duplicate growth.
 */
export function assertUsableRowRef(rowRef: string | null | undefined): string {
  if (rowRef == null || rowRef.trim() === "") {
    throw new Error(
      "Refusing to insert a submission with a null/empty sheetRowRef: the unique " +
        "index submissions_row_ref_idx does not constrain NULLs, so the row would " +
        "be re-inserted on every ingestion run.",
    );
  }
  if (rowRef.length > ROW_REF_MAX_LENGTH) {
    throw new Error(
      `sheetRowRef is ${rowRef.length} characters; the column holds ${ROW_REF_MAX_LENGTH}.`,
    );
  }
  return rowRef;
}
