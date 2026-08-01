// =============================================================================
// LANDING PAGE — tests.
// -----------------------------------------------------------------------------
// BUG 3, reported 2026-08-01: "when students, instructors or admins are logged in,
// the main page / shows login and create account and not something like it's logged
// in for user or even there is no option to go in logged in user's dashboard."
//
// This page is where SignOutButton lands (redirectTo: "/"), so it is the page a
// user sees most often after their first visit — and it was telling them to sign in
// when they already had.
//
// `@/lib/auth` is mocked because importing it for real pulls in `pg` and `bcryptjs`.
// The mock is the whole point of the test anyway: the interesting behaviour is what
// this page does with each shape of session.
// =============================================================================

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => auth() }));

// Imported after the mock is registered.
const { default: HomePage } = await import("./page");

/** Render the async server component's output. */
async function renderPage() {
  render(await HomePage());
}

beforeEach(() => {
  auth.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("signed out", () => {
  it("offers sign-in and registration", async () => {
    auth.mockResolvedValue(null);
    await renderPage();

    expect(screen.getByTestId("landing-signed-out")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register",
    );
    // And no signed-in affordance, which is the other half of the same claim.
    expect(screen.queryByTestId("landing-signed-in")).toBeNull();
  });
});

describe("signed in", () => {
  it.each([
    ["student", "/dashboard", "Go to your dashboard"],
    ["instructor", "/instructor", "Go to your workspace"],
    ["admin", "/admin", "Go to your workspace"],
  ])("a %s is offered %s", async (role, href, label) => {
    auth.mockResolvedValue({ user: { role, name: "Demo Person" } });
    await renderPage();

    const cta = screen.getByTestId("landing-continue");
    // THE DESTINATION IS THE ROLE'S OWN HOME. An admin sent to /dashboard is the bug
    // this page shared with the post-login redirect.
    expect(cta).toHaveAttribute("href", href);
    expect(cta).toHaveTextContent(label);
    expect(screen.getByTestId("landing-signed-in")).toBeInTheDocument();
  });

  it("says who is signed in, and in which role", async () => {
    auth.mockResolvedValue({ user: { role: "admin", name: "Demo Admin" } });
    await renderPage();

    const banner = screen.getByTestId("landing-signed-in");
    expect(banner).toHaveTextContent("Demo Admin");
    expect(banner).toHaveTextContent("Admin");
  });

  it("copes with a session that has no name", async () => {
    // The JWT is minted at sign-in and a name is not guaranteed to be on it.
    auth.mockResolvedValue({ user: { role: "student" } });
    await renderPage();

    expect(screen.getByTestId("landing-signed-in")).toHaveTextContent("Signed in ·");
    expect(screen.getByTestId("landing-continue")).toHaveAttribute("href", "/dashboard");
  });

  it("never shows sign-in and registration to a signed-in user", async () => {
    auth.mockResolvedValue({ user: { role: "instructor", name: "Demo Instructor" } });
    await renderPage();

    expect(screen.queryByTestId("landing-signed-out")).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Create an account" })).toBeNull();
  });
});

describe("degraded sessions", () => {
  it("treats an UNKNOWN role as signed out rather than guessing a surface", async () => {
    // A role this build does not know is a token from elsewhere or a stale JWT.
    // Offering it "your dashboard" would send it to a student page on a guess.
    auth.mockResolvedValue({ user: { role: "superuser", name: "Nobody" } });
    await renderPage();

    expect(screen.getByTestId("landing-signed-out")).toBeInTheDocument();
    expect(screen.queryByTestId("landing-continue")).toBeNull();
  });

  it("STILL RENDERS when the session read throws", async () => {
    // The one route that must survive a broken auth or database layer: it is the
    // public description of the programme and the target of every sign-out.
    auth.mockRejectedValue(new Error("session store unreachable"));
    await renderPage();

    expect(screen.getByTestId("landing-signed-out")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

describe("what the page keeps regardless of session", () => {
  it.each([null, { user: { role: "admin", name: "A" } }])(
    "still describes the programme (session: %p)",
    async (session) => {
      auth.mockResolvedValue(session);
      await renderPage();

      // The marketing content is not conditional — a signed-in user may legitimately
      // be reading it, which is why this is a session-aware page and not a redirect.
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
      expect(screen.getByText("Structured weeks")).toBeInTheDocument();
    },
  );
});
