// =============================================================================
// CERTIFICATES — schema module for the certificates stream (roadmap PHASE 1 #2).
// -----------------------------------------------------------------------------
// Owner: certificates stream.
//
// WHY THIS IS A SEPARATE FILE AND NOT AN APPEND TO src/db/schema.ts
//
// The same reason src/db/schema.access.ts and src/db/schema.submissions.ts are
// separate: `src/db/schema.ts` is the frozen Wave 0 seam, it is edited
// concurrently, and `drizzle.config.ts:12` states the convention in its own
// comment. This module imports FROM schema.ts and schema.ts does not import it,
// so there is no cycle. `drizzle.config.ts` lists this path, which is what makes
// a generated migration identical to an inline declaration — and what stops
// drizzle-kit from offering to DROP these tables because it cannot see them.
//
// -----------------------------------------------------------------------------
// WHERE THIS DEPARTS FROM IMPLEMENTATION_ROADMAP.md:143-169, AND WHY
//
// 1. INTEGER `serial` KEYS, NOT `uuid`. The roadmap writes
//    `uuid('id').primaryKey().defaultRandom()` and
//    `studentId: uuid(...).references(() => users.id)`. That does not compile
//    against this database: `users.id` and `courses.id` are `serial`
//    (src/db/schema.ts:106, :129), so a uuid foreign key could not reference
//    them. Every table in the repository uses integer keys. Existing wins.
//
// 2. NO `pdfUrl` COLUMN. The roadmap's is `varchar('pdf_url', 500).notNull()`
//    annotated "Vercel Blob URL". There is no blob store — see the STORAGE
//    DECISION block in src/lib/certificates/pdf.tsx for the full argument and
//    its failure modes. The PDF is rendered per request from the snapshot
//    columns below, so there is no URL to store, and a column holding one would
//    be a permanently-null field that the next reader takes as a TODO.
//
// 3. THE SNAPSHOT COLUMNS (`recipient_name`, `course_title`, `weeks_completed`,
//    `weeks_total`, `score_points`, `max_score_points`, `completed_at`) ARE NEW,
//    and they are the load-bearing consequence of decision 2. With no stored
//    bytes, "the certificate" is this row, and re-rendering must reproduce the
//    same credential months later. If the PDF were drawn from live joins then a
//    student who corrects the spelling of their name, an admin who retitles the
//    course, or a re-marked assignment would all silently change the meaning of
//    an already-issued credential — and a verifier comparing a printed copy
//    against the verify page would find them disagreeing with no audit trail.
//    Issuance FREEZES the facts here. Only cosmetics (colour, wording) follow
//    the template.
//
// 4. NO `verified_at` COLUMN. The roadmap has `verifiedAt` — "When verification
//    was done". Verification is an unauthenticated GET of a public link that can
//    happen any number of times, so a single timestamp cannot answer the
//    question it is named for, and writing it would make an anonymous read into
//    a database WRITE on a credential row: any crawler that follows a shared
//    link would mutate it. A public read stays a read. If verification analytics
//    are ever wanted they belong in an append-only log table, not here.
//
// 5. `body_template`, NOT `html_template`. See the comment on the column.
// =============================================================================

import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

import { courses, users } from "./schema";

/**
 * The look of a certificate, editable by an admin.
 *
 * SEPARATED FROM THE CREDENTIAL ON PURPOSE. A row here decides colours and
 * wording; a row in `certificates` decides what is true. That split is why an
 * admin editing a template cannot alter what an issued certificate ASSERTS —
 * the assertions are the frozen snapshot columns on the certificate itself.
 *
 * ZERO ROWS IS A SUPPORTED STATE. `resolveTemplate` in
 * src/lib/certificates/template.ts falls back to a built-in default, so the
 * feature works on a fresh checkout with nothing seeded. A required template
 * row would mean a student's earned credential is blocked on an admin having
 * visited a settings screen.
 */
