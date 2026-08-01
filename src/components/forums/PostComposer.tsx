"use client";

// =============================================================================
// COMPOSERS — the three forms that write to a forum, and the moderation buttons.
// -----------------------------------------------------------------------------
// Owner: forums stream. CLIENT component: it needs `useTransition` for pending
// state and `useState` for the draft and the error message.
//
// WHY THE ACTIONS ARE CALLED DIRECTLY RATHER THAN VIA A `<form action={...}>`
// The actions return a TYPED RESULT (`{ ok: false, error }`) rather than throwing
// or redirecting — see src/lib/forums/actions.ts, rule 4 — and a plain form action
// discards the return value. A refusal like "This discussion is locked" has to be
// SHOWN, and the only way to show it is to hold the promise. The trade-off, stated:
// this form does not work with JavaScript disabled. Every other write surface in
// this app has the same property (src/components/courses, src/lib/videos/actions),
// so it is the house behaviour and not a new regression.
//
// NO CLIENT-SIDE VALIDATION IS TRUSTED. `maxLength` below is a courtesy that stops
// a student typing past the limit; `normaliseTitle`/`normaliseBody` on the server
// are the enforcement, because an action is a plain HTTP POST target and no
// attribute in this file protects it (src/lib/courses/policy.ts:265).
//
// NOTHING IN THIS FILE ESCAPES OR STRIPS THE DRAFT. It is sent verbatim. The
// renderer is the security boundary — see ForumPostViewer.tsx's header, layer 4,
// for why sanitising here would corrupt every post containing a `<` and would
// double-escape on the author's next edit.
// =============================================================================

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui";
import {
  createPostAction,
  createTopicAction,
  removePostAction,
  setSolutionAction,
  setTopicLockedAction,
  updatePostAction,
  type ForumActionResult,
} from "@/lib/forums/actions";
import { POST_CONTENT_MAX, TOPIC_TITLE_MAX } from "@/lib/forums/policy";

/**
 * Shared submit plumbing: run an action, surface its refusal, refresh on success.
 *
 * `router.refresh()` rather than a local optimistic insert. The list rows carry
 * SQL-aggregated counts (`replyCount`, `hasSolution`, the last-activity ordering),
 * and an optimistic client-side insert would have to recompute all three in
 * JavaScript — a second implementation of the aggregate that can disagree with
 * the one in `listTopics`. A refresh re-renders the server component and the
 * numbers stay derived from exactly one place. The cost is one round trip (~245 ms
 * on this database) after a post, which is the correct trade for a number that
 * must not lie.
 */
function useForumAction(): {
  pending: boolean;
  error: string | null;
  run: (fn: () => Promise<ForumActionResult>, onDone?: () => void) => void;
  clearError: () => void;
} {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(
    (fn: () => Promise<ForumActionResult>, onDone?: () => void) => {
      setError(null);
      startTransition(async () => {
        const result = await fn();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onDone?.();
        router.refresh();
      });
    },
    [router],
  );

  return { pending, error, run, clearError: () => setError(null) };
}

/** The refusal line. One component so every form reports failure identically. */
function ActionError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p data-testid="forum-error" role="alert" className="text-sm text-red-700">
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// New thread
// ---------------------------------------------------------------------------

export interface NewTopicComposerProps {
  weekId: number;
}

