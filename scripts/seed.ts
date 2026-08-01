// =============================================================================
// SEED SCRIPT — idempotent. Safe to run repeatedly against the same database.
// -----------------------------------------------------------------------------
//   npm run db:seed
//
// Idempotency strategy: every insert is preceded by a lookup on the natural key
// (cohort name, course title, week number, lecture number, question text, user
// email). Re-running inserts nothing new and prints "exists" instead. This
// matters because the same command runs in CI before e2e tests, potentially many
// times against one database branch.
//
// The seed runs as a sequence of independent statements rather than one large
// transaction: it is idempotent, so a partial failure is recovered by simply
// running it again, and that is easier to reason about than a 33-statement
// rollback.
// =============================================================================

import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq, and, sql as rawSql } from "drizzle-orm";

import { db } from "../src/db";
import {
  cohorts,
  courses,
  weeks,
  lectures,
  quizzes,
  questions,
  options,
  assignments,
  users,
} from "../src/db/schema";
import { appConfig } from "../src/lib/config/app.config";
import { isStandInUrl, resolveAssignmentLinks } from "../src/lib/submissions/stand-in";
import {
  curriculum,
  EXPECTED_WEEKS,
  EXPECTED_QUESTIONS_PER_QUIZ,
  EXPECTED_TOTAL_QUESTIONS,
} from "./seed-content";
import { seedDemoActivity } from "./seed-demo-activity";

// bcrypt work factor. 10 is the common default: ~100 ms per hash on modern
// hardware, which is slow enough to resist offline cracking and fast enough for
// an interactive login. Raise it only alongside a login latency measurement.
const BCRYPT_ROUNDS = 10;

// Demo credentials. These exist so the e2e suite and a first-time developer have
// something to log in with.
// TODO(security): these are development accounts. Delete or rotate them before a
// real cohort is enrolled — a known password on an instructor account in
// production would let anyone grade submissions.
const DEMO_PASSWORD = "Passw0rd!demo";
const DEMO_USERS = [
  { email: "instructor@codequeenshub.test", name: "Demo Instructor", role: "instructor" as const },
  { email: "admin@codequeenshub.test", name: "Demo Admin", role: "admin" as const },
  { email: "student@codequeenshub.test", name: "Demo Student", role: "student" as const },
];

let created = 0;
let existed = 0;

// "updated" is counted separately from "created"/"exists" because it means a row
// that already existed had a field BACKFILLED — the summary line must not claim
// it was created (it wasn't) nor that it was untouched (it was).
let updated = 0;

function note(action: "created" | "exists" | "updated", what: string) {
  if (action === "created") {
    created += 1;
    console.log(`  + ${what}`);
  } else if (action === "updated") {
    updated += 1;
    console.log(`  ~ ${what} (updated)`);
  } else {
    existed += 1;
    console.log(`  = ${what} (exists)`);
  }
}

/** Days after the cohort start that week N's work is due, from app.config. */
function weekDueAt(cohortStart: Date, weekNumber: number): Date {
  const offsets = appConfig.schedule.weekDueOffsetsDays;
  // Fall back to a 7-day cadence if the config has fewer offsets than weeks,
  // rather than producing an Invalid Date that silently poisons the deadline.
  const offsetDays = offsets[weekNumber - 1] ?? weekNumber * 7;
  const due = new Date(cohortStart);
  due.setUTCDate(due.getUTCDate() + offsetDays);
  return due;
}

