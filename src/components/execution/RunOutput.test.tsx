// =============================================================================
// RunOutput tests. The assertion that matters is the one about WORDING: a
// rate-limited or unavailable run must tell the student their answer has not been
// marked wrong, because that is what the grader actually does with those results.
// Getting this wrong makes a student rewrite correct code during an exam.
// =============================================================================

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunOutput } from "./RunOutput";
import type { RunResult } from "@/lib/execution";

const BASE = {
  stdout: "",
  stderr: "",
  runtimeMs: 12,
  backend: "piston" as const,
  truncated: { stdout: false, stderr: false },
};

const success: RunResult = { ...BASE, ok: true, exitCode: 0, stdout: "42\n", language: "python" };

function failure(reason: "timeout" | "rate_limited" | "backend_unavailable" | "unsupported_language"): RunResult {
  return { ...BASE, ok: false, reason, message: "Service says so.", exitCode: null, language: "python" };
}

describe("RunOutput", () => {
  it("says nothing has run before the first run", () => {
    render(<RunOutput result={null} running={false} />);
    expect(screen.getByText("Not run yet")).toBeInTheDocument();
  });

  it("announces the run through a polite live region", () => {
    render(<RunOutput result={null} running />);
    const status = screen.getByTestId("run-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Running…");
  });

  it("reports the runtime in milliseconds on success", () => {
    render(<RunOutput result={success} running={false} />);
    expect(screen.getByTestId("run-summary")).toHaveTextContent("12 ms");
    expect(screen.getByTestId("run-stdout")).toHaveTextContent("42");
  });

  it("shows a non-zero exit as the program's own result, with its stderr", () => {
    render(
      <RunOutput
        result={{ ...BASE, ok: true, exitCode: 1, stderr: "NameError: x", language: "python" }}
        running={false}
      />,
    );
    expect(screen.getByTestId("run-summary")).toHaveTextContent("code 1");
    expect(screen.getByTestId("run-stderr")).toHaveTextContent("NameError");
  });

  it("tells the student a rate-limited run has NOT been marked wrong", () => {
    render(<RunOutput result={failure("rate_limited")} running={false} />);
    expect(screen.getByTestId("run-detail")).toHaveTextContent("not been marked wrong");
  });

  it("tells the student an unavailable backend will be reviewed", () => {
    render(<RunOutput result={failure("backend_unavailable")} running={false} />);
    expect(screen.getByTestId("run-detail")).toHaveTextContent("reviewed");
  });

  it("points a timeout at the student's own loop, since that is whose problem it is", () => {
    render(<RunOutput result={failure("timeout")} running={false} />);
    expect(screen.getByTestId("run-summary")).toHaveTextContent("took too long");
    expect(screen.getByTestId("run-detail")).toBeInTheDocument();
  });

  it("warns when output was truncated instead of silently shortening it", () => {
    render(
      <RunOutput
        result={{ ...success, stdout: "x", truncated: { stdout: true, stderr: false } }}
        running={false}
      />,
    );
    expect(screen.getByText(/cut short/i)).toBeInTheDocument();
  });

  it("states that a silent program produced no output", () => {
    render(<RunOutput result={{ ...BASE, ok: true, exitCode: 0, language: "python" }} running={false} />);
    expect(screen.getByText("The program produced no output.")).toBeInTheDocument();
  });
});
