// =============================================================================
// REALTIME-QUIZ BARREL.
// -----------------------------------------------------------------------------
// Owner: realtime-quiz stream.
//
// Pure types and pure logic only. `./actions.ts` ("use server") and `./queries.ts`
// (imports @/db) are NOT re-exported here: a client component importing this
// barrel must not pull the server action or a pg pool into the browser graph, and
// a unit test importing it must not hit the deliberately unreachable test
// database. Import those two directly, from server code only.
// =============================================================================

export {
  isRealtimeQuiz,
  toInlineCheck,
  REALTIME_KIND,
} from "./payload";
export type {
  InlineCheck,
  InlineOption,
  InlineQuestion,
  RealtimeOptionRowLike,
  RealtimeQuestionRowLike,
  RealtimeQuizRowLike,
} from "./payload";

export { revealAnswer } from "./reveal";
export type {
  AnswerKeyOptionRow,
  AnswerReveal,
  RevealFailureCode,
  RevealOutcome,
} from "./reveal";

export type { CheckAnswerOutcome } from "./service";
