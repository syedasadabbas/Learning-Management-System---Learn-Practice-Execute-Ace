// =============================================================================
// REGISTRY TESTS — routability, in both directions.
// -----------------------------------------------------------------------------
// The forward direction (a declared kind has a handler) is enforced by the type
// `Record<JobKind, JobHandler>` at compile time, so the runtime test below is a
// backstop against that record being widened to `Record<string, ...>` by a
// future edit — which would turn a compile error into a job that dead-letters in
// production. The reverse direction (a database row naming a kind this build has
// never heard of) is a genuine runtime possibility and is the one that needs
// real coverage.
//
// `@/db` is mocked because importing the registry pulls in the handler, which
// imports the database client — a module that throws at import time when
// DATABASE_URL is unset and opens a connection pool when it is set.
// =============================================================================

import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { registeredKinds, resolveHandler } from "./registry";
import { JOB_KINDS, isJobKind } from "./types";

describe("resolveHandler", () => {
  it("routes every declared kind to a callable handler", () => {
    for (const kind of JOB_KINDS) {
      expect(typeof resolveHandler(kind)).toBe("function");
    }
  });

  it("returns null for a kind this build does not know", () => {
    // The real scenario: a rolled-back deploy, or an old row left behind after a
    // kind was removed. ./drain.ts dead-letters these on the first attempt rather
    // than retrying, because a missing handler is a deploy-shaped fact.
    for (const unknown of ["", "nope", "submission_graded_emai", "SUBMISSION_GRADED_EMAIL"]) {
      expect(resolveHandler(unknown)).toBeNull();
    }
  });

  it("declares exactly the kinds it registers — no orphans in either direction", () => {
    expect(new Set(registeredKinds())).toEqual(new Set(JOB_KINDS));
  });
});

describe("isJobKind", () => {
  it("accepts only the declared kinds, and only as strings", () => {
    expect(isJobKind("submission_graded_email")).toBe(true);
    for (const bad of [null, undefined, 7, {}, ["submission_graded_email"], "other"]) {
      expect(isJobKind(bad)).toBe(false);
    }
  });
});
