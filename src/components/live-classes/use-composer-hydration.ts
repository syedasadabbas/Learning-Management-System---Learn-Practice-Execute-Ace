"use client";

// =============================================================================
// useComposerHydration — stop a message typed before React hydrates from
// vanishing.
// Owner: the data-bound component stream (defect remediation wave).
// -----------------------------------------------------------------------------
// THE BUG, exactly as the QA stream diagnosed it (CHANGELOG.log, 11:30 entry,
// item 6a). The server sends HTML containing a real `<textarea>`. Until the
// client bundle loads and React hydrates, that textarea accepts keystrokes like
// any other — but they land in the DOM only. React state does not exist yet.
// Hydration then renders the CONTROLLED textarea with its initial value of ""
// over the top, and the keystrokes are gone. Send stays disabled because it is
// computed from the same empty state. There is no page error, no POST in the
// server log, and nothing anywhere tells the student anything was lost.
//
// The QA stream classified it as a test trap, which it is. It is ALSO a real
// bug for any student on a slow connection who starts typing as soon as they
// see the field — which, in a live class that has already started, is the
// normal case rather than the edge one.
//
// TWO REMEDIES, AND THIS HOOK IS BOTH, because each covers the other's gap.
//
//   1. ADOPT WHATEVER IS IN THE DOM. On mount — which is after hydration — read
//      the element's value and, if the user got ahead of React, lift it into
//      state. When this works nothing is lost at all: the student never notices
//      there was a race. It is tried FIRST for that reason.
//
//   2. REFUSE INPUT UNTIL HYDRATED. (1) is not guaranteed: React may have
//      already overwritten the DOM value during hydration, in which case there
//      is nothing left to adopt. So the composer is also DISABLED until this
//      hook reports ready. Disabling alone would be enough to prevent loss, but
//      it throws the keystrokes away in the cases where (1) would have saved
//      them, so it is the fallback and not the primary.
//
// DISABLED WITH A STATED REASON, NEVER A BARE `disabled`. The house style is
// already explicit about this — see the accessibility note in ChatPanel's own
// header, which disables the composer for a read-only class and SAYS SO. A
// control that is dead with no explanation is indistinguishable from a broken
// page, and the student's response to it is to reload, which loses the draft
// this hook exists to protect. Callers of this hook are expected to surface
// `reason` in the composer's hint text and placeholder; that is why the hook
// returns a sentence rather than only a boolean.
//
// The window is one animation frame on a warm bundle and a second or two on a
// cold one over a bad connection. The disabled state is therefore invisible in
// the good case and is the whole point in the bad one.
// =============================================================================

import * as React from "react";

/** What the composer should tell the student while it is not yet interactive. */
export const COMPOSER_HYDRATING_REASON =
  "Just a moment — the composer is still loading. Anything you type now is kept.";

export interface ComposerHydration {
  /** False for the server render and the first client render; true thereafter. */
  ready: boolean;
  /** Sentence to show while `ready` is false. Never render a bare disabled control. */
  reason: string;
}

/**
 * Report when a composer is safe to type into, and rescue anything typed early.
 *
 * @param elementRef the composer's `<textarea>` / `<input>`, so its pre-hydration
 *        DOM value can be adopted rather than discarded
 * @param adopt      called with the salvaged text, exactly once, and only when
 *        there is something to salvage. Callers pass their `setDraft`.
 */
export function useComposerHydration(
  elementRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>,
  adopt: (value: string) => void,
): ComposerHydration {
  const [ready, setReady] = React.useState(false);

  // `adopt` is normally an inline arrow, so it is a new function every render.
  // Keeping it in a ref means the effect below can depend on nothing and run
  // exactly once — re-running it would re-adopt a stale DOM value over text the
  // student has since edited.
  const adoptRef = React.useRef(adopt);
  adoptRef.current = adopt;

  React.useEffect(() => {
    // Runs after hydration by definition. Salvage first, THEN enable: enabling
    // first would let a keystroke land between the two and be overwritten by
    // the value read a moment later.
    const salvaged = elementRef.current?.value ?? "";
    if (salvaged.length > 0) adoptRef.current(salvaged);
    setReady(true);
    // Intentionally empty: this must happen once, on mount, and never again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ready, reason: COMPOSER_HYDRATING_REASON };
}
