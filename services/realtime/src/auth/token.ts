// =============================================================================
// HANDSHAKE TOKEN VERIFIER — the service half.
// -----------------------------------------------------------------------------
// !!! THIS IS A DELIBERATE DUPLICATE of the verify half of
// !!! `src/lib/live-classes/realtime-token.ts` in the Next app. Read that file
// !!! first; it carries the full argument for the token's design.
//
// WHY DUPLICATED RATHER THAN SHARED, and the alternatives that were weighed:
//
//   1. Import across the repo (`../../../src/lib/...`). Breaks the one property
//      this service is built for: `services/realtime` must `npm install` and
//      build with only its own directory present, because the Dockerfile copies
//      only this directory and Railway/Fly/Render deploy it as a root. A
//      relative import out of the package is a build that works on a developer's
//      laptop and fails on every host.
//
//   2. Extract to a shared workspace package. That means npm workspaces at the
//      repo root, a root package.json change, and every one of the eight streams
//      currently working this tree rebasing onto a new install layout — for one
//      120-line function with no dependencies beyond node:crypto.
//
//   3. Publish it. There is no registry in this stack.
//
// So: duplicated, ~120 lines, zero dependencies, and pinned by a CONTRACT TEST
// (./token.contract.test.ts) that verifies tokens minted by the app-side vectors
// against this implementation. If the two drift, that test fails rather than
// production silently rejecting every handshake.
//
// THE DUPLICATION HAS A DIRECTION: the Next app's file is canonical. Changes go
// there first and are mirrored here.
// =============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";

import { REALTIME_ROLES, type RealtimeRole } from "../types";

export const REALTIME_TOKEN_MAX_CHARS = 1_024;

export interface RealtimeTokenClaims {
  userId: number;
  role: RealtimeRole;
  classId: number;
  expiresAtMs: number;
  nonce: string;
}

export type RealtimeTokenFailure = "malformed" | "invalid_claims" | "bad_signature" | "expired";

export type RealtimeTokenVerification =
  | { ok: true; claims: RealtimeTokenClaims }
  | { ok: false; reason: RealtimeTokenFailure };

interface WireClaims {
  u: number;
  r: string;
  c: number;
  e: number;
  n: string;
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(encodedPayload: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(encodedPayload).digest());
}

/** Length-guarded because `timingSafeEqual` throws on a length mismatch. */
function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isRealtimeRole(value: unknown): value is RealtimeRole {
  return typeof value === "string" && (REALTIME_ROLES as readonly string[]).includes(value);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Verify a handshake token.
 *
 * Shape, then signature, then expiry — expiry last so the timestamp compared
 * against is one this deployment's secret signed, not attacker-supplied bytes.
 */
export function verifyRealtimeToken(
  token: unknown,
  secret: string,
  now: number = Date.now(),
): RealtimeTokenVerification {
  if (typeof token !== "string") return { ok: false, reason: "malformed" };
  if (token.length === 0 || token.length > REALTIME_TOKEN_MAX_CHARS) {
    return { ok: false, reason: "malformed" };
  }
  if (!secret || secret.trim().length === 0) return { ok: false, reason: "bad_signature" };

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };
  if (token.indexOf(".", dot + 1) !== -1) return { ok: false, reason: "malformed" };

  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  if (!signaturesMatch(signature, sign(encoded, secret))) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64url(encoded).toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_claims" };
  }

  if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "invalid_claims" };

  const wire = parsed as Partial<WireClaims>;
  if (
    !isFiniteInteger(wire.u) ||
    wire.u <= 0 ||
    !isFiniteInteger(wire.c) ||
    wire.c <= 0 ||
    !isFiniteInteger(wire.e) ||
    !isRealtimeRole(wire.r) ||
    typeof wire.n !== "string"
  ) {
    return { ok: false, reason: "invalid_claims" };
  }

  if (now >= wire.e) return { ok: false, reason: "expired" };

  return {
    ok: true,
    claims: { userId: wire.u, role: wire.r, classId: wire.c, expiresAtMs: wire.e, nonce: wire.n },
  };
}

/**
 * Mint a token. PRESENT ONLY FOR THE TESTS in this package, which need to
 * produce valid handshakes without depending on the Next app.
 *
 * Kept in the same file as the verifier rather than in a test helper on purpose:
 * a minter that lives beside the verifier is obviously the same algorithm, and a
 * round-trip test over both is what proves the encoder and decoder agree. It is
 * not exported from the service's entry point and nothing in the running server
 * calls it.
 */
export function mintRealtimeTokenForTests(input: {
  userId: number;
  role: RealtimeRole;
  classId: number;
  secret: string;
  expiresAtMs: number;
  nonce?: string;
}): string {
  const wire: WireClaims = {
    u: input.userId,
    r: input.role,
    c: input.classId,
    e: input.expiresAtMs,
    n: input.nonce ?? "test-nonce",
  };
  const encoded = base64url(Buffer.from(JSON.stringify(wire), "utf8"));
  return `${encoded}.${sign(encoded, input.secret)}`;
}
