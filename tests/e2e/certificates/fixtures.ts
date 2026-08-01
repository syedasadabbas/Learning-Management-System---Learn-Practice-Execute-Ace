// =============================================================================
// CERTIFICATE E2E FIXTURES — owned by the certificates stream.
// -----------------------------------------------------------------------------
// WHY THIS STREAM CREATES ITS ROWS DIRECTLY, which needs justifying rather than
// assuming: THE HAPPY PATH CANNOT BE PRODUCED THROUGH THE UI TODAY.
//
// A certificate is issued only when EVERY week of the course is complete AND
// unlocked. `appConfig.curriculumSections` ships with the HTML subject enabled and
// css / javascript / git-deployment `enabled: false`, and the section switch is
// evaluated ahead of everything else in `deriveWeekLockStates` — including the
// "week 1 is always unlocked" rule. So weeks 2-4 are shut for every student in the
// seeded database and no amount of clicking can finish them. Driving the UI to
// eligibility would mean editing app.config.ts, which is a shipped policy decision
// this stream does not own.
//
// This is the same argument tests/e2e/fixtures.ts#createVideoCandidate makes for
// inserting a `topic_videos` row by hand: the property under test can only be
// tested when the state exists, and no seeder makes it.
//
// THE CONTRACT, copied from that file because it is what keeps eight streams'
// specs from destroying each other:
//   * every row is created by THIS file and identified by an id it returns, so no
//     other stream's assertions can see it;
//   * `remove()` is idempotent, so a spec that crashed mid-run does not poison the
//     next;
//   * it fails LOUDLY without DATABASE_URL rather than no-op'ing.
//
// It deliberately does NOT delete "all certificates" or truncate the table: the
// unscoped delete is exactly the mistake CHANGELOG.log 2026-07-31 15:50 records,
// where one spec's clean slate wiped three other streams' graded fixtures.
// =============================================================================

import { randomBytes } from "node:crypto";

import { withDb } from "../fixtures";

export interface CertificateFixture {
  id: number;
  studentId: number;
  verificationCode: string;
  recipientName: string;
  /** Delete this one row. Idempotent. */
  remove: () => Promise<void>;
}

/** The user id behind a seeded email, so a spec never hardcodes a serial id. */
export async function userIdFor(email: string): Promise<number> {
  return withDb(async (sql) => {
    const result = await sql(`SELECT id FROM users WHERE email = $1`, [email]);
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `No user with email ${email}. Run the suite preconditions first — see ` +
          `SUITE_PRECONDITIONS in tests/e2e/fixtures.ts.`,
      );
    }
    return Number(row.id);
  });
}

/** The course id the certificate code would pick. Mirrors resolveCertificateCourse. */
async function activeCourse(): Promise<{ id: number; title: string }> {
  return withDb(async (sql) => {
    // Same ORDER BY as src/lib/certificates/store.ts#resolveCertificateCourse and
    // src/lib/progress/query.ts, so a fixture row lands on the course the app
    // measures. Hardcoding "the first course" would silently attach the fixture to
    // a different course now that scripts/seed-course-access.ts seeds three.
    const result = await sql(
      `SELECT id, title FROM courses
       ORDER BY (title = 'Web Development Internship') DESC, id ASC
       LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) throw new Error("No courses in the database. Run `npm run db:seed`.");
    return { id: Number(row.id), title: String(row.title) };
  });
}

/**
 * Insert one certificate for one student.
 *
 * `ON CONFLICT (student_id, course_id)` is not used: a leftover row from a crashed
 * run would then be silently reused and the spec would assert against a
 * certificate it did not create. It deletes any prior row for that pair FIRST, so
 * the row under test is always this call's. That delete is scoped to one student
 * and one course — never to the table.
 */
export async function createCertificate(options: {
  studentEmail: string;
  recipientName?: string;
  revoked?: boolean;
  revocationReason?: string;
}): Promise<CertificateFixture> {
  const studentId = await userIdFor(options.studentEmail);
  const course = await activeCourse();
  // 32 hex characters, the real format, so the shape check in the verify route
  // treats the fixture exactly as it treats a genuine code.
  const verificationCode = randomBytes(16).toString("hex");
  const recipientName = options.recipientName ?? "E2E Certificate Holder";

  const id = await withDb(async (sql) => {
    await sql(`DELETE FROM certificates WHERE student_id = $1 AND course_id = $2`, [
      studentId,
      course.id,
    ]);
    const inserted = await sql(
      `INSERT INTO certificates
         (student_id, course_id, verification_code, recipient_name, course_title,
          weeks_completed, weeks_total, score_points, max_score_points,
          completed_at, issued_at, revoked_at, revocation_reason)
       VALUES ($1, $2, $3, $4, $5, 4, 4, 268, 280, NOW(), NOW(), $6, $7)
       RETURNING id`,
      [
        studentId,
        course.id,
        verificationCode,
        recipientName,
        course.title,
        options.revoked ? new Date().toISOString() : null,
        options.revoked ? (options.revocationReason ?? "E2E fixture revocation") : null,
      ],
    );
    return Number(inserted.rows[0].id);
  });

  return {
    id,
    studentId,
    verificationCode,
    recipientName,
    remove: async () => {
      await withDb(async (sql) => {
        await sql(`DELETE FROM certificates WHERE id = $1`, [id]);
      });
    },
  };
}

/** How many certificates a student holds. Used to prove a refused POST wrote nothing. */
export async function countCertificatesFor(email: string): Promise<number> {
  const studentId = await userIdFor(email);
  return withDb(async (sql) => {
    const result = await sql(`SELECT COUNT(*)::int AS n FROM certificates WHERE student_id = $1`, [
      studentId,
    ]);
    return Number(result.rows[0].n);
  });
}
