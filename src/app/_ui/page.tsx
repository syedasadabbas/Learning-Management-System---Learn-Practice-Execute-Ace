"use client";

import * as React from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  LockBadge,
  ProgressBar,
  Skeleton,
  StarRating,
  Toast,
  ToastViewport,
  cn,
  type BadgeTone,
  type ButtonSize,
  type ButtonVariant,
  type ToastTone,
} from "@/components/ui";
import { AppShell, NAV_LINKS, ROLES, ROLE_LABEL, type Role } from "@/components/nav";

// OWNERSHIP: ui-shell stream.
//
// Storybook-style reference for every primitive in every meaningful state, at
// the URL /_ui. NOTE ON THE FOLDER NAME: App Router treats a folder starting
// with "_" as PRIVATE and gives it no route at all, so a literal `_ui/` would
// 404. `%5Fui/` is the documented Next.js escape that produces the URL /_ui.
//
// This is the reference implementation other streams copy from: no page here
// styles anything itself, every colour comes from a token, and the whole page
// is one client component only because it drives live interactive state.

const BUTTON_VARIANTS: readonly ButtonVariant[] = [
  "primary",
  "secondary",
  "accent",
  "ghost",
  "danger",
];
const BUTTON_SIZES: readonly ButtonSize[] = ["sm", "md", "lg"];
const BADGE_TONES: readonly BadgeTone[] = [
  "brand",
  "accent",
  "neutral",
  "success",
  "warning",
  "danger",
];
const TOAST_TONES: readonly ToastTone[] = [
  "info",
  "success",
  "warning",
  "error",
];

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-testid={`section-${id}`}
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-3"
    >
      <div>
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          {title}
        </h2>
        {note && <p className="mt-0.5 text-sm text-ink-muted">{note}</p>}
      </div>
      <div className="rounded-lg border border-line bg-panel p-4">
        {children}
      </div>
    </section>
  );
}

