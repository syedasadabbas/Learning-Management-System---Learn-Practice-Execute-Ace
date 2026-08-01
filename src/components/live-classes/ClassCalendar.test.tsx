import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AttendanceReport, presencePercent } from "./AttendanceReport";
import { ClassCalendar, formatLocalTime, groupByLocalDay } from "./ClassCalendar";
import { ClassRecording, formatDuration, formatSize } from "./ClassRecording";
import { ClassScheduler, toIsoInstant } from "./ClassScheduler";
import { ClassStatusBadge } from "./ClassStatusBadge";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { QAPanel } from "./QAPanel";
import type { LiveClassSummary, QaRow } from "./types";

function summary(overrides: Partial<LiveClassSummary> = {}): LiveClassSummary {
  return {
    id: 1,
    weekId: 1,
    lectureId: null,
    instructorId: 3,
    instructorName: "Sana",
    title: "Flexbox deep dive",
    description: null,
    scheduledAt: "2026-08-01T09:00:00.000Z",
    durationMinutes: 60,
    status: "scheduled",
    startedAt: null,
    endedAt: null,
    attendanceCount: 0,
    maxParticipants: null,
    allowChat: true,
    allowQa: true,
    allowScreenShare: true,
    enableRecording: true,
    ...overrides,
  };
}

function jsonFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response,
  ) as unknown as typeof fetch;
}

describe("pure helpers", () => {
  it("groups classes by the VIEWER's local day, not the ISO date prefix", () => {
    // A class at 23:30 UTC is tomorrow east of Greenwich. Grouping on the ISO
    // prefix would file it under the wrong heading for exactly those students.
    const grouped = groupByLocalDay([
      summary({ id: 1, scheduledAt: "2026-08-01T09:00:00.000Z" }),
      summary({ id: 2, scheduledAt: "2026-08-01T14:00:00.000Z" }),
      summary({ id: 3, scheduledAt: "2026-08-03T09:00:00.000Z" }),
    ]);

    const expectedFirstKey = new Date("2026-08-01T09:00:00.000Z").toLocaleDateString("en-CA");
    expect(grouped[0].key).toBe(expectedFirstKey);
    expect(grouped.map((g) => g.items.length).reduce((a, b) => a + b, 0)).toBe(3);
    // Sorted ascending.
    expect(grouped[0].key <= grouped[grouped.length - 1].key).toBe(true);
  });

  it("drops an unparseable timestamp instead of producing an Invalid Date heading", () => {
    expect(groupByLocalDay([summary({ scheduledAt: "not a date" })])).toEqual([]);
  });

  it("formats a time, and says so when it cannot", () => {
    expect(formatLocalTime("nope")).toBe("time unknown");
    expect(formatLocalTime("2026-08-01T09:00:00.000Z")).toMatch(/\d/);
  });

  it("converts a datetime-local value to a UTC instant", () => {
    const iso = toIsoInstant("2026-08-01T14:00");
    expect(iso).not.toBeNull();
    expect(iso).toMatch(/Z$/);
    // Round-trips through the browser's own zone, which is what the instructor meant.
    expect(new Date(iso!).getTime()).toBe(new Date("2026-08-01T14:00").getTime());
  });

  it("refuses an empty or unparseable schedule rather than sending Invalid Date", () => {
    expect(toIsoInstant("")).toBeNull();
    expect(toIsoInstant("tomorrow")).toBeNull();
  });

  it("formats durations in hours and minutes", () => {
    expect(formatDuration(null)).toBe("length unknown");
    expect(formatDuration(1_800)).toBe("30 min");
    expect(formatDuration(5_400)).toBe("1h 30m");
  });

  it("formats sizes in MB, escalating to GB", () => {
    expect(formatSize(null)).toBeNull();
    expect(formatSize(0)).toBeNull();
    expect(formatSize(512)).toBe("512 MB");
    expect(formatSize(2_048)).toBe("2.0 GB");
  });

  it("clamps presence above the class length", () => {
    // A student who joins early legitimately exceeds it; "112% present" in a
    // report is a number an instructor has to stop and reason about.
    expect(presencePercent(70, 60)).toBe(100);
    expect(presencePercent(30, 60)).toBe(50);
    expect(presencePercent(30, 0)).toBe(0);
  });
});

