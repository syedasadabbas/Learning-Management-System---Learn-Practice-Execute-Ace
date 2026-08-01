// =============================================================================
// /interview/[slug] — one interview drill. Owner: coding-problems stream.
// =============================================================================

import { BankProblemPage } from "@/components/problems/BankPages";

export const dynamic = "force-dynamic";

export default async function InterviewProblemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <BankProblemPage bank="interview" slug={slug} />;
}
