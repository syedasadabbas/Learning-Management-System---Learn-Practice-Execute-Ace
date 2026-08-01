// =============================================================================
// FORUM POST RENDERER — the highest-risk surface in this codebase.
// -----------------------------------------------------------------------------
// Owner: forums stream. Server component (no "use client", no hooks).
//
// =============================================================================
// THE XSS ARGUMENT, IN FULL. This is the first place in the app where text
// authored by ONE STUDENT is rendered in ANOTHER STUDENT'S BROWSER. Every other
// markdown surface (`lectures.content`) is staff-authored. So the threat model
// changes here even though the renderer does not, and the reasoning has to be
// written down rather than inherited by accident.
// =============================================================================
//
// FIVE LAYERS, and the order matters — each one is sufficient on its own for the
// payload class it covers, and none of them relies on filtering the INPUT.
//
//  1. THE RENDERER DOES NOT INTERPRET HTML AT ALL.
//     `MarkdownContent` (src/components/course/MarkdownContent.tsx) is reused
//     verbatim — NOT reimplemented, NOT re-configured, NOT wrapped with extra
//     plugins. Its header already records the decision that makes it safe:
//     "`rehype-raw` is deliberately NOT used. Without it react-markdown escapes
//     embedded HTML, so a lecture body... cannot inject script tags." That
//     sentence was written about a staff-authored body; it is load-bearing for a
//     student-authored one. `<img src=x onerror=alert(1)>` in a post is therefore
//     never parsed into an element, so there is no element for an `onerror`
//     attribute to be attached to. Verified as a DOM assertion, not a string
//     match — see xss.test.tsx.
//
//     Reuse is itself part of the defence. A second markdown renderer for forums
//     would be a second place for `rehype-raw` to be added by someone who did not
//     read this comment, and the two would drift. There is one renderer.
//
//  2. URL PROTOCOLS ARE FILTERED BY react-markdown ITSELF.
//     `defaultUrlTransform` (node_modules/react-markdown/lib/index.js:416, v9.1.0)
//     is applied to every `href` and `src` a markdown link or image produces, and
//     returns "" for any URI whose scheme is not in its `safeProtocol` allowlist.
//     So `[click](javascript:alert(1))` renders an anchor with an EMPTY href, not
//     a script trigger. This runs by default; the risk is a future edit passing
//     `urlTransform={undefined ?? someCustomFn}` to MarkdownContent, which is why
//     that component takes no such prop.
//
//  3. NO `dangerouslySetInnerHTML` IN THIS STREAM.
//     Not in this file, not in ForumTopicList, not in the composer. Titles, author
//     names and removal reasons reach the DOM as React TEXT CHILDREN — `{title}`,
//     never `innerHTML` — so React escapes them as a property of how it renders,
//     with no call for anyone to remember. `grep -rn "dangerouslySetInnerHTML"
//     src/components/forums src/lib/forums src/app/\(app\)/forums` returns nothing,
//     and that is asserted mechanically in xss.test.tsx so it stays true.
//
//  4. NOTHING IS SANITISED ON THE WAY IN, AND THAT IS DELIBERATE.
//     `normaliseBody` (src/lib/forums/policy.ts) trims and truncates; it does not
//     escape. Escaping at write time is the tempting wrong answer:
//       * it CORRUPTS THE SOURCE. "Why does `a < b` fail?" is stored as
//         "a &lt; b", which every future reader sees literally and which the
//         author's own next edit re-escapes into "a &amp;lt; b". Double-escaping
//         on edit is not a hypothetical; it is the standard outcome.
//       * it is the WRONG LAYER. The same text may later be emailed, exported to
//         CSV, or rendered by a mobile client. An escaping pass tuned for HTML is
//         wrong in all three, whereas "the renderer does not interpret HTML" is
//         correct everywhere.
//     Storage is raw and inert; the RENDERER is the boundary. Asserted in
//     policy.test.ts ("a body is NOT escaped or stripped on the way in").
//
//  5. A REMOVED POST'S BODY IS NOT IN THE PROCESS.
//     `listPosts` (src/lib/forums/store.ts) selects
//     `CASE WHEN removed_at IS NULL THEN content ELSE NULL END`, so a moderated
//     body never crosses the wire from Postgres. This component cannot leak it
//     even by mistake, because it never has it. Property (a) of that file.
//
// WHAT IS **NOT** CLAIMED. This is not a sanitiser and there is no allowlist of
// tags, because no HTML is interpreted at all — an allowlist would be a strictly
// weaker control with more moving parts. Markdown-native abuse remains possible
// and is a MODERATION problem, not an injection one: a student can post a wall of
// headings, a 10 000-character code block, or a link whose text says one thing and
// whose href points elsewhere. The last of those is why links render with their
// href visible on hover and open in a new tab with rel="noopener noreferrer"
// (MarkdownContent's `a` component), and why removal exists.
// =============================================================================

