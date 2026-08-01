// =============================================================================
// The "hand in your work" call to action. Owner: submissions stream.
// -----------------------------------------------------------------------------
// THE NULL-URL CASE IS THE DEFAULT CASE, NOT AN EDGE CASE.
//
// `assignments.google_form_url` is NULL for every seeded assignment — see the
// TODO(decision) in scripts/seed.ts: the real Google Form has not been created,
// so there is no URL to link to. Rendering an anchor with href="" or href="#"
// would give the student a button that appears to work and does nothing, and the
// student would reasonably conclude they had submitted.
//
// So this component has two real states, and the unconfigured one is written
// first and tested. It explains what is missing and who fixes it, and it does not
// render a link at all.
//
// 2026-07-31 — A THIRD STATE: THE STAND-IN.
//
// The seeder now writes a URL into `google_form_url` for every assignment, so the
// unconfigured branch above is no longer the default on a freshly seeded database.
// But that URL is usually NOT a Google Form: with nobody able to create one from
// this repository, it points at /assignments/[weekId]/submit, a page inside this
// LMS that says it is a stand-in and offers an email route to a human.
//
// The student must be told which of the two they are about to open. Rendering the
// stand-in with the same confident "Open the submission form" copy would be the
// same lie as a fabricated docs.google.com link, just one hop further away — the
// student would click, land on a page that is not a form, and have no idea whether
// they had submitted. So the stand-in gets its own label and its own warning, and
// `isStandInUrl` decides which from the URL itself (a `standin=1` flag written at
// seed time), not from a guess about the hostname.
// =============================================================================

import { Badge, buttonClasses } from "@/components/ui";
import { isStandInUrl } from "@/lib/submissions/stand-in";

export function SubmitLink({
  googleFormUrl,
  assignmentTitle,
}: {
  googleFormUrl: string | null;
  assignmentTitle: string;
}) {
  const url = (googleFormUrl ?? "").trim();

  if (url === "") {
    return (
      <div
        className="rounded-lg border border-line bg-surface p-4"
        data-testid="submit-link-unconfigured"
      >
        <Badge tone="warning">Submission link not yet configured</Badge>
        <p className="mt-2 text-sm text-ink-muted">
          The Google Form for <strong>{assignmentTitle}</strong> has not been set up yet, so there
          is nothing to submit through at the moment. Your instructor will publish the form link
          here. Nothing is counted against you until it appears.
        </p>
      </div>
    );
  }

  const standIn = isStandInUrl(url);

  if (standIn) {
    return (
      <div className="flex flex-col gap-2" data-testid="submit-link">
        <Badge tone="warning">Stand-in — the real Google Form does not exist yet</Badge>
        {/*
          A same-origin navigation, so no target="_blank" and no rel: the page is
          part of this app and opening a second tab for it would leave the student
          with two copies of the LMS and no idea which one is current.
        */}
        <a
          href={url}
          className={buttonClasses("secondary", "md", "w-fit")}
          data-testid="submit-link-stand-in"
        >
          Open the stand-in submission page
        </a>
        <p className="text-xs text-ink-muted">
          Your instructor has not published a Google Form for{" "}
          <strong>{assignmentTitle}</strong> yet. This page explains how to hand your work in
          meanwhile, and nothing is counted against you for using it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="submit-link">
      {/*
        Not an embedded iframe. A Google Form iframe cannot see the signed-in LMS
        user, so the student must type their email into the form regardless — and
        that email is the only thing ingestion can match on. A full-page link makes
        it obvious which email address they are filling in, and avoids a third-party
        frame that some browsers block in a first-party cookie context.
      */}
      {/*
        `buttonClasses` rather than <Button>: this is a navigation, so the element
        must be an <a>. Wrapping an anchor inside a <button> is invalid HTML and
        breaks keyboard activation.
      */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClasses("primary", "md", "w-fit")}
      >
        Open the submission form
      </a>
      <p className="text-xs text-ink-muted">
        Opens in a new tab. Submit with the same email address you use to sign in here — that is
        how your response is matched to your account.
      </p>
    </div>
  );
}
