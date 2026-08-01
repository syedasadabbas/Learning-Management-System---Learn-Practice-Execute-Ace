// =============================================================================
// /leaderboard/me — Owner: leaderboard stream.
// -----------------------------------------------------------------------------
// The skill's definition of done requires the current user's row to be
// "reachable via /leaderboard/me". This is a deliberate redirect rather than a
// second copy of the board:
//
//   - one board means one rendering of the ranks, so /leaderboard/me can never
//     show a different rank from /leaderboard;
//   - `#me` is the id the highlighted row carries (see LeaderboardTable), so the
//     browser scrolls straight to it with no JavaScript;
//   - the machine-readable equivalent is GET /api/leaderboard/me, which is a
//     real handler returning `ApiResult<MyStanding | null>`.
//
// `redirect()` throws, so nothing after it executes.
// =============================================================================

import { redirect } from "next/navigation";

import { requireRole } from "@/lib/guard";

export const dynamic = "force-dynamic";

export const metadata = { title: "My standing" };

export default async function MyStandingPage() {
  // Guard before redirecting: an anonymous visitor should land on /login with
  // `next=/leaderboard/me`, not be bounced to /leaderboard and only then blocked.
  await requireRole("student", "/leaderboard/me");
  redirect("/leaderboard#me");
}