import * as React from "react";

import { MarkdownContent } from "@/components/course/MarkdownContent";
import { Badge } from "@/components/ui";
import {
  REMOVED_POST_NOTICE,
  RETRACTED_POST_NOTICE,
} from "@/lib/forums/policy";
import type { PostView } from "@/lib/forums/store";

/** Absolute-ish UTC rendering, so no two readers disagree about the time. */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  // Fixed locale and explicit UTC: `toLocaleString()` with no arguments renders
  // differently on the server and the client, which React reports as a hydration
  // mismatch and which is genuinely ambiguous for a cohort spread across time
  // zones.
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export interface ForumPostViewerProps {
  posts: readonly PostView[];
  /** The reading user, so their own posts can be marked and offered controls. */
  viewerId: number;
  /** Rendered next to each post for a moderator. Built by the page. */
  renderControls?: (post: PostView) => React.ReactNode;
}

/**
 * A REMOVED POST STILL OCCUPIES ITS PLACE IN THE THREAD.
 *
 * This is the visible half of the tombstone decision argued in
 * src/db/schema.forums.ts. Hiding the post entirely would silently renumber the
 * conversation — replies below it would appear to answer whatever now precedes
 * them. The notice names WHO removed it (moderator vs author) because those are
 * different events and a student is entitled to know which happened to their post.
 */
function RemovedPost({ post }: { post: PostView }) {
  return (
    <li
      data-testid={`forum-post-${post.id}`}
      data-removed="true"
      data-removed-by={post.removedByModerator ? "moderator" : "author"}
      className="rounded-lg border border-dashed border-line bg-surface px-4 py-3"
    >
      <p className="text-sm text-ink-muted italic">
        {post.removedByModerator ? REMOVED_POST_NOTICE : RETRACTED_POST_NOTICE}
      </p>
      {/* The reason is a moderator's own words, rendered as a TEXT CHILD. */}
      {post.removalReason && (
        <p className="mt-1 text-sm text-ink-muted">Reason: {post.removalReason}</p>
      )}
    </li>
  );
}

export function ForumPostViewer({
  posts,
  viewerId,
  renderControls,
}: ForumPostViewerProps) {
  if (posts.length === 0) {
    return (
      <p data-testid="forum-thread-empty" className="text-sm text-ink-muted italic">
        No replies yet. Be the first to answer.
      </p>
    );
  }

  return (
    <ol data-testid="forum-thread" className="space-y-4">
      {posts.map((post) => {
        // `content === null` IS the removal signal, and it is checked as well as
        // `post.removed` because the two come from the same row and disagreeing
        // would mean rendering an empty body as if it were a real post. The store
        // guarantees they agree; this is the assertion that they do.
        if (post.removed || post.content === null) {
          return <RemovedPost key={post.id} post={post} />;
        }

        const isOwn = post.authorId === viewerId;

        return (
          <li
            key={post.id}
            id={`post-${post.id}`}
            data-testid={`forum-post-${post.id}`}
            data-own={isOwn ? "true" : "false"}
            data-solution={post.isSolution ? "true" : "false"}
            className={
              post.isSolution
                ? "rounded-lg border-2 border-brand/60 bg-panel px-4 py-3"
                : "rounded-lg border border-line bg-panel px-4 py-3"
            }
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {/* Author name as a TEXT CHILD. React escapes it; there is no
                  innerHTML path here. A name is not markdown and is deliberately
                  NOT passed through MarkdownContent — rendering a display name as
                  markdown would let "**Staff**" impersonate emphasis the UI uses
                  for real signals. */}
              <span className="text-sm font-semibold text-ink">{post.authorName}</span>
              {isOwn && (
                <Badge tone="neutral" size="sm">
                  You
                </Badge>
              )}
              {post.isSolution && (
                <Badge tone="success" size="sm">
                  Solution
                </Badge>
              )}
              <span className="text-xs text-ink-muted">{formatWhen(post.createdAt)}</span>
              {/* Sourced from `edited_at`, which ONLY an author's own edit sets —
                  see src/db/schema.forums.ts. Labelling a moderated post "edited"
                  would be a false statement about a student. */}
              {post.edited && <span className="text-xs text-ink-muted italic">edited</span>}
            </div>

            {/* THE PAYLOAD BOUNDARY. Student-authored markdown, rendered by the
                ONE renderer in this app that does not interpret HTML. See layers
                1 and 2 in the file header. */}
            <MarkdownContent markdown={post.content} className="text-sm" />

            {renderControls && <div className="mt-3">{renderControls(post)}</div>}
          </li>
        );
      })}
    </ol>
  );
}
