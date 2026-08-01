// =============================================================================
// POST /api/classes/:classId/realtime-token  —  "student"
// Feature flag: liveClasses
// Owner: the real-time stream. Path registered in ROUTES (src/lib/contracts/api.ts).
// -----------------------------------------------------------------------------
// THE MISSING HALF OF THE HANDSHAKE. `src/lib/live-classes/realtime-token.ts`
// could mint a token and `services/realtime/src/auth/middleware.ts` could verify
// one, but nothing in `src/` had ever CALLED `mintRealtimeToken`, so the browser
// had no way to obtain the credential the socket service demands and the whole
// real-time layer took its degraded REST path unconditionally. This route is
// that call site and nothing else.
//
// A TOKEN IS A CAPABILITY, NOT A LOOKUP. Once minted, it admits the bearer to
// the class room for the whole session on the strength of one handshake check —
// the socket service re-derives nothing and asks this app nothing ever again. So
// the authorization here is not "may you read this class", it is "may you ENTER
// it", and it has to be at least as strict as /join. It is expressed as a WHERE
// clause (id + joinable status) rather than a fetch followed by an `if`, for the
// reason src/lib/live-classes/access.ts gives: an unmatched row is already the
// 404 path, whereas a forgotten `if` is a silently issued room key.
//
// POST, NOT GET, FOR A READ-SHAPED OPERATION. Minting has no persistent effect,
// which normally argues for GET — but a GET is prefetched by browsers, followed
// by link scanners, and cached by anything between here and the client. A
// credential must never be any of those things, and `POST` is the cheapest way
// to say so that every intermediary already understands.
//
// 404 RATHER THAN 403 for a class the caller may not enter, matching the house
// convention (`featureGate`'s header, and /join): the caller learns nothing
// about which class ids exist or which of them are running.
//
// All durations are milliseconds (house rule: metric units).
// =============================================================================

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { liveClasses } from "@/db/schema.live-classes";
import { featureGate } from "@/lib/feature-guard";
import { apiError, apiGuard, apiOk } from "@/lib/guard";
import { consumeMintAllowance } from "@/lib/live-classes/mint-limiter";
import {
  REALTIME_TOKEN_TTL_MS,
  mintRealtimeToken,
  realtimeSecretFromEnv,
  type RealtimeRole,
} from "@/lib/live-classes/realtime-token";
import { parsePositiveInt } from "@/lib/quizzes/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ classId: string }> };

/**
 * Statuses from which a room may be entered.
 *
 * Deliberately the same pair `canJoin` in src/lib/live-classes/access.ts allows,
 * and deliberately duplicated as a WHERE-clause value rather than reached
 * through that function: `canJoin` decides about a row already in memory, and
 * the whole point here is not to load the row at all unless it is enterable. The
 * two must agree, so if `canJoin` ever admits a third status this array is the
 * other place to change.
 */
const JOINABLE: Array<"scheduled" | "active"> = ["scheduled", "active"];

/**
 * Mint a short-lived Socket.io handshake token for this class.
 *
 * THE ROLE CLAIM IS A CAPABILITY IN THIS ROOM, NOT A COPY OF THE USER'S ROLE.
 * The socket service grants moderation — pinning, answering, deleting other
 * people's messages — to `role: "instructor"`, so handing that claim to every
 * account with the instructor role would let instructor B moderate instructor
 * A's class. It mirrors `mustOwn`/`ownershipFilter` instead: admins are always
 * "admin", an instructor is "instructor" only in a class they own, and everyone
 * else — students, and instructors visiting a colleague's session — is
 * "student". The comparison is evaluated in the SELECT rather than after it, so
 * the elevated claim is derived from the same statement that authorized the
 * mint and cannot drift from it.
 *
 * @param ctx path: `classId`
 * @returns 200 `{ token, expiresAtMs, expiresInMs, role, namespace }`.
 *          `expiresAtMs` is absolute so a client can refresh BEFORE the lapse
 *          rather than discovering it as a failed handshake; `expiresInMs` is
 *          beside it because a browser with a skewed clock can trust a duration
 *          when it cannot trust an instant.
 * @throws 404 flag off, no such class, or a class that cannot be entered
 * @throws 401 not signed in
 * @throws 400 `classId` is not a positive integer
 * @throws 429 too many mints for this user
 * @throws 503 REALTIME_SHARED_SECRET is not configured — the service is not
 *          provisioned, which src/lib/features.ts calls a SUPPORTED state. The
 *          client treats it as "no token" and stays on the REST path.
 */
export async function POST(_request: Request, ctx: Ctx): Promise<Response> {
  const off = featureGate("liveClasses");
  if (off) return off;

  const gate = await apiGuard("student");
  if (!gate.ok) return gate.response;

  const classId = parsePositiveInt((await ctx.params).classId);
  if (classId === null) {
    return apiError(400, "classId must be a positive integer.", "invalid_id");
  }

  // The secret is read BEFORE the query. A deployment with no secret can never
  // answer this route successfully, so spending a database round trip to reach
  // the same 503 is pure cost on the one path that is hit repeatedly by a hook
  // retrying against an unprovisioned service.
  const secret = realtimeSecretFromEnv();
  if (secret === null) {
    return apiError(
      503,
      "Live updates are not available for this deployment.",
      "realtime_unavailable",
    );
  }

  // Bounded because the hook re-mints on every reconnect; see mint-limiter.ts.
  const allowance = consumeMintAllowance(gate.user.id, Date.now());
  if (!allowance.allowed) {
    return apiError(
      429,
      `Too many connection attempts. Try again in ${allowance.retryAfterMs} ms.`,
      "rate_limited",
    );
  }

  // AUTHORIZATION IS THIS WHERE CLAUSE. No row means one of: no such class, or a
  // class that has ended or been cancelled. All three answer 404 — see the
  // header on why they are deliberately indistinguishable.
  const [cls] = await db
    .select({
      id: liveClasses.id,
      // Evaluated by Postgres inside the authorizing statement, so ownership and
      // admission are decided together and cannot disagree.
      owns: sql<boolean>`${liveClasses.instructorId} = ${gate.user.id}`,
    })
    .from(liveClasses)
    .where(and(eq(liveClasses.id, classId), inArray(liveClasses.status, JOINABLE)))
    .limit(1);

  if (!cls) return apiError(404, "Class not found.", "not_found");

  const role: RealtimeRole =
    gate.user.role === "admin" ? "admin" : cls.owns && gate.user.role === "instructor"
      ? "instructor"
      : "student";

  const now = Date.now();
  const token = mintRealtimeToken({ userId: gate.user.id, role, classId, secret, now });

  return apiOk({
    token,
    expiresAtMs: now + REALTIME_TOKEN_TTL_MS,
    expiresInMs: REALTIME_TOKEN_TTL_MS,
    role,
    // Echoed so the client does not hardcode a second copy of the namespace the
    // service registers. `use-realtime.ts` exports `REALTIME_NAMESPACE` for the
    // same value; this is the authoritative one when the two ever differ.
    namespace: "/classes",
  });
}
