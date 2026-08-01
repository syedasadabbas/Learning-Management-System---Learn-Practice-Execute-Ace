// =============================================================================
// WORKFLOW 1 — instructor schedules, student joins, chat works, class ends.
// -----------------------------------------------------------------------------
// THE EXTERNAL DEPENDENCY, AND WHY THIS FILE DOES NOT USE IT.
//
// The video plane is `meet.jit.si`: shared public infrastructure, no SLA, no
// retention guarantee (src/lib/features.ts says exactly that at
// `liveClassesConfig.jitsiDomain`). A spec that waited for a real conference to
// come up would be testing Jitsi's uptime and the CI runner's ability to reach
// it over UDP, and would fail on both counts for reasons that have nothing to do
// with this repository. It would be the flakiest test in the suite and it would
// be measuring nothing we control.
//
// So `external_api.js` is STUBBED at the network layer and the assertions are
// about CONFIGURATION: that the room name the server minted is what the embed
// was pointed at, that the domain is the configured one, that the direct link is
// well formed. That is the whole of what this codebase decides. Whether two
// browsers can then see each other is Jitsi's contract, not ours.
//
// THE ROOM NAME IS THE SECURITY BOUNDARY, which is why it gets its own
// assertion. `meet.jit.si` has no access control beyond the name, so a guessable
// name IS an open door — hence 96 bits of `randomBytes` minted at /start rather
// than at schedule time. The spec checks the shape it must have.
//
// FEATURE FLAGS: this whole file is dark unless LIVE_CLASSES_ENABLED and
// NEXT_PUBLIC_LIVE_CLASSES_ENABLED are "true" on the server under test. With
// them unset the page calls `notFound()` and every assertion below would be
// checking a 404 page. `expectFeatureLive` fails the run rather than let that
// read as a pass.
// =============================================================================

import { expect, test, type Page } from "@playwright/test";

import { loginAs } from "../fixtures";
import {
  NO_TEST_DB_REASON,
  okBody,
  seedIds,
  signedInApi,
  TEST_DB_URL,
} from "../api-integration/fixtures";

test.skip(!TEST_DB_URL, NO_TEST_DB_REASON);
test.describe.configure({ mode: "serial" });

/** Jitsi's loader, replaced by a stub that reports a joined conference. */
const JITSI_SCRIPT = /external_api\.js/;

/**
 * Intercept Jitsi's script and serve a stub implementing the slice of
 * `JitsiMeetExternalAPI` that JitsiEmbed uses.
 *
 * Written as a route interception rather than an `addInitScript` that predefines
 * `window.JitsiMeetExternalAPI`, because the component's own loader is part of
 * what is being tested: if it stopped injecting the script, a predefined global
 * would hide that.
 */
