import { describe, expect, it } from "vitest";

import {
  assertEveryEventIsGoverned,
  CLIENT_EVENTS,
  isModerator,
  mayActInClass,
  mayActOnAuthored,
  mayEmit,
} from "./authz";
import { EVENT_SCHEMAS } from "./schemas";
import type { RealtimeRole, SocketIdentity } from "./types";

function identity(role: RealtimeRole, userId = 1, classId = 10): SocketIdentity {
  return { userId, role, classId, tokenExpiresAtMs: Date.now() + 60_000 };
}

/** The events a student must never be able to emit, whatever the UI shows. */
const MODERATOR_ONLY = ["chat:pin", "qa:answer", "qa:pin", "qa:resolve"] as const;

describe("mayEmit", () => {
  it.each(MODERATOR_ONLY)("refuses %s from a student", (event) => {
    expect(mayEmit(event, identity("student"))).toBe(false);
  });

  it.each(MODERATOR_ONLY)("permits %s for an instructor", (event) => {
    expect(mayEmit(event, identity("instructor"))).toBe(true);
  });

  it.each(MODERATOR_ONLY)("permits %s for an admin, who is a superset of instructor", (event) => {
    expect(mayEmit(event, identity("admin"))).toBe(true);
  });

  it("permits ordinary participation for every role", () => {
    for (const event of ["chat:send", "chat:typing", "chat:react", "qa:ask", "qa:upvote"] as const) {
      for (const role of ["student", "instructor", "admin"] as const) {
        expect(mayEmit(event, identity(role))).toBe(true);
      }
    }
  });
});

describe("the authorization table and the schema table describe the same events", () => {
  // The failure this catches: an event added to one table and not the other.
  // A schema with no permission entry would be default-denied by mayEmit's
  // lookup returning undefined; a permission with no schema would never validate.
  it("covers every schema-declared event", () => {
    expect([...CLIENT_EVENTS].sort()).toEqual(Object.keys(EVENT_SCHEMAS).sort());
  });

  it("boots rather than default-allowing an ungoverned event", () => {
    expect(() => assertEveryEventIsGoverned()).not.toThrow();
  });
});

describe("mayActOnAuthored", () => {
  it("lets an author act on their own row", () => {
    expect(mayActOnAuthored(identity("student", 5), 5)).toBe(true);
  });

  it("refuses a student acting on somebody else's row", () => {
    expect(mayActOnAuthored(identity("student", 5), 6)).toBe(false);
  });

  it("lets a moderator act on anybody's row", () => {
    expect(mayActOnAuthored(identity("instructor", 5), 6)).toBe(true);
    expect(mayActOnAuthored(identity("admin", 5), 6)).toBe(true);
  });
});

describe("mayActInClass", () => {
  it("pins a socket to the class its token names", () => {
    expect(mayActInClass(identity("instructor", 1, 10), 10)).toBe(true);
    // An instructor of class 10 has no authority in class 11 on this token.
    expect(mayActInClass(identity("instructor", 1, 10), 11)).toBe(false);
    expect(mayActInClass(identity("admin", 1, 10), 11)).toBe(false);
  });
});

describe("isModerator", () => {
  it("is instructor or admin and nothing else", () => {
    expect(isModerator(identity("student"))).toBe(false);
    expect(isModerator(identity("instructor"))).toBe(true);
    expect(isModerator(identity("admin"))).toBe(true);
  });
});
