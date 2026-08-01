// =============================================================================
// DASHBOARD VIEW MODEL — pure derivation + one db-backed entry point.
// Owner: progress-tracking stream.
// -----------------------------------------------------------------------------
// The page and the API route share this model so the JSON a client fetches and
// the HTML the server renders can never disagree.
//
// ZERO-ACTIVITY IS THE DEFAULT CASE, NOT AN EDGE CASE. A brand-new student has
// no attempts, no submissions, no attendance and no progress rows. Every number
// below is therefore defined at zero, every division is guarded, and the
// next-action always resolves to something clickable (week 1) or to an honest
// empty state (no weeks authored yet). "NaN%" and a blank page are the two
// failure modes this file exists to prevent.
// =============================================================================

import { POINTS, QUIZ_PASS_PERCENT } from "@/lib/contracts/scoring";

import { totalsFrom, type WeekProgressDetail } from "./aggregate";
import { getWeekProgressDetail } from "./read-model";

// Rendered into the "unlock" copy. Reads the threshold from the scoring contract
// rather than writing "70%" into a string that would go stale if it ever moved.
const POINTS_PASS_LABEL = `${QUIZ_PASS_PERCENT}%`;

/**
 * Where the dashboard sends a student to act.
 *
 * Links to the section roots guaranteed by `src/components/nav/nav-links.ts`
 * with a `#week-N` fragment, so no dashboard link can 404.
 *
 * Root `/weeks` (was `/course`, which never existed as a segment — course-content
 * ships under (app)/weeks/**).
 *
 * Deliberately NOT a deep link to /weeks/{id}: that segment takes a database week
 * id, and `weekNumber` only coincidentally equals it in the seeded data. Passing a
 * week number where an id is expected would silently open the wrong week the first
 * time a week is deleted or a second course exists.
 */
export function weekHref(weekNumber: number): string {
  return `/weeks#week-${weekNumber}`;
}

export function assignmentHref(weekNumber: number): string {
  return `/assignments#week-${weekNumber}`;
}

/** What the student should do next. Null only when there is nothing left to do. */
export type NextAction = {
  kind: "lectures" | "quiz" | "assignment" | "locked" | "done";
  weekNumber: number | null;
  label: string;
  href: string;
};

/** Nearest upcoming week deadline, for the "next deadline" line. */
export type NextDeadline = {
  weekNumber: number;
  weekTitle: string;
  dueAt: Date;
  /** Whole days until `dueAt`; negative when the deadline has passed. */
  daysRemaining: number;
  overdue: boolean;
};

export type DashboardModel = {
  studentId: number;
  weeks: WeekProgressDetail[];
  totalScore: number;
  /** weeks x POINTS.WEEK_MAX. Zero when no weeks exist. */
  maxScore: number;
  /** 0..100, one decimal place. Always a finite number. */
  overallPercent: number;
  weeksUnlocked: number;
  /** Weeks where lectures, quiz and assignment are all done. */
  weeksCompleted: number;
  /** Highest unlocked week number, null on an empty course. */
  currentWeekNumber: number | null;
  nextAction: NextAction;
  nextDeadline: NextDeadline | null;
  /** True when there is genuinely nothing recorded yet. Drives the welcome copy. */
  isNewStudent: boolean;
};

/** Milliseconds in one day. Metric units per house rule 5. */
const DAY_MS = 86_400_000;

/** Is every deliverable of this week done? A week with no work is not "complete". */
export function isWeekComplete(week: WeekProgressDetail): boolean {
  const lecturesDone = week.lectureTotal > 0 && week.lecturesCompleted >= week.lectureTotal;
  const quizDone = week.quizCount === 0 || week.quizCompleted;
  const assignmentDone = week.assignmentCount === 0 || week.assignmentCompleted;
  const hasWork = week.lectureTotal > 0 || week.quizCount > 0 || week.assignmentCount > 0;
  return hasWork && lecturesDone && quizDone && assignmentDone;
}

/**
 * First outstanding thing, scanning unlocked weeks in ascending order:
 * lectures, then quiz, then assignment.
 *
 * Order is deliberate — it mirrors how a week is meant to be worked through, and
 * it means a new student is told "start the Week 1 lectures", not "submit the
 * Week 1 assignment".
 */
