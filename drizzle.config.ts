import type { Config } from "drizzle-kit";
import "dotenv/config"; // loads .env so DATABASE_URL is present for CLI runs

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env first.");
}

export default {
  // An ARRAY, not a single path. `schema.ts` is the frozen Wave 0 seam and is
  // edited concurrently by several streams; a stream that needs a table of its
  // own adds a sibling module and one entry here rather than appending to the
  // hot file, which is how two agents' appends collide in the same commit.
  // drizzle-kit unions every listed path into one snapshot, so a generated
  // migration is identical to what an inline declaration would have produced.
  schema: [
    "./src/db/schema.ts",
    "./src/db/schema.access.ts",
    // submissions stream — submission_ingest_runs. MUST stay listed: drizzle-kit
    // treats a table it cannot see in the snapshot as one to DROP, so omitting
    // this line makes the next `db:push` delete the operator's ingest report.
    "./src/db/schema.submissions.ts",
    // async-queues stream — mail_dispatches, the ledger that closes the queue's
    // double-send hole. Same MUST as the line above: an unlisted table is a
    // table drizzle-kit will offer to DROP.
    "./src/db/schema.queue.ts",
    // badges stream — badge_awards, whose (student_id, type) unique index IS the
    // "award a badge exactly once" guarantee. Same MUST as the two lines above:
    // an unlisted table is a table drizzle-kit will offer to DROP, and dropping
    // this one silently re-arms every duplicate award the index prevents.
    "./src/db/schema.badges.ts",
    // email-notifications stream — notifications, notification_preferences.
    // Same MUST as the lines above: an unlisted table is a table drizzle-kit will
    // offer to DROP, and dropping these two loses every student's notification
    // history AND their opt-outs, which is the one kind of row a system must not
    // silently forget (a student re-opted-in without asking is a spam complaint).
    "./src/db/schema.notifications.ts",
    // certificates stream — certificates, certificate_templates. Same MUST as the
    // lines above, and the consequence here is the least recoverable of the set:
    // a certificate row IS the credential (no bytes are stored anywhere else), and
    // its verification code may already be printed on a student's CV. Dropping
    // this table turns those links into "no such certificate", which a verifier
    // cannot tell apart from a forgery.
    "./src/db/schema.certificates.ts",
    // forums stream — forum_topics, forum_posts. Same MUST as the lines above.
    // The consequence of omitting it is that `db:push` offers to DROP every
    // student-authored thread and reply in the cohort — user-generated content
    // that exists nowhere else and that no seeder can recreate.
    "./src/db/schema.forums.ts",
    // activity-logs stream — activity_logs, the audit trail. Same MUST as every
    // line above, and it bites hardest here: an unlisted table is a table
    // drizzle-kit will offer to DROP, and the audit trail is the one table in this
    // schema that cannot be reconstructed from any other. Every other table holds
    // current state that a reseed or a re-ingest can rebuild; this one holds the
    // record of acts that have already happened, which nothing can replay.
    "./src/db/schema.activity.ts",
    // prerequisites stream — course_prerequisites, course_prerequisite_overrides.
    // Same MUST as every line above. Two distinct consequences of omitting it:
    // dropping `course_prerequisites` silently OPENS every course whose entry
    // requirements an admin deliberately set, and dropping
    // `course_prerequisite_overrides` silently REVOKES every exception an admin
    // granted — in both directions an access decision changes with no record that
    // anything happened.
    "./src/db/schema.prerequisites.ts",
    // peer-review stream — grading_rubrics, peer_review_rounds,
    // peer_review_allocations, peer_reviews. Same MUST as every line above, with
    // one consequence worth naming separately: `peer_review_allocations` carries
    // the CHECK constraint that makes it impossible to allocate a student their
    // own submission to review. Omitting this line drops the table AND that
    // constraint, so the guarantee would survive only as a comment in
    // src/lib/peer-review/allocate.ts.
    "./src/db/schema.peer-review.ts",
    // learning-enhancement wave — assignment_samples, practice_problems,
    // interview_questions, lecture_visualizations. Same MUST as every line above:
    // an unlisted module is a set of tables drizzle-kit will offer to DROP. These
    // hold AUTHORED CURRICULUM CONTENT — worked samples, hint ladders, model
    // interview answers — which no seeder can recreate and which is the most
    // expensive kind of row in this system to produce (a human wrote it).
    "./src/db/schema.learning.ts",
    // live-classes wave — live_classes, class_attendance, class_chat, class_qa,
    // class_recordings. Same MUST as every line above, with two consequences worth
    // naming: `class_attendance` IS the record a participation mark was computed
    // from, so dropping it makes every such mark unjustifiable after the fact, and
    // `class_chat` / `class_qa` are the transcript a conduct complaint would be
    // investigated against.
    "./src/db/schema.live-classes.ts",
    // presentations wave — presentations, presentation_slides,
    // presentation_submissions, presentation_feedback. Same MUST as every line
    // above. `presentations.slides_json` IS the student's deck: the bytes exist
    // nowhere else, so dropping this table destroys coursework outright.
    "./src/db/schema.presentations.ts",
  ],
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  strict: true,
  verbose: true,
} satisfies Config;
