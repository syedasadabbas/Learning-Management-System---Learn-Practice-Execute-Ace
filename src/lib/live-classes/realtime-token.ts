// =============================================================================
// REAL-TIME HANDSHAKE TOKEN — minted by the Next app, verified by the Socket.io
// service in `services/realtime`.
// Owner: the real-time stream.
// -----------------------------------------------------------------------------
// THE PROBLEM THIS SOLVES. The Socket.io service runs on a DIFFERENT HOST from
// the Next app (Railway/Fly/Render — see DEPLOYMENT_LIVE_CLASSES.md). It cannot
// read the Auth.js session cookie: the cookie is scoped to the app's origin, the
// socket connects cross-origin, and even if the browser did send it, the service
// has no access to AUTH_SECRET's session decryption or to the sessions table.
//
// So identity has to travel with the handshake, and the ONE property that makes
// that safe is this: THE CLIENT NEVER NAMES ITS OWN IDENTITY. The browser asks
// the Next app (which does have the session) for a token; the app decides who
// the caller is and which class they may enter, and signs that decision. The
// service trusts the signature, never the socket payload. A client that edits
// `role` to `"instructor"` invalidates the MAC and is rejected at the handshake.
//
// WHY HMAC-SHA256 BY HAND AND NOT A JWT LIBRARY.
// A JWT library would be a new dependency on BOTH sides — the Next app and a
// service whose whole design goal is a small, independently-installable
// dependency set. What a JWT buys over this is `alg` negotiation, JWKS rotation
// and a registered-claim vocabulary, none of which apply to a symmetric secret
// shared between two processes the same team deploys. It also brings the
// `alg: "none"` and algorithm-confusion families of bug with it. Node's `crypto`
// is already present in both runtimes and costs nothing.
//
// TOKEN SHAPE: `<base64url(payload JSON)>.<base64url(HMAC-SHA256 of that exact
// base64url string)>`. The MAC covers the ENCODED payload, not the decoded
// object, so verification never has to re-serialise JSON — canonical-form
// disagreement between two JSON.stringify implementations is a classic way for a
// signature check to become a coin flip.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Roles the service understands.
 *
 * Deliberately a local literal union rather than an import of `UserRole` from
 * `@/lib/guard` (which derives from the Drizzle enum). Two reasons: this type is
 * a WIRE CONTRACT duplicated inside `services/realtime/src/types.ts`, and a wire
 * contract that silently widens when somebody adds a database role is a service
 * that starts accepting a claim it has no authorization rules for. If the enum
 * gains a member, `roleFromDb` below fails to compile and the change is noticed.
 */
export const REALTIME_ROLES = ["student", "instructor", "admin"] as const;
export type RealtimeRole = (typeof REALTIME_ROLES)[number];

/** Claims the service attaches to an authenticated socket. */
export interface RealtimeTokenClaims {
  /** `users.id`. Authoritative — the socket may not override it. */
  userId: number;
  role: RealtimeRole;
  /** `live_classes.id`. A token is valid for EXACTLY ONE class room. */
  classId: number;
  /** Absolute expiry, epoch milliseconds. */
  expiresAtMs: number;
  /**
   * Random per-mint value.
   *
   * NOT a replay defence — nothing stores issued nonces, and within the 120 s
   * window a leaked token is replayable by design (that is why the window is
   * 120 s). It exists so two tokens minted for the same user, class and
   * millisecond are not byte-identical, which keeps a token out of the class of
   * values that can be usefully compared, cached or deduplicated by a proxy.
   */
  nonce: string;
}

/**
 * Default lifetime: 120 seconds.
 *
 * The token is used for ONE thing — the initial WebSocket upgrade — and the
 * socket then lives for the whole class on the strength of that one check. So
 * the window only has to cover "page rendered" to "socket connected", which is
 * one round trip plus retries on a bad mobile connection. 120 s is generous for
 * that and short enough that a token captured from a log or a shared screenshot
 * is worthless before anyone can paste it. It is NOT the session length.
 */
export const REALTIME_TOKEN_TTL_MS = 120_000;

/**
 * Hard ceiling on accepted token length, checked before any parsing.
 *
 * A signature check on attacker-controlled input should never be reached with a
 * megabyte of base64. The real payload is ~120 bytes encoded.
 */
export const REALTIME_TOKEN_MAX_CHARS = 1_024;

/** Why a token was refused. A value, not an exception — see the mail module's argument. */
export type RealtimeTokenFailure =
  /** Not a string, empty, oversized, or not `payload.signature`. */
  | "malformed"
  /** Payload decoded but is not the expected claim shape. */
  | "invalid_claims"
  /** The MAC did not match. Tampering, or the wrong secret. */
  | "bad_signature"
  /** Well-formed and correctly signed, but past `expiresAtMs`. */
  | "expired";

