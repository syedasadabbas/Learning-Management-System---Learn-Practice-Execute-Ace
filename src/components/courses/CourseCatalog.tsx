"use client";

// =============================================================================
// COURSE CATALOG — every course, the student's own status, and the ask.
// -----------------------------------------------------------------------------
// Owner: courses / access-requests stream.
//
// THIS COMPONENT DECIDES NOTHING ABOUT ACCESS. `canRequest` and `state` are
// computed on the server by `decideCourseAccess`/`canRequestAccess` and arrive as
// props; the server action re-derives both before it writes anything. Rendering
// a Request button to someone who may not request would still be refused
// server-side. A hidden button is not access control — and, just as importantly,
// a SHOWN button is not authorization either.
//
// WHAT IT DELIBERATELY SHOWS TO A STUDENT WITH NO ACCESS: the title, the
// description and the week count of every course. Those are catalog copy. A
// catalog that hides what you cannot have gives you nothing to request, which is
// the same argument GET /api/courses:5 makes for returning locked weeks with a
// padlock rather than filtering them out. The COURSE CONTENT is what is withheld,
// by the gate on /courses/[courseId].
//
// STATUS IS THE PRODUCT HERE, not a decoration: item 4 of this stream's brief is
// "the student can SEE their request status". Every state therefore renders a
// distinct, labelled badge AND a sentence saying what happens next, with a
// `data-access-state` attribute so an e2e spec can assert the state rather than
// pattern-matching prose that a copy edit will change.
// =============================================================================

import Link from "next/link";
import * as React from "react";

import { Badge, Button, Card, EmptyState, Toast } from "@/components/ui";
import { requestCourseAccessAction } from "@/lib/courses/actions";
// From the PURE module. Importing from ./policy or ./store here would pull
// `@/lib/guard` -> `@/lib/auth` -> `pg` into the client bundle and break the
// build; see src/lib/courses/labels.ts for the full note.
import { REQUEST_MESSAGE_MAX, STATUS_LABEL, STATUS_TONE } from "@/lib/courses/labels";

/** Mirrors `AccessStatusLabelKey` in @/lib/courses/labels. */
export type CatalogState = "open" | "approved" | "pending" | "rejected" | "none";

export interface CatalogCourse {
  id: number;
  title: string;
  description: string | null;
  weekCount: number;
  durationWeeks: number;
  state: CatalogState;
  /** Server-computed `canRequestAccess(...).canRequest`. Never inferred here. */
  canRequest: boolean;
  /** The admin's note on a rejection, shown so the student knows why. */
  decisionNote: string | null;
  /** ISO 8601 UTC. Dates cross the RSC boundary as strings; see the page. */
  requestedAt: string | null;
  decidedAt: string | null;
}

export interface CourseCatalogProps {
  courses: CatalogCourse[];
  /**
   * True for instructors and admins. Staff read every course without a request
   * (`decideCourseAccess` -> via "staff"), so the catalog says so once at the
   * top instead of putting a disabled Request button on every row.
   */
  viewerIsStaff: boolean;
}

/** What happens next, per state. The sentence a student actually needs. */
const STATE_EXPLANATION: Record<CatalogState, string> = {
  open: "This is your cohort's course. No request is needed.",
  approved: "An admin approved your request. You can open this course.",
  pending: "Sent. An admin will approve or decline it — this page will show the outcome.",
  rejected: "An admin declined this request. You can ask again below.",
  none: "You are not enrolled. Request access and an admin will review it.",
};

