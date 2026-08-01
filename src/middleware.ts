// =============================================================================
// EDGE MIDDLEWARE — authenticated route groups. Owned by the auth stream.
// -----------------------------------------------------------------------------
// LOCATION: this file MUST live at src/middleware.ts, not at the repository root.
// Next.js looks for middleware next to the app directory, and this project's app
// directory is src/app. A root-level middleware.ts is silently ignored — every
// protected route stayed reachable and no error was reported. Verified by e2e:
// /dashboard only redirects an anonymous visitor with the file here.
//
// WHY THIS DOES NOT IMPORT src/lib/auth.ts
//
// Middleware runs on the edge runtime. `src/lib/auth.ts` pulls in `pg` (TCP
// sockets) and `bcryptjs`, neither of which exists there, so importing `auth()`
// here fails the build. The usual workaround is a second, database-free
// "auth.config.ts" — but the JWT already contains everything an authorization
// decision needs, so this file verifies the token directly with
// `next-auth/jwt`'s getToken (pure `jose`, edge-safe) and reads the SAME frozen
// ROLES_SATISFYING table that src/lib/guard.ts uses.
//
// This is cryptographic verification, not a cookie-presence sniff: a forged or
// tampered cookie fails to decrypt and is treated as no session.
//
// DEFENCE IN DEPTH, not the only defence. Middleware is a fast reject at the
// edge; src/lib/guard.ts re-checks on the server for every page and route
// handler. A route that forgets to call the guard is still a bug — middleware
// covers path prefixes, and a page added under an unlisted prefix would slip
// through the matcher.
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { ROLES_SATISFYING, type ApiErr, type RouteAuth } from "@/lib/contracts/api";
// Pure, no database and no next/headers — safe on the edge runtime. It reads
// NAV_LINKS, which is itself client-safe (type-only schema import).
import { redirectForPage } from "@/lib/navigation/role-access";

/**
 * Path prefixes that require a session, with the ROUTE_AUTH level each needs.
 * Longest prefix wins, so "/api/instructor" is evaluated before "/api".
 *
 * Mirrors ROUTE_AUTH in src/lib/contracts/api.ts. API paths are copied straight
 * from that map; page paths are the UI surfaces the owning streams are building.
 * When a stream adds a protected page group, it belongs here AND behind a
 * requireRole() call in the page itself.
 */
type ProtectedPrefix = { prefix: string; required: RouteAuth };