export function NewTopicComposer({ weekId }: NewTopicComposerProps) {
  const { pending, error, run } = useForumAction();
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [open, setOpen] = React.useState(false);

  if (!open) {
    return (
      <Button
        data-testid="forum-new-topic-open"
        variant="primary"
        onClick={() => setOpen(true)}
      >
        Ask a question
      </Button>
    );
  }

  return (
    <div data-testid="forum-new-topic" className="space-y-2 rounded-lg border border-line bg-panel p-4">
      <label className="block text-sm font-medium text-ink" htmlFor="forum-title">
        Title
      </label>
      <input
        id="forum-title"
        name="title"
        data-testid="forum-title-input"
        value={title}
        maxLength={TOPIC_TITLE_MAX}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
        placeholder="What are you stuck on?"
      />

      <label className="block text-sm font-medium text-ink" htmlFor="forum-body">
        Details <span className="font-normal text-ink-muted">(optional, markdown)</span>
      </label>
      <textarea
        id="forum-body"
        name="description"
        data-testid="forum-body-input"
        value={body}
        rows={6}
        maxLength={POST_CONTENT_MAX}
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink"
        placeholder="Paste the code or describe what you tried. Fenced code blocks work."
      />

      <ActionError message={error} />

      <div className="flex gap-2">
        <Button
          data-testid="forum-new-topic-submit"
          loading={pending}
          disabled={pending || title.trim().length === 0}
          onClick={() =>
            run(() => createTopicAction(weekId, title, body), () => {
              setTitle("");
              setBody("");
              setOpen(false);
            })
          }
        >
          Post question
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reply
// ---------------------------------------------------------------------------

export interface ReplyComposerProps {
  topicId: number;
  /** False when the thread is locked or removed; the server refuses either way. */
  enabled: boolean;
  /** Copy explaining why replies are closed. */
  disabledReason?: string;
}

export function ReplyComposer({ topicId, enabled, disabledReason }: ReplyComposerProps) {
  const { pending, error, run } = useForumAction();
  const [body, setBody] = React.useState("");

  // Hiding the form is presentation only. `createPostAction` re-checks the lock
  // AND the INSERT itself carries `WHERE EXISTS (... is_locked = false)`, so a
  // caller who skips this UI entirely is still refused. Hiding a control is not
  // access control (src/components/course/data.ts:13).
  if (!enabled) {
    return (
      <p data-testid="forum-reply-closed" className="text-sm text-ink-muted italic">
        {disabledReason ?? "Replies are closed on this discussion."}
      </p>
    );
  }

  return (
    <div data-testid="forum-reply" className="space-y-2">
      <label className="block text-sm font-medium text-ink" htmlFor="forum-reply-body">
        Your reply <span className="font-normal text-ink-muted">(markdown)</span>
      </label>
      <textarea
        id="forum-reply-body"
        name="content"
        data-testid="forum-reply-input"
        value={body}
        rows={5}
        maxLength={POST_CONTENT_MAX}
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink"
      />
      <ActionError message={error} />
      <Button
        data-testid="forum-reply-submit"
        loading={pending}
        disabled={pending || body.trim().length === 0}
        onClick={() => run(() => createPostAction(topicId, body), () => setBody(""))}
      >
        Post reply
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-post controls
// ---------------------------------------------------------------------------

export interface PostControlsProps {
  postId: number;
  /** Current body, so Edit opens pre-filled instead of blank. */
  content: string;
  isSolution: boolean;
  /**
   * WHAT THIS VIEWER MAY DO, DECIDED ON THE SERVER by policy.ts and passed in as
   * booleans. This component re-derives NOTHING — it does not know the viewer's
   * role and does not compare ids. That is deliberate: a client-side authorization
   * derivation is a second copy of the rule that ships to the browser, where it
   * can be read and where it will eventually disagree with the server's copy.
   * These flags decide what is DRAWN; the action decides what HAPPENS.
   */
  canEdit: boolean;
  canRemove: boolean;
  canMarkSolution: boolean;
}

export function PostControls({
  postId,
  content,
  isSolution,
  canEdit,
  canRemove,
  canMarkSolution: mayMarkSolution,
}: PostControlsProps) {
  const { pending, error, run } = useForumAction();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(content);
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);
  const [reason, setReason] = React.useState("");

  if (!canEdit && !canRemove && !mayMarkSolution) return null;

  if (editing) {
    return (
      <div data-testid={`forum-edit-${postId}`} className="space-y-2">
        <textarea
          data-testid={`forum-edit-input-${postId}`}
          value={draft}
          rows={5}
          maxLength={POST_CONTENT_MAX}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink"
        />
        <ActionError message={error} />
        <div className="flex gap-2">
          <Button
            size="sm"
            data-testid={`forum-edit-save-${postId}`}
            loading={pending}
            disabled={pending || draft.trim().length === 0}
            onClick={() => run(() => updatePostAction(postId, draft), () => setEditing(false))}
          >
            Save
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (confirmingRemove) {
    // A CONFIRMATION STEP, not a bare button. Removal writes an attributable
    // tombstone that only a moderator can undo (there is no un-remove action), so
    // a mis-click must not perform it.
    return (
      <div data-testid={`forum-remove-${postId}`} className="space-y-2">
        <p className="text-sm text-ink">Remove this post? This cannot be undone from here.</p>
        <input
          data-testid={`forum-remove-reason-${postId}`}
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (shown to readers; moderators only)"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
        <ActionError message={error} />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="danger"
            data-testid={`forum-remove-confirm-${postId}`}
            loading={pending}
            disabled={pending}
            onClick={() => run(() => removePostAction(postId, reason))}
          >
            Remove
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => setConfirmingRemove(false)}
          >
            Keep
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canEdit && (
        <Button
          size="sm"
          variant="ghost"
          data-testid={`forum-edit-open-${postId}`}
          onClick={() => {
            setDraft(content);
            setEditing(true);
          }}
        >
          Edit
        </Button>
      )}
      {canRemove && (
        <Button
          size="sm"
          variant="ghost"
          data-testid={`forum-remove-open-${postId}`}
          onClick={() => setConfirmingRemove(true)}
        >
          Remove
        </Button>
      )}
      {mayMarkSolution && (
        <Button
          size="sm"
          variant="ghost"
          data-testid={`forum-solution-${postId}`}
          loading={pending}
          disabled={pending}
          onClick={() => run(() => setSolutionAction(postId, !isSolution))}
        >
          {isSolution ? "Unmark solution" : "Mark as solution"}
        </Button>
      )}
      <ActionError message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread-level moderation
// ---------------------------------------------------------------------------

export interface TopicModerationProps {
  topicId: number;
  isLocked: boolean;
  /** Server-decided. See PostControlsProps#canEdit for why this is a prop. */
  canAdminister: boolean;
}

export function TopicModeration({ topicId, isLocked, canAdminister }: TopicModerationProps) {
  const { pending, error, run } = useForumAction();
  if (!canAdminister) return null;

  return (
    <div data-testid="forum-topic-moderation" className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        data-testid="forum-lock-toggle"
        loading={pending}
        disabled={pending}
        onClick={() => run(() => setTopicLockedAction(topicId, !isLocked))}
      >
        {isLocked ? "Unlock discussion" : "Lock discussion"}
      </Button>
      <ActionError message={error} />
    </div>
  );
}
