// =============================================================================
// /forums/[weekId]/[topicId] — one thread.
// -----------------------------------------------------------------------------
// Owner: forums stream.
//
// TWO INDEPENDENT REFUSALS GUARD THIS URL, and both are needed:
//
//  1. THE WEEK GATE. `gateForumWeek` refuses a week that is not in the active
//     course (`not_found`) or is locked (`LockedNotice`) — the same decision
//     /weeks/[weekId] makes, inherited rather than restated. See
//     src/lib/forums/access.ts.
//
//  2. THE TOPIC-BELONGS-TO-THE-WEEK CHECK. `getTopic(topicId, weekId)` filters on
//     BOTH ids, so /forums/1/<a-week-4-topic> is a 404 rather than week 4's
//     withheld discussion rendered behind week 1's open gate. Without it the first
//     guard would be trivially bypassable by pairing any readable week with any
//     topic id. This is the same defect `gateLecture`'s `weekIdHint` closes
//     (src/components/course/data.ts:376), and it is the reason `getTopic` takes a
//     week id at all.
//
// EVERY PER-POST CONTROL IS DECIDED HERE, ON THE SERVER, BY policy.ts. The client
// component receives booleans and re-derives nothing — it does not know the
// viewer's role. A client-side authorization derivation is a second copy of the
// rule that ships to the browser, where it can be read and where it will
// eventually disagree with the server's copy. And the buttons are not the control
// in any case: each action re-checks (src/lib/forums/actions.ts, rule 1), and the
// UPDATE that performs an edit carries `author_id = <session user>` in its WHERE
// clause (src/lib/forums/store.ts, property (b)).
//
// QUERY BUDGET: 4 STATEMENTS, SEQUENTIAL DEPTH 1 (~245 ms). `getWeekList` (2,
// internally concurrent), `getTopic` (1) and `listPosts` (1), all issued together.
// The post list is ONE statement for the whole thread — author names are JOINed,
// not looked up per post, which is the other classic N+1 on a page like this.
// =============================================================================

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LockedNotice } from "@/components/course/LockedNotice";
import { MarkdownContent } from "@/components/course/MarkdownContent";
import { getWeekList } from "@/components/course/data";
import {
  ForumPostViewer,
  PostControls,
  ReplyComposer,
  TopicModeration,
} from "@/components/forums";
import { Badge, EmptyState } from "@/components/ui";
import { gateForumWeek, requireForumUser } from "@/lib/forums/access";
import {
  canAdministerTopic,
  canEditPost,
  canMarkSolution,
  canRemovePost,
  canReply,
  REPLY_REFUSAL_MESSAGE,
} from "@/lib/forums/policy";
import { getTopic, listPosts } from "@/lib/forums/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discussion",
};

interface PageProps {
  params: Promise<{ weekId: string; topicId: string }>;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function ForumThreadPage({ params }: PageProps) {
  const { weekId: rawWeekId, topicId: rawTopicId } = await params;
  const weekId = Number(rawWeekId);
  const topicId = Number(rawTopicId);

  const user = await requireForumUser(`/forums/${rawWeekId}/${rawTopicId}`);

  if (!Number.isInteger(weekId) || weekId <= 0) notFound();
  if (!Number.isInteger(topicId) || topicId <= 0) notFound();

  // All four statements on the wire at once. `getTopic` carries the week id, so a
  // mismatched pair resolves to null regardless of what the gate says.
  const [gate, topic, posts] = await Promise.all([
    gateForumWeek(user.id, weekId),
    getTopic(topicId, weekId),
    listPosts(topicId),
  ]);

  if (!gate.ok && gate.kind === "not_found") notFound();

  if (!gate.ok) {
    // Locked week. `topic` and `posts` are discarded unread.
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

  // Null covers both "no such topic" and "that topic belongs to another week".
  if (!topic) notFound();

  const viewer = { id: user.id, role: user.role };
  const mayModerate = canAdministerTopic(user.role);
  const mayMarkSolution = canMarkSolution(user.role);

  // A tombstoned thread is a NOTICE, not a 404: the URL was valid yesterday and a
  // 404 would read as "the link is broken" rather than "a moderator took this
  // down". Its body and its posts are withheld — the store never selected them.
  if (topic.removed) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6" data-testid="forum-thread-removed">
        <nav aria-label="Breadcrumb" className="mb-3 text-sm">
          <Link href={`/forums/${weekId}`} className="text-brand underline underline-offset-2">
            Back to Week {gate.week.weekNumber} discussions
          </Link>
        </nav>
        <EmptyState
          icon={<span className="text-2xl">🚫</span>}
          title="This discussion was removed"
          description={
            topic.removalReason
              ? `Reason: ${topic.removalReason}`
              : "A moderator removed this discussion."
          }
        />
      </main>
    );
  }