export const certificateTemplates = pgTable(
  "certificate_templates",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    /**
     * A HANDLEBARS TEXT TEMPLATE, and the column is named for that rather than
     * for HTML — which is where this deliberately departs from the roadmap's
     * `htmlTemplate: text('html_template')  // Handlebars template`.
     *
     * The roadmap names `@react-pdf/renderer` as the PDF engine in the same
     * breath (line 173), and @react-pdf does not render HTML. It renders a tree
     * of its own primitives (Document / Page / View / Text). Feeding it a string
     * of HTML gets you the literal tags printed on the page; making the HTML
     * meaningful would need an HTML-to-PDF engine, i.e. headless Chromium, which
     * is not something the free hosting tier this project is committed to
     * (FREE_STACK.md) can run inside a serverless function.
     *
     * So the stored template is compiled by handlebars to PLAIN TEXT and drawn
     * with <Text>. A column called `html_template` whose contents are never
     * treated as HTML is a name that misleads every future reader into pasting
     * markup that silently does nothing.
     *
     * Placeholders are documented in src/lib/certificates/template.ts, which
     * also refuses to compile a template referencing anything else.
     */
    bodyTemplate: text("body_template").notNull(),
    /**
     * Path to a logo, NOT a URL. `appConfig.branding.logoPath` ("/logo.svg") is
     * the project's own convention and the file is served from /public, so a
     * remote URL would add a network fetch inside PDF rendering — the one place
     * a slow third party turns into a failed download. Nullable, and the
     * renderer omits the logo rather than substituting a placeholder.
     */
    logoPath: varchar("logo_path", { length: 500 }),
    /** Hex, including the leading '#'. Default mirrors appConfig.branding.colors.primary. */
    accentColor: varchar("accent_color", { length: 7 }).notNull().default("#4f5bd5"),
    /**
     * MUST be one of @react-pdf/renderer's four built-in font families
     * (Helvetica, Times-Roman, Courier, Symbol). The roadmap's default is
     * 'Inter', which @react-pdf can only use after `Font.register` fetches a
     * .ttf over the network at render time — an external dependency inside the
     * download path, on a stack whose whole premise is no external services.
     * `assertRenderableFont` in src/lib/certificates/template.ts enforces this,
     * because a bad value here fails at render time for every student at once.
     */
    fontFamily: varchar("font_family", { length: 100 }).notNull().default("Helvetica"),
    isActive: boolean("is_active").notNull().default(true),
    /** `set null`, not cascade: deleting a departed admin must not delete the template. */
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * `resolveTemplate` reads `WHERE is_active = true ORDER BY id DESC LIMIT 1`.
     * Deliberately NOT a unique partial index on `is_active`: two active rows is
     * a recoverable ambiguity (newest wins, deterministically), whereas a unique
     * constraint would make "activate this one" a two-statement operation that
     * can fail halfway and leave the cohort with NO active template.
     */
    activeIdx: index("certificate_templates_active_idx").on(t.isActive, t.id),
  }),
);

/**
 * ONE ISSUED CREDENTIAL. The row IS the certificate — there are no stored bytes.
 *
 * IDEMPOTENCY IS THE UNIQUE INDEX, NOT APPLICATION CODE. `studentCourseIdx`
 * below is what makes "issue my certificate" safe to call twice, which it will
 * be: the gallery page issues on first view, a student reloads, and two requests
 * arrive concurrently. Without the index both would insert and the student would
 * hold two credentials with two different verification codes for one
 * achievement — and a verifier checking the older code could not tell which was
 * canonical. Same reasoning, same mechanism, as
 * `course_access_requests_student_course_idx` (src/db/schema.access.ts) and
 * `submissions_assignment_row_idx`.
 *
 * A REVOKED ROW IS KEPT, never deleted, for the reason a rejected access request
 * is kept: the verification code may already be printed on a CV, and a deleted
 * row makes that link read "no such certificate" — indistinguishable from a
 * forged code. A revoked row lets the verify page say the true thing, which is
 * "this credential was issued and has since been withdrawn".
 */
