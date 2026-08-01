// =============================================================================
// SIGN-OUT CONTROL — fills the AppShell `actions` slot.
// -----------------------------------------------------------------------------
// Added at integration: ui-shell built the slot and the auth stream built
// `signOut`, but neither owned a file where the two could meet.
//
// WHY IT LIVES HERE AND NOT IN src/components/nav/
// It is a top-bar control, so nav looks like the obvious home — but that
// directory's barrel states an invariant: "nothing here imports src/lib/auth, so
// nav stays client-safe and unit-testable without a session". This file DOES
// import @/lib/auth, and TopBar/Sidebar/AppShell are "use client". Putting it in
// that barrel would drag a server-only module across a client boundary and break
// nav's unit tests. It is imported by direct path from the two route-group
// layouts instead, both of which are server components.
//
// It was originally src/app/(app)/SignOutButton.tsx, which is why the staff
// layout did not have one: a file inside the (app) route group is not somewhere
// (staff) can reasonably import from.
//
// A form posting to a server action, not an onClick handler, for two reasons:
//   1. It works with JavaScript disabled, matching how the login and register
//      pages were built (server components + server actions, no client JS).
//   2. Sign-out is a state change, so it must not be reachable by GET. A GET
//      logout can be triggered by any <img src> on a page the user visits, which
//      is how people get silently signed out mid-quiz.
// =============================================================================

import { signOut } from "@/lib/auth";

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        // redirectTo rather than the default: landing on "/" makes it obvious the
        // session ended, whereas staying on a now-unauthorised page would bounce
        // through the login redirect and look like an error.
        await signOut({ redirectTo: "/" });
      }}
    >
      <button
        type="submit"
        className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Sign out
      </button>
    </form>
  );
}
