// =============================================================================
// API ROUTE CONTRACT (frozen)
// -----------------------------------------------------------------------------
// Next.js App Router route handlers. Each stream owns the routes under its
// prefix and MUST NOT change another stream's paths. Response envelope is shared.
// Owner: shared-contracts skill (Wave 0).
// =============================================================================

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; code?: string };
export type ApiResult<T> = ApiOk<T> | ApiErr;

// Route map — the seam between streams. Path -> owning skill.
export const ROUTES = {
  // auth skill
  "POST /api/auth/register": "auth",
  "POST /api/auth/login": "auth",
  "POST /api/auth/logout": "auth",
  "GET  /api/auth/me": "auth",

  // course-content skill
  "GET  /api/courses": "course-content",
  "GET  /api/weeks/:weekId": "course-content",
  "GET  /api/weeks/:weekId/lectures": "course-content",
  "GET  /api/lectures/:lectureId": "course-content",

  // quizzes skill
  "GET  /api/weeks/:weekId/quiz": "quizzes",
  "POST /api/quizzes/:quizId/submit": "quizzes",
  "GET  /api/quizzes/:quizId/attempts": "quizzes",

  // progress-tracking skill
  "GET  /api/me/progress": "progress-tracking",
  "GET  /api/me/dashboard": "progress-tracking",

  // leaderboard skill
  "GET  /api/leaderboard": "leaderboard",
  "GET  /api/leaderboard/me": "leaderboard",

  // submissions skill
  "GET  /api/weeks/:weekId/assignment": "submissions",
  // Manual re-ingest of one assignment's Google Sheet, triggered by staff.
  "POST /api/assignments/:assignmentId/ingest": "submissions",
  // Scheduled sweep of every active assignment. A cron job cannot fill in a
  // path parameter, so ingestion needs this parameterless entrypoint as well.
  "POST /api/cron/ingest-submissions": "submissions",
  "GET  /api/me/submissions": "submissions",

  // instructor-admin skill
  "GET  /api/instructor/submissions": "instructor-admin",
  "POST /api/instructor/submissions/:id/grade": "instructor-admin",
  "GET  /api/instructor/students": "instructor-admin",
  "GET  /api/instructor/analytics": "instructor-admin",

  // =========================================================================
  // ADD-ON WAVE. Declared here, once, by the contracts owner — NOT by the
  // streams that implement them.
  //
  // Three streams independently reported needing routes that this map did not
  // list, and each guarded its handler correctly anyway. That works, but it
  // defeats the point of the map: an unlisted route has no ROUTE_AUTH entry, so
  // the Record<RouteKey, RouteAuth> exhaustiveness check cannot notice a route
  // that forgot to authorize itself. Listing them restores that compile-time
  // check for every add-on path, including ones not yet written.
  // =========================================================================

  // code-execution skill
  "POST /api/execute": "code-execution",

  // account skill — self-service profile, password, and reset.
  "GET  /api/account/profile": "account",
  "PATCH /api/account/profile": "account",
  "POST /api/account/password": "account",
  "POST /api/account/reset-request": "account",
  "POST /api/account/reset-confirm": "account",

  // grand-quiz skill — the one-attempt, 120-minute weekly exam.
  "POST /api/exams/:weekId/start": "grand-quiz",
  "POST /api/exams/:attemptId/answer": "grand-quiz",
  "POST /api/exams/:attemptId/submit": "grand-quiz",
  "GET  /api/exams/:attemptId": "grand-quiz",
  // Safety-net sweeper for attempts whose deadline passed with the browser
  // closed. Lazy finalize on read and the client auto-submitter cover the normal
  // cases; this exists because neither runs if the student never comes back.
  "POST /api/cron/finalize-exams": "grand-quiz",

  // coding-problems skill — practice + interview banks.
  "GET  /api/problems": "coding-problems",
  "GET  /api/problems/:slug": "coding-problems",
  "POST /api/problems/:slug/attempt": "coding-problems",

  // interactive-learning skill
  "POST /api/learn/steps/:stepId/complete": "interactive-learning",

  // async-queues skill — the outbound-notification job queue.
  // Added at integration by the coordinator's decision, not unilaterally by the
  // implementing stream: both handlers were already guarded (`requireCron` and
  // `apiGuard("admin")`), so enforcement does not change. What changes is that the
  // map stops omitting two live routes, which is the only way its
  // `Record<RouteKey, RouteAuth>` exhaustiveness check can do its job.
  //
  // The drain endpoint is parameterless for the same reason the two sweepers above
  // are: a scheduler cannot fill in a path parameter.
  "POST /api/cron/drain-jobs": "async-queues",
  "GET  /api/admin/jobs": "async-queues",
  "POST /api/admin/jobs": "async-queues",

  // activity-logs skill — the audit trail's own read and maintenance surfaces.
  // Added here for the reason the async-queues block above states: all three
  // handlers already take their level from `apiGuard`/`requireCron`, so nothing
  // about enforcement changes, but an UNLISTED route has no ROUTE_AUTH entry and
  // therefore cannot be caught by the `Record<RouteKey, RouteAuth>` exhaustiveness
  // check. For an audit feature that is a particularly bad omission: the routes
  // that read and delete the trail are exactly the ones a reviewer will look for in
  // this map.
  //
  // There is deliberately NO route that WRITES a log entry. Entries are written
  // only by server-side code holding the actor from a guard; an endpoint accepting
  // a hand-made row would make the trail forgeable. See src/lib/activity/record.ts.
  "GET  /api/admin/activity": "activity-logs",
  "GET  /api/admin/activity/export": "activity-logs",
  "POST /api/cron/prune-activity": "activity-logs",

  // =========================================================================
  // LEARNING-ENHANCEMENT WAVE. Added by the API stream following the stated
  // convention of this file: verb + padded space + path, dynamic segments as
  // `:name`, grouped by owning skill, and a matching ROUTE_AUTH entry below for
  // every key — the `Record<RouteKey, RouteAuth>` exhaustiveness check is the
  // only mechanical guarantee that a new route did not forget to authorize
  // itself, and it only works for routes that are listed.
  //
  // EVERY route in the three blocks below is additionally behind a FEATURE FLAG
  // (`featureGate` from src/lib/feature-guard.ts), which this map cannot express.
  // The flag is checked BEFORE the auth level named here, so a route whose flag
  // is off answers 404 to everyone regardless of what this table says. The flag
  // per block: learningEnhancements, liveClasses, presentations.
  // =========================================================================

  // --- learning enhancements: samples, practice, interview, visualizations ---
  "GET  /api/assignments/:assignmentId/samples": "learning-enhancements",
  "POST /api/assignments/:assignmentId/samples": "learning-enhancements",
  "GET  /api/assignments/:assignmentId/samples/:sampleId": "learning-enhancements",
  "PUT  /api/assignments/:assignmentId/samples/:sampleId": "learning-enhancements",
  "DELETE /api/assignments/:assignmentId/samples/:sampleId": "learning-enhancements",

  "GET  /api/lectures/:lectureId/practice-problems": "learning-enhancements",
  "POST /api/lectures/:lectureId/practice-problems": "learning-enhancements",
  "GET  /api/practice-problems/:problemId": "learning-enhancements",
  "PUT  /api/practice-problems/:problemId": "learning-enhancements",
  "DELETE /api/practice-problems/:problemId": "learning-enhancements",
  "POST /api/practice-problems/:problemId/attempt": "learning-enhancements",
  "GET  /api/practice-problems/:problemId/hints": "learning-enhancements",
  "GET  /api/practice-problems/:problemId/solution": "learning-enhancements",

  "GET  /api/interview-questions": "learning-enhancements",
  "POST /api/interview-questions": "learning-enhancements",
  "GET  /api/interview-questions/:questionId": "learning-enhancements",
  "PUT  /api/interview-questions/:questionId": "learning-enhancements",
  "DELETE /api/interview-questions/:questionId": "learning-enhancements",

  "GET  /api/lectures/:lectureId/visualizations": "learning-enhancements",
  "POST /api/lectures/:lectureId/visualizations": "learning-enhancements",
  "GET  /api/visualizations/:visualizationId": "learning-enhancements",
  "PUT  /api/visualizations/:visualizationId": "learning-enhancements",
  "DELETE /api/visualizations/:visualizationId": "learning-enhancements",

  // --- live classes ---------------------------------------------------------
  "GET  /api/classes": "live-classes",
  "POST /api/classes": "live-classes",
  // Parameterless sibling of the list, for the same reason the cron sweepers are:
  // "upcoming" is scoped by the CALLER's role and cohort, not by a path segment,
  // so it cannot be expressed as a filter value a client supplies.
  "GET  /api/classes/upcoming": "live-classes",
  "GET  /api/classes/:classId": "live-classes",
  "PUT  /api/classes/:classId": "live-classes",
  "DELETE /api/classes/:classId": "live-classes",
  "POST /api/classes/:classId/start": "live-classes",
  "POST /api/classes/:classId/end": "live-classes",
  "GET  /api/classes/:classId/join": "live-classes",
  "POST /api/classes/:classId/leave": "live-classes",
  "GET  /api/classes/:classId/recording": "live-classes",
  "PUT  /api/classes/:classId/recording": "live-classes",
  // The Socket.io handshake credential. POST despite having no persistent
  // effect, because a credential must not be prefetched, followed or cached;
  // see the handler's header.
  "POST /api/classes/:classId/realtime-token": "live-classes",
  "GET  /api/classes/:classId/attendance": "live-classes",
  "PATCH /api/classes/:classId/attendance/:studentId": "live-classes",
  "GET  /api/classes/:classId/chat": "live-classes",
  "POST /api/classes/:classId/chat": "live-classes",
  "PATCH /api/classes/:classId/chat/:messageId": "live-classes",
  "DELETE /api/classes/:classId/chat/:messageId": "live-classes",
  "GET  /api/classes/:classId/qa": "live-classes",
  "POST /api/classes/:classId/qa": "live-classes",
  "PATCH /api/classes/:classId/qa/:questionId": "live-classes",
  "POST /api/classes/:classId/qa/:questionId/answer": "live-classes",
  "POST /api/classes/:classId/qa/:questionId/upvote": "live-classes",

  // --- presentations --------------------------------------------------------
  "GET  /api/presentations": "presentations",
  "POST /api/presentations": "presentations",
  // Static segment, so it is matched before `:presentationId` by the App Router.
  // Listed before the dynamic sibling here too, so the precedence is visible.
  "GET  /api/presentations/submissions": "presentations",
  "POST /api/presentations/submissions": "presentations",
  "POST /api/presentations/submissions/:submissionId/grade": "presentations",
  "GET  /api/presentations/:presentationId": "presentations",
  "PUT  /api/presentations/:presentationId": "presentations",
  "DELETE /api/presentations/:presentationId": "presentations",
  "GET  /api/presentations/:presentationId/slides": "presentations",
  "POST /api/presentations/:presentationId/slides": "presentations",
  "PUT  /api/presentations/:presentationId/slides/:slideNumber": "presentations",
  "DELETE /api/presentations/:presentationId/slides/:slideNumber": "presentations",
  "GET  /api/presentations/:presentationId/theme": "presentations",
  "PUT  /api/presentations/:presentationId/theme": "presentations",
  "POST /api/presentations/:presentationId/export": "presentations",
  "POST /api/presentations/:presentationId/present": "presentations",
  "GET  /api/presentations/:presentationId/feedback": "presentations",
  "POST /api/presentations/:presentationId/feedback": "presentations",
} as const;

