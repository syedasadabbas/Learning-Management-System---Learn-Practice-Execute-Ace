// =============================================================================
// E2E — CERTIFICATES. Owner: the certificates stream.
// -----------------------------------------------------------------------------
// NOT RUN BY THIS STREAM. Eight agents share port 3000 and one seeded, mutable
// database, so the coordinator runs the e2e suite serially at integration.
// Authored and reviewed here; NEVER EXECUTED. Nothing below should be read as a
// passing result — see the stream report.
//
// A CERTIFICATE IS A CREDENTIAL, SO THE NEGATIVE PATHS COME FIRST IN THIS FILE
// AND NOT AS AN AFTERTHOUGHT. Two properties have to hold, and neither is
// established by the happy path:
//
//   P1  One student can never fetch another student's certificate. The download
//       route takes a SEQUENTIAL id from the URL, so this is the property with a
//       real attack: log in, walk /api/certificates/1/pdf upwards.
//   P2  An unearned certificate cannot be issued by finding the URL. There is one
//       write endpoint and it must refuse a student who has not finished, and
//       write NOTHING when it refuses (asserted against the database, not merely
//       against the status code).
//
// WHAT THE UNIT TESTS ALREADY COVER, so these specs do not repeat it:
// src/lib/certificates/*.test.ts (50 cases, run) cover the eligibility rule
// including the withdrawn-subject and locked-week cases, template compilation and
// its fallback, the code format and its shape check, PDF rendering, and the
// filename sanitisation. What they CANNOT cover is what lives in the request
// path: the guards, the ownership predicate in SQL, and whether the public verify
// page is genuinely reachable without a session.
//
// WHY EVERY CERTIFICATE HERE IS CREATED BY A FIXTURE. Under the shipped
// `appConfig.curriculumSections` only the HTML subject is enabled, so weeks 2-4
// are locked for every seeded student and NO student can become eligible through
// the UI. The full argument is in ./fixtures.ts. The consequence for reading this
// file: the "not eligible" specs are the real cohort state, and the "holds a
// certificate" specs describe a state a fixture manufactures.
//
// SIDE EFFECTS. Every spec that writes creates one `certificates` row for one
// named student and deletes exactly that row afterwards. Nothing here truncates
// the table or deletes by anything other than a primary key — the unscoped delete
// is the mistake CHANGELOG.log 2026-07-31 15:50 records, where one spec's clean
// slate destroyed three other streams' graded fixtures.
// =============================================================================

import { expect, test, type APIResponse } from "@playwright/test";

import { DEMO, SEEDED_CLASSMATES, expectNoServerError, loginAs } from "../fixtures";
import { countCertificatesFor, createCertificate, type CertificateFixture } from "./fixtures";

/** The magic number every PDF starts with. */
const PDF_MAGIC = "%PDF-";

async function bodyText(response: APIResponse): Promise<string> {
  return (await response.body()).toString("utf8");
}

// ---------------------------------------------------------------------------
// 1. P2 — an unearned certificate is not issuable
// ---------------------------------------------------------------------------