export type RealtimeTokenVerification =
  | { ok: true; claims: RealtimeTokenClaims }
  | { ok: false; reason: RealtimeTokenFailure };

/** Compact wire form of the claims. Short keys because this rides in a URL query. */
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

/**
 * Constant-time comparison of two base64url signatures.
 *
 * `timingSafeEqual` THROWS when the buffers differ in length, which is the trap
 * in every naive use of it — a length mismatch would become a 500 instead of a
 * rejection, and the throw itself leaks length. Compared as UTF-8 bytes of the
 * encoded form, whose length is fixed at 43 chars for SHA-256, so a differing
 * length already means "not our signature" and short-circuiting on it reveals
 * nothing an attacker did not supply themselves.
 */
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
 * Narrow a database role string to a `RealtimeRole`.
 *
 * Returns null for a role the service has no authorization rules for, which the
 * caller must treat as "cannot join" rather than as "student". Defaulting an
 * unknown role to the least-privileged one sounds safe and is not: it silently
 * admits a role nobody reviewed into a live class.
 */
export function roleFromDb(value: string): RealtimeRole | null {
  return isRealtimeRole(value) ? value : null;
}

/**
 * Mint a signed handshake token.
 *
 * `now` and `nonce` are injectable so the tests can assert expiry behaviour
 * without sleeping and so a round-trip test is deterministic. Production callers
 * pass neither.
 *
 * THROWS on an empty secret, and that is deliberate — it is the one failure here
 * that must not be swallowed. An HMAC over the empty string is a perfectly valid
 * MAC that anybody who reads this file can forge, so a missing
 * REALTIME_SHARED_SECRET has to be loud at the mint site rather than producing
 * tokens that "work" in staging.
 */
export function mintRealtimeToken(input: {
  userId: number;
  role: RealtimeRole;
  classId: number;
  secret: string;
  ttlMs?: number;
  now?: number;
  nonce?: string;
}): string {
  if (!input.secret || input.secret.trim().length === 0) {
    throw new Error(
      "REALTIME_SHARED_SECRET is empty. Refusing to mint an unforgeable-in-name-only " +
        "handshake token; set the variable on the Next app and the realtime service to " +
        "the same value (see DEPLOYMENT_LIVE_CLASSES.md).",
    );
  }

  const now = input.now ?? Date.now();
  const ttl = input.ttlMs ?? REALTIME_TOKEN_TTL_MS;
  // 9 bytes -> exactly 12 base64url chars with no padding to strip. 72 bits is
  // far more than enough for a value whose only job is uniqueness within a
  // 120-second window.
  const nonce = input.nonce ?? base64url(randomBytes(9));

  const wire: WireClaims = {
    u: input.userId,
    r: input.role,
    c: input.classId,
    e: now + ttl,
    n: nonce,
  };

  const encoded = base64url(Buffer.from(JSON.stringify(wire), "utf8"));
  return `${encoded}.${sign(encoded, input.secret)}`;
}

/**
 * Verify a token and return its claims.
 *
 * ORDER IS DELIBERATE: shape, then signature, then expiry. Expiry is checked
 * LAST because reading a claim out of an unverified payload and acting on it —
 * even to reject — treats attacker-controlled bytes as facts. Checking the MAC
 * first means the timestamp we compare against is one we ourselves signed.
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
  if (!secret || secret.trim().length === 0) {
    // Same argument as the mint side: with no secret every token verifies
    // against an empty key. Refuse rather than accept.
    return { ok: false, reason: "bad_signature" };
  }

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };
  // Exactly one separator. A second dot means this is a JWT or a mangled value,
  // and guessing which segment we meant is how a parser becomes a vulnerability.
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
    // Reachable only with the correct secret, so this is our own bug or a
    // truncated write — not an attack. Still a rejection.
    return { ok: false, reason: "invalid_claims" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "invalid_claims" };
  }

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
 * The shared secret, read from the environment.
 *
 * Returns null rather than throwing so a caller can distinguish "the feature is
 * not provisioned" (a SUPPORTED state — see src/lib/features.ts) from "minting
 * failed". A route that needs a token and gets null should behave exactly as it
 * does when NEXT_PUBLIC_REALTIME_URL is unset: render the read-only, REST-backed
 * chat history and no socket.
 */
export function realtimeSecretFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env.REALTIME_SHARED_SECRET?.trim();
  return raw && raw.length > 0 ? raw : null;
}
