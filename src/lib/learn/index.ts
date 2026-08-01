// =============================================================================
// LEARN BARREL — what the pages, components and route handler import.
// Owner: interactive-learning stream.
// -----------------------------------------------------------------------------
// query.ts and complete.ts are NOT re-exported here. They import `@/db`, and
// tests/setup.ts forbids a unit test from reaching the database — a barrel that
// pulls them in would make every `import { moduleProgress } from "@/lib/learn"`
// in a test file drag a live pg Pool along with it. Server code imports those two
// modules by path; everything pure comes from here.
// =============================================================================

export {
  LAB_LANGUAGES,
  LEARN_LEVELS,
  LEARN_STEP_KINDS,
} from "./types";
export type {
  CheckExpectation,
  CheckOption,
  DiagramFrame,
  ExplainExpectation,
  LabExpectation,
  LabLanguage,
  LearnLevel,
  LearnModuleDetail,
  LearnModuleSummary,
  LearnStepKind,
  LearnStepView,
  LearnTrackSummary,
  PublicCheck,
  StepExpectation,
} from "./types";

export {
  correctIndex,
  evaluateCheck,
  parseCheck,
  parseExplain,
  parseLab,
  parseStepKind,
  publicCheck,
} from "./expectation";
export type { CheckOutcome } from "./expectation";

export {
  firstIncompleteIndex,
  groupByLevel,
  moduleProgress,
  progressAnnouncement,
  trackProgress,
} from "./progress";
export type {
  ModuleProgress,
  ModuleProgressInput,
  ModuleStatus,
  TrackProgress,
} from "./progress";

export {
  levelLabel,
  titleFromSlug,
  trackDisplay,
  trackMeta,
  trackOrder,
  TRACKS,
} from "./tracks";
export type { TrackMeta } from "./tracks";
