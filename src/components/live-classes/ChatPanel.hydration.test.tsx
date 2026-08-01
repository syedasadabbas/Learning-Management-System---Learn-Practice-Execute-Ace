// =============================================================================
// Regression test — a chat message typed BEFORE React hydrates must not vanish.
// Owner: the data-bound component stream (defect remediation wave).
// -----------------------------------------------------------------------------
// WHY THIS FILE HYDRATES INSTEAD OF RENDERING. Every other component test in
// this directory calls `render()`, which mounts on an empty container. That path
// CANNOT reproduce this bug: the bug is the gap between server HTML being
// interactive and React taking ownership of it, and `render()` has no such gap.
// So this file does the real sequence — `renderToString`, put the HTML in the
// document, type into the resulting textarea the way an impatient student does,
// and only THEN `hydrateRoot`.
//
// Before the fix, the assertion that fails is the last one: hydration renders
// the controlled textarea's initial value of "" over the typed text and the
// keystrokes are gone, with no error, no request and nothing logged. That
// silence is why the bug survived a full QA pass as a "test trap" rather than
// being reported as a defect.
//
// A SEPARATE FILE FROM ChatPanel.test.tsx on purpose: that file is another
// stream's and is being edited concurrently, and this one needs a different
// mounting strategy from every test in it.
// =============================================================================

import * as React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "./ChatPanel";
import { COMPOSER_HYDRATING_REASON } from "./use-composer-hydration";

const BASE = {
  classId: 9,
  currentUserId: 2,
  currentUserName: "Ayesha",
  allowChat: true,
  mode: "unavailable" as const,
};

/** History fetch that always succeeds and returns nothing. Not the subject here. */
function emptyHistoryFetch(): typeof fetch {
  const impl = vi.fn(async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { items: [], limit: 100, offset: 0, total: 0 } }),
    } as unknown as Response;
  });
  return impl as unknown as typeof fetch;
}

let container: HTMLDivElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

/**
 * Server-render the panel into a detached-then-attached container, exactly as a
 * browser would receive it, and hand back the live textarea.
 */
function serverRender(): { host: HTMLDivElement; textarea: HTMLTextAreaElement } {
  const host = document.createElement("div");
  host.innerHTML = renderToString(<ChatPanel {...BASE} fetchImpl={emptyHistoryFetch()} />);
  document.body.appendChild(host);
  container = host;

  const textarea = host.querySelector("textarea");
  if (!textarea) throw new Error("the server render produced no composer textarea");
  return { host, textarea };
}

describe("ChatPanel — the pre-hydration window", () => {
  it("ships the composer disabled, with the reason stated in the hint", () => {
    const { host, textarea } = serverRender();

    // Disabled, because a controlled input that is live before React owns it is
    // a control that silently throws keystrokes away.
    expect(textarea.disabled).toBe(true);
    // And NOT a bare disabled attribute: the house style is "disabled with a
    // stated reason", and a dead field with no explanation reads as a broken
    // page — whose remedy, reloading, loses the draft outright.
    expect(host.textContent).toContain(COMPOSER_HYDRATING_REASON);
  });

  it("adopts text typed before hydration instead of silently discarding it", async () => {
    const { textarea } = serverRender();

    // What a student on a slow connection does: the field is on screen, so they
    // type. This lands in the DOM only — React state does not exist yet.
    textarea.value = "Can you go back a slide?";

    await act(async () => {
      hydrateRoot(container as HTMLDivElement, <ChatPanel {...BASE} fetchImpl={emptyHistoryFetch()} />);
    });

    // THE REGRESSION. Before the fix, hydration rendered the controlled
    // textarea's initial value of "" over the top and this read "".
    expect(textarea.value).toBe("Can you go back a slide?");
  });

  it("enables the composer and Send once hydrated, so the salvaged draft is sendable", async () => {
    const { host, textarea } = serverRender();
    textarea.value = "Can you go back a slide?";

    await act(async () => {
      hydrateRoot(container as HTMLDivElement, <ChatPanel {...BASE} fetchImpl={emptyHistoryFetch()} />);
    });

    expect(textarea.disabled).toBe(false);
    // Send is computed from the same state the salvaged text was lifted into,
    // so a draft that is visible but unsendable would mean the salvage reached
    // the DOM and not React — the original bug wearing a different face.
    const send = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Send",
    );
    expect(send).toBeDefined();
    expect(send?.disabled).toBe(false);

    // The hydrating hint is gone; the ordinary one is back.
    expect(host.textContent).not.toContain(COMPOSER_HYDRATING_REASON);
  });

  it("leaves the composer disabled after hydration when chat is switched off", async () => {
    // The pre-existing read-only rule outranks hydration and must survive it.
    const host = document.createElement("div");
    host.innerHTML = renderToString(
      <ChatPanel {...BASE} allowChat={false} fetchImpl={emptyHistoryFetch()} />,
    );
    document.body.appendChild(host);
    container = host;

    await act(async () => {
      hydrateRoot(host, <ChatPanel {...BASE} allowChat={false} fetchImpl={emptyHistoryFetch()} />);
    });

    const textarea = host.querySelector("textarea");
    expect(textarea?.disabled).toBe(true);
    expect(host.textContent).toContain("Chat is switched off for this class.");
  });
});
