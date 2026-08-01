// =============================================================================
// /problems — the syllabus practice bank. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// A thin wrapper: everything is in `BankListPage`, shared with /interview, because
// the two surfaces differ only by `coding_problems.is_interview`.
// =============================================================================

import { BankListPage, type RawSearchParams } from "@/components/problems/BankPages";

// Reads this student's derived solved state per request; nothing is prerenderable.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Practice problems",
  description: "Coding drills by track and level, with in-browser runs and server-side grading.",
};

export default async function ProblemsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <BankListPage bank="practice" searchParams={await searchParams} />;
}
