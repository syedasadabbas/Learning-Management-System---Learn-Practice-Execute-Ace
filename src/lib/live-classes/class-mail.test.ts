import { describe, expect, it } from "vitest";

import {
  CLASS_REMINDER_LEAD_MS,
  formatClassTime,
  liveClassMailKey,
  reminderRunAfter,
  renderClassScheduledMail,
  renderClassStartingSoonMail,
  renderRecordingAvailableMail,
} from "./class-mail";

const STARTS_AT = new Date("2026-09-14T13:00:00.000Z");

const base = {
  name: "Ana",
  classTitle: "Week 3: Flexbox",
  startsAt: STARTS_AT,
  timeZone: "Asia/Karachi",
  url: "https://lms.example.org/classes/12",
  appName: "Code Queens Hub",
};

describe("formatClassTime", () => {
  it("names the time zone in the string", () => {
    // A cohort spread across time zones reading "18:00" has no way to know
    // whose 18:00, and the failure is a student joining an hour late.
    const formatted = formatClassTime(STARTS_AT, "Asia/Karachi");
    expect(formatted).toMatch(/18:00/);
    expect(formatted).toMatch(/GMT\+5|PKT/);
  });

  it("renders the same instant differently in a different zone", () => {
    expect(formatClassTime(STARTS_AT, "Asia/Karachi")).not.toBe(
      formatClassTime(STARTS_AT, "Europe/London"),
    );
  });
});

describe("renderClassScheduledMail", () => {
  it("puts the class title in the subject and the time in the body", () => {
    const mail = renderClassScheduledMail(base);
    expect(mail.subject).toBe("Live class scheduled: Week 3: Flexbox");
    expect(mail.text).toContain("18:00");
    expect(mail.text).toContain(base.url);
  });

  it("greets an unknown recipient without a dangling name", () => {
    expect(renderClassScheduledMail({ ...base, name: null }).text.startsWith("Hello,")).toBe(true);
  });

  it("escapes a class title in the HTML body", () => {
    // A class title is staff free text and reaches the markup.
    const mail = renderClassScheduledMail({ ...base, classTitle: "<script>x</script>" });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("strips CR/LF from the subject, because a newline in a header is injection", () => {
    const mail = renderClassScheduledMail({
      ...base,
      classTitle: "Flexbox\r\nBcc: attacker@example.org",
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});

describe("renderClassStartingSoonMail", () => {
  it("says ABOUT 15 minutes, because the cron that sends it is best-effort", () => {
    // Writing "in 15 minutes" would make the mail state something the delivery
    // mechanism cannot guarantee, and would train students to distrust it.
    const mail = renderClassStartingSoonMail(base);
    expect(mail.text).toContain("about 15 minutes");
  });

  it("still gives the exact start time, which IS exact", () => {
    expect(renderClassStartingSoonMail(base).text).toContain("18:00");
  });
});

describe("renderRecordingAvailableMail", () => {
  it("links the recording", () => {
    const mail = renderRecordingAvailableMail({
      name: "Ana",
      classTitle: "Week 3: Flexbox",
      url: "https://example.org/rec/1",
      appName: "Code Queens Hub",
    });
    expect(mail.subject).toBe("Recording available: Week 3: Flexbox");
    expect(mail.text).toContain("https://example.org/rec/1");
  });

  it("states an expiry when one is known, and says nothing when it is not", () => {
    // Several of the free hosting options expire; a student who assumes
    // permanence and finds a dead link in week nine was misled by omission.
    const withExpiry = renderRecordingAvailableMail({
      name: null,
      classTitle: "Week 3",
      url: "https://example.org/rec/1",
      appName: "App",
      availableUntil: new Date("2026-12-01T00:00:00.000Z"),
    });
    expect(withExpiry.text).toContain("2026-12-01");

    const without = renderRecordingAvailableMail({
      name: null,
      classTitle: "Week 3",
      url: "https://example.org/rec/1",
      appName: "App",
    });
    expect(without.text).not.toContain("available until");
  });
});

describe("liveClassMailKey", () => {
  it("is stable for the same message to the same student", () => {
    // An instructor editing a class three times must not send three
    // "class scheduled" emails; the repeats collide on the unique index.
    const payload = { kind: "scheduled" as const, classId: 12, recipientId: 5 };
    expect(liveClassMailKey(payload)).toBe(liveClassMailKey(payload));
  });

  it("differs by kind, class and recipient", () => {
    const keys = new Set([
      liveClassMailKey({ kind: "scheduled", classId: 12, recipientId: 5 }),
      liveClassMailKey({ kind: "starting_soon", classId: 12, recipientId: 5 }),
      liveClassMailKey({ kind: "scheduled", classId: 13, recipientId: 5 }),
      liveClassMailKey({ kind: "scheduled", classId: 12, recipientId: 6 }),
    ]);
    expect(keys.size).toBe(4);
  });
});

describe("reminderRunAfter", () => {
  it("schedules the reminder one lead time before the class", () => {
    const now = new Date("2026-09-14T09:00:00.000Z");
    expect(reminderRunAfter(STARTS_AT, now).getTime()).toBe(
      STARTS_AT.getTime() - CLASS_REMINDER_LEAD_MS,
    );
  });

  it("clamps to now for a class starting inside the lead time", () => {
    // A run_after in the past is harmless but reads in the jobs table as a
    // backlog rather than as intent.
    const now = new Date(STARTS_AT.getTime() - 60_000);
    expect(reminderRunAfter(STARTS_AT, now).getTime()).toBe(now.getTime());
  });
});
