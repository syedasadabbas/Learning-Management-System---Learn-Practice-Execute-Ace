// =============================================================================
// E2E — /admin/videos review screen. video-ingestion stream.
// -----------------------------------------------------------------------------
// The first block is the one that must never regress: a STUDENT and an
// INSTRUCTOR are both refused the curation screen. Instructor refusal is the
// unusual one and it is intentional — approving a video publishes third-party
// content to the whole cohort, so it is an admin act (see src/lib/videos/access.ts
// for the argument and its cost).
//
// The second block asserts the honest-empty-state property: with no curated list
// ingested, there are no candidates, the page says so, and a lecture still shows
// its "video coming soon" placeholder rather than an invented video.
//
// Credentials and seeded facts come from tests/e2e/fixtures.ts (devops-testing) —
// never hardcoded.
//
// APPROVE/REJECT ARE STILL NOT EXERCISED HERE, but the reason has changed and the
// old one no longer applies. It used to be that no candidate row could be obtained
// without a live oEmbed call to youtube.com. This file now creates its own candidate
// through `createVideoCandidate()` in tests/e2e/fixtures.ts and deletes it again, so
// the precondition is available; what is left undone is the decision flow itself.
// See the TODO(test) note at the foot of this file.
//
// UPDATED 2026-07-31 (test isolation). The "no unreviewed candidate is presented as
// live" block below used to read whatever the shared database happened to hold and
// therefore failed on state that another commit had legitimately created. It now owns
// the row it asserts about. The full diagnosis is in the comment on that block.
// =============================================================================

import { expect, test, type Page } from "@playwright/test";

import {
  clearE2EVideoCandidates,
  createVideoCandidate,
  expectNoServerError,
  loginAs,
  type VideoCandidateFixture,
} from "../fixtures";

/**
 * The PENDING queue's <ul>, disambiguated from the reviewed one.
 *
 * `data-testid="video-review-list"` is NOT unique on this page. /admin/videos
 * renders <ReviewQueue> TWICE — "Awaiting review" at
 * src/app/(staff)/admin/videos/page.tsx:102 and "Already reviewed" at :186 — and
 * both emit the same testid (src/components/videos/ReviewQueue.tsx:125). Worse,
 * ReviewQueue renders an EmptyState and NO <ul> when its list is empty (:108-114),
 * so which queue `getByTestId(...).first()` resolves to depends on whether any
 * candidates exist.
 *
 * That is exactly how this file's central assertion failed: with 0 candidates and
 * 77 approved rows in the shared database, `.first()` was the REVIEWED list and the
 * spec reported `Expected: "candidate", Received: "approved"` against a row that was
 * correctly labelled. Scoping through the enclosing card's heading makes the
 * intended queue explicit, so the locator can no longer silently change meaning.
 * The component is owned by the video-ingestion source stream and cannot be given a
 * second testid from here.
 */
function pendingQueue(page: Page) {
  return page
    .locator('[data-testid="card"]')
    .filter({ has: page.getByRole("heading", { name: /^Awaiting review \(\d+\)$/ }) })
    .getByTestId("video-review-list");
}

