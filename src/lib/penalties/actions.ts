"use server";

// =============================================================================
// PENALTY SERVER ACTIONS — owned by the `penalties-attendance` stream.
// -----------------------------------------------------------------------------
// The frozen `ROUTES` map has no penalty endpoint, so issuing and clearing
// penalties happens through server actions. Every action re-checks the caller's
// role server-side; a server action is a public POST target.
// =============================================================================

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/guard";
import { penaltySeverity, penaltyType } from "@/db/schema";
import type { PenaltyDecision } from "@/lib/contracts/events";

import { SEVERITY_DEMERITS } from "./rules";
import { issuePenalties, resolvePenalty } from "./service";

export type PenaltyActionResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

const TYPES: readonly string[] = penaltyType.enumValues;
const SEVERITIES: readonly string[] = penaltySeverity.enumValues;

/**
 * Instructor issues a penalty by hand (the rules cover the automatic cases).
 *
 * `penaltyPoints` is derived from the severity ladder rather than accepted from
 * the form: demerits are the escalation currency, and letting the UI set them
 * arbitrarily would make two instructors' "warnings" weigh differently.
 *
 * `dedupe` is off here: an instructor issuing a second penalty of the same type
 * is making a deliberate judgement, unlike the automatic path where a repeated
 * decision is just the same event being re-processed.
 */
export async function issuePenaltyAction(input: {
  studentId: number;
  type: string;
  severity: string;
  description: string;
}): Promise<PenaltyActionResult> {
  const staff = await requireRole("instructor");

  if (!Number.isInteger(input.studentId) || input.studentId <= 0) {
    return { ok: false, error: "studentId must be a positive integer." };
  }
  if (!TYPES.includes(input.type)) {
    return { ok: false, error: `type must be one of: ${TYPES.join(", ")}.` };
  }
  if (!SEVERITIES.includes(input.severity)) {
    return { ok: false, error: `severity must be one of: ${SEVERITIES.join(", ")}.` };
  }
  const description = input.description.trim();
  if (description.length === 0) {
    return { ok: false, error: "A penalty must say why it was issued." };
  }

  const decision: PenaltyDecision = {
    type: input.type as PenaltyDecision["type"],
    severity: input.severity as PenaltyDecision["severity"],
    description,
    penaltyPoints: SEVERITY_DEMERITS[input.severity as PenaltyDecision["severity"]],
  };

  const rows = await issuePenalties({
    studentId: input.studentId,
    decisions: [decision],
    issuedBy: staff.id,
    dedupe: false,
  });

  revalidatePath("/me/notices");
  return { ok: true, count: rows.length };
}

/**
 * Instructor clears a penalty. Once resolved it stops counting against the
 * student everywhere (see service.resolvePenalty).
 */
export async function resolvePenaltyAction(penaltyId: number): Promise<PenaltyActionResult> {
  const staff = await requireRole("instructor");

  if (!Number.isInteger(penaltyId) || penaltyId <= 0) {
    return { ok: false, error: "penaltyId must be a positive integer." };
  }

  const row = await resolvePenalty(penaltyId, staff.id);
  if (!row) return { ok: false, error: "No such penalty." };

  revalidatePath("/me/notices");
  return { ok: true, count: 1 };
}
