// =============================================================================
// INSTRUCTOR/ADMIN COMPONENT BARREL — owned by the instructor-admin stream.
// Pages under src/app/(staff) import from here.
// =============================================================================

export { StatTile, RateTile, RateText, AverageText } from "./StatTile";
export type { StatTileProps, RateTileProps } from "./StatTile";

export { QueueTable, QueueFilters } from "./QueueTable";
export type { QueueTableProps, QueueFiltersProps } from "./QueueTable";

export { GradeForm } from "./GradeForm";
export type { GradeFormProps } from "./GradeForm";

export { PenaltyForm } from "./PenaltyForm";
export type { PenaltyFormProps } from "./PenaltyForm";

export { ExportButton } from "./ExportButton";
export type { ExportButtonProps } from "./ExportButton";

export {
  AnalyticsSummary,
  WeekAnalyticsTable,
  QuizDistribution,
  AtRiskList,
} from "./AnalyticsPanels";

export {
  StudentTable,
  StudentProgressPanel,
  PenaltyList,
  AttendanceList,
} from "./StudentTable";

export {
  QuizForm,
  QuestionForm,
  AssignmentForm,
  DeadlineRowForm,
  CohortForm,
  AccountRowForm,
} from "./AdminForms";
export type {
  QuizFormProps,
  QuestionFormProps,
  AssignmentFormProps,
  DeadlineRowFormProps,
  CohortFormProps,
  AccountRowFormProps,
} from "./AdminForms";
