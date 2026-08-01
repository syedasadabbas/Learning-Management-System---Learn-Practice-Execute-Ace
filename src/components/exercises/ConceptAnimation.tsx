"use client";

// =============================================================================
// CONCEPT ANIMATION — dispatcher for the animated explainers
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// One entry point so a caller (a lecture page, the practice page) needs to know
// only a concept id, never which component file implements it. An unknown id
// renders an explanatory note instead of throwing: ids arrive from the registry
// and, in the /practice/concept route, from a URL a student can mistype.
// =============================================================================

import * as React from "react";

import { Card } from "@/components/ui";
import { conceptById, type ConceptId } from "@/lib/exercises";

import { BoxModelDiagram } from "./animations/BoxModelDiagram";
import { FlexAxesDiagram } from "./animations/FlexAxesDiagram";
import { HttpCycleDiagram } from "./animations/HttpCycleDiagram";

const DIAGRAMS: Record<ConceptId, React.ComponentType> = {
  "box-model": BoxModelDiagram,
  "flex-axes": FlexAxesDiagram,
  "http-cycle": HttpCycleDiagram,
};

export interface ConceptAnimationProps {
  /** Typed as string, not ConceptId: callers include a dynamic route segment. */
  conceptId: string;
  /** Render without the surrounding Card (for embedding in another card). */
  bare?: boolean;
}

export function ConceptAnimation({ conceptId, bare = false }: ConceptAnimationProps) {
  const concept = conceptById(conceptId);
  const Diagram = concept ? DIAGRAMS[concept.id] : undefined;

  if (!concept || !Diagram) {
    return (
      <Card title="Explainer not available" data-testid="concept-animation-missing">
        <p className="text-sm text-ink-muted">
          There is no animated explainer called &ldquo;{conceptId}&rdquo;. The rest of this
          page is unaffected.
        </p>
      </Card>
    );
  }

  if (bare) return <Diagram />;

  return (
    <Card title={concept.title} subtitle={concept.summary} data-testid="concept-card">
      <Diagram />
    </Card>
  );
}

export default ConceptAnimation;