test.describe("authorization on /admin/videos", () => {
  test("a student is refused", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/admin/videos");
    // The guard redirects to /login?error=forbidden; either way the queue must
    // not render.
    await expect(page.getByTestId("admin-videos")).toHaveCount(0);
    await expect(page.getByTestId("video-review-list")).toHaveCount(0);
  });

  test("an INSTRUCTOR is refused — curation is an admin act, on purpose", async ({ page }) => {
    await loginAs(page, "instructor");
    await page.goto("/admin/videos");
    await expect(page.getByTestId("admin-videos")).toHaveCount(0);
  });

  test("an anonymous visitor is sent to login", async ({ page }) => {
    await page.goto("/admin/videos");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("the admin review screen", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
  });

  test("renders, with status counts and no server error", async ({ page }) => {
    await page.goto("/admin/videos");
    await expectNoServerError(page);

    await expect(page.getByTestId("admin-videos")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Video review", level: 1 })).toBeVisible();
    await expect(page.getByTestId("video-status-counts")).toBeVisible();
  });

  test("explains both sources and states the RSS limit rather than overselling it", async ({
    page,
  }) => {
    await page.goto("/admin/videos");

    // Curated ids are named as the primary path; RSS as a supplement only. This
    // assertion exists so nobody later rewrites the copy into a promise the
    // keyless stack cannot keep.
    await expect(page.getByText(/curated list — the primary path/i)).toBeVisible();
    await expect(page.getByText(/channel rss — a supplement only/i)).toBeVisible();
    await expect(page.getByText(/most recent uploads/i)).toBeVisible();
    await expect(page.getByText(/no api key is involved/i)).toBeVisible();
  });

  test("an empty queue says what to hand over, not nothing", async ({ page }) => {
    await page.goto("/admin/videos");

    // pendingQueue(), not getByTestId: see the note on that helper. This test used
    // the ambiguous locator and passed by coincidence — it was inspecting the
    // REVIEWED list, whose rows happen to satisfy the same shape assertions.
    const list = pendingQueue(page);
    if ((await list.count()) === 0) {
      await expect(page.getByText(/No candidates awaiting review/i)).toBeVisible();
      await expect(page.getByText(/topic_key,video,duration_seconds,order_index/)).toBeVisible();
    } else {
      // Once a curated list is ingested, every visible row must carry the three
      // things a reviewer needs: a title, a channel, and a length or an honest
      // admission that the length is unknown.
      const first = list.locator("li").first();
      await expect(first).toBeVisible();
      await expect(first.locator("code")).toHaveCount(1);
      await expect(first.getByText(/Duration unknown|\d+:\d{2}/)).toBeVisible();
    }
  });

  // -------------------------------------------------------------------------
  // THE CENTRAL PROPERTY, and the only block in this file that owns a DB row.
  //
  // The assertion is unchanged in substance and deliberately so: an unreviewed
  // candidate must never be presented as live. What changed is that the spec now
  // ESTABLISHES ITS OWN PRECONDITION instead of reading whatever the shared database
  // happened to contain.
  //
  // The old form depended on global state it did not own, and that is precisely how
  // it failed on 2026-07-31 with `Expected: "candidate", Received: "approved"`. Two
  // independent reasons, both fixed here:
  //
  //   1. NO CANDIDATE EXISTED. Commit 664dbc1 harvested 77 curated rows; the work in
  //      46b9d4e then approved them so lecture pages could play a real video. The
  //      shared database therefore held 77 approved rows and zero candidates — a
  //      legitimate state that this spec had no way to distinguish from a defect.
  //   2. THE LOCATOR RESOLVED TO THE WRONG QUEUE once the pending list was empty.
  //      See the note on pendingQueue().
  //
  // The row is created directly in `topic_videos` (createVideoCandidate() explains
  // why the real harvest path is unavailable to this suite) with a topic key that
  // matches no lecture, so it publishes nothing to students, and it is deleted in
  // afterEach plus swept in afterAll in case a run is killed mid-test.
  // -------------------------------------------------------------------------
  test.describe("the pending queue, against a candidate this spec owns", () => {
    let candidate: VideoCandidateFixture;

    test.beforeEach(async () => {
      candidate = await createVideoCandidate();
    });

    test.afterEach(async () => {
      await candidate.remove();
    });

    // Belt and braces: afterEach does not run if the process is killed, and a
    // leftover row would then be inherited by the next run as the very kind of
    // unowned state this rewrite exists to eliminate.
    test.afterAll(clearE2EVideoCandidates);

    test("no unreviewed candidate is presented as live", async ({ page }) => {
      await page.goto("/admin/videos");
      await expect(page.getByTestId("admin-videos")).toBeVisible();

      const queue = pendingQueue(page);
      const rows = queue.locator("li");

      // The precondition is asserted, not assumed. If the row this spec just wrote
      // is not in the queue, the queue and the database disagree — which is itself
      // the class of bug under test — and that must fail here rather than be
      // reported as a vacuous pass over zero rows.
      const mine = queue.locator(`[data-testid="video-row-${candidate.id}"]`);
      await expect(
        mine,
        `the candidate this spec inserted (topic_videos.id ${candidate.id}) must appear in the pending queue`,
      ).toHaveCount(1);
      await expect(mine).toHaveAttribute("data-status", "candidate");
      // Approve/Reject are offered; Undo is not. A row the screen thinks is decided
      // would show the opposite pair, so this pins the status to behaviour and not
      // only to an attribute.
      await expect(page.getByTestId(`approve-video-${candidate.id}`)).toBeVisible();
      await expect(page.getByTestId(`reject-video-${candidate.id}`)).toBeVisible();
      await expect(page.getByTestId(`requeue-video-${candidate.id}`)).toHaveCount(0);

      // And now the property itself, over the WHOLE pending queue: every row in it
      // is a candidate. `count` is >= 1 by construction, so the loop cannot be
      // vacuous the way the previous version was.
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        await expect(rows.nth(i)).toHaveAttribute("data-status", "candidate");
      }
    });

  });
});