export type RouteKey = keyof typeof ROUTES;

// ---------------------------------------------------------------------------
// AUTHORIZATION CONTRACT (frozen alongside the route map)
// ---------------------------------------------------------------------------
// Every route above MUST appear here. "public" is an explicit, reviewed choice —
// never a default. The auth stream exports the guards; each owning stream calls
// the guard named for its route. A route missing from this map is a bug, caught
// by the exhaustiveness of Record<RouteKey, RouteAuth>.
//
// "cron" = server-to-server only. Requires the CRON_SECRET bearer token AND
// rejects browser requests; it is not reachable by any logged-in user.
export type RouteAuth = "public" | "student" | "instructor" | "admin" | "cron";

export const ROUTE_AUTH: Record<RouteKey, RouteAuth> = {
  // auth — register/login must be reachable before a session exists.
  "POST /api/auth/register": "public",
  "POST /api/auth/login": "public",
  "POST /api/auth/logout": "student",
  "GET  /api/auth/me": "student",

  // course-content — locked weeks are filtered server-side by the unlock model,
  // so authorization here is "signed in", not "signed in and unlocked".
  "GET  /api/courses": "student",
  "GET  /api/weeks/:weekId": "student",
  "GET  /api/weeks/:weekId/lectures": "student",
  "GET  /api/lectures/:lectureId": "student",

  // quizzes
  "GET  /api/weeks/:weekId/quiz": "student",
  "POST /api/quizzes/:quizId/submit": "student",
  "GET  /api/quizzes/:quizId/attempts": "student",

  // progress-tracking
  "GET  /api/me/progress": "student",
  "GET  /api/me/dashboard": "student",

  // leaderboard
  "GET  /api/leaderboard": "student",
  "GET  /api/leaderboard/me": "student",

  // submissions
  "GET  /api/weeks/:weekId/assignment": "student",
  // Ingestion pulls the Google Sheet and WRITES submission rows. Left
  // unauthenticated, any visitor could trigger it — so the manual trigger is
  // staff-only and the scheduled sweep requires the CRON_SECRET bearer token.
  "POST /api/assignments/:assignmentId/ingest": "instructor",
  "POST /api/cron/ingest-submissions": "cron",
  "GET  /api/me/submissions": "student",

  // instructor-admin
  "GET  /api/instructor/submissions": "instructor",
  "POST /api/instructor/submissions/:id/grade": "instructor",
  "GET  /api/instructor/students": "instructor",
  "GET  /api/instructor/analytics": "instructor",

  // --- add-on wave ---------------------------------------------------------

  // Executes student-supplied source. Anonymous access would make this an open
  // keyless code-execution proxy for anyone who finds the URL.
  "POST /api/execute": "student",

  // Self-service account routes read the caller from the session and never take
  // a target user id, so "student" (= any signed-in role) is correct.
  "GET  /api/account/profile": "student",
  "PATCH /api/account/profile": "student",
  "POST /api/account/password": "student",
  // The two reset routes are the only add-on paths that MUST be public: a user
  // who cannot sign in is exactly the user who needs them. Both are rate-limited
  // and the request route deliberately returns one identical response for known
  // and unknown addresses, so being public leaks no membership information.
  "POST /api/account/reset-request": "public",
  "POST /api/account/reset-confirm": "public",

  // The exam. "student" rather than "public" is the floor, but note that the
  // one-attempt and week-unlock rules are NOT authorization — they are enforced
  // inside the handlers and by the unique index (invariant I1).
  "POST /api/exams/:weekId/start": "student",
  "POST /api/exams/:attemptId/answer": "student",
  "POST /api/exams/:attemptId/submit": "student",
  "GET  /api/exams/:attemptId": "student",
  // Same reasoning as the ingest sweeper: a scheduler cannot hold a session, and
  // no user role may finalize other people's exams.
  "POST /api/cron/finalize-exams": "cron",

  "GET  /api/problems": "student",
  "GET  /api/problems/:slug": "student",
  "POST /api/problems/:slug/attempt": "student",

  "POST /api/learn/steps/:stepId/complete": "student",

  // --- async-queues --------------------------------------------------------

  // "cron", i.e. the CRON_SECRET bearer token and NO user role — deliberately
  // stricter than "admin". A drain sends mail to students, so an admin session
  // that could trigger it would be a way to mail the whole cohort from a browser;
  // the route additionally refuses any request carrying a session cookie, as a
  // confused-deputy defence for a leaked secret. Called on a schedule by
  // .github/workflows/drain-jobs.yml.
  "POST /api/cron/drain-jobs": "cron",
  // "admin", NOT "instructor", even though ROLES_SATISFYING.instructor admits
  // admins: this endpoint exposes queue payloads across the whole cohort and can
  // re-trigger student email. That is operations, not teaching.
  "GET  /api/admin/jobs": "admin",
  "POST /api/admin/jobs": "admin",

  // --- activity-logs -------------------------------------------------------

  // "admin", NOT "instructor". This table records every act of every user,
  // instructors' own grading decisions included, so at "instructor"
  // (ROLES_SATISFYING.instructor = ["instructor","admin"]) colleagues could audit
  // each other and see which of their own acts had been reviewed. Oversight is not
  // teaching. The export is separately the more sensitive of the two: it joins in
  // the names and addresses the table deliberately does not store.
  "GET  /api/admin/activity": "admin",
  "GET  /api/admin/activity/export": "admin",
  // "cron", deliberately stricter than "admin", for the same reason
  // POST /api/cron/drain-jobs is: a drain can mail the whole cohort from a browser,
  // and this can DELETE the audit trail from one. No user session may do that. The
  // handler additionally refuses to delete without an explicit confirm=exported
  // flag, because this stack has no cold-storage archive and the deletion is final.
  "POST /api/cron/prune-activity": "cron",

  // --- learning enhancements -----------------------------------------------
  //
  // READS ARE "student" (= any signed-in role) and WRITES ARE "instructor".
  // The content in these tables is authored curriculum, not student work, so
  // there is no per-student ownership to scope a read by — but there IS
  // answer-key material inside it (practice-problem solutions, interview model
  // answers), and THAT is not handled by this table at all. It is handled by
  // column PROJECTION inside each handler; see src/lib/learning/projection.ts.
  // Stated here because "student" next to a route that serves solutions reads
  // like an oversight otherwise.
  "GET  /api/assignments/:assignmentId/samples": "student",
  "POST /api/assignments/:assignmentId/samples": "instructor",
  "GET  /api/assignments/:assignmentId/samples/:sampleId": "student",
  "PUT  /api/assignments/:assignmentId/samples/:sampleId": "instructor",
  "DELETE /api/assignments/:assignmentId/samples/:sampleId": "instructor",

  "GET  /api/lectures/:lectureId/practice-problems": "student",
  "POST /api/lectures/:lectureId/practice-problems": "instructor",
  "GET  /api/practice-problems/:problemId": "student",
  "PUT  /api/practice-problems/:problemId": "instructor",
  "DELETE /api/practice-problems/:problemId": "instructor",
  "POST /api/practice-problems/:problemId/attempt": "student",
  "GET  /api/practice-problems/:problemId/hints": "student",
  "GET  /api/practice-problems/:problemId/solution": "student",

  "GET  /api/interview-questions": "student",
  "POST /api/interview-questions": "instructor",
  "GET  /api/interview-questions/:questionId": "student",
  "PUT  /api/interview-questions/:questionId": "instructor",
  "DELETE /api/interview-questions/:questionId": "instructor",

  "GET  /api/lectures/:lectureId/visualizations": "student",
  "POST /api/lectures/:lectureId/visualizations": "instructor",
  "GET  /api/visualizations/:visualizationId": "student",
  "PUT  /api/visualizations/:visualizationId": "instructor",
  "DELETE /api/visualizations/:visualizationId": "instructor",

  // --- live classes ---------------------------------------------------------
  //
  // "instructor" here is the FLOOR, not the whole rule. Every instructor-level
  // write below additionally requires that the caller OWNS the class, and that
  // check is a `where instructor_id = session.id` clause on the statement rather
  // than an `if` after the fetch — otherwise instructor B can start, end, or
  // delete instructor A's session. Admins bypass the ownership clause on
  // purpose (covering for an absent colleague), which is why it is expressed as
  // an optional clause and not as a second role level.
  "GET  /api/classes": "student",
  "POST /api/classes": "instructor",
  "GET  /api/classes/upcoming": "student",
  "GET  /api/classes/:classId": "student",
  "PUT  /api/classes/:classId": "instructor",
  "DELETE /api/classes/:classId": "instructor",
  "POST /api/classes/:classId/start": "instructor",
  "POST /api/classes/:classId/end": "instructor",
  // Joining WRITES an attendance row, so it is not a public read despite being
  // a GET. The verb is the spec's; the effect is an idempotent upsert.
  "GET  /api/classes/:classId/join": "student",
  "POST /api/classes/:classId/leave": "student",
  "GET  /api/classes/:classId/recording": "student",
  "PUT  /api/classes/:classId/recording": "instructor",
  // "student" is the FLOOR and, as with the writes above, not the whole rule.
  // The handler additionally requires the class to be enterable (the same
  // statuses /join admits) as a WHERE clause, and it derives the token's ROLE
  // claim from class ownership rather than from the caller's role — an
  // instructor visiting a colleague's class is minted a "student" claim, because
  // the socket service grants moderation on that claim alone.
  "POST /api/classes/:classId/realtime-token": "student",
  // The roster names every student who attended and their participation score.
  // A student may see their OWN attendance (via join/leave), never the roster.
  "GET  /api/classes/:classId/attendance": "instructor",
  "PATCH /api/classes/:classId/attendance/:studentId": "instructor",
  "GET  /api/classes/:classId/chat": "student",
  "POST /api/classes/:classId/chat": "student",
  // Author-or-moderator. "student" is the floor; the handler distinguishes an
  // author editing their own message from a moderator pinning someone else's.
  "PATCH /api/classes/:classId/chat/:messageId": "student",
  "DELETE /api/classes/:classId/chat/:messageId": "student",
  "GET  /api/classes/:classId/qa": "student",
  "POST /api/classes/:classId/qa": "student",
  "PATCH /api/classes/:classId/qa/:questionId": "instructor",
  "POST /api/classes/:classId/qa/:questionId/answer": "instructor",
  "POST /api/classes/:classId/qa/:questionId/upvote": "student",

  // --- presentations --------------------------------------------------------
  //
  // "student" throughout except grading, because a deck is STUDENT-OWNED work.
  // The access decision is therefore not a role at all — it is creator vs
  // published vs shared, evaluated per row in src/app/api/presentations/_access.ts
  // and applied as a WHERE clause. Authorizing these by role alone would let any
  // signed-in student read any other student's unpublished coursework.
  "GET  /api/presentations": "student",
  "POST /api/presentations": "student",
  "GET  /api/presentations/submissions": "student",
  "POST /api/presentations/submissions": "student",
  "POST /api/presentations/submissions/:submissionId/grade": "instructor",
  "GET  /api/presentations/:presentationId": "student",
  "PUT  /api/presentations/:presentationId": "student",
  "DELETE /api/presentations/:presentationId": "student",
  "GET  /api/presentations/:presentationId/slides": "student",
  "POST /api/presentations/:presentationId/slides": "student",
  "PUT  /api/presentations/:presentationId/slides/:slideNumber": "student",
  "DELETE /api/presentations/:presentationId/slides/:slideNumber": "student",
  "GET  /api/presentations/:presentationId/theme": "student",
  "PUT  /api/presentations/:presentationId/theme": "student",
  "POST /api/presentations/:presentationId/export": "student",
  "POST /api/presentations/:presentationId/present": "student",
  "GET  /api/presentations/:presentationId/feedback": "student",
  "POST /api/presentations/:presentationId/feedback": "student",
};

// Roles that satisfy a given requirement. Staff can read student-scoped routes;
// a student can never reach instructor-scoped ones. "cron" is satisfied by no
// user role at all — only the shared secret.
export const ROLES_SATISFYING: Record<RouteAuth, readonly string[]> = {
  public: ["student", "instructor", "admin"],
  student: ["student", "instructor", "admin"],
  instructor: ["instructor", "admin"],
  admin: ["admin"],
  cron: [],
} as const;
