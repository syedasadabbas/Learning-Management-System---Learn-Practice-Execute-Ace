"use client";

// =============================================================================
// VIDEO REVIEW QUEUE — the human in "human review". video-ingestion stream.
// -----------------------------------------------------------------------------
// Owner: video-ingestion stream.
//
// WHAT AN ADMIN NEEDS TO DECIDE, and therefore what every row shows: the
// thumbnail, the oEmbed-confirmed title and channel, the length in
// minutes:seconds (or an explicit "Duration unknown" — oEmbed has no duration
// field, so a number here only ever comes from the curated list), the topic key it
// would attach to, and whether any lecture currently claims that topic. That last
// one answers "will approving this actually make a video appear?", which matters
// because `topic_key` is not a foreign key.
//
// THIS COMPONENT DECIDES NOTHING ABOUT ACCESS. Both buttons call an admin-guarded
// server action; rendering them to an instructor would still be refused
// server-side. A hidden button is not access control.
//
// THE THUMBNAIL IS AN i.ytimg.com REQUEST — an admin-only page loading an image
// from Google. That is a deliberate, narrower trade than the student-facing embed,
// which is why the student path stays on youtube-nocookie.com and this page does
// not preview playback. `referrerPolicy="no-referrer"` withholds the LMS URL, and
// a plain <img> is used rather than next/image so no remote host has to be added
// to the shared next.config (which this stream does not own).
//
// Optimistic-ish UI: the row is marked pending, the action runs, and the result
// replaces the row's status locally as well as revalidating the page. If the
// action fails, the row reverts and a sticky error toast says so — an admin must
// never be left believing a video is approved when the write failed.
// =============================================================================

import * as React from "react";

import { Badge, Button, Card, EmptyState, Toast } from "@/components/ui";
import {
  approveVideoAction,
  rejectVideoAction,
  returnVideoToQueueAction,
} from "@/lib/videos/actions";
// From the PURE module, never from ./read (which imports @/db and would
// pull `pg` into this client bundle — it did, and it broke `next build`).
import { formatDuration } from "@/lib/videos/format";
import { thumbnailUrlFor } from "@/lib/videos/oembed";

export interface ReviewQueueItem {
  id: number;
  topicKey: string;
  youtubeId: string;
  title: string | null;
  channelTitle: string | null;
  /** SECONDS (SI). Null renders as "Duration unknown", never as 0:00. */
  durationSeconds: number | null;
  status: "candidate" | "approved" | "rejected";
  source: string;
  lectureCount: number;
  reviewerName: string | null;
  reviewedAt: string | null;
}

export interface ReviewQueueProps {
  items: ReviewQueueItem[];
  /** Heading, e.g. "Awaiting review (7)". */
  title: string;
  subtitle?: React.ReactNode;
  emptyTitle: string;
  emptyDescription?: string;
}

const STATUS_TONE = {
  candidate: "warning",
  approved: "success",
  rejected: "neutral",
} as const;

export function ReviewQueue({
  items,
  title,
  subtitle,
  emptyTitle,
  emptyDescription,
}: ReviewQueueProps) {
  const [pendingId, setPendingId] = React.useState<number | null>(null);
  const [overrides, setOverrides] = React.useState<
    Record<number, ReviewQueueItem["status"]>
  >({});
  const [error, setError] = React.useState<string | null>(null);

  async function run(
    id: number,
    action: (videoId: number) => Promise<{ ok: boolean; error?: string; status?: string }>,
  ) {
    setPendingId(id);
    setError(null);
    const result = await action(id);
    setPendingId(null);

    if (!result.ok) {
      setError(result.error ?? "The review decision was not saved.");
      return;
    }
    setOverrides((prev) => ({
      ...prev,
      [id]: (result.status ?? "candidate") as ReviewQueueItem["status"],
    }));
  }

  if (items.length === 0) {
    return (
      <Card title={title} subtitle={subtitle}>
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </Card>
    );
  }

  return (
    <Card padded={false} title={title} subtitle={subtitle}>
      {error && (
        <div className="px-4 pt-3">
          {/* Sticky (autoDismissMs omitted): a failure an admin can miss is not a
              failure report. */}
          <Toast tone="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      <ul className="divide-y divide-line" data-testid="video-review-list">
        {items.map((item) => {
          const status = overrides[item.id] ?? item.status;
          const busy = pendingId === item.id;

          return (
            <li
              key={item.id}
              data-testid={`video-row-${item.id}`}
              data-status={status}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- see header:
                  a remote host would have to be registered in next.config, which
                  this stream does not own. */}
              <img
                src={thumbnailUrlFor(item.youtubeId)}
                alt=""
                aria-hidden="true"
                width={160}
                height={90}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-40 shrink-0 rounded border border-line bg-surface object-cover"
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">
                  {/* The title is the oEmbed-confirmed one. A row with no title
                      cannot exist — validateVideo refuses a titleless payload. */}
                  {item.title ?? item.youtubeId}
                </p>
                <p className="text-xs text-ink-muted">
                  {item.channelTitle ?? "Channel unknown"} ·{" "}
                  <span data-testid={`video-duration-${item.id}`}>
                    {formatDuration(item.durationSeconds)}
                  </span>{" "}
                  · id <code>{item.youtubeId}</code>
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="brand" size="sm">
                    {item.topicKey}
                  </Badge>
                  <Badge tone={STATUS_TONE[status]} size="sm">
                    {status}
                  </Badge>
                  <Badge tone="neutral" size="sm">
                    {item.source}
                  </Badge>
                  {item.lectureCount === 0 && (
                    <span className="text-amber-900">
                      No lecture claims this topic key yet — approving it shows
                      nothing to students until one does.
                    </span>
                  )}
                  {status !== "candidate" && item.reviewerName && (
                    <span className="text-ink-muted">
                      reviewed by {item.reviewerName}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs">
                  <a
                    href={`https://www.youtube.com/watch?v=${item.youtubeId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand underline underline-offset-2"
                  >
                    Watch on YouTube before approving
                  </a>
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                {status === "candidate" ? (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      loading={busy}
                      disabled={busy}
                      data-testid={`approve-video-${item.id}`}
                      onClick={() => run(item.id, approveVideoAction)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      disabled={busy}
                      data-testid={`reject-video-${item.id}`}
                      onClick={() => run(item.id, rejectVideoAction)}
                    >
                      Reject
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy}
                    disabled={busy}
                    data-testid={`requeue-video-${item.id}`}
                    onClick={() => run(item.id, returnVideoToQueueAction)}
                  >
                    Undo
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
