// Barrel for the sample-implementation surface. Import from here, not from the
// files: the split between SampleCard and CodeSnippetViewer is an internal
// detail and moving a component between them should not touch a call site.
export { AssignmentSampleShowcase } from "./AssignmentSampleShowcase";
export type { AssignmentSampleShowcaseProps } from "./AssignmentSampleShowcase";
export { SampleCard } from "./SampleCard";
export type { SampleCardProps } from "./SampleCard";
export { CodeSnippetViewer, toLines, normaliseLineNotes } from "./CodeSnippetViewer";
export type { CodeSnippetViewerProps, SnippetLanguage } from "./CodeSnippetViewer";
export {
  readCodeFiles,
  readFeatures,
  readAcceptanceCriteria,
  readStringList,
} from "./types";
export type { AssignmentSample, CodeExampleFile, AcceptanceCriterion } from "./types";