const PROTECTED: ReadonlyArray<ProtectedPrefix> = ([
  // --- staff-only (checked first by length; see sorting below) --------------
  { prefix: "/admin", required: "admin" },
  { prefix: "/api/admin", required: "admin" },
  { prefix: "/instructor", required: "instructor" },
  { prefix: "/api/instructor", required: "instructor" },
  // POST /api/assignments/:id/ingest is ROUTE_AUTH "instructor".
  { prefix: "/api/assignments", required: "instructor" },

  // --- signed-in ("student" in ROUTE_AUTH means any role) ------------------
  { prefix: "/dashboard", required: "student" },
  { prefix: "/weeks", required: "student" },
  { prefix: "/lectures", required: "student" },
  { prefix: "/quizzes", required: "student" },
  { prefix: "/leaderboard", required: "student" },
  // The submissions stream ships its pages at /assignments, not /submissions —
  // (app)/course/[weekId]/assignment in its SKILL.md belongs to course-content's
  // segment. Without this row the edge did not gate them at all and requireUser()
  // inside each page was the only enforcement.
  { prefix: "/assignments", required: "student" },
  // Staff-facing attendance grid (penalties-attendance stream). "instructor"
  // rather than "student": ROLES_SATISFYING.instructor is ["instructor","admin"],
  // so a student is refused at the edge instead of reaching the page.
  { prefix: "/attendance", required: "instructor" },
  { prefix: "/practice", required: "student" },
  { prefix: "/profile", required: "student" },
  // Course catalog and the per-course gate (courses/access-requests stream).
  // Only "signed in" at the edge: whether THIS student may open THAT course
  // depends on a row in `course_access_requests`, which the edge runtime cannot
  // query — the same limitation this table already records for /exams above.
  // `decideCourseAccess` in src/lib/courses/policy.ts makes the real decision
  // inside the page, and both /courses pages call requireUser() regardless.
  { prefix: "/courses", required: "student" },
  // Add-on wave. All three are "signed in" at the edge and re-check inside the
  // page, which is this table's documented rule rather than laziness: middleware
  // matches on path PREFIX and cannot know which student owns which row.
  //
  // /certificates is the one worth reading twice. A certificate is a credential,
  // so the real gate is the ownership predicate in the SQL
  // (getOwnCertificateById(id, studentId)) — there is deliberately no
  // fetch-by-id-then-compare for a later caller to reach for, and a non-owner gets
  // 404 rather than 403 so sequential ids reveal nothing. The edge row here only
  // keeps anonymous traffic out.
  //
  // NOT LISTED: /verify/[code]. The public verification page must be reachable
  // with no session — that is its whole purpose — and it is keyed on 128 bits of
  // randomBytes rather than the row id, so it is unguessable rather than merely
  // unlisted. Leaving it outside this table is what avoids needing a hole in it.
  { prefix: "/notifications", required: "student" },
  { prefix: "/certificates", required: "student" },
  { prefix: "/api/certificates", required: "student" },
  { prefix: "/badges", required: "student" },
  { prefix: "/api/courses", required: "student" },
  { prefix: "/api/weeks", required: "student" },
  { prefix: "/api/lectures", required: "student" },
  { prefix: "/api/quizzes", required: "student" },
  { prefix: "/api/leaderboard", required: "student" },
  { prefix: "/api/me", required: "student" },
  { prefix: "/api/auth/logout", required: "student" },
  { prefix: "/api/auth/me", required: "student" },

  // --- add-on wave ---------------------------------------------------------
  // Each of these is ALSO guarded inside its own page or handler. These rows are
  // defence in depth, not the only control — three add-on streams shipped
  // correctly guarded routes that the edge did not know about, which is one layer
  // short of the pattern used everywhere else in this table.
  { prefix: "/settings", required: "student" },
  // Runs student-supplied source; anonymous access would be an open keyless
  // code-execution proxy, so it is rejected at the edge as well as in the handler.
  { prefix: "/api/execute", required: "student" },
  // Exam pages and API. Note this is only "signed in" — the one-attempt rule and
  // the week-unlock gate are enforced in the handlers and by a unique index, not
  // here. The edge cannot express "has not already sat this exam".
  { prefix: "/exams", required: "student" },
  { prefix: "/api/exams", required: "student" },
  { prefix: "/problems", required: "student" },
  { prefix: "/interview", required: "student" },
  { prefix: "/api/problems", required: "student" },
  { prefix: "/learn", required: "student" },
  { prefix: "/api/learn", required: "student" },
  // Discussion forums (forums stream). Only "signed in" at the edge, and that is
  // the ceiling rather than a shortcut: whether THIS student may read week N's
  // threads depends on the section-release switch and their own quiz progress,
  // which the edge runtime cannot query — the same limitation this table already
  // records for /exams above and for /courses below. `gateWeek` makes the real
  // decision inside each page (src/lib/forums/access.ts), every page calls
  // requireForumUser() regardless, and every mutating server action re-runs the
  // same gate. There is no /api/forums prefix because this stream ships no API
  // routes: its mutations are server actions, which POST to the page's own path
  // and are therefore already covered by this row. See src/lib/forums/actions.ts
  // for why (the frozen ROUTES map lists no forum endpoint).
  { prefix: "/forums", required: "student" },
  // Account self-service. The two reset endpoints under this prefix are
  // deliberately public and are exempted in ALWAYS_ALLOWED below — a user who
  // cannot sign in is precisely the user who needs them.
  { prefix: "/api/account", required: "student" },
  // Certificates. The gallery page and both API routes; each is ALSO guarded in
  // its own handler (requireRole / apiGuard) and the download additionally scopes
  // its SQL to the caller's own id, which is the control that matters — the edge
  // cannot express "this certificate belongs to you".
  //
  // NOTE THAT THE PUBLIC VERIFICATION PAGE IS NOT UNDER EITHER PREFIX. It is at
  // /verify/:code precisely so that no ALWAYS_ALLOWED exemption is needed to
  // punch a hole in a protected prefix; see the header of
  // src/app/verify/[code]/page.tsx.
  { prefix: "/certificates", required: "student" },
  { prefix: "/api/certificates", required: "student" },
] satisfies ProtectedPrefix[])
  // Longest prefix first: "/api/instructor/..." must not be matched by a shorter
  // sibling that happens to appear earlier in the literal above.
  .slice()
  .sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Paths that must stay reachable without a session even though a prefix above
 * would otherwise cover them. `/api/auth/**` is Auth.js's own flow plus the
 * public register/login endpoints; `/api/cron/**` is guarded by requireCron()
 * inside the handler because no user session can ever satisfy ROUTE_AUTH "cron"
 * (ROLES_SATISFYING.cron is empty).
 */
