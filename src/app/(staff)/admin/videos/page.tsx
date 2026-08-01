// =============================================================================
// /admin/videos — review harvested video candidates. video-ingestion stream.
// -----------------------------------------------------------------------------
// ADMIN ONLY, on purpose and at two levels. The `(staff)` layout already applied
// `requireRole("instructor")`, which admits instructors as well
// (`ROLES_SATISFYING.instructor` is ["instructor","admin"]). This page restates
// `requireRole("admin")` because approving a video publishes third-party content
// to the whole cohort — the same class of act as quiz authoring, which is
// admin-only here for the same reason. The full argument, and the cost of the
// choice, is in `src/lib/videos/access.ts`.
//
// The guard is repeated in every server action the page's buttons call. A page
// guard protects the render; it does not protect the mutation.
//
// WHAT THE PAGE SAYS WHEN IT IS EMPTY — which is its state today — matters more
// than the queue itself: nobody has supplied a curated list yet, so there are no
// candidates, no lecture shows a video, and the honest placeholder stands. The
// empty state therefore explains exactly what file to hand over and what command
// to run, rather than showing a blank panel.
//
// NOT IN THE NAV. `src/components/nav/nav-links.ts` is owned by ui-shell and is
// read-only for this stream, so /admin/videos is reachable by URL (and from the
// note below) until that file gains an entry. Flagged in the stream report.
// =============================================================================

import type { Metadata } from "next";

import { Badge, Card } from "@/components/ui";
import { ReviewQueue, type ReviewQueueItem } from "@/components/videos";
import { requireRole } from "@/lib/guard";
import { RSS_FEED_TYPICAL_ITEM_COUNT } from "@/lib/videos/rss";
import {
  countByStatus,
  listLectureTopicKeys,
  listReviewRows,
  type ReviewRow,
} from "@/lib/videos/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Video review",
};

/**
 * Dates cross the server/client boundary as ISO strings. A `Date` would be
 * serialised anyway; doing it explicitly keeps the client component's props typed
 * as what it actually receives.
 */
function toItem(row: ReviewRow): ReviewQueueItem {
  return {
    id: row.id,
    topicKey: row.topicKey,
    youtubeId: row.youtubeId,
    title: row.title,
    channelTitle: row.channelTitle,
    durationSeconds: row.durationSeconds,
    status: row.status,
    source: row.source,
    lectureCount: row.lectureCount,
    reviewerName: row.reviewerName,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
  };
}

export default async function AdminVideosPage() {
  await requireRole("admin");

  const [rows, counts, topicKeys] = await Promise.all([
    listReviewRows(),
    countByStatus(),
    listLectureTopicKeys(),
  ]);

  const candidates = rows.filter((r) => r.status === "candidate").map(toItem);
  const decided = rows.filter((r) => r.status !== "candidate").map(toItem);

  const topicsWithApproved = new Set(
    rows.filter((r) => r.status === "approved").map((r) => r.topicKey),
  );
  const topicsWithoutVideo = topicKeys.filter((k) => !topicsWithApproved.has(k));

  return (
    <div className="space-y-6" data-testid="admin-videos">
      <header>
        <h1 className="text-2xl font-semibold">Video review</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Candidates are harvested from a curated id list (and, optionally, a
          channel RSS feed) and validated against YouTube&apos;s keyless oEmbed
          endpoint — so every id below is confirmed to resolve. Nothing here is
          visible to a student until you approve it.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-sm" data-testid="video-status-counts">
        <Badge tone="warning">{counts.candidate} awaiting review</Badge>
        <Badge tone="success">{counts.approved} approved</Badge>
        <Badge tone="neutral">{counts.rejected} rejected</Badge>
        <Badge tone="brand">{topicKeys.length} lecture topic keys</Badge>
      </div>

      <ReviewQueue
        title={`Awaiting review (${candidates.length})`}
        subtitle="Watch it on YouTube first. Approving publishes it to the cohort."
        items={candidates}
        emptyTitle="No candidates awaiting review"
        emptyDescription={
          counts.approved + counts.rejected > 0
            ? "Everything harvested so far has been reviewed. Re-run the harvester after adding rows to the curated list."
            : "No curated list has been ingested yet, so no lecture shows a video and every lecture keeps its “video coming soon” placeholder."
        }
      />

      <Card
        title="How candidates get here"
        subtitle="No API key is involved in any step."
      >
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-muted">
          <li>
            <strong className="text-ink">Curated list — the primary path.</strong>{" "}
            A CSV or JSON file mapping a <code>topic_key</code> to a YouTube id or
            URL, chosen by a human. Header row:{" "}
            <code>topic_key,video,duration_seconds,order_index</code> — the last
            two are optional, and <code>duration_seconds</code> is the only source
            of a video&apos;s length, because oEmbed does not report one.
            <br />
            <code className="text-xs">
              npx tsx scripts/harvest-videos.ts --curated=./videos.csv
            </code>
          </li>
          <li>
            <strong className="text-ink">Channel RSS — a supplement only.</strong>{" "}
            A channel feed returns roughly the{" "}
            {RSS_FEED_TYPICAL_ITEM_COUNT} most recent uploads and nothing more:
            there is no search or paging without the paid-key Data API, so RSS
            cannot cover a syllabus of dozens of specific topics. Use it to sweep a
            partner channel&apos;s new videos into the queue.
            <br />
            <code className="text-xs">
              npx tsx scripts/harvest-videos.ts --channel-id=UC…
              --rss-topic-key=html-forms
            </code>
          </li>
          <li>
            <strong className="text-ink">Every id is validated</strong> through
            oEmbed. A 404 (deleted, private, never existed) is rejected outright
            rather than stored, so an approved row cannot become a dead embed.
          </li>
          <li>
            <strong className="text-ink">You approve or reject.</strong> Both
            record you and the timestamp. Re-running the harvester never changes a
            decision you have made.
          </li>
        </ol>
      </Card>

      {topicsWithoutVideo.length > 0 && (
        <Card
          title={`Lecture topics with no approved video (${topicsWithoutVideo.length})`}
          subtitle="These lectures show the “video coming soon” placeholder. Nothing is invented to fill them."
        >
          <ul className="flex flex-wrap gap-2">
            {topicsWithoutVideo.map((key) => (
              <li key={key}>
                <Badge tone="neutral" size="sm">
                  {key}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {topicKeys.length === 0 && (
        <Card title="No lecture has a topic key yet">
          <p className="max-w-prose text-sm text-ink-muted">
            <code>lectures.topic_key</code> is null on every seeded lecture, so an
            approved video has nothing to attach to yet. Set a topic key per
            lecture first (a stable slug such as <code>html-forms</code>, which
            survives a reseed — lecture ids do not), then harvest against those
            keys.
          </p>
        </Card>
      )}

      {decided.length > 0 && (
        <ReviewQueue
          title={`Already reviewed (${decided.length})`}
          subtitle="Rejected rows are kept so a re-harvest does not resurface them."
          items={decided}
          emptyTitle="Nothing reviewed yet"
        />
      )}
    </div>
  );
}