export function CourseCatalog({ courses, viewerIsStaff }: CourseCatalogProps) {
  const [pendingId, setPendingId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [openFormId, setOpenFormId] = React.useState<number | null>(null);

  async function submitRequest(courseId: number, message: string) {
    setPendingId(courseId);
    setError(null);
    setNotice(null);

    const result = await requestCourseAccessAction(courseId, message);
    setPendingId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    // No local status override, unlike the video review queue: the action calls
    // revalidatePath("/courses"), and this page is the one being revalidated, so
    // the server sends back the real row. An optimistic "pending" here could
    // disagree with a status the database refused to change.
    setOpenFormId(null);
    setNotice("Request sent. An admin will review it.");
  }

  if (courses.length === 0) {
    return (
      <EmptyState
        title="No courses have been published"
        description="Nothing has been seeded yet, so there is nothing to request access to."
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="course-catalog">
      {error && (
        // Sticky (no autoDismissMs): a student must not be left believing a
        // request was filed when the write was refused.
        <Toast tone="error" message={error} onDismiss={() => setError(null)} />
      )}
      {notice && (
        <Toast tone="success" message={notice} onDismiss={() => setNotice(null)} />
      )}

      {viewerIsStaff && (
        <p className="text-sm text-ink-muted" data-testid="staff-catalog-note">
          You are signed in as staff, so you can open every course without an
          access request. Students see only the courses they are enrolled in.
        </p>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {courses.map((course) => {
          const busy = pendingId === course.id;
          const readable = course.state === "open" || course.state === "approved" || viewerIsStaff;
          const badgeKey = viewerIsStaff && course.state === "none" ? "open" : course.state;

          return (
            <li key={course.id}>
              <Card
                // The identifying attributes belong on the CARD, not on the div
                // inside it. `Card` renders `title` in its own header, which is a
                // SIBLING of `children` — so while these lived on the inner div,
                // the card element did not contain its own title text and
                // `locator('[data-testid^="course-card-"]').filter({ has:
                // getByText(title) })` matched nothing. That broke 12 of the 20
                // courses e2e specs: every one that resolves a course id by name
                // goes through that filter, and the whole
                // request -> approve -> access chain hangs off it.
                //
                // Card spreads `...rest` onto its outer element AFTER its own
                // data-testid="card", so passing data-testid here overrides that
                // rather than colliding with it (src/components/ui/Card.tsx:53).
                data-testid={`course-card-${course.id}`}
                data-access-state={course.state}
                data-can-request={course.canRequest ? "true" : "false"}
                title={course.title}
                subtitle={`${course.weekCount} week${course.weekCount === 1 ? "" : "s"} · ${course.durationWeeks}-week programme`}
                action={
                  <Badge tone={STATUS_TONE[badgeKey]} size="sm">
                    {STATUS_LABEL[badgeKey]}
                  </Badge>
                }
              >
                <div className="space-y-3">
                  {course.description && (
                    <p className="text-sm text-ink-muted">{course.description}</p>
                  )}

                  <p
                    className="text-sm text-ink-muted"
                    data-testid={`course-status-${course.id}`}
                  >
                    {STATE_EXPLANATION[course.state]}
                  </p>

                  {course.state === "rejected" && course.decisionNote && (
                    <p
                      className="rounded border border-line bg-surface p-2 text-sm text-ink"
                      data-testid={`course-decision-note-${course.id}`}
                    >
                      Admin note: {course.decisionNote}
                    </p>
                  )}

                  {readable ? (
                    <Link
                      href={`/courses/${course.id}`}
                      className="text-sm text-brand underline underline-offset-2"
                      data-testid={`open-course-${course.id}`}
                    >
                      Open {course.title}
                    </Link>
                  ) : (
                    // NO ANCHOR AT ALL for a course the student may not read —
                    // the same rule WeekCard.tsx follows for a locked week
                    // (docs/SUBJECT_SECTIONS.md:105). The server refuses the URL
                    // anyway; omitting the link just stops offering a door that
                    // will be shut.
                    <p className="text-xs text-ink-muted">
                      The course content is not available until this is approved.
                    </p>
                  )}

                  {course.canRequest && (
                    <RequestForm
                      courseId={course.id}
                      isOpen={openFormId === course.id}
                      busy={busy}
                      isReapplication={course.state === "rejected"}
                      onOpen={() => setOpenFormId(course.id)}
                      onCancel={() => setOpenFormId(null)}
                      onSubmit={(message) => submitRequest(course.id, message)}
                    />
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The ask. Collapsed to a single button until clicked, because the note is
 * optional and a permanently-open textarea reads as a required field.
 */
function RequestForm({
  courseId,
  isOpen,
  busy,
  isReapplication,
  onOpen,
  onCancel,
  onSubmit,
}: {
  courseId: number;
  isOpen: boolean;
  busy: boolean;
  isReapplication: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onSubmit: (message: string) => void;
}) {
  const [message, setMessage] = React.useState("");
  const label = isReapplication ? "Request again" : "Request access";

  if (!isOpen) {
    return (
      <Button
        size="sm"
        variant="primary"
        loading={busy}
        disabled={busy}
        data-testid={`request-access-${courseId}`}
        onClick={onOpen}
      >
        {label}
      </Button>
    );
  }

  return (
    <form
      className="space-y-2"
      data-testid={`request-form-${courseId}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(message);
      }}
    >
      <label
        className="block text-xs font-medium text-ink"
        htmlFor={`request-message-${courseId}`}
      >
        Why do you want this course? (optional)
      </label>
      <textarea
        id={`request-message-${courseId}`}
        name="message"
        rows={3}
        // Presentation only. `normaliseRequestMessage` truncates server-side —
        // the action is a plain POST target that this attribute cannot protect.
        maxLength={REQUEST_MESSAGE_MAX}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        className="w-full rounded border border-line bg-panel p-2 text-sm text-ink"
        data-testid={`request-message-${courseId}`}
      />
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant="primary"
          loading={busy}
          disabled={busy}
          data-testid={`submit-request-${courseId}`}
        >
          Send request
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