/**
 * Fill in `google_form_url` / `google_sheet_csv_url` — PER COLUMN, ONLY WHEN NULL.
 *
 * THE DIAGNOSIS THIS REPAIRS. Confirmed against the live database on 2026-07-31:
 * 4 assignment rows, and 4/4 had NULL in BOTH columns. Every downstream piece was
 * correct and starved. `SubmitLink` short-circuits to its "not yet configured"
 * banner on a blank Form URL (src/components/submissions/SubmitLink.tsx:28), and
 * `fetchPublishedCsv` returns `no_csv_url` before it opens a socket
 * (src/lib/submissions/fetch-csv.ts:88), so an ingest sweep's honest report was
 * "4 considered, 0 ingested, 4 skipped". The pipeline delivered nothing and
 * ingested nothing because it had no addresses, not because it was broken.
 *
 * WHAT IT WRITES. `resolveAssignmentLinks` prefers a real URL from
 * SUBMISSIONS_FORM_URL_WEEK_<n> / SUBMISSIONS_SHEET_CSV_URL_WEEK_<n>, and
 * otherwise falls back to this repository's own LOCAL STAND-IN surfaces. Nothing
 * here fabricates a docs.google.com address. See the header of
 * src/lib/submissions/stand-in.ts for precisely what is real and what is not, and
 * the TODO(course-owner) there for what must happen before a cohort is enrolled.
 *
 * WHY `== null` PER COLUMN, AND WHY IT IS NOT NEGOTIABLE. This mirrors the
 * `topic_key` backfill above and exists for the same reason recorded in
 * CHANGELOG.log for that fix: the loop's "exists, skip" rule would leave already-
 * seeded rows NULL forever, so a re-seed could never repair them — but a blind
 * UPDATE would overwrite whatever an instructor had typed into the admin console
 * (src/components/instructor/AdminForms.tsx sets both columns), and the moment a
 * real Google Form URL is entered, a re-seed would silently replace it with a
 * stand-in and start pointing students at the wrong place. Guarding on NULL makes
 * the write idempotent and makes an instructor's edit final. The two columns are
 * guarded INDEPENDENTLY because they are supplied independently: a Form URL may be
 * known before its response sheet has been published.
 *
 * THE ONE EXCEPTION TO `== null`, ADDED 2026-07-31, AND WHY IT DOES NOT WEAKEN THE
 * RULE ABOVE. A stand-in Form URL that is already stored is REWRITTEN when it does
 * not match the current canonical stand-in shape. The rule the paragraph above
 * protects is "an instructor's edit is final", and a stand-in URL is by definition
 * not an instructor's edit: this repository wrote it, and it says so in the value
 * itself via the `standin=1` flag that `isStandInUrl` tests
 * (src/lib/submissions/stand-in.ts). Anything WITHOUT that flag is still left
 * strictly alone, so a real docs.google.com URL — or any other value a human
 * typed — is untouchable exactly as before.
 *
 * It is needed because the earlier revision stored an ABSOLUTE stand-in Form URL
 * built from NEXTAUTH_URL ("http://localhost:3000/assignments/1/submit?standin=1")
 * and the shape is now origin-relative. Without this, every already-seeded database
 * would keep a link that leaves the current origin, drops the session cookie and
 * lands the student on /login. `== null` alone cannot repair a value that is
 * already non-null and wrong, which is the same trap the topic_key entry in
 * CHANGELOG.log records.
 *
 * No other column on the row is touched. This is a seeder, not a migration.
 */
async function backfillAssignmentLinks(
  assignment: typeof assignments.$inferSelect,
  weekRowId: number,
  weekNumber: number,
): Promise<void> {
  const links = resolveAssignmentLinks({
    weekNumber,
    weekRowId,
    assignmentId: assignment.id,
  });

  const patch: Partial<typeof assignments.$inferInsert> = {};
  if (assignment.googleFormUrl == null) patch.googleFormUrl = links.googleFormUrl;
  if (assignment.googleSheetCsvUrl == null) patch.googleSheetCsvUrl = links.googleSheetCsvUrl;

  // See "THE ONE EXCEPTION" above. Only ever stand-in -> stand-in, and only when
  // the stored shape differs from the one this revision produces.
  if (
    patch.googleFormUrl === undefined &&
    links.formSource === "stand-in" &&
    isStandInUrl(assignment.googleFormUrl) &&
    assignment.googleFormUrl !== links.googleFormUrl
  ) {
    patch.googleFormUrl = links.googleFormUrl;
    note(
      "updated",
      `assignment ${assignment.id} stand-in form URL renormalised ` +
        `(was "${assignment.googleFormUrl}")`,
    );
  }

  if (Object.keys(patch).length === 0) {
    note("exists", `assignment ${assignment.id} Form/Sheet URLs (already set — left alone)`);
    return;
  }

  await db.update(assignments).set(patch).where(eq(assignments.id, assignment.id));
  const which = [
    patch.googleFormUrl ? `form(${links.formSource})` : null,
    patch.googleSheetCsvUrl ? `sheet(${links.sheetSource})` : null,
  ]
    .filter(Boolean)
    .join(" ");
  note("updated", `assignment ${assignment.id} links -> ${which}`);
}

