// =============================================================================
// /problems/[slug] — one practice problem. Owner: coding-problems stream.
// =============================================================================

import { BankProblemPage } from "@/components/problems/BankPages";

export const dynamic = "force-dynamic";

export default async function PracticeProblemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <BankProblemPage bank="practice" slug={slug} />;
}