// A separate top-level describe rather than a third test inside the block above:
// that block's beforeEach signs in as ADMIN, and re-driving /login from an
// established admin session is a different flow from signing in fresh. Keeping the
// student path in its own block means this spec tests the barrier, not the
// behaviour of /login for an already-authenticated visitor.
test.describe("the student read path, against a candidate this spec owns", () => {
  let candidate: VideoCandidateFixture;

  test.beforeEach(async () => {
    candidate = await createVideoCandidate();
  });
  test.afterEach(async () => {
    await candidate.remove();
  });
  test.afterAll(clearE2EVideoCandidates);

  test("an unapproved candidate's id reaches no student-visible page", async ({ page }) => {
    // The complement of the queue assertion, and the one that would actually hurt if
    // it broke: an unreviewed candidate now genuinely EXISTS while this test runs, so
    // if the approved-only barrier leaked, its id would be reachable where a student
    // can see it. Asserted by ID rather than by counting embeds, so an approved video
    // legitimately playing (commit 46b9d4e) neither satisfies nor breaks it.
    await loginAs(page, "student");
    await page.goto("/weeks");
    expect(await page.content()).not.toContain(candidate.youtubeId);

    const firstLecture = page.locator('a[href*="/lectures/"]').first();
    if ((await firstLecture.count()) === 0) {
      test.skip(true, "no reachable lecture in this seed");
    }
    await firstLecture.click();
    await expect(page.getByTestId("lecture-title")).toBeVisible();
    expect(await page.content()).not.toContain(candidate.youtubeId);
  });
});

test.describe("student side: no candidate means the placeholder stands", () => {
  test("a lecture with no approved video shows “video coming soon”, not an invented embed", async ({
    page,
  }) => {
    await loginAs(page, "student");
    await page.goto("/weeks");

    // Week 1 is always unlocked by the seed; walk into its first lecture.
    const firstLecture = page.locator('a[href*="/lectures/"]').first();
    if ((await firstLecture.count()) === 0) test.skip(true, "no reachable lecture in this seed");
    await firstLecture.click();

    await expect(page.getByTestId("lecture-title")).toBeVisible();

    // Exactly one of the two states, never both, and never an iframe pointing at a
    // fabricated id. Every seeded lecture has youtube_url NULL and no approved
    // topic video, so the placeholder is the expected branch today.
    const placeholder = page.getByTestId("video-placeholder");
    const embed = page.getByTestId("video-embed");
    expect((await placeholder.count()) + (await embed.count())).toBe(1);

    if ((await embed.count()) === 1) {
      // If a video IS live, it must be the privacy-mode host. Nothing in this
      // stream may introduce a youtube.com/embed frame.
      const src = await embed.locator("iframe").getAttribute("src");
      expect(src).toContain("youtube-nocookie.com/embed/");
    }
  });
});

// TODO(test): approve -> student-visible, and reject -> stays hidden, are still NOT
// covered end to end. HALF of the old blocker is now gone: `createVideoCandidate()`
// supplies the candidate row, so the first bullet below no longer stands.
//
// What still stands is the SECOND half: the flow needs a candidate whose `topic_key`
// matches a real lecture, and approving it would then publish a video onto a lecture
// page that the course-content specs assert against — including the assertion added
// in 46b9d4e that a lecture plays an APPROVED video. A fixture that mutates what
// another stream's spec reads is the exact hazard this file was just repaired for, so
// it needs the lecture-side owner's agreement rather than a unilateral fixture. The
// isolation-safe shape is probably a dedicated fixture LECTURE with a topic key no
// other spec asserts on; that lecture must be created by scripts/seed.ts, which this
// stream does not own.
//
// The unit tests cover the barrier itself (src/lib/videos/read.test.ts asserts a
// candidate never enters a student payload, including after a JSON round-trip) and
// the review stamp (harvest.test.ts asserts a re-harvest cannot un-approve). What
// remains unproven end to end is the wiring, which also depends on the
// course-content owner adopting <TopicVideoSection> in the lecture page.
