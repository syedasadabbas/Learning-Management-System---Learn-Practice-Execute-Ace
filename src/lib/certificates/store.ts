// =============================================================================
// PERSISTENCE — the only file in this stream that talks to the database.
// Owner: certificates stream.
// -----------------------------------------------------------------------------
// THE PROPERTY THIS FILE EXISTS TO GUARANTEE, stated in the same form as
// src/lib/courses/store.ts's header because it is the same class of risk and a
// worse consequence: THERE IS NO QUERY HERE THAT CAN RETURN ONE STUDENT'S
// CERTIFICATE TO ANOTHER STUDENT.
//
//   * Every authenticated read takes `studentId` and puts it in the WHERE clause.
//   * `getOwnCertificateById` takes BOTH the certificate id and the student id.
//     There is deliberately no `getCertificateById(id)` for a signed-in caller to
//     reach for, because a caller that forgets to filter is a bug that compiles —
//     and the bug's output is another student's credential.
//   * `findByVerificationCode` is the ONE unauthenticated read. It is keyed on
//     the 128-bit code (never on the row id), returns a narrow public projection
//     rather than the row, and is the only function in this file a public route
//     may call.
//
// PERFORMANCE. docs/SUBJECT_SECTIONS.md measures a warm Neon round trip at
// ~245 ms and concludes that a page's SEQUENTIAL DEPTH is the number that
// matters. The gallery page therefore costs: 1 (progress aggregate, via
// getCertificateEligibility) + 1 (own certificate) + at most 1 (issue), and the
// verify page costs exactly 1.
// =============================================================================

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { courses } from "@/db/schema";
import {
  certificates,
  certificateTemplates,
  type Certificate,
} from "@/db/schema.certificates";
import { appConfig } from "@/lib/config/app.config";

import { getCertificateEligibility, type CertificateEligibility } from "./eligibility";
import { builtInTemplate, fromRow, type ResolvedTemplate } from "./template";
import { generateVerificationCode } from "./verification";

// ---------------------------------------------------------------------------
// Which course a certificate is FOR
// ---------------------------------------------------------------------------

export interface CertificateCourse {
  id: number;
  title: string;
}

/**
 * The course this student's progress was measured against.
 *
 * THIS MIRRORS src/lib/progress/query.ts:148-154 AND NOT
 * `getActiveCourseId()` (src/lib/courses/store.ts:46), AND THE DIFFERENCE IS REAL.
 * There are three course pickers in this repository and two distinct rules:
 *
 *   progress/query.ts  ORDER BY (title = appConfig.course.title) DESC, id ASC
 *   courses/store.ts   ORDER BY id ASC          (matching components/course/data.ts)
 *
 * They agree on the seeded single-course database and can disagree the moment a
 * second course is seeded — which shipped today (scripts/seed-course-access.ts
 * creates two more). A certificate MUST name the course whose weeks were actually
 * counted, or the credential asserts completion of a course whose content was
 * never examined. So this follows the PROGRESS rule, because eligibility comes
 * from the progress read model.
 *
 * TODO(shared-contracts): src/components/course/data.ts:123 already carries a
 * standing TODO for an explicit "active course" marker. When it exists, all three
 * pickers collapse into it and this comment can go.
 */
export async function resolveCertificateCourse(): Promise<CertificateCourse | null> {
  const rows = await db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .orderBy(sql`(${courses.title} = ${appConfig.course.title}) DESC`, asc(courses.id))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * The template in force, or the built-in default when no active row exists.
 *
 * NEVER RETURNS NULL AND NEVER THROWS FOR WANT OF A ROW. A student's earned
 * credential must not be blocked on an admin having visited a settings screen —
 * see the comment on `certificate_templates` in src/db/schema.certificates.ts.
 *
 * A DATABASE ERROR IS ALSO ABSORBED, which is the less obvious half. On a
 * checkout where the migration has not been applied yet this table does not
 * exist, and the certificate row's own table might (they are created by the same
 * migration, but a partially applied migration is a real state). Falling back to
 * the built-in default means the download still works and looks right; throwing
 * would make an issued credential unreadable because of a cosmetic table.
 */
export async function resolveActiveTemplate(): Promise<ResolvedTemplate> {
  const fallback = builtInTemplate({ accentColor: appConfig.branding.colors.primary });
  try {
    const rows = await db
      .select()
      .from(certificateTemplates)
      .where(eq(certificateTemplates.isActive, true))
      // Newest wins. See the `activeIdx` comment for why two active rows is a
      // tolerated ambiguity resolved deterministically rather than a constraint.
      .orderBy(desc(certificateTemplates.id))
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : fallback;
  } catch (err) {
    console.error(
      "[certificates] could not read certificate_templates; falling back to the " +
        "built-in default. The certificate still renders correctly.",
      err,
    );
    return fallback;
  }
}