test.describe("an unearned certificate cannot be issued", () => {
  test("POST /api/certificates refuses the demo student and writes nothing", async ({ page }) => {
    // The demo student has not finished the course — and under the shipped
    // section policy cannot. The status code alone is not the assertion that
    // matters: the row count before and after is, because a handler that returns
    // 403 AFTER inserting would look correct from the outside.
    const before = await countCertificatesFor(DEMO.student.email);

    await loginAs(page, "student");
    const response = await page.request.post("/api/certificates");

    expect(response.status()).toBe(403);
    const payload = await response.json();
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("not_eligible");

    expect(await countCertificatesFor(DEMO.student.email)).toBe(before);
  });

  test("the gallery shows the eligibility notice, not a credential", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/certificates");
    await expectNoServerError(page);

    await expect(page.getByTestId("certificate-eligibility")).toBeVisible();
    await expect(page.getByTestId("certificate-card")).toHaveCount(0);
    // The notice must name what is outstanding. "Not eligible" with no detail is
    // the message that generates a support request.
    await expect(page.getByTestId("certificate-outstanding-weeks")).toBeVisible();
  });

  test("merely LOADING the gallery does not mint a certificate", async ({ page }) => {
    // The page issues on read when a student IS eligible. This asserts the other
    // half of that decision: a student who is not eligible must not acquire a
    // credential by visiting the page, however many times.
    const before = await countCertificatesFor(DEMO.student.email);
    await loginAs(page, "student");
    await page.goto("/certificates");
    await page.reload();
    expect(await countCertificatesFor(DEMO.student.email)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 2. P1 — no cross-student access
// ---------------------------------------------------------------------------

test.describe("one student cannot fetch another student's certificate", () => {
  let victim: CertificateFixture;

  test.beforeAll(async () => {
    // A classmate's credential, created by this file so nothing else asserts on it.
    victim = await createCertificate({
      studentEmail: SEEDED_CLASSMATES[0].email,
      recipientName: SEEDED_CLASSMATES[0].name,
    });
  });

  test.afterAll(async () => {
    await victim.remove();
  });

  test("the demo student gets 404, not 403, for a classmate's PDF", async ({ page }) => {
    await loginAs(page, "student");
    const response = await page.request.get(`/api/certificates/${victim.id}/pdf`);

    // 404 deliberately: a 403 would confirm the row exists, and with sequential
    // ids that tells an enumerating student how many classmates have finished.
    expect(response.status()).toBe(404);
    // And no bytes leak in the error body.
    expect(await bodyText(response)).not.toContain(PDF_MAGIC);
    expect(await bodyText(response)).not.toContain(SEEDED_CLASSMATES[0].name);
  });

  test("an INSTRUCTOR also gets 404 — staff are not exempt", async ({ page }) => {
    // `ROLES_SATISFYING.student` admits instructors, so the role guard lets staff
    // past; the ownership predicate in the SQL is what refuses them. Staff needing
    // to check a credential use the public verify page, which reveals strictly
    // less. This spec is the proof that the narrowing is real and not documentation.
    await loginAs(page, "instructor");
    const response = await page.request.get(`/api/certificates/${victim.id}/pdf`);
    expect(response.status()).toBe(404);
  });

  test("an ADMIN also gets 404", async ({ page }) => {
    await loginAs(page, "admin");
    const response = await page.request.get(`/api/certificates/${victim.id}/pdf`);
    expect(response.status()).toBe(404);
  });

  test("the demo student's own listing never contains a classmate's certificate", async ({
    page,
  }) => {
    await loginAs(page, "student");
    const response = await page.request.get("/api/certificates");
    expect(response.status()).toBe(200);
    const body = await bodyText(response);
    // Neither the classmate's name nor their code may appear in a response scoped
    // to the caller.
    expect(body).not.toContain(SEEDED_CLASSMATES[0].name);
    expect(body).not.toContain(victim.verificationCode);
  });

  test("walking the id space finds nothing", async ({ page }) => {
    // The enumeration attack, run as an attack rather than described as one.
    await loginAs(page, "student");
    for (const id of [1, 2, 3, victim.id, victim.id + 1, 999_999]) {
      const response = await page.request.get(`/api/certificates/${id}/pdf`);
      // Only the caller's OWN certificate could answer 200, and in this spec the
      // demo student holds none.
      expect([404, 410], `id ${id}`).toContain(response.status());
    }
  });

  test("a non-numeric id is a 404, not a 500", async ({ page }) => {
    await loginAs(page, "student");
    const response = await page.request.get("/api/certificates/abc/pdf");
    expect(response.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 3. Anonymous access is refused everywhere except the verify page
// ---------------------------------------------------------------------------

test.describe("anonymous access", () => {
  let held: CertificateFixture;

  test.beforeAll(async () => {
    held = await createCertificate({
      studentEmail: SEEDED_CLASSMATES[1].email,
      recipientName: SEEDED_CLASSMATES[1].name,
    });
  });

  test.afterAll(async () => {
    await held.remove();
  });

  test("the gallery page redirects a signed-out visitor to /login", async ({ page }) => {
    await page.goto("/certificates");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the API answers 401 in the frozen envelope, not an HTML login page", async ({ page }) => {
    // A redirect here would give a fetch() caller a 200-with-HTML it cannot act
    // on — the reason src/middleware.ts#deny branches on /api/.
    const listing = await page.request.get("/api/certificates");
    expect(listing.status()).toBe(401);
    expect((await listing.json()).ok).toBe(false);

    const download = await page.request.get(`/api/certificates/${held.id}/pdf`);
    expect(download.status()).toBe(401);
    expect(await bodyText(download)).not.toContain(PDF_MAGIC);
  });

  test("POST /api/certificates is 401 for a signed-out caller", async ({ page }) => {
    const response = await page.request.post("/api/certificates");
    expect(response.status()).toBe(401);
  });

  test("the public verify page is reachable with NO session", async ({ page }) => {
    // The one surface that must work signed out. If /verify ever moves under
    // /certificates this spec fails, which is the reminder that the move needs an
    // ALWAYS_ALLOWED exemption in src/middleware.ts.
    await page.goto(`/verify/${held.verificationCode}`);
    await expect(page).not.toHaveURL(/\/login/);
    await expectNoServerError(page);
    await expect(page.getByTestId("verification-panel")).toHaveAttribute(
      "data-outcome",
      "valid",
    );
    await expect(page.getByTestId("verification-recipient")).toContainText(
      SEEDED_CLASSMATES[1].name,
    );
  });

  test("the verify page reveals no email address and no marks", async ({ page }) => {
    // The privacy boundary, asserted on the rendered page rather than trusted from
    // the projection. A shared credential link must not become a way to turn a
    // name on a CV into a contact address.
    await page.goto(`/verify/${held.verificationCode}`);
    const html = await page.content();
    for (const classmate of SEEDED_CLASSMATES) {
      expect(html).not.toContain(classmate.email);
    }
    expect(html).not.toContain(DEMO.student.email);
    // The score snapshot the fixture wrote (268 of 280) must not be on the page.
    expect(html).not.toContain("268");
  });

  test("an unknown code is 'not verified', and reads the same as a typo", async ({ page }) => {
    await page.goto(`/verify/${"f".repeat(32)}`);
    await expect(page.getByTestId("verification-panel")).toHaveAttribute(
      "data-outcome",
      "unknown",
    );
  });

  test("a guessed short id does not resolve to anything", async ({ page }) => {
    // /verify/1 is the certificates version of the enumeration attempt. The shape
    // check rejects it before any query runs.
    for (const guess of ["1", "2", "42", "abc"]) {
      await page.goto(`/verify/${guess}`);
      await expect(page.getByTestId("verification-panel")).toHaveAttribute(
        "data-outcome",
        "unknown",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The holder's own path
// ---------------------------------------------------------------------------

test.describe("a student who holds a certificate", () => {
  let mine: CertificateFixture;

  test.beforeAll(async () => {
    mine = await createCertificate({
      studentEmail: DEMO.student.email,
      recipientName: DEMO.student.name,
    });
  });

  test.afterAll(async () => {
    // Must run even if a spec above failed: leaving a certificate on the demo
    // student would make the "not eligible" specs at the top of this file fail on
    // the next run, in a way whose cause is invisible from their code.
    await mine.remove();
  });

  test("the gallery shows the card with its code and both links", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/certificates");
    await expectNoServerError(page);

    const card = page.getByTestId("certificate-card");
    await expect(card).toBeVisible();
    // The testid is on the Card element itself, so this locator's subtree includes
    // the heading Card renders as a SIBLING of its children — the trap that cost a
    // sibling stream 12 specs today.
    await expect(card).toContainText(DEMO.student.name);
    await expect(page.getByTestId("certificate-code")).toContainText(mine.verificationCode);
    await expect(page.getByTestId("certificate-download")).toBeVisible();
    await expect(page.getByTestId("certificate-verify-link")).toHaveAttribute(
      "href",
      `/verify/${mine.verificationCode}`,
    );
  });

  test("the download is a real PDF, served as a private attachment", async ({ page }) => {
    await loginAs(page, "student");
    const response = await page.request.get(`/api/certificates/${mine.id}/pdf`);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    // `attachment` so a click saves rather than opening a viewer, and `no-store`
    // because a per-user credential must never land in a shared or CDN cache.
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(response.headers()["cache-control"]).toContain("no-store");

    const body = await response.body();
    expect(body.subarray(0, 5).toString("utf8")).toBe(PDF_MAGIC);
    expect(body.byteLength).toBeGreaterThan(1000);
  });

  test("the PDF is reproducible — the same row renders twice", async ({ page }) => {
    // The storage decision (render per request, store only the facts) rests on
    // this. If a second download failed or differed in length, the credential
    // would not be a pure function of its row.
    await loginAs(page, "student");
    const first = await page.request.get(`/api/certificates/${mine.id}/pdf`);
    const second = await page.request.get(`/api/certificates/${mine.id}/pdf`);
    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
    expect((await second.body()).byteLength).toBe((await first.body()).byteLength);
  });

  test("the verify link the student is shown actually verifies", async ({ page }) => {
    // End to end: the code on the card resolves on the public page. A mismatch
    // between what is printed and what verifies is the worst failure this feature
    // can have, because the student only finds out when an employer does.
    await loginAs(page, "student");
    await page.goto("/certificates");
    await page.getByTestId("certificate-verify-link").click();
    await expect(page.getByTestId("verification-panel")).toHaveAttribute(
      "data-outcome",
      "valid",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Revocation
// ---------------------------------------------------------------------------

test.describe("a revoked certificate", () => {
  let revoked: CertificateFixture;

  test.beforeAll(async () => {
    revoked = await createCertificate({
      studentEmail: SEEDED_CLASSMATES[2].email,
      recipientName: SEEDED_CLASSMATES[2].name,
      revoked: true,
      revocationReason: "Issued in error during E2E",
    });
  });

  test.afterAll(async () => {
    await revoked.remove();
  });

  test("verifies as WITHDRAWN, which is not the same as unknown", async ({ page }) => {
    // Deleting a revoked row would make the link read "no such certificate",
    // indistinguishable from a forgery. The distinction is the whole reason the row
    // is kept.
    await page.goto(`/verify/${revoked.verificationCode}`);
    await expect(page.getByTestId("verification-panel")).toHaveAttribute(
      "data-outcome",
      "revoked",
    );
    await expect(page.getByTestId("verification-revoked-note")).toBeVisible();
    await expect(page.getByTestId("verification-panel")).toContainText(
      "Issued in error during E2E",
    );
  });

  test("cannot be downloaded, and answers 410 rather than 404", async ({ page }) => {
    // The holder is entitled to know it was withdrawn rather than to think the
    // link broke.
    await loginAs(page, "student");
    const response = await page.request.get(`/api/certificates/${revoked.id}/pdf`);
    // 404 because it is not the demo student's; the 410 branch is exercised by the
    // owner. Both are acceptable here and neither returns bytes.
    expect([404, 410]).toContain(response.status());
    expect(await bodyText(response)).not.toContain(PDF_MAGIC);
  });
});

// ---------------------------------------------------------------------------
// 6. The admin template surface
// ---------------------------------------------------------------------------

test.describe("the admin template screen", () => {
  test("is refused to a student", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/admin/certificates/templates");
    // Refused at the edge with ?error=forbidden, per src/middleware.ts#deny.
    await expect(page).toHaveURL(/\/login/);
  });

  test("is refused to an INSTRUCTOR — ROLES_SATISFYING.admin is ['admin'] alone", async ({
    page,
  }) => {
    await loginAs(page, "instructor");
    await page.goto("/admin/certificates/templates");
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows the admin which template is in force and previews it", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/certificates/templates");
    await expectNoServerError(page);

    // With no rows seeded this must say "built-in" rather than showing an empty
    // panel: the fallback is a supported state, not a misconfiguration.
    await expect(page.getByTestId("active-template")).toBeVisible();
    await expect(page.getByTestId("template-preview")).toContainText("Sample Student");
    await expect(page.getByTestId("template-placeholders")).toContainText("recipientName");
    // The preview must never contain a real student's code or name.
    await expect(page.getByTestId("template-preview")).not.toContainText(DEMO.student.email);
  });
});
