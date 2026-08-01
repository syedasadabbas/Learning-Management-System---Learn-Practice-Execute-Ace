"use client";

// =============================================================================
// CSV EXPORT BUTTON — instructor-admin stream.
// -----------------------------------------------------------------------------
// Calls the admin-guarded `exportGradesCsvAction`, which returns CSV TEXT, and
// saves it with a Blob + object URL. There is no download route because this
// stream owns none in the frozen route map (see lib/instructor/actions.ts).
//
// The object URL is revoked immediately after the click: an un-revoked blob URL
// keeps the whole CSV alive in memory for the life of the document, and a grade
// export for a full cohort is not small.
// =============================================================================

import * as React from "react";

import { Button, Toast } from "@/components/ui";
import { exportGradesCsvAction } from "@/lib/instructor/actions";

export interface ExportButtonProps {
  cohortId?: number;
  label?: string;
}

export function ExportButton({ cohortId, label = "Export grades (CSV)" }: ExportButtonProps) {
  const [pending, setPending] = React.useState(false);
  const [toast, setToast] = React.useState<
    { tone: "success" | "error" | "info"; message: string } | null
  >(null);

  async function onClick() {
    setPending(true);
    setToast(null);
    const result = await exportGradesCsvAction(cohortId);
    setPending(false);

    if (!result.ok) {
      setToast({ tone: "error", message: result.error });
      return;
    }
    if (result.data.rowCount === 0) {
      // Still download it: a header-only file is a truthful answer, and silently
      // doing nothing looks like a broken button.
      setToast({
        tone: "info",
        message: "No submissions to export yet — the file contains headers only.",
      });
    } else {
      setToast({
        tone: "success",
        message: `Exported ${result.data.rowCount} row(s) to ${result.data.filename}.`,
      });
    }

    const blob = new Blob([result.data.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.data.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <Button onClick={onClick} loading={pending} disabled={pending} data-testid="export-grades">
        {label}
      </Button>
      {toast && (
        <div className="mt-3">
          <Toast
            tone={toast.tone}
            message={toast.message}
            autoDismissMs={toast.tone === "error" ? 0 : 6_000}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}
    </div>
  );
}
