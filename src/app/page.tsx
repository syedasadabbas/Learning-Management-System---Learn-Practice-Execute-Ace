import Link from "next/link";
import { appConfig } from "@/lib/config/app.config";
import { Badge, buttonClasses, Card } from "@/components/ui";
import { auth } from "@/lib/auth";
import { ROLE_LABEL, type Role } from "@/components/nav/nav-links";
import { homeFor } from "@/lib/navigation/role-access";

// OWNERSHIP: ui-shell stream. Public landing page — still no AppShell, because the
// shell needs a role-scoped sidebar and this page is reachable signed out.
//
// IT NOW READS THE SESSION, which it did not before, and that was a reported bug:
// a signed-in student, instructor or admin arriving at "/" was shown "Sign in" and
// "Create an account" and given NO route into their own area. Signing out lands
// here too (SignOutButton uses redirectTo: "/"), so the page a user sees most often
// after their first visit was telling them to do the one thing they had already
// done.
//
// NOT A REDIRECT. A signed-in visitor still gets the landing page — it carries the
// programme description and is a legitimate thing to look at — but the primary
// action becomes "continue where you belong", resolved through homeFor(role) so
// this page does not acquire its own opinion about where an admin lives. That
// mapping is derived from NAV_LINKS; see src/lib/navigation/role-access.ts.
//
// force-dynamic: the output depends on a cookie now. Without it the signed-out
// markup would be cached and served to signed-in users, which is the bug again with
// extra steps.

const HIGHLIGHTS: readonly { title: string; body: string }[] = [
  {
    title: "Structured weeks",
    body: "Lectures, quizzes and one assignment per week. The next week unlocks when you pass.",
  },
  {
    title: "Practice in the browser",
    body: "Live HTML, CSS and JavaScript editors with instant preview — nothing to install.",
  },
  {
    title: "Real feedback",
    body: "Instructors rate every submission out of five stars and write back on it.",
  },
];

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { branding, course, quiz } = appConfig;

  // A failed session read must not take the public landing page down with it: this
  // is the one route that has to render when everything else is broken.
  let role: Role | null = null;
  let name: string | null = null;
  try {
    const session = await auth();
    const sessionRole = session?.user?.role;
    if (sessionRole === "student" || sessionRole === "instructor" || sessionRole === "admin") {
      role = sessionRole;
      name = session?.user?.name ?? null;
    }
  } catch {
    role = null;
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-12 sm:px-6 lg:py-16">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-semibold tracking-wide text-brand uppercase">
          {branding.organizationName}
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          {branding.appName}
        </h1>
        <h2 className="text-xl font-medium text-ink-muted sm:text-2xl">
          {course.title}
        </h2>
        <p className="max-w-2xl text-base text-ink-muted">
          {course.description}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{course.durationWeeks} weeks</Badge>
          <Badge tone="accent">
            {quiz.passingScorePercent}% to unlock the next week
          </Badge>
          <Badge tone="neutral">
            {quiz.attemptsAllowed} quiz attempts, best counts
          </Badge>
        </div>

        {/* Navigation targets are links, not buttons — styled from the shared
            Button class source so they cannot drift. */}
        {role ? (
          <div className="mt-2 flex flex-col gap-2" data-testid="landing-signed-in">
            <p className="text-sm text-ink-muted">
              Signed in{name ? ` as ${name}` : ""} · {ROLE_LABEL[role]}
            </p>
            <div className="flex flex-wrap gap-3">
              {/* The destination is the role's own home, not /dashboard: an admin
                  sent to the student dashboard is the bug this page shared with the
                  post-login redirect. */}
              <Link
                href={homeFor(role)}
                className={buttonClasses("primary", "lg")}
                data-testid="landing-continue"
              >
                {role === "student" ? "Go to your dashboard" : "Go to your workspace"}
              </Link>
              <Link href="/settings" className={buttonClasses("secondary", "lg")}>
                Account settings
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-3" data-testid="landing-signed-out">
            <Link href="/login" className={buttonClasses("primary", "lg")}>
              Sign in
            </Link>
            <Link href="/register" className={buttonClasses("secondary", "lg")}>
              Create an account
            </Link>
          </div>
        )}
      </header>

      <section
        aria-label="What the programme covers"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {HIGHLIGHTS.map((item) => (
          <Card key={item.title} title={item.title}>
            <p className="text-sm text-ink-muted">{item.body}</p>
          </Card>
        ))}
      </section>

      <footer className="text-sm text-ink-muted">
        Component reference:{" "}
        <Link
          href="/_ui"
          className="font-medium text-brand underline underline-offset-2"
        >
          /_ui
        </Link>
      </footer>
    </main>
  );
}
