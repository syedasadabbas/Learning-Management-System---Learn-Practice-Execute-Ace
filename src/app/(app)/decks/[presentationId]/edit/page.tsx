// =============================================================================
// /decks/[presentationId]/edit — the presentation builder.
// Owner: the data-bound component stream (add-on wave).
// -----------------------------------------------------------------------------
// ACCESS TO A DECK IS NOT A ROLE, IT IS A ROW, and this page enforces the
// editing half of that rule rather than assuming the API will.
//
// `ROUTE_AUTH` marks every presentation route "student", and the contract file
// explains why in a comment on those lines: "a deck is STUDENT-OWNED work ...
// the access decision is therefore not a role at all — it is creator vs
// published vs shared, evaluated per row". READING is governed by
// src/app/api/presentations/_access.ts. WRITING is narrower still: only the
// creator or an admin may save. So this page refuses a non-creator BEFORE
// rendering an editor whose save button would 403 — an editor you can type into
// and cannot save is a worse experience than an honest refusal.
//
// SPEAKER NOTES COME FROM THE SERVER'S OWN ANSWER. `speakerNotesIncluded` is
// computed by `mayReadSpeakerNotes`, and this page recomputes the same
// condition rather than defaulting the editor to "notes editable". A notes
// field that silently discards what is typed is the failure being avoided.
// =============================================================================

import Link from "next/link";
import { eq } from "drizzle-orm";

import { PresentationBuilder } from "@/components/presentations/builder";
import { EmptyState } from "@/components/ui";
import { db } from "@/db";
import { presentations } from "@/db/schema.presentations";
import { requireFeature } from "@/lib/feature-guard";
import { requireRole } from "@/lib/guard";
import { emptyDeck, parseSlideDeck } from "@/lib/presentations/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ presentationId: string }>;

function intParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function Refusal({ title, description }: { title: string; description: string }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <EmptyState
        title={title}
        description={description}
        action={
          <Link className="text-brand underline" href="/dashboard">
            Back to your dashboard
          </Link>
        }
      />
    </main>
  );
}

export default async function DeckEditorPage({ params }: { params: Params }) {
  requireFeature("presentations");
  const user = await requireRole("student");

  const presentationId = intParam((await params).presentationId);
  if (presentationId === null) {
    return <Refusal title="That is not a deck" description="The address is malformed." />;
  }

  const [deckRow] = await db
    .select({
      id: presentations.id,
      title: presentations.title,
      creatorId: presentations.creatorId,
      slidesJson: presentations.slidesJson,
    })
    .from(presentations)
    .where(eq(presentations.id, presentationId))
    .limit(1);

  if (!deckRow) {
    // 404 rather than 403 for a deck that exists but is not yours would leak
    // its existence; this branch covers both by answering the same way.
    return (
      <Refusal
        title="Deck not found"
        description="This presentation does not exist, or it is not yours to edit."
      />
    );
  }

  const isCreator = deckRow.creatorId === user.id;
  const mayEdit = isCreator || user.role === "admin";

  if (!mayEdit) {
    return (
      <Refusal
        title="Deck not found"
        description="This presentation does not exist, or it is not yours to edit."
      />
    );
  }

  // Every read of `slides_json` goes through the canonical parser — the column
  // is jsonb and a stored blob is untrusted input, not a type. A deck written
  // by an older schema that no longer validates opens EMPTY rather than
  // crashing the editor, and the author is told so.
  const parsed = parseSlideDeck(deckRow.slidesJson);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      {!parsed.ok && (
        <p role="alert" className="rounded-md border border-line bg-panel p-3 text-sm text-ink">
          The stored slides for this deck could not be read and have not been loaded. Saving now
          will replace them. First problem: {parsed.errors[0]}
        </p>
      )}
      <PresentationBuilder
        presentationId={presentationId}
        title={deckRow.title}
        initialDeck={parsed.ok ? parsed.value : emptyDeck()}
        // Speaker notes are presenter-only; the creator and staff see them, and
        // this is the same condition `mayReadSpeakerNotes` applies server-side.
        notesEditable={isCreator || user.role === "admin" || user.role === "instructor"}
      />
    </main>
  );
}
