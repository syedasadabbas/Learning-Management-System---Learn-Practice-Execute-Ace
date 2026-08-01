// =============================================================================
// /classes/[classId] — the class room, or the reason you cannot enter it.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// THE JOIN HAPPENS ON THE SERVER, BEFORE ANYTHING RENDERS, and that is what
// makes this page correct rather than merely convenient.
//
// `GET /api/classes/:id/join` is a GET WITH A SIDE EFFECT — it upserts the
// attendance row — and it is also the only source of the room name and
// password. Doing it here means:
//   - the room credentials never sit in a client bundle or a props payload for
//     a student the server would have refused;
//   - the four refusal states (404 no class, 425 not started, 409 ended, 409
//     full) are rendered as PAGES with the right words, instead of as an error
//     toast over an empty video box;
//   - attendance is recorded even if the Jitsi script is blocked on the
//     student's network.
// The route is idempotent by unique index, so a refresh does not double-count;
// its header makes that the entire argument for the verb.
//
// AUTHORIZATION IS READ FROM THE SESSION HERE AND PASSED DOWN. `canModerate` is
// computed from `user.role`, never from a query parameter or a client value.
// The routes it unlocks (answer a question, read the roster) each check the
// session themselves AND filter on class ownership, so a student who forges the
// prop in devtools gets a 404 from the server rather than a working control.
// =============================================================================

import Link from "next/link";

import { LiveClassRoom } from "@/components/live-classes";
import type { JoinPayload } from "@/components/live-classes";
import { Card, EmptyState } from "@/components/ui";
import { db } from "@/db";
import { requireFeature } from "@/lib/feature-guard";
import { requireRole } from "@/lib/guard";
import { canJoin, type ClassStatus } from "@/lib/live-classes/access";
import { liveClassesConfig } from "@/lib/features";
import { liveClasses } from "@/db/schema.live-classes";
import { classAttendance } from "@/db/schema.live-classes";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Params = Promise<{ classId: string }>;

/** Positive integer or null — the same narrowing every route applies. */
function intParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function Refusal({ title, description }: { title: string; description: string }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <EmptyState
        title={title}
        description={description}
        action={
          <Link className="text-brand underline" href="/classes">
            Back to the class list
          </Link>
        }
      />
    </main>
  );
}

export default async function ClassRoomPage({ params }: { params: Params }) {
  requireFeature("liveClasses");
  const user = await requireRole("student");

  const classId = intParam((await params).classId);
  if (classId === null) {
    return <Refusal title="That is not a class" description="The address is malformed." />;
  }

  // The same read the /join route performs, executed here so the refusal states
  // are pages. The attendance WRITE is left to the route, which the embed calls
  // on `videoConferenceJoined` — writing it here would mark a student present
  // for merely opening a URL they never entered.
  const [cls] = await db
    .select({
      id: liveClasses.id,
      title: liveClasses.title,
      status: liveClasses.status,
      durationMinutes: liveClasses.durationMinutes,
      jitsiRoomName: liveClasses.jitsiRoomName,
      jitsiPassword: liveClasses.jitsiPassword,
      allowChat: liveClasses.allowChat,
      allowQa: liveClasses.allowQa,
      allowScreenShare: liveClasses.allowScreenShare,
      startedAt: liveClasses.startedAt,
      instructorId: liveClasses.instructorId,
    })
    .from(liveClasses)
    .where(eq(liveClasses.id, classId))
    .limit(1);

  if (!cls) {
    return (
      <Refusal
        title="Class not found"
        description="This class does not exist, or it has been removed from the schedule."
      />
    );
  }

  const verdict = canJoin(cls.status as ClassStatus);
  if (verdict.kind === "refused") {
    return <Refusal title={cls.title} description={verdict.reason} />;
  }

  if (cls.jitsiRoomName === null) {
    // The 425 case. The room is minted at /start, so there is nothing to enter
    // yet — and a student told "wait" behaves differently from one told "this
    // will never work".
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
        <Card title={cls.title} subtitle="Not started yet">
          <p className="text-sm text-ink-muted">
            The instructor has not opened the room. Refresh this page when the class begins.
          </p>
        </Card>
      </main>
    );
  }

  // Ownership, from the session — never from a prop. An instructor moderates
  // only their OWN class; an admin moderates any. This mirrors
  // `ownershipFilter` in src/lib/live-classes/access.ts, which is what the
  // routes actually enforce.
  const canModerate =
    user.role === "admin" || (user.role === "instructor" && cls.instructorId === user.id);

  // Whether the student has been here before, for the room's own display only.
  const [existing] = await db
    .select({ joinedAt: classAttendance.joinedAt })
    .from(classAttendance)
    .where(and(eq(classAttendance.classId, classId), eq(classAttendance.studentId, user.id)))
    .limit(1);

  const join: JoinPayload = {
    canJoin: true,
    jitsiConfig: {
      roomName: cls.jitsiRoomName,
      password: cls.jitsiPassword,
      serverUrl: `https://${liveClassesConfig.jitsiDomain}`,
    },
    attendance: {
      joinedAt: (existing?.joinedAt ?? new Date()).toISOString(),
      firstJoin: existing === undefined,
    },
    class: {
      id: cls.id,
      title: cls.title,
      status: cls.status as ClassStatus,
      durationMinutes: cls.durationMinutes,
      allowChat: cls.allowChat,
      allowQa: cls.allowQa,
      allowScreenShare: cls.allowScreenShare,
      startedAt: cls.startedAt?.toISOString() ?? null,
    },
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <LiveClassRoom
        join={join}
        currentUserId={user.id}
        currentUserName={user.name}
        canModerate={canModerate}
      />
    </main>
  );
}