export function deriveNextAction(weeks: readonly WeekProgressDetail[]): NextAction {
  if (weeks.length === 0) {
    return {
      kind: "locked",
      weekNumber: null,
      label: "No course content is published yet",
      href: "/weeks",
    };
  }

  const ordered = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);

  for (const week of ordered) {
    if (!week.unlocked) continue;

    if (week.lectureTotal > 0 && week.lecturesCompleted < week.lectureTotal) {
      return {
        kind: "lectures",
        weekNumber: week.weekNumber,
        label:
          week.lecturesCompleted === 0
            ? `Start the Week ${week.weekNumber} lectures`
            : `Continue the Week ${week.weekNumber} lectures`,
        href: weekHref(week.weekNumber),
      };
    }
    if (week.quizCount > 0 && !week.quizCompleted) {
      return {
        kind: "quiz",
        weekNumber: week.weekNumber,
        label: `Take the Week ${week.weekNumber} quiz`,
        href: weekHref(week.weekNumber),
      };
    }
    if (week.assignmentCount > 0 && !week.assignmentCompleted) {
      return {
        kind: "assignment",
        weekNumber: week.weekNumber,
        label: `Submit the Week ${week.weekNumber} assignment`,
        href: assignmentHref(week.weekNumber),
      };
    }
  }

  // Everything unlocked is finished. Either the next week is gated on a quiz pass
  // that has not happened, or the course is done.
  const firstLocked = ordered.find((w) => !w.unlocked);
  if (firstLocked) {
    const gate = ordered.find((w) => w.weekNumber === firstLocked.weekNumber - 1);
    return {
      kind: "locked",
      weekNumber: firstLocked.weekNumber,
      label:
        gate && gate.quizCount > 0
          ? `Score ${POINTS_PASS_LABEL} on the Week ${gate.weekNumber} quiz to unlock Week ${firstLocked.weekNumber}`
          : `Week ${firstLocked.weekNumber} is locked`,
      href: gate ? weekHref(gate.weekNumber) : "/weeks",
    };
  }

  return {
    kind: "done",
    weekNumber: ordered[ordered.length - 1]?.weekNumber ?? null,
    label: "Every week is complete — nice work",
    href: "/leaderboard",
  };
}

/**
 * Nearest week deadline at or after `now`. Falls back to the most recent OVERDUE
 * deadline when every date has passed, because "nothing upcoming" is unhelpful
 * when the real message is "you are late".
 */
export function deriveNextDeadline(
  weeks: readonly WeekProgressDetail[],
  now: Date,
): NextDeadline | null {
  const scheduled = weeks.filter(
    (w): w is WeekProgressDetail & { dueAt: Date } => w.dueAt instanceof Date,
  );
  if (scheduled.length === 0) return null;

  const describe = (w: WeekProgressDetail & { dueAt: Date }): NextDeadline => {
    const deltaMs = w.dueAt.getTime() - now.getTime();
    return {
      weekNumber: w.weekNumber,
      weekTitle: w.title,
      dueAt: w.dueAt,
      daysRemaining: Math.ceil(deltaMs / DAY_MS),
      overdue: deltaMs < 0,
    };
  };

  const upcoming = scheduled
    .filter((w) => w.dueAt.getTime() >= now.getTime())
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  if (upcoming.length > 0) return describe(upcoming[0]);

  const past = [...scheduled].sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime());
  return describe(past[0]);
}

/** Pure: week rows -> everything the dashboard renders. Safe on an empty array. */
export function buildDashboard(
  studentId: number,
  weeks: readonly WeekProgressDetail[],
  now: Date = new Date(),
): DashboardModel {
  const ordered = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  const totals = totalsFrom(ordered);

  const weeksUnlocked = ordered.filter((w) => w.unlocked).length;
  const weeksCompleted = ordered.filter(isWeekComplete).length;

  const unlockedNumbers = ordered.filter((w) => w.unlocked).map((w) => w.weekNumber);

  const isNewStudent =
    totals.totalScore === 0 &&
    ordered.every(
      (w) =>
        w.lecturesCompleted === 0 &&
        w.quizBestPercent == null &&
        !w.quizCompleted &&
        !w.assignmentCompleted,
    );

  return {
    studentId,
    weeks: ordered,
    totalScore: totals.totalScore,
    maxScore: totals.maxScore,
    overallPercent: totals.percent,
    weeksUnlocked,
    weeksCompleted,
    currentWeekNumber: unlockedNumbers.length > 0 ? Math.max(...unlockedNumbers) : null,
    nextAction: deriveNextAction(ordered),
    nextDeadline: deriveNextDeadline(ordered, now),
    isNewStudent,
  };
}

/** Cap of a single week, re-exported so the UI does not hardcode 70. */
export const WEEK_MAX_POINTS = POINTS.WEEK_MAX;

/**
 * Wire shape of `DashboardModel`: every `Date` becomes an ISO-8601 UTC string.
 *
 * Declared here rather than in the route file because Next.js type-checks the
 * exports of a `route.ts` and extra exports are not part of that contract.
 */
export type DashboardPayload = Omit<DashboardModel, "weeks" | "nextDeadline"> & {
  weeks: Array<Omit<WeekProgressDetail, "dueAt"> & { dueAt: string | null }>;
  nextDeadline: (Omit<NextDeadline, "dueAt"> & { dueAt: string }) | null;
};

/**
 * Serialise for JSON transport. Explicit rather than relying on
 * `JSON.stringify(Date)`: the output is the same today, but the payload type a
 * client compiles against is then the truth (`string`), not a `Date` that never
 * survives the wire.
 */
export function serialiseDashboard(model: DashboardModel): DashboardPayload {
  return {
    ...model,
    weeks: model.weeks.map((w) => ({ ...w, dueAt: w.dueAt ? w.dueAt.toISOString() : null })),
    nextDeadline: model.nextDeadline
      ? { ...model.nextDeadline, dueAt: model.nextDeadline.dueAt.toISOString() }
      : null,
  };
}

/**
 * The db-backed dashboard read. ONE database round trip: `getWeekProgressDetail`
 * runs the single aggregate statement and everything else is pure derivation.
 */
export async function getDashboard(studentId: number, now: Date = new Date()): Promise<DashboardModel> {
  const weeks = await getWeekProgressDetail(studentId);
  return buildDashboard(studentId, weeks, now);
}
