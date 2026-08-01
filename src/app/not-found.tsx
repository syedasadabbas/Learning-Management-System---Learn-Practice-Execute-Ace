// =============================================================================
// 404 PAGE — what every `notFound()` in this codebase actually renders.
// -----------------------------------------------------------------------------
// This is not a cosmetic addition. `notFound()` is the primary AUTHORIZATION
// outcome across several streams, not just the answer to a mistyped URL: a
// peer-review allocation that is not the caller's, a coding problem below the
// caller's level, a locked week, an instructor route reached by a student. Those
// streams chose 404 over 403 deliberately, so that a probe cannot learn whether a
// row exists. All of them landed on Next.js's built-in page, which has no route
// back into the app — so the most common outcome of the platform's own
// authorization rules was a dead end.
//
// NO SPECIFIC REASON IS GIVEN, and that is the point rather than laziness. The
// streams that call notFound() for an authorization failure rely on this page
// being indistinguishable from a genuine missing page; "you do not have access to
// this submission" would hand back exactly the fact the 404 exists to withhold.
// See src/lib/peer-review/** and the coding-problems level ladder.
//
// A SERVER COMPONENT: there is no state and no handler here, so shipping it to
// the browser would buy nothing. It renders inside src/app/layout.tsx and so has
// the design tokens, but NOT the app shell — <AppShell> needs a role, and this
// page is reachable while signed out.
// =============================================================================

import Link from "next/link";

import { Card } from "@/components/ui";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6"
      data-testid="not-found"
    >
      <Card title="Page not found">
        <p className="text-sm text-ink">
          This page does not exist, or it is not available to your account.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm font-medium">
          <Link href="/" className="underline">
            Go to your dashboard
          </Link>
          <Link href="/login" className="underline">
            Sign in
          </Link>
        </div>
      </Card>
    </main>
  );
}
