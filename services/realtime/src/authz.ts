// =============================================================================
// EVENT AUTHORIZATION — one table, consulted before every handler runs.
// -----------------------------------------------------------------------------
// THE RULE THIS FILE EXISTS TO ENFORCE: authority comes from the TOKEN CLAIMS,
// never from the event payload, and never from the fact that a client managed to
// emit the event at all. Hiding the "Pin" button from students is a UI courtesy.
// It is not a permission, because a socket is a public API the moment it is
// reachable — anyone with the page open has a console.
//
// WHY A TABLE RATHER THAN AN `if` IN EACH HANDLER.
// A per-handler check is invisible when it is MISSING. A new event added to
// ./schemas.ts with no entry here fails `assertKnownEvent` at wiring time rather
// than defaulting to "allowed", so forgetting is a boot failure and not a
// privilege escalation. That inversion is the whole point.
//
// OWNERSHIP CHECKS ARE NOT HERE. "May this user edit THIS message" depends on a
// row and therefore on the store; it lives in ./handlers/chat.ts beside the read
// that answers it. This file answers only the role question.
// =============================================================================

import type { RealtimeRole, SocketIdentity } from "./types";

/** Every event a client may emit. Keep in step with ./schemas.ts. */
export const CLIENT_EVENTS = [
  "chat:send",
  "chat:edit",
  "chat:delete",
  "chat:pin",
  "chat:typing",
  "chat:react",
  "qa:ask",
  "qa:answer",
  "qa:upvote",
  "qa:pin",
  "qa:resolve",
  "presence:join",
  "presence:leave",
] as const;

export type ClientEvent = (typeof CLIENT_EVENTS)[number];

/**
 * Roles permitted to emit each event.
 *
 * `admin` is included everywhere `instructor` is. That is a deliberate product
 * decision rather than an oversight: an admin in this LMS is a superset of an
 * instructor (src/lib/guard.ts treats it that way for every HTTP route), and a
 * class moderated by an admin who cannot pin a message would be a surprise.
 *
 * NOTE ON `chat:delete`: students appear here because a student may delete their
 * OWN message. The row-level "is it yours" test is in the handler — see the file
 * header. An instructor may delete anyone's, which is also a handler decision.
 */
const PERMITTED: Record<ClientEvent, readonly RealtimeRole[]> = {
  // Anyone in the room can talk, correct their own words, retract them, react,
  // and show a typing indicator.
  "chat:send": ["student", "instructor", "admin"],
  "chat:edit": ["student", "instructor", "admin"],
  "chat:delete": ["student", "instructor", "admin"],
  "chat:typing": ["student", "instructor", "admin"],
  "chat:react": ["student", "instructor", "admin"],

  // MODERATION. Pinning promotes a message to the top of every participant's
  // view for the rest of the class — it is a broadcast privilege, not a personal
  // preference, and a student who could pin could pin anything at any moment.
  "chat:pin": ["instructor", "admin"],

  "qa:ask": ["student", "instructor", "admin"],
  "qa:upvote": ["student", "instructor", "admin"],

  // An "answer" carries institutional weight: the client renders it as THE
  // answer and the question stops being surfaced as open. A student-supplied
  // answer wearing that badge is misinformation with authority.
  "qa:answer": ["instructor", "admin"],
  "qa:pin": ["instructor", "admin"],
  // Resolving closes the thread for everyone, including the asker.
  "qa:resolve": ["instructor", "admin"],

  "presence:join": ["student", "instructor", "admin"],
  "presence:leave": ["student", "instructor", "admin"],
};

/** True when this socket's ROLE may emit this event at all. */
export function mayEmit(event: ClientEvent, identity: SocketIdentity): boolean {
  return PERMITTED[event].includes(identity.role);
}

/** Instructor or admin. The single test the handlers use for moderation powers. */
export function isModerator(identity: SocketIdentity): boolean {
  return identity.role === "instructor" || identity.role === "admin";
}

/**
 * Whether this socket may act on a row authored by `authorId`.
 *
 * A moderator may act on anyone's; everybody else may act only on their own.
 * Exposed as a named function rather than inlined so that "edit", "delete" and
 * any future action cannot drift apart in what they consider ownership.
 */
export function mayActOnAuthored(identity: SocketIdentity, authorId: number): boolean {
  return isModerator(identity) || identity.userId === authorId;
}

/**
 * Whether this socket may act in this class room at all.
 *
 * The token is minted for ONE class id. This check would be redundant if the
 * only way to reach a room were the handshake — but a payload may carry a
 * classId, and the correct response to a mismatch is refusal, not silently using
 * the token's value. Refusing makes a client bug visible; silently correcting it
 * hides a client that thinks it is somewhere it is not.
 */
export function mayActInClass(identity: SocketIdentity, classId: number): boolean {
  return identity.classId === classId;
}

/**
 * Guard used at wiring time: every event registered on the namespace must have a
 * permission entry. Called from ./server.ts, so a missing entry is a boot
 * failure rather than a default-allow.
 */
export function assertEveryEventIsGoverned(): void {
  const missing = CLIENT_EVENTS.filter((event) => !(event in PERMITTED));
  if (missing.length > 0) {
    throw new Error(
      `Events with no authorization rule: ${missing.join(", ")}. ` +
        "Add them to PERMITTED in src/authz.ts. Refusing to start rather than default-allow.",
    );
  }
}
