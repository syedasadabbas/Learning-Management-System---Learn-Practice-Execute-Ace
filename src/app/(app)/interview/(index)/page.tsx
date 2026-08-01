// =============================================================================
// /interview — the interview drill bank. Owner: coding-problems stream.
// -----------------------------------------------------------------------------
// Same machinery as /problems; `coding_problems.is_interview` is the whole
// difference. The level ladder is computed per bank, so progress here is separate
// from practice progress — see src/lib/problems/progression.ts for why.
// =============================================================================

import { BankListPage, type RawSearchParams } from "@/components/problems/BankPages";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Interview drills",
  description: "Interview-style coding problems by track and level.",
};

export default async function InterviewPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  return <BankListPage bank="interview" searchParams={await searchParams} />;
}