describe("ClassStatusBadge", () => {
  it("states the status in words, not only as a coloured dot", () => {
    render(<ClassStatusBadge status="active" />);
    const badge = screen.getByTestId("class-status-badge");
    expect(badge).toHaveTextContent("Live now");
    // The pulse is motion-safe, so prefers-reduced-motion stops it.
    expect(badge.className).toContain("motion-safe:animate-pulse");
  });

  it("does not animate a class that is not live", () => {
    render(<ClassStatusBadge status="ended" />);
    expect(screen.getByTestId("class-status-badge").className).not.toContain("animate-pulse");
  });
});

describe("ClassCalendar", () => {
  it("loads, then groups the upcoming classes", async () => {
    const fetchImpl = jsonFetch(200, {
      ok: true,
      data: { items: [summary()], limit: 100, offset: 0, total: 1 },
    });

    render(<ClassCalendar fetchImpl={fetchImpl} />);
    expect(screen.getByRole("status", { name: "Loading upcoming classes" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("calendar-class-1")).toBeInTheDocument());
  });

  it("states the missing cohort scoping instead of hiding it", async () => {
    // A known API defect. A UI that quietly renders a wrong list is worse than
    // one that admits the list is wrong.
    const fetchImpl = jsonFetch(200, {
      ok: true,
      data: { items: [summary()], limit: 100, offset: 0, total: 1 },
    });
    render(<ClassCalendar fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByTestId("calendar-scope-caveat")).toBeInTheDocument());
    expect(screen.getByTestId("calendar-scope-caveat")).toHaveTextContent(/not filtered by cohort/);
  });

  it("renders an empty state when nothing is scheduled", async () => {
    render(
      <ClassCalendar
        fetchImpl={jsonFetch(200, { ok: true, data: { items: [], limit: 100, offset: 0, total: 0 } })}
      />,
    );
    await waitFor(() => expect(screen.getByText("No classes scheduled")).toBeInTheDocument());
  });

  it("renders an error with a retry", async () => {
    render(<ClassCalendar fetchImpl={jsonFetch(503, { ok: false, error: "down" })} />);
    await waitFor(() => expect(screen.getByTestId("async-error")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("ClassScheduler", () => {
  const weeks = [
    { id: 1, label: "Week 1" },
    { id: 2, label: "Week 2" },
  ];

  it("shows the resulting UTC instant so the instructor can check the conversion", () => {
    render(<ClassScheduler weeks={weeks} fetchImpl={jsonFetch(201, {})} />);
    fireEvent.change(screen.getByLabelText("Starts at"), {
      target: { value: "2026-08-01T14:00" },
    });
    expect(screen.getByTestId("class-when-hint")).toHaveTextContent(/UTC/);
  });

  it("keeps submit disabled until the required fields are valid", () => {
    render(<ClassScheduler weeks={weeks} fetchImpl={jsonFetch(201, {})} />);
    const submit = screen.getByRole("button", { name: "Schedule the class" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Flexbox" } });
    fireEvent.change(screen.getByLabelText("Starts at"), {
      target: { value: "2026-08-01T14:00" },
    });
    expect(submit).toBeEnabled();
  });

  it("sends an offset-bearing instant and never sends instructorId or status", async () => {
    const fetchImpl = jsonFetch(201, { ok: true, data: summary({ title: "Flexbox" }) });
    render(<ClassScheduler weeks={weeks} fetchImpl={fetchImpl} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Flexbox" } });
    fireEvent.change(screen.getByLabelText("Starts at"), {
      target: { value: "2026-08-01T14:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule the class" }));

    await waitFor(() => expect(screen.getByTestId("scheduler-success")).toBeInTheDocument());

    const body = JSON.parse(
      ((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit)
        .body as string,
    );
    expect(body.scheduledAt).toMatch(/Z$/);
    expect(body).not.toHaveProperty("instructorId");
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("jitsiRoomName");
  });

  it("surfaces a validation failure from the server", async () => {
    const fetchImpl = jsonFetch(422, { ok: false, error: "weekId does not exist." });
    render(<ClassScheduler weeks={weeks} fetchImpl={fetchImpl} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Starts at"), {
      target: { value: "2026-08-01T14:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule the class" }));

    await waitFor(() =>
      expect(screen.getByTestId("scheduler-error")).toHaveTextContent("weekId does not exist."),
    );
  });
});

describe("QAPanel", () => {
  function qa(overrides: Partial<QaRow> = {}): QaRow {
    return {
      id: 1,
      classId: 9,
      studentId: 5,
      studentName: "Bilal",
      question: "Why does flex-grow do that?",
      answer: null,
      instructorId: null,
      isAnswered: false,
      isPinned: false,
      upvotes: 2,
      createdAt: "2026-08-01T10:00:00.000Z",
      answeredAt: null,
      ...overrides,
    };
  }

  const BASE = { classId: 9, currentUserId: 2, allowQa: true, mode: "unavailable" as const };

  it("puts the vote count in the button's accessible name", async () => {
    render(<QAPanel {...BASE} fetchImpl={jsonFetch(200, { ok: true, data: { items: [qa()], limit: 100, offset: 0, total: 1 } })} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Upvote this question. 2 votes" }),
      ).toBeInTheDocument(),
    );
  });

  it("refuses to let a student upvote their own question", async () => {
    render(
      <QAPanel
        {...BASE}
        currentUserId={5}
        fetchImpl={jsonFetch(200, { ok: true, data: { items: [qa()], limit: 100, offset: 0, total: 1 } })}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "You cannot upvote your own question" }),
      ).toBeDisabled(),
    );
  });

  it("hides the answer composer from a student and shows it to staff", async () => {
    const data = { ok: true, data: { items: [qa()], limit: 100, offset: 0, total: 1 } };

    const student = render(<QAPanel {...BASE} fetchImpl={jsonFetch(200, data)} />);
    await waitFor(() => expect(screen.getByTestId("qa-question-1")).toBeInTheDocument());
    expect(screen.queryByLabelText("Answer this question")).not.toBeInTheDocument();
    student.unmount();

    render(<QAPanel {...BASE} canAnswer fetchImpl={jsonFetch(200, data)} />);
    await waitFor(() => expect(screen.getByLabelText("Answer this question")).toBeInTheDocument());
  });

  it("renders an empty state and a disabled composer when Q&A is off", async () => {
    render(
      <QAPanel
        {...BASE}
        allowQa={false}
        fetchImpl={jsonFetch(200, { ok: true, data: { items: [], limit: 100, offset: 0, total: 0 } })}
      />,
    );
    expect(screen.getByTestId("qa-input")).toBeDisabled();
    await waitFor(() => expect(screen.getByText("No questions yet")).toBeInTheDocument());
  });
});

describe("ParticipantsPanel", () => {
  it("does not request the roster for a student, and says why the list is absent", () => {
    // `GET /api/classes/:id/attendance` is instructor-only. A 403 in the network
    // tab every 30 s reads as a bug.
    const fetchImpl = jsonFetch(403, { ok: false, error: "forbidden" });
    render(<ParticipantsPanel classId={9} fetchImpl={fetchImpl} />);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      screen.getByText("The participant list is not shown to students"),
    ).toBeInTheDocument();
  });

  it("shows the Jitsi participant count when the embed reports one", () => {
    render(<ParticipantsPanel classId={9} conferenceCount={4} fetchImpl={jsonFetch(200, {})} />);
    expect(screen.getByTestId("conference-count")).toHaveTextContent("4 in the video call");
  });
});

describe("AttendanceReport", () => {
  const rows = {
    ok: true,
    data: {
      items: [
        {
          id: 1,
          studentId: 5,
          studentName: "Bilal",
          studentEmail: "b@example.com",
          joinedAt: "2026-08-01T09:00:00.000Z",
          leftAt: null,
          timePresentMinutes: 45,
          messagesSent: 3,
          questionsAsked: 1,
          screenShareCount: 0,
          markedPresent: true,
          participationScore: 62,
        },
      ],
      limit: 100,
      offset: 0,
      total: 1,
      classDurationMinutes: 60,
    },
  };

  it("is a real table with column and row headers", async () => {
    render(<AttendanceReport classId={9} fetchImpl={jsonFetch(200, rows)} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    expect(screen.getByRole("columnheader", { name: "Student" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /Bilal/ })).toBeInTheDocument();
  });

  it("names the toggle by what it will do to which student", async () => {
    render(<AttendanceReport classId={9} fetchImpl={jsonFetch(200, rows)} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Stop counting Bilal as present" }),
      ).toBeInTheDocument(),
    );
  });

  it("rolls the toggle back when the server refuses", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      call += 1;
      if ((init?.method ?? "GET") === "GET") {
        return { ok: true, status: 200, json: async () => rows } as unknown as Response;
      }
      return {
        ok: false,
        status: 500,
        json: async () => ({ ok: false, error: "nope" }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    render(<AttendanceReport classId={9} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Stop counting Bilal as present" }));

    await waitFor(() =>
      expect(screen.getByTestId("attendance-live-region")).toHaveTextContent("Could not update"),
    );
    // Back to the value we started from.
    expect(
      screen.getByRole("button", { name: "Stop counting Bilal as present" }),
    ).toBeInTheDocument();
    expect(call).toBeGreaterThan(1);
  });
});

describe("ClassRecording", () => {
  it("treats a 404 as 'no recording', not as an error", async () => {
    // The route answers 404 for four situations, only one of which is a fault.
    render(<ClassRecording classId={9} fetchImpl={jsonFetch(404, { ok: false, error: "x" })} />);
    await waitFor(() =>
      expect(screen.getByText("No recording for this class")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("recording-error")).not.toBeInTheDocument();
  });

  it("does report a genuine server failure", async () => {
    render(<ClassRecording classId={9} fetchImpl={jsonFetch(500, { ok: false, error: "down" })} />);
    await waitFor(() => expect(screen.getByTestId("recording-error")).toBeInTheDocument());
  });

  it("explains a deleted recording rather than rendering an empty player", async () => {
    render(
      <ClassRecording
        classId={9}
        fetchImpl={jsonFetch(200, { ok: true, data: { id: 1, classId: 9, status: "deleted" } })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("This recording has been deleted")).toBeInTheDocument(),
    );
  });

  it("renders a native player for a plain file and a link for an adaptive stream", async () => {
    const withFile = render(
      <ClassRecording
        classId={9}
        fetchImpl={jsonFetch(200, {
          ok: true,
          data: { id: 1, classId: 9, status: "available", filePath: "/r.mp4", isPublic: true },
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("recording-player")).toBeInTheDocument());
    withFile.unmount();

    render(
      <ClassRecording
        classId={9}
        fetchImpl={jsonFetch(200, {
          ok: true,
          data: { id: 1, classId: 9, status: "available", hlsUrl: "https://x/y.m3u8", isPublic: true },
        })}
      />,
    );
    // No <video>: hls.js is not a dependency, so an embedded player would be a
    // black rectangle outside Safari.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open the recording" })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("recording-player")).not.toBeInTheDocument();
  });
});
