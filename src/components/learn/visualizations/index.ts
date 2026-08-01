// =============================================================================
// VISUALIZATION BARREL — the concept visualizers a lecture page may embed
// -----------------------------------------------------------------------------
// Owner: interactive-learning stream (visualizations).
//
// Import from "@/components/learn/visualizations" only. These components are
// entirely client-side and take no data from the API: a lecture page can drop
// one in with literal props and it works, which is deliberate — a visual
// explanation should never be blocked on a fetch.
//
// `./controls` is intentionally NOT re-exported. The shared slider, select and
// live region are an implementation detail of this directory; exporting them
// would invite a seventh visualizer to be built somewhere else, which is how
// the accessibility guarantees here stop being guarantees.
// =============================================================================

export { BoxModelVisualizer, computeDimensions, toSides } from "./BoxModelVisualizer";
export type {
  BoxModelVisualizerProps,
  BoxModelElement,
  BoxModelDimensions,
  BoxSides,
} from "./BoxModelVisualizer";

export {
  FlexboxPlayground,
  FLEX_DIRECTIONS,
  JUSTIFY_VALUES,
  ALIGN_VALUES,
  WRAP_VALUES,
} from "./FlexboxPlayground";
export type {
  FlexboxPlaygroundProps,
  FlexboxConfig,
  FlexDirection,
  JustifyContent,
  AlignItems,
  FlexWrap,
} from "./FlexboxPlayground";

export { GridPlayground, JUSTIFY_ITEMS_VALUES } from "./GridPlayground";
export type {
  GridPlaygroundProps,
  GridPlaygroundConfig,
  GridJustifyItems,
} from "./GridPlayground";

export { HTTPCycleDiagram, DEFAULT_HTTP_STAGES } from "./HTTPCycleDiagram";
export type { HTTPCycleDiagramProps, HttpCycleStage } from "./HTTPCycleDiagram";

export { CSSSpecificityCalculator } from "./CSSSpecificityCalculator";
export type { CSSSpecificityCalculatorProps } from "./CSSSpecificityCalculator";

export { EventBubblingVisualizer } from "./EventBubblingVisualizer";
export type {
  EventBubblingVisualizerProps,
  PropagationEntry,
  PropagationPhase,
} from "./EventBubblingVisualizer";

// The specificity arithmetic is exported because a quiz or a grader may want to
// compute the same answer the visualizer shows, and two implementations of a
// cascade rule would eventually disagree.
export {
  calculateSpecificity,
  compareSpecificity,
  formatSpecificity,
  findWinner,
} from "./specificity";
export type { Specificity, SpecificityResult } from "./specificity";
