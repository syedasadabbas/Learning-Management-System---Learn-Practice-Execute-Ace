// =============================================================================
// /weeks/[weekId]/lectures/[lectureId] — the lecture view.
// Owner: course-content stream.
// -----------------------------------------------------------------------------
// Renders, in order: the video (or its honest placeholder), the markdown lesson,
// and the external practice links. Sandpack exercises from the same `resources`
// column are the interactive-exercises stream's surface, not this one — this page
// only mentions how many there are.
//
// GATED SERVER-SIDE, TWICE OVER:
//   1. `gateLecture(user.id, lectureId, weekId)` refuses the lecture when the
//      lecture's own week is locked for this student. This is the check that
//      makes a hand-typed URL useless.
//   2. The same call requires the lecture to actually belong to the weekId in the
//      path, so /weeks/1/lectures/12 cannot serve a Week 4 lecture through a
//      Week 1 URL (which would otherwise pass check 1).
// =============================================================================

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LockedNotice } from "@/components/course/LockedNotice";
import { MarkdownContent } from "@/components/course/MarkdownContent";
import { PracticeLinks } from "@/components/course/PracticeLinks";
import { TopicVideoSection } from "@/components/videos";
import {
  getLectureNeighbours,
  getWeekList,
} from "@/components/course/data";
// NOTE: the loader is imported from src/lib/navigation/guards.ts, not from its own
// module. That wrapper is the shared React `cache()` memo, and the sibling
// layout.tsx guard calls the SAME one — which is what makes this route's 404
// correct (the guard runs above this route's loading.tsx boundary, where the HTTP
// status is still settable) without paying for the query twice at ~245 ms a round
// trip. See that file and src/components/nav/PageSkeleton.tsx.
import { loadLectureGate } from "@/lib/navigation/guards";
import { linkResourcesFrom, sandpackResourceCount } from "@/components/course/resources";
import { LazyExerciseList } from "@/components/exercises/LazyExerciseList";
import { parseSandpackResources } from "@/lib/exercises";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lecture",
};

interface PageProps {
  params: Promise<{ weekId: string; lectureId: string }>;
}

export default async function LecturePage({ params }: PageProps) {
  const { weekId: rawWeekId, lectureId: rawLectureId } = await params;
  const weekId = Number(rawWeekId);
  const lectureId = Number(rawLectureId);

  const user = await requireUser(`/weeks/${rawWeekId}/lectures/${rawLectureId}`);

  if (!Number.isInteger(weekId) || weekId <= 0) notFound();

  const gate = await loadLectureGate(user.id, lectureId, weekId);

  if (!gate.ok && gate.kind === "not_found") notFound();

  if (!gate.ok) {
    const { items } = await getWeekList(user.id);
    const previous = items.find((w) => w.weekNumber === gate.lock.weekNumber - 1);

    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <LockedNotice
          weekNumber={gate.lock.weekNumber}
          title={gate.lock.title}
          reason={gate.lock.reason ?? "This week is not yet available."}
          previousWeekId={previous?.id}
        />
      </main>
    );
  }

  const { lecture, week } = gate;
  const links = linkResourcesFrom(lecture.resources);
  const interactiveCount = sandpackResourceCount(lecture.resources);
  const { previous, next } = await getLectureNeighbours(week.id, lecture.id);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-ink-muted">
        <Link href="/weeks" className="text-brand underline underline-offset-2">
          All weeks
        </Link>
        <span aria-hidden="true"> / </span>
        <Link
          href={`/weeks/${week.id}`}
          className="text-brand underline underline-offset-2"
        >
          Week {week.weekNumber}
        </Link>
      </nav>

      <header className="mb-4">
        <p className="text-sm text-ink-muted">
          Week {week.weekNumber}: {week.title}
        </p>
        <h1 data-testid="lecture-title" className="text-2xl font-bold text-ink">
          {lecture.lectureNumber}. {lecture.title}
        </h1>
      </header>

      <section aria-label="Lecture video" className="mb-6">
        {/*
          THE ONE-LINE ADOPTION the video-ingestion stream packaged and nobody
          performed. It was previously `<VideoEmbed source={lecture.youtubeUrl} …>`,
          and since every seeded lecture has youtubeUrl: null, that branch could
          only ever render "Video coming soon" — which is exactly what the owner
          reported seeing.

          TopicVideoSection does not reimplement the embed. It resolves an id via
          resolveLectureVideo (an APPROVED topic video wins over the pinned
          column) and delegates to the same VideoEmbed, so the nocookie-only host
          and the 11-character id validation stay where they already work. When
          nothing is approved it returns null and the honest placeholder is still
          what renders — no video is ever invented to fill the gap.
        */}
        <TopicVideoSection
          topicKey={lecture.topicKey}
          fallbackSource={lecture.youtubeUrl}
          title={lecture.title}
        />
      </section>

      <section aria-label="Lecture notes" className="mb-6">
        <MarkdownContent markdown={lecture.content} />
      </section>

      <section aria-label="Practice" className="mb-6">
        <Card title="Practice" subtitle="Opens on the external site in a new tab">
          <PracticeLinks links={links} interactiveCount={interactiveCount} />
        </Card>
      </section>

      {/*
        Live exercises, mounted at integration. The interactive-exercises stream
        built ExerciseList but could not edit this page (course-content's file), so
        the SKILL acceptance criterion — "a lecture with a sandpack resource shows
        an editable live editor" — was met only at /practice/[lectureId].

        Guarded by interactiveCount so the 8 of 12 seeded lectures with no sandpack
        resource render nothing here rather than an empty panel. parseSandpackResources
        never throws: a malformed starterCode becomes an "Unavailable" card and its
        siblings still render.
      */}
      {interactiveCount > 0 && (
        <section aria-label="Live exercises" className="mb-6">
          {/*
            LazyExerciseList, not ExerciseList: a static import put Sandpack in
            this route's bundle unconditionally, taking First Load JS from ~115 kB
            to 377 kB on the most-visited page in the app. See that file.
          */}
          <LazyExerciseList entries={parseSandpackResources(lecture.id, lecture.resources)} />
        </section>
      )}

      <nav
        aria-label="Lecture navigation"
        data-testid="lecture-nav"
        className="flex items-center justify-between gap-3 border-t border-line pt-4 text-sm"
      >
        {previous ? (
          <Link
            href={`/weeks/${week.id}/lectures/${previous.id}`}
            className="text-brand underline underline-offset-2"
          >
            ← {previous.lectureNumber}. {previous.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/weeks/${week.id}/lectures/${next.id}`}
            className="text-right text-brand underline underline-offset-2"
          >
            {next.lectureNumber}. {next.title} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