export default function UiReferencePage() {
  const [role, setRole] = React.useState<Role>("student");
  const [rating, setRating] = React.useState(0);
  const [clickCount, setClickCount] = React.useState(0);
  const [toasts, setToasts] = React.useState<
    { id: number; tone: ToastTone }[]
  >([]);

  function pushToast(tone: ToastTone) {
    setToasts((prev) => [...prev, { id: Date.now() + prev.length, tone }]);
  }

  return (
    <AppShell
      role={role}
      userName="Ada Lovelace"
      actions={
        <Button size="sm" variant="ghost" data-testid="fake-signout">
          Sign out
        </Button>
      }
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">UI primitive reference</h1>
          <p className="text-sm text-ink-muted">
            Every component exported from{" "}
            <code className="rounded bg-surface px-1 py-0.5">
              @/components/ui
            </code>
            , in every state a feature page can hit. Colours come from the
            design tokens in <code>globals.css</code>, which mirror{" "}
            <code>app.config.ts</code>.
          </p>
        </header>

        {/* ------------------------------------------------------------ nav */}
        <Section
          id="nav"
          title="Navigation (role-driven)"
          note="The sidebar and top bar above re-render from the role→links map. Switch role to see the link set change; nothing here is hardcoded per role."
        >
          <div
            role="group"
            aria-label="Preview role"
            className="flex flex-wrap gap-2"
          >
            {ROLES.map((r) => (
              <Button
                key={r}
                size="sm"
                variant={r === role ? "primary" : "secondary"}
                aria-pressed={r === role}
                data-testid={`role-switch-${r}`}
                onClick={() => setRole(r)}
              >
                {ROLE_LABEL[r]}
              </Button>
            ))}
          </div>

          <ul
            data-testid="nav-link-preview"
            data-role={role}
            className="mt-4 grid gap-1 text-sm sm:grid-cols-2"
          >
            {NAV_LINKS[role].map((link) => (
              <li
                key={link.href}
                className="flex items-baseline gap-2 rounded px-2 py-1 odd:bg-surface"
              >
                <span aria-hidden="true">{link.glyph}</span>
                <span className="font-medium">{link.label}</span>
                <code className="text-xs text-ink-muted">{link.href}</code>
              </li>
            ))}
          </ul>
        </Section>

        {/* --------------------------------------------------------- buttons */}
        <Section
          id="button"
          title="Button"
          note="5 variants × 3 sizes, plus disabled, loading and full-width."
        >
          <div className="flex flex-col gap-4">
            {BUTTON_SIZES.map((size) => (
              <div key={size} className="flex flex-wrap items-center gap-2">
                <span className="w-8 text-xs text-ink-muted">{size}</span>
                {BUTTON_VARIANTS.map((variant) => (
                  <Button
                    key={variant}
                    variant={variant}
                    size={size}
                    onClick={() => setClickCount((c) => c + 1)}
                  >
                    {variant}
                  </Button>
                ))}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <Button disabled data-testid="button-disabled">
                disabled
              </Button>
              <Button variant="secondary" disabled>
                disabled secondary
              </Button>
              <Button loading data-testid="button-loading">
                loading
              </Button>
              <span
                data-testid="button-click-count"
                className="text-sm text-ink-muted"
              >
                clicks: {clickCount}
              </span>
            </div>
            <Button fullWidth variant="accent" data-testid="button-fullwidth">
              full width
            </Button>
          </div>
        </Section>

        {/* ------------------------------------------------------------ card */}
        <Section id="card" title="Card" note="Bare, headed, footed, interactive.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <p className="text-sm">Bare card — content only.</p>
            </Card>
            <Card
              title="Week 2 — CSS layout"
              subtitle="3 lectures · quiz open"
              action={<LockBadge locked={false} />}
            >
              <p className="text-sm text-ink-muted">
                Header with title, subtitle and an action slot.
              </p>
            </Card>
            <Card
              title="With footer"
              footer={<span>Due in 3 days · 2 day grace window</span>}
            >
              <p className="text-sm text-ink-muted">Footer is a muted strip.</p>
            </Card>
            <Card interactive title="Interactive">
              <p className="text-sm text-ink-muted">
                Hover lifts; focus inside draws the ring.
              </p>
              <Button size="sm" variant="ghost" className="mt-2">
                focusable child
              </Button>
            </Card>
          </div>
        </Section>

        {/* ----------------------------------------------------------- badge */}
        <Section id="badge" title="Badge" note="6 tones, 2 sizes, optional dot.">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {BADGE_TONES.map((tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {BADGE_TONES.map((tone) => (
                <Badge key={tone} tone={tone} size="sm" dot>
                  {tone} sm
                </Badge>
              ))}
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------- lockbadge */}
        <Section
          id="lockbadge"
          title="LockBadge"
          note="Mirrors the week_lock enum. A locked badge always carries the reason it is locked."
        >
          <div className="flex flex-wrap items-center gap-3">
            <LockBadge locked reason="Score 70% on the Week 1 quiz to unlock." />
            <LockBadge locked={false} />
            <LockBadge locked size="sm" label="Week 4" reason="Not yet open." />
          </div>
        </Section>

        {/* ---------------------------------------------------- progress bar */}
        <Section
          id="progress"
          title="ProgressBar"
          note="Out-of-range and NaN inputs are clamped to 0..100 — check aria-valuenow on the last three."
        >
          <div className="flex flex-col gap-4">
            <ProgressBar percent={0} label="Not started" />
            <ProgressBar percent={42} label="Week 2 quiz" />
            <ProgressBar percent={70} label="Pass threshold" tone="accent" />
            <ProgressBar percent={100} label="Complete" tone="success" />
            <ProgressBar
              percent={-20}
              label="Negative input (-20)"
              tone="danger"
              data-testid="progress-negative"
            />
            <ProgressBar
              percent={140}
              label="Over 100 input (140)"
              data-testid="progress-over"
            />
            <ProgressBar
              percent={Number.NaN}
              label="NaN input"
              data-testid="progress-nan"
            />
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              {/* animateFill={false} is the documented per-call-site opt-out
                  for lists and tables; kept in the reference so the e2e spec
                  can prove the opt-out actually removes the keyframe rather
                  than only removing the class. Bar COUNT is unchanged — the
                  primitives spec asserts 10 progressbars in this section. */}
              <ProgressBar
                percent={55}
                size="sm"
                showValue={false}
                ariaLabel="Small"
                animateFill={false}
                data-testid="progress-static"
              />
              <ProgressBar percent={55} size="md" showValue={false} ariaLabel="Medium" />
              <ProgressBar percent={55} size="lg" showValue={false} ariaLabel="Large" />
            </div>
          </div>
        </Section>

        {/* ----------------------------------------------------- star rating */}
        <Section
          id="stars"
          title="StarRating"
          note="Interactive (radiogroup, arrow keys + Enter/Space) and read-only (single image with a spoken label)."
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-4">
              <StarRating
                value={rating}
                onChange={setRating}
                size="lg"
                label="Rate this submission"
                showValue
                testId="rating-interactive"
              />
              <span
                data-testid="rating-value"
                className="text-sm font-medium text-ink-muted"
              >
                value: {rating}
              </span>
              <Button
                size="sm"
                variant="secondary"
                data-testid="rating-reset"
                onClick={() => setRating(0)}
              >
                reset
              </Button>
            </div>

            <div className="flex flex-col gap-2 border-t border-line pt-4">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="flex items-center gap-3">
                  <StarRating
                    value={n}
                    readOnly
                    size="sm"
                    label={`Example ${n}`}
                    testId={`rating-readonly-${n}`}
                  />
                  <span className="text-xs text-ink-muted">
                    read-only, value {n}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- avatar */}
        <Section
          id="avatar"
          title="Avatar"
          note="Initials fallback: first + last initial, 2 letters for a single name, ? for empty."
        >
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name="Ada Lovelace" size="sm" />
            <Avatar name="Ada Lovelace" size="md" />
            <Avatar name="Grace Brewster Murray Hopper" size="lg" />
            <Avatar name="Prince" />
            <Avatar name="" />
            {/* Inline data URI so the demo needs no /public asset. A CSS named
                colour, not a hex literal — no .tsx in this stream carries hex. */}
            <Avatar
              name="With image"
              size="lg"
              src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' fill='slateblue'/%3E%3C/svg%3E"
            />
          </div>
        </Section>

        {/* ----------------------------------------------------- empty state */}
        <Section id="empty" title="EmptyState" note="With and without an action.">
          <div className="grid gap-4 sm:grid-cols-2">
            <EmptyState
              title="No submissions yet"
              description="Work you hand in through the Google Form will appear here within the hour."
            />
            <EmptyState
              icon={<span className="text-3xl">▤</span>}
              title="Nothing in the grading queue"
              description="Every submission for this cohort has been rated."
              action={<Button size="sm">Refresh</Button>}
            />
          </div>
        </Section>

        {/* -------------------------------------------------------- skeleton */}
        <Section
          id="skeleton"
          title="Skeleton"
          note="Loading placeholder. The shimmer is the signal that content is coming; under prefers-reduced-motion the sweep stops and role=status + aria-busy carry that meaning instead."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Skeleton lines={3} label="Loading lecture text" />
              <Skeleton shape="block" label="Loading the video" />
            </div>
            <div className="flex items-start gap-3">
              <Skeleton shape="circle" label="Loading the avatar" />
              <Skeleton lines={2} label="Loading the student name" />
            </div>
          </div>
        </Section>

        {/* ----------------------------------------------------------- toast */}
        <Section
          id="toast"
          title="Toast"
          note="Info/success are polite (role=status); warning/error are assertive (role=alert) and never auto-dismiss."
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {TOAST_TONES.map((tone) => (
                <Button
                  key={tone}
                  size="sm"
                  variant="secondary"
                  data-testid={`toast-trigger-${tone}`}
                  onClick={() => pushToast(tone)}
                >
                  push {tone}
                </Button>
              ))}
            </div>
            {/* Static examples so the spec can assert them without clicking. */}
            <div className="flex flex-col gap-2">
              {TOAST_TONES.map((tone) => (
                <Toast
                  key={tone}
                  tone={tone}
                  title={tone}
                  message={`A ${tone} message rendered inline.`}
                  className={cn("max-w-md")}
                />
              ))}
              <Toast
                tone="info"
                title="Dismissible"
                message="Has a dismiss control and no auto-dismiss."
                onDismiss={() => undefined}
                className="max-w-md"
              />
            </div>
          </div>
        </Section>

        <ToastViewport>
          {toasts.map((t) => (
            <Toast
              key={t.id}
              tone={t.tone}
              title={t.tone}
              message="Pushed from the reference page."
              // 6000 ms for polite tones; urgent tones stay until dismissed.
              autoDismissMs={
                t.tone === "info" || t.tone === "success" ? 6000 : 0
              }
              onDismiss={() =>
                setToasts((prev) => prev.filter((x) => x.id !== t.id))
              }
            />
          ))}
        </ToastViewport>
      </div>
    </AppShell>
  );
}