/** Every template, newest first. Admin screen only. */
export async function listTemplates(): Promise<ResolvedTemplate[]> {
  try {
    const rows = await db
      .select()
      .from(certificateTemplates)
      .orderBy(desc(certificateTemplates.id));
    return rows.map(fromRow);
  } catch (err) {
    console.error("[certificates] could not list certificate_templates", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Reads — every one of them student-scoped
// ---------------------------------------------------------------------------

/** This student's certificate for this course, or null. */
export async function getOwnCertificate(
  studentId: number,
  courseId: number,
): Promise<Certificate | null> {
  const rows = await db
    .select()
    .from(certificates)
    .where(and(eq(certificates.studentId, studentId), eq(certificates.courseId, courseId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Every certificate this student holds, newest first. Drives the gallery. */
export async function listOwnCertificates(studentId: number): Promise<Certificate[]> {
  return db
    .select()
    .from(certificates)
    .where(eq(certificates.studentId, studentId))
    .orderBy(desc(certificates.issuedAt));
}

/**
 * ONE certificate, BY ID AND BY OWNER — the download path's only read.
 *
 * BOTH PREDICATES ARE IN THE SQL, deliberately, rather than fetching by id and
 * comparing `row.studentId === user.id` in the handler. The two are equivalent
 * only as long as every future caller remembers the comparison; putting the
 * ownership rule in the WHERE clause means forgetting it is impossible, and a
 * mismatched id is indistinguishable from a nonexistent one at every layer
 * above. That is also what lets the route answer 404 rather than 403, which
 * leaks nothing about whether the certificate exists at all.
 */
export async function getOwnCertificateById(
  certificateId: number,
  studentId: number,
): Promise<Certificate | null> {
  if (!Number.isInteger(certificateId) || certificateId <= 0) return null;
  const rows = await db
    .select()
    .from(certificates)
    .where(and(eq(certificates.id, certificateId), eq(certificates.studentId, studentId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * WHAT A PUBLIC VERIFIER IS ALLOWED TO SEE. This projection IS the privacy
 * boundary, so it is a hand-written field list and never `select()`.
 *
 * INCLUDED, because a verifier cannot check a credential without them: the
 * recipient's NAME (the whole point — "is this person's claim true"), the course
 * title, how many weeks it covered, the completion and issue dates, the expiry if
 * any, and whether it has been revoked with the reason.
 *
 * EXCLUDED, and each for a reason:
 *   * the student's EMAIL, id and cohort — a shared link would otherwise become a
 *     way to turn a name on a CV into a contact address, and the leaderboard
 *     stream already treats a classmate's address as the thing never to leak
 *     (tests/e2e/fixtures.ts#otherSeededEmails).
 *   * `score_points` / `max_score_points` — a certificate attests COMPLETION. A
 *     transcript is a different document with a different audience, and a student
 *     sharing proof of completion has not consented to publishing their marks.
 *   * the row `id` — it is sequential, and publishing it alongside the code would
 *     hand an attacker the mapping between a guessable number and the credential
 *     it belongs to.
 *   * `template_id`, `revoked_by` — internal.
 */
export interface PublicCertificate {
  recipientName: string;
  courseTitle: string;
  weeksCompleted: number;
  weeksTotal: number;
  completedAt: Date;
  issuedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revocationReason: string | null;
  verificationCode: string;
}

/**
 * The one unauthenticated read in this file.
 *
 * Keyed on the code, never the id. The caller MUST have checked
 * `isVerificationCodeShape` first — that is not a security boundary (a
 * well-formed code that matches nothing is still "not found"), it is what stops a
 * crawler walking /verify/1, /verify/2, ... from costing a query each.
 *
 * A REVOKED CERTIFICATE IS STILL RETURNED, with its `revokedAt` set. Returning
 * null for a revoked credential would make a withdrawn certificate
 * indistinguishable from a forged code, and those are different facts that a
 * verifier needs told apart.
 */
export async function findByVerificationCode(code: string): Promise<PublicCertificate | null> {
  const rows = await db
    .select({
      recipientName: certificates.recipientName,
      courseTitle: certificates.courseTitle,
      weeksCompleted: certificates.weeksCompleted,
      weeksTotal: certificates.weeksTotal,
      completedAt: certificates.completedAt,
      issuedAt: certificates.issuedAt,
      expiresAt: certificates.expiresAt,
      revokedAt: certificates.revokedAt,
      revocationReason: certificates.revocationReason,
      verificationCode: certificates.verificationCode,
    })
    .from(certificates)
    .where(eq(certificates.verificationCode, code))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

/** Why an issue attempt produced no new certificate. Returned, never thrown. */
export type IssueOutcome =
  /** A new row was written. */
  | { status: "issued"; certificate: Certificate }
  /** One already existed. The NORMAL outcome of a reload — not a problem. */
  | { status: "existing"; certificate: Certificate }
  /** The student has not finished the course. */
  | { status: "not_eligible"; eligibility: CertificateEligibility }
  /** No course rows at all — an unseeded database. */
  | { status: "no_course" };

/**
 * Issue this student's certificate, or return the one they already have.
 *
 * ELIGIBILITY IS RE-DERIVED HERE, IN THE WRITE PATH, and that is the whole
 * security argument for this function. The page that calls it has already checked
 * eligibility to decide what to render, and that check is a UI concern that a
 * hand-crafted POST bypasses entirely. src/lib/guard.ts's header makes the same
 * point about middleware: the edge check is a fast reject, not the decision. So
 * the decision is made here, against the progress read model, on every call —
 * there is no `force` parameter and no way for a caller to assert eligibility it
 * has computed itself.
 *
 * IDEMPOTENCY IS THE UNIQUE INDEX, NOT THE `getOwnCertificate` CHECK ABOVE IT.
 * That read is an optimisation; the ~245 ms between it and the insert is a real
 * window, and a student double-clicking is not an exotic race. Two credentials
 * for one achievement, with two different verification codes, is the outcome
 * `certificates_student_course_idx` exists to make impossible —
 * `onConflictDoNothing` then makes the second caller's INSERT a no-op that
 * returns nothing, and we re-read the winner. Same mechanism and same reasoning
 * as src/lib/learn/complete.ts:101 and src/lib/mail/dispatch.ts:415.
 *
 * `recipientName` is passed in from the SESSION (`AuthUser.name`) rather than
 * read back from `users`, for one round trip fewer on the page a student is
 * waiting on; it is snapshotted either way.
 */
export async function issueCertificate(input: {
  studentId: number;
  recipientName: string;
  now?: Date;
}): Promise<IssueOutcome> {
  const now = input.now ?? new Date();

  const course = await resolveCertificateCourse();
  if (!course) return { status: "no_course" };

  const existing = await getOwnCertificate(input.studentId, course.id);
  if (existing) return { status: "existing", certificate: existing };

  const eligibility = await getCertificateEligibility(input.studentId, now);
  if (!eligibility.eligible || !eligibility.completedAt) {
    return { status: "not_eligible", eligibility };
  }

  const template = await resolveActiveTemplate();

  const inserted = await db
    .insert(certificates)
    .values({
      studentId: input.studentId,
      courseId: course.id,
      templateId: template.id,
      verificationCode: generateVerificationCode(),
      // The frozen snapshot. A trimmed empty name would print a blank credential,
      // so the email-less fallback is the course title's owner rather than "".
      recipientName: input.recipientName.trim() || "Student",
      courseTitle: course.title,
      weeksCompleted: eligibility.weeksCompleted,
      weeksTotal: eligibility.weeksTotal,
      scorePoints: eligibility.scorePoints,
      maxScorePoints: eligibility.maxScorePoints,
      completedAt: eligibility.completedAt,
      issuedAt: now,
    })
    .onConflictDoNothing({
      target: [certificates.studentId, certificates.courseId],
    })
    .returning();

  if (inserted[0]) return { status: "issued", certificate: inserted[0] };

  // The conflict branch: another request won the race. Re-read rather than
  // reporting failure — the student's credential exists, which is what they asked
  // for, and which request created it is not information anybody needs.
  const winner = await getOwnCertificate(input.studentId, course.id);
  if (winner) return { status: "existing", certificate: winner };

  // Neither inserted nor found. The only way here is a conflict on the
  // verification-code index instead of the student/course one, i.e. a 128-bit
  // collision. Reported honestly as not-eligible-shaped failure would be a lie,
  // so it throws: this is the one genuinely impossible state in this file and it
  // must be loud if it ever happens.
  throw new Error(
    `[certificates] issue for student ${input.studentId} neither inserted nor ` +
      `resolved an existing row. A verification-code collision is the only ` +
      `explanation; retry the request.`,
  );
}

/**
 * Withdraw a certificate. Admin-only by construction — the caller must have
 * passed `requireRole("admin")`; this function does not check, in the same way
 * `decideRequest` (src/lib/courses/store.ts:356) does not.
 *
 * `WHERE revoked_at IS NULL` is a COMPARE-AND-SET, not a redundant filter: two
 * admins acting on the same certificate must not overwrite each other's
 * `revoked_by`, and the second one is told it changed nothing.
 *
 * NO UI SHIPS WITH THIS. Stated plainly rather than left to be discovered: the
 * public verify page renders the revoked branch and this is the only way to reach
 * it, so today revocation is an operator action through this function.
 * TODO(certificates): an admin screen with a reason field. The verify page's
 * revoked branch is written and unexercised until then.
 */
export async function revokeCertificate(input: {
  certificateId: number;
  adminId: number;
  reason: string;
  now?: Date;
}): Promise<boolean> {
  const updated = await db
    .update(certificates)
    .set({
      revokedAt: input.now ?? new Date(),
      revokedBy: input.adminId,
      revocationReason: input.reason.slice(0, 500),
    })
    .where(and(eq(certificates.id, input.certificateId), isNull(certificates.revokedAt)))
    .returning({ id: certificates.id });
  return updated.length > 0;
}