  const replyEligibility = canReply({
    viewer,
    topicLocked: topic.isLocked,
    topicRemoved: topic.removed,
  });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6" data-testid="forum-thread-page">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm">
        <Link href={`/forums/${weekId}`} className="text-brand underline underline-offset-2">
          Back to Week {gate.week.weekNumber} discussions
        </Link>
      </nav>

      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {topic.isPinned && (
            <Badge tone="brand" size="sm">
              Pinned
            </Badge>
          )}
          {topic.isLocked && (
            <Badge tone="neutral" size="sm">
              Locked
            </Badge>
          )}
        </div>
        {/* A TITLE IS TEXT, never markdown and never markup. See
            src/components/forums/ForumTopicList.tsx's header. */}
        <h1 data-testid="forum-topic-title" className="mt-1 text-2xl font-bold text-ink">
          {topic.title}
        </h1>
        <p className="mt-1 text-xs text-ink-muted">
          {topic.authorName} · {formatWhen(topic.createdAt)}
        </p>
      </header>

      {/* THE OPENING POST. Student-authored markdown through the one renderer that
          does not interpret HTML — see src/components/forums/ForumPostViewer.tsx
          for the five-layer XSS argument that covers this call too. */}
      {topic.description && (
        <section
          data-testid="forum-topic-body"
          className="mb-6 rounded-lg border border-line bg-panel px-4 py-3"
        >
          <MarkdownContent markdown={topic.description} className="text-sm" />
        </section>
      )}

      {mayModerate && (
        <div className="mb-5">
          <TopicModeration
            topicId={topic.id}
            isLocked={topic.isLocked}
            canAdminister={mayModerate}
          />
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold text-ink">
        {posts.length} {posts.length === 1 ? "reply" : "replies"}
      </h2>

      <ForumPostViewer
        posts={posts}
        viewerId={user.id}
        renderControls={(post) => {
          // A removed post gets no controls: there is nothing to edit and a second
          // removal is refused (policy.ts#canRemovePost -> already_removed).
          if (post.removed) return null;

          // THE SERVER DECIDES. Both calls go through policy.ts over the row's own
          // facts — never an inline `post.authorId === user.id` comparison in this
          // page, because that would be a second copy of the ownership rule that
          // policy.test.ts does not cover.
          const subject = {
            authorId: post.authorId,
            removed: post.removed,
            topicLocked: topic.isLocked,
            topicRemoved: topic.removed,
          };
          const edit = canEditPost({ viewer, post: subject });
          const remove = canRemovePost({ viewer, post: subject });

          return (
            <PostControls
              postId={post.id}
              content={post.content ?? ""}
              isSolution={post.isSolution}
              canEdit={edit.canEdit}
              canRemove={remove.canRemove}
              canMarkSolution={mayMarkSolution}
            />
          );
        }}
      />

      <div className="mt-6 border-t border-line pt-4">
        <ReplyComposer
          topicId={topic.id}
          enabled={replyEligibility.canReply}
          disabledReason={
            replyEligibility.canReply
              ? undefined
              : REPLY_REFUSAL_MESSAGE[replyEligibility.refusal]
          }
        />
      </div>
    </main>
  );
}
