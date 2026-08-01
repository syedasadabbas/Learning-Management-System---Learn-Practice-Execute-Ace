"use server";

// =============================================================================
// ATTENDANCE SERVER ACTIONS — owned by the `penalties-attendance` stream.
// -----------------------------------------------------------------------------
// The frozen `ROUTES` map has no attendance endpoint, so the instructor UI talks
// to the database through these server actions instead of fetch(). Each one
// re-checks authorization server-side: a server action is a public POST target,
// so trusting the client that rendered the button would be an open door.
// =============================================================================

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/guard";
import { POINTS } from "@/lib/contracts/scoring";

import { recordAttendanceAndSync } from "./service";

export type MarkAttendanceResult =
  | { ok: true; attended: boolean; participationPoints: number; rationale: string }
  | { ok: false; error: string };

/**
 * Instructor marks (or corrects) one student's attendance for one lecture and
 * gets that week's recomputed participation points back.
 *
 * Re-marking the same (studentId, lectureId) updates the existing row — the
 * unique index makes that the only correct behaviour.
 */
export async function markAttendanceAction(input: {
  studentId: number;
  lectureId: number;
  weekId: number;
  attended: boolean;
  participationScore?: number;
}): Promise<MarkAttendanceResult> {
  await requireRole("instructor");

  if (
    !Number.isInteger(input.studentId) ||
    !Number.isInteger(input.lectureId) ||
    !Number.isInteger(input.weekId)
  ) {
    return { ok: false, error: "studentId, lectureId and weekId must be integers." };
  }

  const score = input.participationScore ?? 0;
  if (!Number.isFinite(score) || score < 0 || score > POINTS.PARTICIPATION_MAX) {
    return {
      ok: false,
      error: `participationScore must be between 0 and ${POINTS.PARTICIPATION_MAX}.`,
    };
  }

  const { participation } = await recordAttendanceAndSync({
    studentId: input.studentId,
    lectureId: input.lectureId,
    weekId: input.weekId,
    attended: input.attended,
    participationScore: score,
  });

  revalidatePath("/attendance");

  return {
    ok: true,
    attended: input.attended,
    participationPoints: participation.points,
    rationale: participation.rationale,
  };
}