async function stubJitsi(page: Page): Promise<void> {
  await page.route(JITSI_SCRIPT, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        window.__jitsiCalls = [];
        window.JitsiMeetExternalAPI = function (domain, options) {
          window.__jitsiCalls.push({ domain: domain, options: options });
          var listeners = {};
          var iframe = document.createElement("iframe");
          iframe.title = "Jitsi stub";
          iframe.setAttribute("data-stub-domain", domain);
          iframe.setAttribute("data-stub-room", options && options.roomName);
          if (options && options.parentNode) options.parentNode.appendChild(iframe);
          this.addListener = function (name, fn) { listeners[name] = fn; };
          this.dispose = function () { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); };
          this.executeCommand = function () {};
          this.getIFrame = function () { return iframe; };
          setTimeout(function () {
            if (listeners.videoConferenceJoined) listeners.videoConferenceJoined({});
          }, 10);
        };
      `,
    });
  });
}

/** Fail loudly if the live-classes flag is off on the server under test. */
async function expectFeatureLive(page: Page): Promise<void> {
  await page.goto("/classes");
  await expect(
    page.locator("text=404").first(),
    "/classes rendered a 404. Set LIVE_CLASSES_ENABLED and NEXT_PUBLIC_LIVE_CLASSES_ENABLED " +
      "to \"true\" on the server under test — otherwise this file asserts against a disabled feature.",
  ).toHaveCount(0);
}

test.describe("live class end to end", () => {
  let classId = 0;
  let roomName: string | null = null;
  const title = `QA workflow class ${Date.now()}`;

  // THREE TIMES THE DEFAULT BUDGET, and the reason is compilation rather than
  // slowness. Against `next dev` each of /classes, /classes/:id and the six API
  // routes this file touches compiles on FIRST request — measured at 20 s for
  // `/` alone on a cold cache. The global setup in tests/e2e/global-setup.ts
  // pre-warms the routes that existed when it was written; these are newer than
  // it. Raising the budget here rather than in playwright.config.ts keeps the
  // 30 s default — which is a useful signal everywhere else — intact.
  test.setTimeout(90_000);

  test.afterAll(async ({ browser }) => {
    if (!classId) return;
    const page = await browser.newPage();
    const api = await signedInApi(page, "instructor");
    await api.post(`/api/classes/${classId}/end`);
    await api.delete(`/api/classes/${classId}`);
    await page.close();
  });

  test("an instructor schedules a class and it appears on the calendar", async ({ page }) => {
    const api = await signedInApi(page, "instructor");
    await expectFeatureLive(page);
    const { weekId } = await seedIds();

    // Scheduled through the API rather than the form: the form is covered by
    // ClassScheduler's own component tests, and driving a date picker here would
    // make this workflow spec fail for reasons about input formatting rather
    // than about the workflow.
    const created = await api.post("/api/classes", {
      data: {
        weekId,
        title,
        scheduledAt: new Date(Date.now() + 900_000).toISOString(),
        durationMinutes: 45,
      },
    });
    classId = (await okBody<{ id: number }>(created, 201)).id;

    await page.goto("/classes");
    await expect(page.getByText(title)).toBeVisible();
  });

  test("the room name is minted at /start, not at schedule time", async ({ page }) => {
    // A room name published days in advance is a room strangers can be sitting
    // in before the class begins — the argument recorded on the column in
    // src/db/schema.live-classes.ts.
    const api = await signedInApi(page, "instructor");

    // THE DETAIL ROUTE WITHHOLDS ROOM CREDENTIALS ENTIRELY — a stronger property
    // than "it is null until start", and the one the handler actually
    // implements: `jitsiRoomName` and `jitsiPassword` are absent from the
    // projection at every lifecycle stage, because they belong to
    // GET /api/classes/:id/join, which checks the lifecycle and records
    // attendance FIRST. Asserted on the raw body rather than on a typed field so
    // that reintroducing the column under any key fails here.
    const before = await api.get(`/api/classes/${classId}`);
    const beforeRaw = await before.text();
    expect(before.status()).toBe(200);
    for (const secret of ["jitsiRoomName", "jitsi_room_name", "jitsiPassword", "jitsi_password"]) {
      expect(
        beforeRaw,
        `${secret} is in the class detail payload — the room is reachable without going through ` +
          `/join, which is what records attendance and checks the lifecycle`,
      ).not.toContain(secret);
    }

    const started = await api.post(`/api/classes/${classId}/start`);
    const running = await okBody<{ jitsiRoomName: string; jitsiUrl: string }>(started);
    roomName = running.jitsiRoomName;

    // `lms-<id>-` plus 96 bits of randomBytes, hex-encoded: 24 hex characters.
    expect(roomName).toMatch(new RegExp(`^lms-${classId}-[0-9a-f]{24}$`));
    expect(running.jitsiUrl).toBe(`https://meet.jit.si/${roomName}`);
  });

  test("a student joins the room and the embed is pointed at the minted room", async ({
    page,
  }) => {
    await stubJitsi(page);
    await loginAs(page, "student");
    await page.goto(`/classes/${classId}`);

    await expect(page.getByTestId("live-class-room")).toBeVisible();
    const embed = page.getByTestId("jitsi-embed");
    await expect(embed).toBeVisible();

    // THE ASSERTION THAT MATTERS: the client was handed the SAME room the server
    // minted. A mismatch puts the student in an empty conference that looks,
    // from the browser, exactly like a working one.
    // The embed's own error branch renders `jitsi-error` and HIDES the video
    // container, while the outer `jitsi-embed` wrapper stays visible — so
    // `toBeVisible` above passes on the failure path too. Surface the error text
    // in the assertion message, otherwise a broken loader reports only as
    // "0 calls" and gives no clue why.
    const errorPanel = page.getByTestId("jitsi-error");
    const errorText = (await errorPanel.count()) > 0 ? await errorPanel.innerText() : "(none)";

    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              () =>
                (
                  window as unknown as {
                    __jitsiCalls?: Array<{ domain: string; options: { roomName: string } }>;
                  }
                ).__jitsiCalls ?? [],
            )
          ).length,
        {
          timeout: 20_000,
          message:
            `JitsiEmbed never constructed the external API. The embed's error panel said: ` +
            `${errorText}. The script load is asynchronous inside an effect, so this polls ` +
            `rather than reading once.`,
        },
      )
      .toBeGreaterThan(0);

    const calls = await page.evaluate(
      () =>
        (window as unknown as { __jitsiCalls?: Array<{ domain: string; options: { roomName: string } }> })
          .__jitsiCalls ?? [],
    );
    expect(calls[0].domain).toBe("meet.jit.si");
    expect(calls[0].options.roomName).toBe(roomName);

    // And the human-readable fallback link agrees with it.
    await expect(embed.getByRole("link", { name: /Direct room link/i })).toHaveAttribute(
      "href",
      `https://meet.jit.si/${roomName}`,
    );
  });

  test("joining recorded attendance", async ({ page }) => {
    const api = await signedInApi(page, "instructor");
    const { studentId } = await seedIds();
    const roster = await api.get(`/api/classes/${classId}/attendance`);
    const data = await okBody<
      { items: Array<{ studentId: number }> } | Array<{ studentId: number }>
    >(roster);
    const items = Array.isArray(data) ? data : data.items;
    expect(
      items.some((row) => row.studentId === studentId),
      "the student loaded the room but no attendance row was written",
    ).toBe(true);
  });

  test("the student posts a chat message and it survives a reload", async ({ page }) => {
    // Survival across a reload is the point. The realtime service may be absent
    // — `NEXT_PUBLIC_REALTIME_URL` is optional and its absence is a SUPPORTED
    // state (src/lib/features.ts) in which the panel degrades to the REST
    // history endpoints. So the durable assertion is "the message is in the
    // history", which holds with or without the socket, rather than "it appeared
    // in another browser", which does not.
    // A hydration failure anywhere in this tree disarms the composer, and it is
    // otherwise INVISIBLE — the markup renders, the field accepts text, and
    // nothing reports an error. Collecting page errors means the assertion below
    // can name the cause instead of saying "the button stayed disabled".
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(msg.text());
    });

    await stubJitsi(page);
    await loginAs(page, "student");
    await page.goto(`/classes/${classId}`);

    const message = `hello from QA ${Date.now()}`;
    const input = page.getByTestId("chat-input");
    const send = page.getByRole("button", { name: "Send" });

    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();

    // TYPE IN A RETRY LOOP, BECAUSE OF A RACE THAT FAILS SILENTLY AND WAS
    // MEASURED, NOT GUESSED.
    //
    // The composer is a CONTROLLED textarea: `value={draft}`, with `draft` fed
    // by `onChange`, and Send is disabled while `draft` is empty. Text typed
    // before React hydrates lands in the DOM but not in `draft` — and then
    // hydration renders `value=""` over it and the typing is GONE. The observed
    // state was exactly that: `textarea value=""`, Send disabled, no page error,
    // no POST in the server log. Nothing anywhere says the keystrokes were lost.
    //
    // A fixed sleep would paper over it at the cost of being wrong on a slower
    // machine in both directions. Waiting for a hydration marker is not possible
    // either — the composer hint that would serve as one is server-rendered too,
    // so it reads identical before and after. What IS unambiguous is the pair
    // "the field holds my text AND Send is enabled", since both are computed
    // from `draft`. So: fill, check, repeat until it sticks.
    await expect
      .poll(
        async () => {
          await input.fill(message);
          return (await input.inputValue()) === message && (await send.isEnabled());
        },
        {
          timeout: 30_000,
          intervals: [250, 500, 1_000],
          message:
            "the composer never armed: the typed text kept vanishing from a controlled textarea " +
            "and Send stayed disabled. Page errors: " +
            (pageErrors.length ? pageErrors.join(" | ") : "(none)"),
        },
      )
      .toBe(true);

    await send.click();

    await expect(page.getByTestId("chat-transcript")).toContainText(message, {
      timeout: 15_000,
    });

    await page.reload();
    await expect(page.getByTestId("chat-transcript")).toContainText(message, {
      timeout: 15_000,
    });
  });

  test("the instructor ends the class and the room stops being offered", async ({ page }) => {
    const api = await signedInApi(page, "instructor");
    const ended = await api.post(`/api/classes/${classId}/end`);
    expect(ended.status()).toBe(200);

    const after = await api.get(`/api/classes/${classId}`);
    const cls = await okBody<{ status: string; endedAt: string | null }>(after);
    expect(cls.status).toBe("ended");
    expect(cls.endedAt).not.toBeNull();

    // A student arriving after the end must not be dropped into a conference.
    // The page does something stronger than badge it as over: `canJoin` refuses,
    // and the room component — with it the Jitsi embed, the chat composer and the
    // attendance write — is never rendered at all. Asserting the ABSENCE of the
    // room is the assertion with teeth; a status badge could be shown beside a
    // perfectly live conference.
    await stubJitsi(page);
    await loginAs(page, "student");
    await page.goto(`/classes/${classId}`);

    await expect(page.getByTestId("live-class-room")).toHaveCount(0);
    await expect(page.getByTestId("jitsi-embed")).toHaveCount(0);
    await expect(page.getByTestId("chat-input")).toHaveCount(0);
    await expect(page.getByText(title)).toBeVisible();

    // And the room name must not have been shipped to the browser in the HTML
    // even though nothing renders it — a student who reads the page source after
    // the class must not be able to walk back into the conference.
    expect(await page.content()).not.toContain(roomName!);
  });
});
