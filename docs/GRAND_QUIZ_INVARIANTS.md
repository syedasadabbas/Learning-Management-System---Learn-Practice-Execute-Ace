# Grand-quiz invariants I1–I6

`DECISIONS.md` cites "grand-quiz invariants I1–I6 (validated 16/16)" but never
defines them. This file defines them. Written 2026-07-30 by the shared-contracts
owner, before any add-on stream started, because a one-attempt timed exam that
carries marks is the least forgiving thing in the product: a student cannot retry
it, and a scoring or timing bug is discovered by the person it robbed.

Each invariant states the property, the failure it prevents, where it is
enforced, and how it is proved. **Enforcement is layered deliberately**: a
database constraint cannot be talked out of, a transaction cannot half-apply, and
a test tells you when a refactor removed the guard.

> Terminology. A *grand quiz* is `quizzes.kind = 'grand'`, with
> `attempts_allowed = 1` and `time_limit_minutes = 120`. An *attempt* is one
> `quiz_attempts` row. *Auto-graded* items are MCQ and code-correction; *deferred*
> items are free-form code awaiting Piston or an instructor.

---

## I1 — One attempt per student per grand quiz, ever

**Property.** For any (student, grand quiz) there is at most one `quiz_attempts`
row, and once it exists no second one can be created — not by a double-clicked
Start button, not by two tabs, not by a direct POST.

**Prevents.** A second sitting of an exam the syllabus says is one-shot. Also the
subtler case: two concurrent Start requests each reading "0 attempts so far" and
both inserting.

**Enforced by.**
1. `UNIQUE (student_id, quiz_id, attempt_number)` on `quiz_attempts`. Two
   concurrent inserts both computing `attempt_number = 1` cannot both commit —
   the loser gets a unique violation, which the service translates into "you have
   already started this quiz" and returns the existing attempt.
2. The attempt-budget check runs **inside** the same transaction as the insert,
   so the read and the write cannot be separated by another writer.

**Proved by.** A test that fires two `startGrandQuiz` calls concurrently and
asserts exactly one row exists and both callers receive the same attempt id.

---

## I2 — Expiry is server-authoritative

**Property.** `quiz_attempts.deadline_at` is computed **on the server** at start
as `started_at + time_limit_minutes` and stored. Every later decision about
whether time remains compares `now()` on the server against that stored value.
No value supplied by a client can move it.

**Prevents.** The obvious cheat (edit the countdown in devtools, or send a forged
`remainingMs`) and the accidental one (a laptop whose clock is 40 minutes slow
granting its owner 40 extra minutes).

**Enforced by.** `deadline_at` written once at start and never updated; the submit
path recomputing remaining time from it and ignoring any client-sent timing.
The countdown in the browser is presentation only — it is seeded from a
server-sent deadline and never trusted back.

**Proved by.** A test that submits with a client clock skewed hours into the past
and asserts the submission is still treated as expired.

---

## I3 — Submission is idempotent and terminal

**Property.** Once an attempt's status is `submitted` or `graded`, no answer may
be inserted or updated for it, and a repeat submit returns the **existing**
result rather than creating another attempt or re-scoring.

**Prevents.** A double-submit (impatient click, retried request, the client
auto-submitter racing the server sweeper) producing two results, two leaderboard
events, or an answer written after the exam closed.

**Enforced by.** A status guard inside the submit transaction — the row is read
`FOR UPDATE`, so a concurrent submit waits and then sees the terminal status —
plus the autosave path refusing to write when status is not `in_progress`.

**Proved by.** Tests that submit twice concurrently and assert one result, one
scoring event, and identical response bodies; and that an autosave arriving after
submit is rejected without altering the score.

---

## I4 — Unanswered questions are recorded, not omitted

**Property.** After submit — manual or automatic — **every** question in the quiz
has exactly one `answers` row. A question the student never reached carries no
selected option and no code, with `awarded = 0`.

**Prevents.** Silent truncation. If unanswered questions produced no row, then
"attempted 50, answered 12" and "attempted 12" would be indistinguishable
afterwards, and any denominator computed from row count would be wrong. This is
the explicit requirement that unattempted questions are *submitted without an
answer recorded and no score given*.

**Enforced by.** The submit transaction inserting a row for every question id in
the quiz, on conflict leaving the student's saved answer intact — the same
`UNIQUE (attempt_id, question_id)` index that makes autosave an upsert.

**Proved by.** A test that starts a 50-question quiz, answers 12, submits, and
asserts 50 answer rows exist, 38 with no selection and `awarded = 0`.

---

## I5 — No negative marking, and the score is a sum of bounded parts

**Property.** For every answer, `0 <= awarded <= max_points`. The attempt score
is exactly the sum of `awarded`, so it can never be negative and can never exceed
`total_possible`.

**Prevents.** A wrong answer subtracting marks, and a mis-weighted question
letting a single item exceed its own ceiling or push a total past 100%.

**Enforced by.** `awarded` and `max_points` defaulting to 0 and written only by
the grader, which clamps to `[0, max_points]`; the score derived by summation
rather than by incrementing a running total that could drift.

**Proved by.** Boundary tests at 0, at `max_points`, and above it, plus a test
that an all-wrong 50-question attempt scores exactly 0 — not a negative number.

---

## I6 — The student sees a score at submit, and it never overstates

**Property.** The submit response carries the auto-graded score, the per-question
outcome, and an explicit count of deferred items. The score shown at submit is
**provisional if and only if** deferred items exist, and because of I5 the
provisional total can only ever *rise* when those items are graded — never fall.

**Prevents.** Two opposite failures. A blank "your instructor will be in touch"
screen after a two-hour exam, which is what students most complain about. And the
reverse: a confident total that later drops, which is exactly the defect already
open on ungraded assignments scoring 40/40 (see `HANDOFF.md`, decision 1) — this
invariant keeps the grand quiz from repeating it.

**Enforced by.** Scoring the auto-gradable items inside the submit transaction so
a score always exists; labelling the total `provisional` while
`deferred_count > 0`; and never awarding points optimistically for an ungraded
item.

**Proved by.** Tests asserting: an all-MCQ attempt returns a final score at
submit; a mixed attempt returns a provisional score plus a deferred count; and
`provisional_total <= final_total` after the deferred items are graded.

---

## Why these six and not more

They cover the four ways this feature can hurt a student — being denied a retry
they were entitled to (I1), losing time they were owed (I2), having work
discarded or duplicated (I3, I4), and being scored wrongly (I5, I6). Anything
else in the grand quiz is a bug; these are the ones that are *unrecoverable*
after the fact, so they get constraints and tests rather than care.
