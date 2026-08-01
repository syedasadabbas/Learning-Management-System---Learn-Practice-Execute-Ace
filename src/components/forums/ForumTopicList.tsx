// =============================================================================
// THREAD LIST — one row per topic, with its SQL-aggregated reply count.
// -----------------------------------------------------------------------------
// Owner: forums stream. Server component.
//
// EVERY NUMBER ON THIS SCREEN ARRIVES PRE-AGGREGATED. `replyCount`,
// `lastReplyAt` and `hasSolution` come out of the single `listTopics` statement
// (src/lib/forums/store.ts) — this component performs no fetch, no count and no
// `await`. That is the N+1 requirement expressed as a component contract: a
// props-only list CANNOT become 20 round trips later, because there is nothing
// here to make a round trip with. If a future column needs data this shape does
// not carry, it belongs in that GROUP BY, not in a per-row read.
//
// A TITLE IS NOT MARKDOWN. Titles render as React text children, deliberately NOT
// through MarkdownContent — see src/components/forums/ForumPostViewer.tsx for the
// full XSS argument, and note the additional reason here: rendering a display
// title as markdown would let "**URGENT**" borrow the emphasis the UI reserves for
// real signals (pinned, solved), and "[text](url)" would put a student-controlled
// link in a list row. Plain text is both safer and more honest.
// =============================================================================

import * as React from "react";
import Link from "next/link";

import { Badge, EmptyState } from "@/components/ui";
import type { TopicListItem } from "@/lib/forums/store";

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  // Fixed UTC formatting for the same server/client hydration reason as
  // ForumPostViewer#formatWhen.
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export interface ForumTopicListProps {
  weekId: number;
  topics: readonly TopicListItem[];
  /** The reading user, so their own threads are marked. */
  viewerId: number;
}

export function ForumTopicList({ weekId, topics, viewerId }: ForumTopicListProps) {
  if (topics.length === 0) {
    return (
      <EmptyState
        icon={<span className="text-2xl">💬</span>}
        title="No discussions yet"
        description="Ask the first question about this week. Classmates and your instructor can answer here instead of by email."
      />
    );
  }

  return (
    <ul data-testid="forum-topic-list" className="space-y-2">
      {topics.map((topic) => (
        <li
          key={topic.id}
          data-testid={`forum-topic-${topic.id}`}
          data-pinned={topic.isPinned ? "true" : "false"}
          data-locked={topic.isLocked ? "true" : "false"}
          data-reply-count={topic.replyCount}
          className="rounded-lg border border-line bg-panel"
        >
          {/* The whole row is the link target. A locked thread is still READABLE
              — locking closes replies, not reading — so unlike a locked WEEK card
              (src/components/course/WeekCard.tsx, which renders no anchor at all)
              this always links. */}
          <Link
            href={`/forums/${weekId}/${topic.id}`}
            className="block px-4 py-3 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <div className="flex flex-wrap items-center gap-2">
              {topic.isPinned && (
                <Badge tone="brand" size="sm">
                  Pinned
                </Badge>
              )}
              {topic.hasSolution && (
                <Badge tone="success" size="sm">
                  Solved
                </Badge>
              )}
              {topic.isLocked && (
                <Badge tone="neutral" size="sm">
                  Locked
                </Badge>
              )}
              {/* TEXT CHILD. See the file header. */}
              <span className="font-medium text-ink">{topic.title}</span>
            </div>

            <p className="mt-1 text-xs text-ink-muted">
              <span>{topic.authorName}</span>
              {topic.authorId === viewerId && <span> (you)</span>}
              <span>
                {" · "}
                {/* Singular/plural stated rather than "1 replies". The count is
                    the aggregate from SQL. */}
                {topic.replyCount} {topic.replyCount === 1 ? "reply" : "replies"}
              </span>
              {topic.lastReplyAt ? (
                <span>
                  {" · last reply "}
                  {formatWhen(topic.lastReplyAt)}
                </span>
              ) : (
                <span>
                  {" · opened "}
                  {formatWhen(topic.createdAt)}
                </span>
              )}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
