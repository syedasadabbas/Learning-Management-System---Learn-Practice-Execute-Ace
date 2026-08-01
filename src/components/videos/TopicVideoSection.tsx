// =============================================================================
// TOPIC VIDEO SECTION — the drop-in for the lecture page. One line to adopt.
// -----------------------------------------------------------------------------
// Owner: video-ingestion stream.
//
// WHY THIS EXISTS AT ALL. The lecture page
// (`src/app/(app)/weeks/[weekId]/lectures/[lectureId]/page.tsx`) belongs to the
// course-content stream, which this stream may not edit. So the integration is
// packaged as a single async server component. When the course-content owner is
// ready, this:
//
//     <VideoEmbed source={lecture.youtubeUrl} title={lecture.title} />
//
// becomes this:
//
//     <TopicVideoSection
//       topicKey={lecture.topicKey}
//       fallbackSource={lecture.youtubeUrl}
//       title={lecture.title}
//     />
//
// and nothing else changes. Until that swap happens, no student-visible behaviour
// is altered by this stream at all.
//
// IT DOES NOT REIMPLEMENT THE EMBED. It resolves an id and delegates to the
// existing `VideoEmbed`, so the nocookie-only host, the 11-character id validation
// before anything reaches an iframe `src`, and the honest "Video coming soon"
// placeholder all stay exactly where they already work. `resolveLectureVideo`
// returns null when there is no APPROVED row, which means the placeholder is the
// default rendering — no video is ever invented to fill the gap.
// =============================================================================

import * as React from "react";

import { VideoEmbed } from "@/components/course/VideoEmbed";
import { formatDuration, resolveLectureVideo } from "@/lib/videos/read";

export interface TopicVideoSectionProps {
  /** `lectures.topic_key` — null on every seeded lecture today. */
  topicKey: string | null | undefined;
  /** `lectures.youtube_url`, used only when no approved topic video exists. */
  fallbackSource: string | null | undefined;
  /** Lecture title, for the iframe's accessible name. */
  title: string;
  /** Optional start offset in MILLISECONDS, passed straight through. */
  startMs?: number;
}

export async function TopicVideoSection({
  topicKey,
  fallbackSource,
  title,
  startMs,
}: TopicVideoSectionProps) {
  const { source, approved } = await resolveLectureVideo({ topicKey, fallbackSource });

  return (
    <div data-testid="topic-video" data-source={approved ? "approved-topic-video" : "lecture-column"}>
      <VideoEmbed source={source} title={title} startMs={startMs} />
      {approved && (
        <p className="mt-2 text-xs text-ink-muted">
          {/* Attribution is not decoration: the cohort is watching third-party
              content and should be able to see whose channel it came from. */}
          {approved.channelTitle ?? "Unknown channel"}
          {approved.durationSeconds !== null && ` · ${formatDuration(approved.durationSeconds)}`}
        </p>
      )}
    </div>
  );
}
