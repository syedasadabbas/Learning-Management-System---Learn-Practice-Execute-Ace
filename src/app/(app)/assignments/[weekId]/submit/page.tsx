// =============================================================================
// /assignments/[weekId]/submit — the LOCAL STAND-IN for a Google Form.
// Owner: submissions stream.
// -----------------------------------------------------------------------------
// WHY THIS PAGE EXISTS RATHER THAN A FABRICATED docs.google.com LINK
//
// `assignments.google_form_url` was NULL on all four seeded rows, so SubmitLink
// rendered its "not yet configured" banner and a student had literally nowhere to
// hand work in. The obvious repair — invent a plausible-looking Google Forms URL —
// is the worst available option: it produces a link that LOOKS real, 404s on
// click, and teaches the student that the LMS lies. A Google Form cannot be
// created from this repository (no account, no credential, no API for it), so the
// honest alternative is a page inside the LMS that says exactly what it is and
// still gives the student a way to hand work in.
//
// SO, PLAINLY: this is not the submission form. It is a stand-in. It states that
// at the top, in the page title, and in the badge. The mailto fallback is a real
// working route to a human, not decoration — it is the only genuine delivery
// mechanism this repository can offer today.
//
// AUTHORIZATION: this sits under the "/assignments" prefix, which src/middleware.ts
// gates at "student" (i.e. any signed-in role), and it additionally calls
// requireUser() — the same defence-in-depth pattern the sibling page uses.
//
// TODO(course-owner): once the real Google Form exists, set google_form_url (admin
// console -> Assignments, or SUBMISSIONS_FORM_URL_WEEK_<n>). SubmitLink then links
// straight to Google and this page stops being reachable from the UI. DELETE IT at
// that point — a stand-in that outlives its reason is a trap for the next reader.
// =============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Card } from "@/components/ui";
import { requireUser } from "@/lib/guard";
// NOTE: the loader is imported from src/lib/navigation/guards.ts, not from its own
// module. That wrapper is the shared React `cache()` memo, and the sibling
// layout.tsx guard calls the SAME one — which is what makes this route's 404
// correct (the guard runs above this route's loading.tsx boundary, where the HTTP
// status is still settable) without paying for the query twice at ~245 ms a round
// trip. See that file and src/components/nav/PageSkeleton.tsx.
import { loadAssignmentForWeek } from "@/lib/navigation/guards";
import { isStandInUrl } from "@/lib/submissions/stand-in";

export const dynamic = "force-dynamic";

/**
 * Where a student's work actually goes while there is no Form.
 *
 * Defaults to the seeded instructor account so the page is never a dead end on a
 * fresh checkout. TODO(course-owner): set SUBMISSIONS_INSTRUCTOR_EMAIL to the real
 * address before a cohort is enrolled — the default is a .test domain and mail to
 * it will not be delivered anywhere.
 */
const INSTRUCTOR_EMAIL =
  process.env.SUBMISSIONS_INSTRUCTOR_EMAIL?.trim() || "instructor@codequeenshub.test";

/** The four questions the real Google Form must ask, and why each one. */
const REQUIRED_QUESTIONS = [
  {
    label: "Email Address",
    why:
      "The ONLY field ingestion can match on. It must be the same address you sign in " +
      "with here, or your response will be skipped as an unknown student.",
  },
  {
    label: "GitHub Repository URL",
    why: "Where your source lives. Shown to the instructor in the grading queue.",
  },
  {
    label: "Live Site URL",
    why: "Your deployed page, so it can be marked without cloning anything.",
  },
  {
    label: "Anything else you want us to know?",
    why: "Optional context for the grader. Stored on the submission.",
  },
] as const;

export default async function StandInSubmitPage({
  params,
}: {
  params: Promise<{ weekId: string }>;
}) {
  const { weekId: rawWeekId } = await params;
  const weekId = Number(rawWeekId);
  if (!Number.isInteger(weekId) || weekId <= 0) notFound();

  const user = await requireUser(`/assignments/${weekId}/submit`);
  const item = await loadAssignmentForWeek(weekId, user.id);
  if (!item) notFound();

  // If a real Form URL has since been configured, this page is obsolete for that
  // assignment and must not compete with it. Say so and point at the real thing
  // rather than silently rendering a second, worse submission route.
  const formIsReal = (item.googleFormUrl ?? "").trim() !== "" && !isStandInUrl(item.googleFormUrl);

  const mailtoSubject = encodeURIComponent(
    `[${item.assignmentTitle}] submission from ${user.email}`,
  );
  const mailtoBody = encodeURIComponent(
    [
      `Student email: ${user.email}`,
      "GitHub repository URL: ",
      "Live site URL: ",
      "Anything else you want us to know: ",
      "",
      `Assignment: ${item.assignmentTitle}`,
      `Week ${item.weekNumber} — ${item.weekTitle}`,
    ].join("\n"),
  );

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6" data-testid="stand-in-form-page">
      <header>
        <p className="text-sm text-ink-muted">
          Week {item.weekNumber} — {item.weekTitle}
        </p>
        <h1 className="text-2xl font-semibold">Submit — stand-in form</h1>
      </header>

      {formIsReal ? (
        <Card title="A real submission form is now configured">
          <p className="text-sm text-ink-muted">
            This stand-in is no longer the way to hand in {item.assignmentTitle}.
          </p>
          <Link
            href={`/assignments/${weekId}`}
            className="mt-2 inline-block text-sm underline"
            data-testid="stand-in-superseded"
          >
            Go to the assignment and use the real form
          </Link>
        </Card>
      ) : (
        <>
          <div
            className="rounded-lg border border-line bg-surface p-4"
            data-testid="stand-in-warning"
          >
            <Badge tone="warning">Stand-in — this is not the real submission form</Badge>
            <p className="mt-2 text-sm text-ink-muted">
              The Google Form for <strong>{item.assignmentTitle}</strong> has not been created yet,
              so there is no form to fill in. This page exists so you are not left with a dead
              link. Send your work by email using the button below and it will be recorded by hand;
              nothing is counted against you for using this route.
            </p>
          </div>

          <Card title="Send your submission">
            <a
              href={`mailto:${INSTRUCTOR_EMAIL}?subject=${mailtoSubject}&body=${mailtoBody}`}
              className="text-sm underline"
              data-testid="stand-in-mailto"
            >
              Email {INSTRUCTOR_EMAIL} with your links
            </a>
            <p className="mt-2 text-xs text-ink-muted">
              Sent from <strong>{user.email}</strong> — the address your account is matched on.
            </p>
          </Card>
        </>
      )}

      <Card title="What the real form will ask">
        <p className="mb-3 text-sm text-ink-muted">
          Listed here so the wording is agreed before the Form is built: ingestion matches these
          column names, and a question worded differently is silently dropped.
        </p>
        <dl className="flex flex-col gap-3">
          {REQUIRED_QUESTIONS.map((q) => (
            <div key={q.label}>
              <dt className="text-sm font-medium">{q.label}</dt>
              <dd className="text-xs text-ink-muted">{q.why}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Link href={`/assignments/${weekId}`} className="text-sm underline">
        Back to the assignment
      </Link>
    </main>
  );
}