async function main() {
  // ---- Guard the content before writing anything ---------------------------
  if (curriculum.length !== EXPECTED_WEEKS) {
    throw new Error(
      `Curriculum has ${curriculum.length} weeks, expected ${EXPECTED_WEEKS}. ` +
        `Update EXPECTED_WEEKS in seed-content.ts if the course length changed.`,
    );
  }
  const totalQuestions = curriculum.reduce((n, w) => n + w.quiz.questions.length, 0);
  if (totalQuestions !== EXPECTED_TOTAL_QUESTIONS) {
    throw new Error(
      `Curriculum has ${totalQuestions} questions, expected ${EXPECTED_TOTAL_QUESTIONS}.`,
    );
  }
  for (const week of curriculum) {
    if (week.quiz.questions.length !== EXPECTED_QUESTIONS_PER_QUIZ) {
      throw new Error(
        `Week ${week.weekNumber} has ${week.quiz.questions.length} questions, ` +
          `expected ${EXPECTED_QUESTIONS_PER_QUIZ}.`,
      );
    }
    for (const q of week.quiz.questions) {
      const correct = q.options.filter((o) => o.correct).length;
      if (correct !== 1) {
        // An MCQ with zero or two correct answers makes auto-grading meaningless.
        throw new Error(
          `Week ${week.weekNumber}: question "${q.questionText.slice(0, 60)}..." ` +
            `has ${correct} correct options, expected exactly 1.`,
        );
      }
      if (q.options.length < 2) {
        throw new Error(`Week ${week.weekNumber}: a question has fewer than 2 options.`);
      }
    }
  }
  console.log(
    `Content validated: ${curriculum.length} weeks, ${totalQuestions} questions, ` +
      `exactly one correct option each.\n`,
  );

  // ---- Cohort --------------------------------------------------------------
  const cohortStart = new Date(appConfig.schedule.week1StartISO);
  if (Number.isNaN(cohortStart.getTime())) {
    throw new Error(
      `appConfig.schedule.week1StartISO is not a valid date: "${appConfig.schedule.week1StartISO}"`,
    );
  }
  const cohortName = `${appConfig.course.title} — Cohort 1`;

  console.log("Cohort:");
  let [cohort] = await db.select().from(cohorts).where(eq(cohorts.name, cohortName)).limit(1);
  if (!cohort) {
    [cohort] = await db
      .insert(cohorts)
      .values({
        name: cohortName,
        startsAt: cohortStart,
        gracePeriodDays: appConfig.schedule.gracePeriodDays,
        isActive: true,
      })
      .returning();
    note("created", `cohort "${cohortName}" starting ${cohortStart.toISOString().slice(0, 10)}`);
  } else {
    note("exists", `cohort "${cohortName}"`);
  }

  // ---- Course --------------------------------------------------------------
  console.log("\nCourse:");
  let [course] = await db
    .select()
    .from(courses)
    .where(eq(courses.title, appConfig.course.title))
    .limit(1);
  if (!course) {
    [course] = await db
      .insert(courses)
      .values({
        title: appConfig.course.title,
        description: appConfig.course.description,
        durationWeeks: appConfig.course.durationWeeks,
      })
      .returning();
    note("created", `course "${course.title}"`);
  } else {
    note("exists", `course "${course.title}"`);
  }

  // ---- Weeks, lectures, quizzes, questions, options, assignments ----------
  for (const seedWeek of curriculum) {
    console.log(`\nWeek ${seedWeek.weekNumber} — ${seedWeek.title}:`);
    const dueAt = weekDueAt(cohortStart, seedWeek.weekNumber);

    let [week] = await db
      .select()
      .from(weeks)
      .where(and(eq(weeks.courseId, course.id), eq(weeks.weekNumber, seedWeek.weekNumber)))
      .limit(1);
    if (!week) {
      [week] = await db
        .insert(weeks)
        .values({
          courseId: course.id,
          weekNumber: seedWeek.weekNumber,
          title: seedWeek.title,
          description: seedWeek.description,
          dueAt,
        })
        .returning();
      note("created", `week ${week.weekNumber} (due ${dueAt.toISOString().slice(0, 10)})`);
    } else {
      note("exists", `week ${week.weekNumber}`);
    }

    // -- Lectures --
    for (const seedLecture of seedWeek.lectures) {
      const [existing] = await db
        .select()
        .from(lectures)
        .where(
          and(eq(lectures.weekId, week.id), eq(lectures.lectureNumber, seedLecture.lectureNumber)),
        )
        .limit(1);
      if (!existing) {
        await db.insert(lectures).values({
          weekId: week.id,
          lectureNumber: seedLecture.lectureNumber,
          title: seedLecture.title,
          content: seedLecture.content,
          youtubeUrl: seedLecture.youtubeUrl,
          topicKey: seedLecture.topicKey,
          resources: seedLecture.resources,
          orderIndex: seedLecture.lectureNumber,
        });
        note("created", `lecture ${seedLecture.lectureNumber}: ${seedLecture.title}`);
      } else if (existing.topicKey == null && seedLecture.topicKey != null) {
        // BACKFILL, and deliberately the ONLY field this branch touches.
        //
        // The lectures above were seeded before `topic_key` was populated, and
        // this loop's "already exists, skip" rule would leave them null forever
        // — so every lecture would keep showing "Video coming soon" no matter
        // how many videos an admin approved, because nothing would join them.
        //
        // Guarded on `== null` so it is idempotent and, more importantly, so it
        // never overwrites a key an admin has already set by hand. Content
        // fields (title, body, resources) are NOT refreshed here: this script is
        // a seeder, not a migration, and silently rewriting edited lecture text
        // on a re-run is how an instructor's corrections disappear.
        await db
          .update(lectures)
          .set({ topicKey: seedLecture.topicKey })
          .where(eq(lectures.id, existing.id));
        note("updated", `lecture ${seedLecture.lectureNumber} topic key -> ${seedLecture.topicKey}`);
      } else {
        note("exists", `lecture ${seedLecture.lectureNumber}`);
      }
    }

    // -- Quiz --
    let [quiz] = await db.select().from(quizzes).where(eq(quizzes.weekId, week.id)).limit(1);
    if (!quiz) {
      [quiz] = await db
        .insert(quizzes)
        .values({
          weekId: week.id,
          title: seedWeek.quiz.title,
          totalQuestions: seedWeek.quiz.questions.length,
          passingScore: appConfig.quiz.passingScorePercent,
          attemptsAllowed: appConfig.quiz.attemptsAllowed,
        })
        .returning();
      note("created", `quiz "${quiz.title}"`);
    } else {
      note("exists", `quiz "${quiz.title}"`);
    }

    // -- Questions + options --
    let questionsAdded = 0;
    for (const [i, seedQuestion] of seedWeek.quiz.questions.entries()) {
      const [existingQ] = await db
        .select()
        .from(questions)
        .where(
          and(eq(questions.quizId, quiz.id), eq(questions.questionText, seedQuestion.questionText)),
        )
        .limit(1);
      if (existingQ) continue;

      const [question] = await db
        .insert(questions)
        .values({
          quizId: quiz.id,
          questionText: seedQuestion.questionText,
          type: "mcq",
          explanation: seedQuestion.explanation,
          orderIndex: i + 1,
        })
        .returning();

      await db.insert(options).values(
        seedQuestion.options.map((opt, j) => ({
          questionId: question.id,
          optionText: opt.text,
          isCorrect: Boolean(opt.correct),
          orderIndex: j + 1,
        })),
      );
      questionsAdded += 1;
    }
    if (questionsAdded > 0) {
      note("created", `${questionsAdded} question(s) with options`);
    } else {
      note("exists", `all ${seedWeek.quiz.questions.length} questions`);
    }

    // -- Assignment --
    const [existingAssignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.weekId, week.id))
      .limit(1);
    if (!existingAssignment) {
      // The final week's assignment uses the final-project offset rather than
      // the weekly cadence, since the capstone deadline is configured separately.
      const isFinalWeek = seedWeek.weekNumber === curriculum.length;
      const assignmentDue = isFinalWeek
        ? (() => {
            const d = new Date(cohortStart);
            d.setUTCDate(d.getUTCDate() + appConfig.schedule.finalProjectDueOffsetDays);
            return d;
          })()
        : dueAt;

      // Inserted with the URL columns NULL and then filled in by the backfill
      // below, rather than resolved up front: the stand-in sheet URL contains the
      // assignment's own id, which does not exist until the row does. One extra
      // statement per new assignment, run once, in exchange for not having to
      // predict a serial.
      const [created] = await db
        .insert(assignments)
        .values({
          weekId: week.id,
          title: seedWeek.assignment.title,
          description: seedWeek.assignment.description,
          requirements: seedWeek.assignment.requirements,
          googleFormUrl: null,
          googleSheetCsvUrl: null,
          dueAt: assignmentDue,
          latePenaltyPercentPerDay: 10,
        })
        .returning();
      note(
        "created",
        `assignment "${seedWeek.assignment.title}" (due ${assignmentDue.toISOString().slice(0, 10)})`,
      );
      await backfillAssignmentLinks(created, week.id, seedWeek.weekNumber);
    } else {
      note("exists", `assignment for week ${week.weekNumber}`);
      await backfillAssignmentLinks(existingAssignment, week.id, seedWeek.weekNumber);
    }
  }

  // ---- Demo users ---------------------------------------------------------
  console.log("\nDemo users:");
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  for (const demo of DEMO_USERS) {
    const [existing] = await db.select().from(users).where(eq(users.email, demo.email)).limit(1);
    if (!existing) {
      await db.insert(users).values({
        email: demo.email,
        name: demo.name,
        passwordHash,
        role: demo.role,
        // Students belong to the cohort; staff are not cohort-scoped.
        cohortId: demo.role === "student" ? cohort.id : null,
      });
      note("created", `${demo.role}: ${demo.email}`);
    } else {
      // RE-ASSERT THE PASSWORD ON AN EXISTING ROW. This branch used to be
      // `note("exists")` and nothing else, which made the seed NON-CONVERGENT for
      // the one fact every test suite depends on.
      //
      // THE INCIDENT, 2026-08-01. admin@codequeenshub.test's hash no longer
      // matched DEMO_PASSWORD — bcrypt.compare returned false for the admin while
      // returning true for the student and the instructor. Because the row
      // existed, `npm run db:seed` reported "exists: admin" and repaired nothing,
      // so the account stayed broken across every subsequent run. The cost was 26
      // failures spread over four suites that name no admin in their titles —
      // activity-log (18), auth (4), analytics (2), certificates (2) — plus the
      // global-setup warm-up timing out on the admin login while student and
      // instructor warmed cleanly. Every one of those reads as a feature bug.
      //
      // The seed's own summary PROMISES this password works for all three
      // accounts (see the closing console.log). A seed that prints that line
      // while leaving a stale hash in place is asserting something it has not
      // checked. Re-hashing on every run is what makes the promise true.
      //
      // Scoped to DEMO_USERS, which is the hard-coded trio of
      // @codequeenshub.test fixture accounts — this cannot touch a real student's
      // password, because no real address is in that list.
      //
      // Role and cohort are re-asserted for the same reason: a demo account whose
      // role drifted would fail the authorization specs in the same misleading
      // way, and the seed is the definition of what these three accounts are.
      await db
        .update(users)
        .set({
          passwordHash,
          role: demo.role,
          cohortId: demo.role === "student" ? cohort.id : null,
        })
        .where(eq(users.id, existing.id));
      note("updated", `${demo.role}: ${demo.email} (password, role and cohort re-asserted)`);
    }
  }

  // ---- Students with real activity ----------------------------------------
  // The three accounts above have zero attempts and zero submissions, which is
  // correct for representing a new cohort but leaves everything downstream of
  // scoring unverifiable. These profiles fill that gap.
  console.log("\nDemo activity (quiz attempts, graded submissions, leaderboard):");
  const activity = await seedDemoActivity((line) => console.log(line));
  created += activity.created;
  existed += activity.existed;

  // ---- Summary ------------------------------------------------------------
  // PRACTICE QUESTIONS ONLY.
  //
  // This assertion guards the OWNER'S curriculum: exactly 40 MCQs across the four
  // practice quizzes, so a database holding a different revision fails loudly
  // instead of seeding on top of it. It counted every row in `questions`, which
  // was unambiguous while practice quizzes were the only kind.
  //
  // The add-on wave adds 200 grand-exam questions (scripts/seed-exams.ts) and
  // more later from the realtime checks, all in this same table. Left unscoped,
  // the count became 240, the assertion threw, and `npm run db:seed` — which CI
  // runs before every e2e job — exited 1 even though the owner's curriculum was
  // perfectly intact. The join makes the check mean what its message says.
  const [{ count: questionCount }] = await db
    .select({ count: rawSql<number>`count(*)::int` })
    .from(questions)
    .innerJoin(quizzes, eq(questions.quizId, quizzes.id))
    .where(eq(quizzes.kind, "practice"));

  console.log(
    [
      "",
      "-".repeat(66),
      `Seed complete: ${created} created, ${updated} updated, ${existed} already present.`,
      `Questions in database: ${questionCount} (expected ${EXPECTED_TOTAL_QUESTIONS}).`,
      "",
      `Demo login password for all three accounts: ${DEMO_PASSWORD}`,
      "-".repeat(66),
    ].join("\n"),
  );

  if (questionCount !== EXPECTED_TOTAL_QUESTIONS) {
    throw new Error(
      `Expected ${EXPECTED_TOTAL_QUESTIONS} questions in the database but found ${questionCount}. ` +
        `The database may hold content from a different curriculum revision.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nSeed FAILED:");
    console.error(err);
    process.exit(1);
  });