export const certificates = pgTable(
  "certificates",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    /**
     * The template in force AT ISSUANCE, `set null` if it is later deleted.
     * Recorded rather than always re-resolving the active template so that a
     * re-download is visually stable too, not merely factually stable.
     */
    templateId: integer("template_id").references(() => certificateTemplates.id, {
      onDelete: "set null",
    }),

    // --- the public identifier ---------------------------------------------
    /**
     * THE SHAREABLE SECRET. 32 lowercase hex characters = 128 bits of
     * `crypto.randomBytes` entropy (src/lib/certificates/verification.ts).
     *
     * This is the ONLY key the public verify page accepts. The roadmap proposes
     * `GET /api/certificates/[id]/verify` (line 175) keyed on the row id, which
     * would make every credential in the cohort enumerable by counting from 1 —
     * the certificates stream's version of the exact defect the guard rules in
     * src/lib/guard.ts exist to prevent. A sequential id can be guessed; 128
     * bits cannot be.
     *
     * varchar(64) rather than (32) so the format can grow without a migration.
     */
    verificationCode: varchar("verification_code", { length: 64 }).notNull(),

    // --- FROZEN SNAPSHOT: what this certificate asserts --------------------
    // See departure note 3 in the file header for why these are copies and not
    // joins. They are `notNull` because a credential missing the recipient's
    // name is not a credential.
    recipientName: varchar("recipient_name", { length: 255 }).notNull(),
    courseTitle: varchar("course_title", { length: 255 }).notNull(),
    /** Weeks the student had completed at issuance, and how many existed. */
    weeksCompleted: integer("weeks_completed").notNull(),
    weeksTotal: integer("weeks_total").notNull(),
    /**
     * Points earned and available at issuance, in the units of
     * src/lib/contracts/scoring.ts POINTS (a normal week is 70).
     *
     * Integers, not the `decimal` used for `quiz_attempts.percentage`: these are
     * whole points by construction (`weekScoreBreakdown` rounds), and a percent
     * is derivable from the pair, whereas a stored percent could disagree with
     * the pair it came from. Recorded but NOT PRINTED anywhere public — see the
     * privacy note in src/app/verify/[code]/page.tsx. This is the evidence of
     * what was true when the credential was granted, not a transcript.
     */
    scorePoints: integer("score_points").notNull(),
    maxScorePoints: integer("max_score_points").notNull(),
    /**
     * When the course was FINISHED, which is not when the row was written.
     * Currently equal to `issued_at` because completion is observed at issuance
     * rather than event-sourced; kept as its own column because the certificate
     * PRINTS this date, and the day a student finished must not silently become
     * the day an operator happened to backfill a row.
     */
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Nullable = no expiry, as the roadmap specifies (line 149). NOTHING IN THIS
     * REPOSITORY SETS IT, stated plainly so the next reader does not assume an
     * expiry policy exists: a completion credential does not lapse. It is kept
     * because it has a defined reader — the verify page prints "does not expire"
     * when null and the date when set — rather than being a column with no
     * meaning attached.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    // --- revocation --------------------------------------------------------
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by").references(() => users.id, { onDelete: "set null" }),
    /** Shown on the public verify page. A withdrawal with no reason is not accountable. */
    revocationReason: varchar("revocation_reason", { length: 500 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** See the note above — this index IS the "one certificate per course" rule. */
    studentCourseIdx: uniqueIndex("certificates_student_course_idx").on(t.studentId, t.courseId),
    /**
     * The public verify path's only lookup. UNIQUE as well as indexed: a
     * duplicate code would make one credential's link resolve to another
     * student's, which is the single worst outcome this table has.
     */
    verificationCodeIdx: uniqueIndex("certificates_verification_code_idx").on(t.verificationCode),
    /** The student's own gallery reads every row for one student. */
    studentIdx: index("certificates_student_idx").on(t.studentId),
  }),
);

export type Certificate = typeof certificates.$inferSelect;
export type NewCertificate = typeof certificates.$inferInsert;
export type CertificateTemplate = typeof certificateTemplates.$inferSelect;
export type NewCertificateTemplate = typeof certificateTemplates.$inferInsert;
