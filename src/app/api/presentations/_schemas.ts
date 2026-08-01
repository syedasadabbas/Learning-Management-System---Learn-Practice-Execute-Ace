// =============================================================================
// REQUEST VALIDATION — presentation write payloads.
// Owner: the API stream. (src/lib/presentations/ belongs to the Reveal.js
// stream; see the note in ./_access.ts on why these live here.)
// -----------------------------------------------------------------------------
// THE SLIDE JSON IS VALIDATED WITH THE CANONICAL CONTRACT, NOT A LOCAL COPY.
// `src/lib/presentations/types.ts` is the Reveal.js stream's discriminated union
// plus its zod schema, and it says in its own header that the API stream builds
// to it. So `slideDeckSchema` and `slideSchema` are IMPORTED here. Declaring a
// second, looser shape would defeat the point of that file existing: the
// database, the API and the renderer must agree, and they can only agree on one
// definition.
//
// The consequence is a hard dependency in the right direction — this module
// imports from the contract, the contract imports nothing from here — and a
// deck whose JSON does not parse is a 422 naming the field path rather than a
// stack trace from deep inside the renderer.
//
// PER-SLIDE `content_json` IS NOT SEPARATELY VALIDATED, deliberately. The
// canonical contract types a slide as a whole (a code slide statically carries
// `language`, an image slide statically carries `alt`); it does not define a
// standalone `content_json` shape, because in that model the type-specific
// payload IS the slide's own fields. `presentation_slides.content_json` is the
// projection's storage for those fields, written by this API from an
// already-validated slide. Inventing a schema for it here would be inventing a
// second slide contract.
// =============================================================================

import { z } from "zod";

import { slideDeckSchema, slideSchema } from "@/lib/presentations/types";

/**
 * Create a deck.
 *
 * `deck` is optional: a new presentation normally starts empty, and
 * `emptyDeck()` from the canonical contract is what the create handler stores
 * so that the API and the editor's "new presentation" button produce
 * byte-identical JSON.
 */
export const createPresentationSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().max(2_000).optional(),
    /** Reveal theme key. Free varchar in the schema: themes ship without a migration. */
    theme: z.string().max(50).default("default"),
    assignmentId: z.number().int().positive().nullable().optional(),
    relatedClassId: z.number().int().positive().nullable().optional(),
    deck: slideDeckSchema.optional(),
  })
  .strict();

export type CreatePresentationInput = z.infer<typeof createPresentationSchema>;

/**
 * Update a deck.
 *
 * `isPublished` is here and `publishedAt` is NOT: the schema CHECKs
 * `(published_at IS NOT NULL) = is_published`, so the timestamp is a server
 * consequence of the flag, never a client input. A settable `publishedAt` would
 * let a client write a deck that is published with no publication date, or dated
 * without being published, and the gallery's sort key stops working.
 */
export const updatePresentationSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(2_000).nullable().optional(),
    theme: z.string().max(50).optional(),
    isPublished: z.boolean().optional(),
    isTemplate: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    sharedWithRoles: z.array(z.enum(["student", "instructor", "admin"])).max(3).nullable().optional(),
    showSpeakerNotes: z.boolean().optional(),
    showSlideNumbers: z.boolean().optional(),
    allowExport: z.boolean().optional(),
    assignmentId: z.number().int().positive().nullable().optional(),
    relatedClassId: z.number().int().positive().nullable().optional(),
    /**
     * The whole editor document, replaced atomically. `slides_json` WINS over
     * `presentation_slides` when they disagree — DECISIONS.md and the
     * schema.presentations.ts header both say so — which is why the save handler
     * writes this first and rebuilds the projection from it, rather than the
     * other way round.
     */
    deck: slideDeckSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "at least one field must be supplied");

export type UpdatePresentationInput = z.infer<typeof updatePresentationSchema>;

/**
 * One slide, appended or replaced.
 *
 * Validated by the CANONICAL `slideSchema` — the discriminated union from
 * src/lib/presentations/types.ts — so a code slide without `language` and an
 * image slide without `alt` are both rejected here rather than at render time.
 * `alt` being required is a WCAG 2.1 AA decision that contract makes and this
 * layer inherits without re-litigating.
 */
export const slideBodySchema = z.object({ slide: slideSchema }).strict();

export type SlideBodyInput = z.infer<typeof slideBodySchema>;

/** Change the deck theme. Its own route because the picker changes only this. */
export const themeSchema = z.object({ theme: z.string().min(1).max(50) }).strict();

/**
 * Export request.
 *
 * `pdf` is absent from the enum on purpose: PDF generation in this stack is a
 * client-side Reveal print view, not a server capability, and offering a format
 * the server cannot produce means a 500 the client cannot act on. The two
 * formats here are ones this endpoint can actually assemble from the stored
 * document.
 */
export const exportSchema = z
  .object({
    format: z.enum(["html", "json"]),
    /** Presenter script in the export. Refused for a non-owner by the handler. */
    includeSpeakerNotes: z.boolean().default(false),
  })
  .strict();

export type ExportInput = z.infer<typeof exportSchema>;

/**
 * Submit a deck for an assignment.
 *
 * `studentId` is absent: it comes from the session. Accepting it would let a
 * student submit in a classmate's name, and `presentation_submissions` has
 * UNIQUE(assignment_id, student_id), so that would also silently overwrite the
 * classmate's own submission.
 */
export const submitPresentationSchema = z
  .object({
    assignmentId: z.number().int().positive(),
    presentationId: z.number().int().positive(),
    submissionType: z.enum(["recorded", "live", "document"]).default("recorded"),
    videoUrl: z.string().url().max(500).optional(),
    /** Seconds, matching the column. CHECKed >= 0 in the database. */
    videoDurationSeconds: z.number().int().min(0).max(86_400).optional(),
    presentationDate: z
      .string()
      .datetime({ offset: true })
      .transform((v) => new Date(v))
      .optional(),
    audienceCount: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export type SubmitPresentationInput = z.infer<typeof submitPresentationSchema>;

/**
 * Grade a submission.
 *
 * `score` and `gradedAt` are written together by the handler because
 * `presentation_submissions_grade_consistent` CHECKs that a grade is whole or
 * absent — a partially written grade must not sit in the table looking finished.
 */
export const gradePresentationSchema = z
  .object({
    /** 0-100, CHECKed. */
    score: z.number().int().min(0).max(100),
    feedback: z.string().max(10_000).optional(),
    /** `Record<criterionKey, number>` — same convention as peer_reviews.rubric_scores. */
    rubricScores: z.record(z.string().max(60), z.number()).optional(),
  })
  .strict();

export type GradePresentationInput = z.infer<typeof gradePresentationSchema>;

/** Feedback on a deck, from a peer, an instructor, or the author reflecting. */
export const presentationFeedbackSchema = z
  .object({
    comment: z.string().min(1).max(5_000),
    /** 1-5 stars, or absent — a written comment with no rating is valid. */
    rating: z.number().int().min(1).max(5).optional(),
    category: z.enum(["content", "design", "delivery"]).optional(),
    improvementSuggestions: z.string().max(5_000).optional(),
  })
  .strict();

export type PresentationFeedbackInput = z.infer<typeof presentationFeedbackSchema>;
