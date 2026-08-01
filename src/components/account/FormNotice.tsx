// =============================================================================
// FORM NOTICE — owned by the `account` stream.
// -----------------------------------------------------------------------------
// The one success/error banner every account form uses. A server component: it
// renders resolved text and has no behaviour, so shipping it to the browser would
// buy nothing.
//
// `data-testid` rather than `getByRole("alert")`, because Next.js injects its own
// role="alert" route announcer and a spec targeting the role matches two nodes —
// the login page's header records the same trap.
//
// `role="status"` for success and `role="alert"` for errors: alert interrupts a
// screen reader, which is right for "that is not your current password" and wrong
// for "profile updated".
// =============================================================================

import { cn } from "@/components/ui";
import type { Notice } from "@/lib/account/messages";

export function FormNotice({
  notice,
  testId = "form-notice",
}: {
  notice: Notice | null;
  testId?: string;
}) {
  if (!notice) return null;

  const isError = notice.tone === "error";

  return (
    <p
      role={isError ? "alert" : "status"}
      data-testid={testId}
      data-tone={notice.tone}
      className={cn(
        "rounded-md border p-3 text-sm",
        isError
          ? "border-red-300 bg-red-50 text-red-800"
          : "border-green-300 bg-green-50 text-green-800",
      )}
    >
      {notice.message}
    </p>
  );
}
