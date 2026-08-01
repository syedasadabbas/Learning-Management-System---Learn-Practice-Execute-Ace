// =============================================================================
// The wiring plan is DATA, so it can be checked. This is the check.
//
// A prose TODO listing "hook into all API endpoints that modify data" cannot fail
// when a route is renamed, so it drifts in the direction of looking done. Keying the
// plan on the frozen route map and asserting against it means the plan cannot
// describe a codebase that no longer exists — the same argument the nav-href check
// in tests/unit/cross-stream-contracts.test.ts makes about hand-kept allowlists.
// =============================================================================

import { describe, it, expect } from "vitest";

import { ROUTES, ROUTE_AUTH } from "@/lib/contracts/api";

import { ACTION_META, ACTIVITY_ACTIONS } from "./actions";
import { isForbiddenDetailKey } from "./redact";
import { HOOK_POINTS, hookPointsForRoute, hookedRoutes, unwiredActions } from "./hook-points";

describe("every hook point names a route that exists", () => {
  it("is not empty, so the assertions below are not vacuous", () => {
    expect(HOOK_POINTS.length).toBeGreaterThan(10);
  });

  it.each(HOOK_POINTS.map((h) => [h.route, h.action] as const))(
    "%s -> %s",
    (route) => {
      expect(Object.keys(ROUTES)).toContain(route);
    },
  );

  it("every hooked route is classified for authorization", () => {
    // A route that emits an audit row but has no ROUTE_AUTH entry would be a route
    // that never checked who the actor was.
    for (const route of hookedRoutes()) {
      expect(ROUTE_AUTH[route], route).toBeDefined();
    }
  });
});

describe("every hook point names a real action with sane instructions", () => {
  it.each(HOOK_POINTS.map((h) => [h.action, h.route] as const))(
    "%s is in the enum",
    (action) => {
      expect(ACTIVITY_ACTIONS).toContain(action);
    },
  );

  it("every entityType is a slug the filter parser accepts", () => {
    // filter.ts validates ?entityType= against /^[a-z0-9_]{1,50}$/. A hook point
    // instructing a call site to write "Submission" would produce rows that the
    // admin UI could never filter for.
    for (const hook of HOOK_POINTS) {
      expect(hook.entityType, `${hook.route} -> ${hook.action}`).toMatch(/^[a-z0-9_]{1,50}$/);
    }
  });

  it("no `details` key would be silently dropped by the redactor", () => {
    // The plan must not instruct an implementer to record something this feature
    // then throws away — that is how a call site looks wired and records nothing.
    for (const hook of HOOK_POINTS) {
      for (const key of hook.details) {
        expect(isForbiddenDetailKey(key), `${hook.action}.details.${key}`).toBe(false);
      }
    }
  });

  it("a critical action is never planned as a fire-and-forget write", () => {
    // recordActivityDetached refuses critical actions at runtime; this asserts the
    // PLAN agrees, so a stream owner reading their hook point is not being told to
    // do something the API will reject.
    for (const hook of HOOK_POINTS) {
      if (ACTION_META[hook.action].significance === "critical" && !hook.inTransaction) {
        // Allowed, but only with an explicit note explaining the ordering — see the
        // login hook, where the act is not a database transaction at all.
        expect(hook.note, `${hook.action} at ${hook.route}`).toBeTruthy();
      }
    }
  });
});

describe("coverage is reported honestly", () => {
  it("names the actions that have no call site yet", () => {
    // An audit trail whose coverage is unknown invites false confidence in a gap.
    // This asserts the reporting function works, not that coverage is complete —
    // it deliberately is not, and the admin page says so on screen.
    const unwired = unwiredActions();
    expect(Array.isArray(unwired)).toBe(true);
    // The three self-emitted actions must NOT be reported as unwired: this stream
    // owns their call sites.
    expect(unwired).not.toContain("activity_export");
    expect(unwired).not.toContain("activity_pruned");
    expect(unwired).not.toContain("activity_export_denied");
  });

  it("reports the staff acts whose call sites are server actions, not routes", () => {
    // role_change and report_export are LISTED in HOOK_POINTS against a placeholder
    // route, so they are not "unwired" — but the note must flag the placeholder,
    // because an implementer who trusts the route field would edit the wrong file.
    for (const action of ["role_change", "report_export"] as const) {
      const hooks = HOOK_POINTS.filter((h) => h.action === action);
      expect(hooks.length, action).toBeGreaterThan(0);
      expect(hooks[0].note).toContain("PLACEHOLDER");
    }
  });

  it("hookPointsForRoute finds the two identity hooks on the login route", () => {
    // One route legitimately emits two actions (login and login_failed), which is
    // why the plan is a list and not a map.
    const hooks = hookPointsForRoute("POST /api/auth/login");
    expect(hooks.map((h) => h.action).sort()).toEqual(["login", "login_failed"]);
  });
});
