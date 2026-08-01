// =============================================================================
// SHARED VALIDATION SCHEMAS (Zod)
// -----------------------------------------------------------------------------
// Request/response payload shapes shared across streams. Auth validates login
// bodies with these; quizzes validate submit bodies; etc. Import, don't re-declare.
// Owner: shared-contracts skill (Wave 0).
// =============================================================================
import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  cohortId: z.number().int().positive().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const quizSubmitSchema = z.object({
  quizId: z.number().int().positive(),
  // questionId -> selectedOptionId
  answers: z.array(
    z.object({
      questionId: z.number().int().positive(),
      selectedOptionId: z.number().int().positive(),
    }),
  ).min(1),
});

export const gradeSubmissionSchema = z.object({
  submissionId: z.number().int().positive(),
  score: z.number().int().min(0).max(40).optional(),
  stars: z.number().int().min(1).max(5),
  feedback: z.string().max(4000).optional(),
});

export const profileUpdateSchema = z.object({
  bio: z.string().max(2000).optional(),
  githubProfile: z.string().url().max(255).optional().or(z.literal("")),
  linkedinProfile: z.string().url().max(255).optional().or(z.literal("")),
  avatarUrl: z.string().url().max(500).optional().or(z.literal("")),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type QuizSubmitInput = z.infer<typeof quizSubmitSchema>;
export type GradeSubmissionInput = z.infer<typeof gradeSubmissionSchema>;