const ALWAYS_ALLOWED = [
  "/api/auth/",
  "/api/cron/",
  "/login",
  "/register",
  // --- add-on wave: the password-recovery path -----------------------------
  // These sit under the "/api/account" and page prefixes above, so without these
  // exemptions the edge would redirect a signed-OUT user away from the only
  // routes that can get them back in — locking out exactly the person the feature
  // exists for. Both are ROUTE_AUTH "public" by explicit, reviewed choice: they
  // are rate-limited per email and per IP, and the request endpoint returns one
  // identical response for known and unknown addresses, so exposure leaks no
  // membership information.
  "/api/account/reset-request",
  "/api/account/reset-confirm",
  "/forgot-password",
  "/reset-password",
  // The dev-only outbox that exposes the reset link so the flow can be tested
  // end-to-end. Exempted for the same reason as the two routes above: the flow
  // under test is one a signed-OUT user performs, so requiring a session here
  // would make the recovery path unverifiable.
  //
  // TRADE-OFF, stated rather than hidden: this is a route that returns other
  // people's reset links. It is double-gated in its own handler — it 404s unless
  // NODE_ENV === "development" AND SMTP is unset — so it cannot exist in a
  // production build. Do not run a development build on a host students can
  // reach. The alternative was an unverifiable reset flow, which is worse.
  "/api/account/dev-outbox",
];

function matchRequirement(pathname: string): RouteAuth | null {
  if (ALWAYS_ALLOWED.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))) {
    // /api/auth/logout and /api/auth/me are guarded inside their handlers via
    // apiGuard("student"); letting them past the edge keeps Auth.js's own
    // endpoints (session, csrf, callback) working.
    return null;
  }
  for (const entry of PROTECTED) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      return entry.required;
    }
  }
  return null;
}

export default async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const required = matchRequirement(pathname);
  if (!required) return NextResponse.next();

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Fail closed. Without the secret no token can be verified, and treating
    // that as "allow" would open every protected route at once.
    return deny(request, required, pathname + search, 503, "Auth is not configured.");
  }

  // Auth.js v5 cookie names. The __Secure- prefix is only valid over HTTPS.
  const useSecureCookie = request.nextUrl.protocol === "https:";
  const cookieName = `${useSecureCookie ? "__Secure-" : ""}authjs.session-token`;

  const token = await getToken({
    req: request,
    secret,
    // In v5 the encryption salt IS the cookie name; passing a different value
    // silently fails to decrypt every token.
    salt: cookieName,
    cookieName,
    secureCookie: useSecureCookie,
  });

  if (!token) {
    return deny(request, required, pathname + search, 401, "Not signed in.");
  }

  const role = typeof token.role === "string" ? token.role : undefined;
  if (!role || !ROLES_SATISFYING[required].includes(role)) {
    return deny(
      request,
      required,
      pathname + search,
      403,
      "You do not have access to this resource.",
      true,
    );
  }

  // ROLE-APPROPRIATE VIEW. The check above answers "may this role be here?";
  // ROLES_SATISFYING.student is ["student","instructor","admin"], so for every
  // student page the answer for staff is yes — which is why an admin opening
  // /assignments got the student's list, and why an instructor signing in landed on
  // the student /dashboard (AFTER_LOGIN_PATH is one constant for all roles). This
  // second question is "is this the right view FOR this role?", and the answer is a
  // redirect to the staff equivalent rather than a refusal. Table and reasoning in
  // src/lib/navigation/role-access.ts.
  //
  // GET ONLY, and this is load-bearing rather than cautious: a server action is a
  // POST to its own page's path, and forum moderation is implemented as exactly
  // that — there are no forum endpoints in the frozen ROUTES map. Redirecting a
  // POST here would discard an instructor's moderation action silently. HEAD is
  // included because a HEAD is a document request too.
  if (request.method === "GET" || request.method === "HEAD") {
    const destination = redirectForPage(role, pathname);
    if (destination) {
      const url = request.nextUrl.clone();
      url.pathname = destination;
      // The query belonged to the page being left; carrying a student page's
      // filters onto a staff screen would apply them to different data.
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

/**
 * API paths get the frozen ApiResult envelope with a real status code; page
 * paths get a redirect to /login. Redirecting a fetch() caller to an HTML login
 * page produces a confusing 200-with-HTML that no JSON client can handle.
 */
function deny(
  request: NextRequest,
  _required: RouteAuth,
  next: string,
  status: number,
  message: string,
  forbidden = false,
): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const body: ApiErr = {
      ok: false,
      error: message,
      code: status === 403 ? "forbidden" : status === 503 ? "misconfigured" : "unauthenticated",
    };
    return NextResponse.json(body, { status });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (forbidden) {
    url.searchParams.set("error", "forbidden");
  }
  url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * Everything except Next.js internals and static assets. The prefix table
   * above decides what is actually protected; keeping the matcher broad means a
   * newly added protected prefix needs one edit, not two.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
