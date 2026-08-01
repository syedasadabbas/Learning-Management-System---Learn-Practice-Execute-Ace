// =============================================================================
// LECTURE VIDEO — privacy-mode YouTube embed, or an honest placeholder.
// -----------------------------------------------------------------------------
// Owner: course-content stream.
//
// EVERY SEEDED `youtubeUrl` IS NULL. scripts/seed-content.ts says so explicitly:
// real video ids must come from the course owner, and inventing ids would ship
// embeds that 404 — worse than admitting the video is not recorded yet. So the
// null branch is not an edge case here, it is the current default rendering, and
// it is written to be presentable rather than apologetic.
//
// The embed branch is fully implemented and switches on automatically the moment
// a row gets a real URL or id — no code change needed.
// =============================================================================

import * as React from "react";

import { youTubeEmbedUrl, youTubeWatchUrl, type YouTubeSource } from "./youtube";

export interface VideoEmbedProps {
  /** Raw `lectures.youtube_url` value: full URL, bare id, or null. */
  source: YouTubeSource;
  /** Lecture title, folded into the iframe's accessible name. */
  title: string;
  /** Optional start offset in milliseconds (house rule: metric units). */
  startMs?: number;
}

export function VideoEmbed({ source, title, startMs }: VideoEmbedProps) {
  const embedUrl = youTubeEmbedUrl(source, { startMs });

  if (!embedUrl) {
    return (
      <div
        data-testid="video-placeholder"
        className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-surface px-6 text-center"
      >
        <span aria-hidden="true" className="text-2xl text-ink-muted opacity-70">
          ▶
        </span>
        <p className="text-base font-semibold text-ink">Video coming soon</p>
        <p className="max-w-prose text-sm text-ink-muted">
          The recording for this lecture has not been published yet. The written
          lesson below is complete — work through that and the practice links.
        </p>
      </div>
    );
  }

  const watchUrl = youTubeWatchUrl(source);

  return (
    <figure data-testid="video-embed" className="w-full">
      <div className="aspect-video w-full overflow-hidden rounded-lg border border-line bg-black">
        <iframe
          // youtube-nocookie.com: no tracking cookie is set before playback.
          src={embedUrl}
          title={`Lecture video: ${title}`}
          className="h-full w-full"
          // Only what a video player needs. No camera, microphone, or payment.
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          allowFullScreen
        />
      </div>
      {watchUrl && (
        <figcaption className="mt-2 text-sm text-ink-muted">
          Trouble with the embed?{" "}
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-ink"
          >
            Open this video on YouTube
          </a>
          .
        </figcaption>
      )}
    </figure>
  );
}
