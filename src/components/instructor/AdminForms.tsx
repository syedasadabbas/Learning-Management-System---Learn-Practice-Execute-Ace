"use client";

// =============================================================================
// ADMIN CONSOLE FORMS — instructor-admin stream.
// -----------------------------------------------------------------------------
// Quiz settings, question authoring, assignment briefs, deadlines and account
// management. Every submit calls an ADMIN-GUARDED server action from
// `@/lib/instructor/actions`; none of these components decides anything about
// access, and rendering one to an instructor would still fail server-side with
// "you do not have access" because `ROLES_SATISFYING.admin` is ["admin"] alone.
//
// Dates are typed as `datetime-local` and sent as an ISO string. The browser
// interprets the field in LOCAL time and the database stores UTC, so each field
// states the timezone it is displaying to avoid an off-by-hours deadline.
// =============================================================================

import * as React from "react";

import { Button, Card, Toast } from "@/components/ui";
import {
  saveAssignmentAction,
  saveQuestionAction,
  saveQuizAction,
  setDeadlineAction,
  updateAccountAction,
  updateCohortAction,
} from "@/lib/instructor/actions";

type Tone = "success" | "error";

/** Shared submit/feedback plumbing so five forms do not repeat it five times. */
function useActionForm() {
  const [pending, setPending] = React.useState(false);
  const [toast, setToast] = React.useState<{ tone: Tone; message: string } | null>(null);

  async function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) {
    setPending(true);
    setToast(null);
    const result = await fn();
    setPending(false);
    setToast(
      result.ok
        ? { tone: "success", message: successMessage }
        : { tone: "error", message: result.error ?? "The change was not saved." },
    );
  }

  const feedback = toast ? (
    <div className="mt-3">
      <Toast
        tone={toast.tone}
        message={toast.message}
        autoDismissMs={toast.tone === "success" ? 5_000 : 0}
        onDismiss={() => setToast(null)}
      />
    </div>
  ) : null;

  return { pending, run, feedback };
}

const inputClass =
  "mt-1 block w-full rounded-md border border-line bg-panel px-2 py-1 text-sm";

/** ISO string -> value for a datetime-local input, in the viewer's timezone. */
function toLocalInputValue(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const offsetMs = d.getTimezoneOffset() * 60_000; // minutes -> milliseconds
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

// ---------------------------------------------------------------------------
// Quiz settings
// ---------------------------------------------------------------------------

export interface QuizFormProps {
  weeks: readonly { id: number; weekNumber: number; title: string }[];
  quiz?: {
    id: number;
    weekId: number;
    title: string;
    totalQuestions: number;
    passingScore: number;
    attemptsAllowed: number;
    timeLimitMinutes: number | null;
    authoredQuestions: number;
  };
}

export function QuizForm({ weeks, quiz }: QuizFormProps) {
  const { pending, run, feedback } = useActionForm();
  const [weekId, setWeekId] = React.useState(String(quiz?.weekId ?? weeks[0]?.id ?? ""));
  const [title, setTitle] = React.useState(quiz?.title ?? "");
  const [totalQuestions, setTotalQuestions] = React.useState(
    String(quiz?.totalQuestions ?? 10),
  );
  const [passingScore, setPassingScore] = React.useState(String(quiz?.passingScore ?? 70));
  const [attemptsAllowed, setAttemptsAllowed] = React.useState(
    String(quiz?.attemptsAllowed ?? 3),
  );
  const [timeLimit, setTimeLimit] = React.useState(
    quiz?.timeLimitMinutes === null || quiz?.timeLimitMinutes === undefined
      ? ""
      : String(quiz.timeLimitMinutes),
  );

  return (
    <Card
      title={quiz ? `Edit quiz: ${quiz.title}` : "New quiz"}
      subtitle={
        quiz
          ? `${quiz.authoredQuestions} question(s) authored of ${quiz.totalQuestions} declared`
          : "One quiz per week; the pass threshold drives week unlocking."
      }
      data-testid="quiz-form-card"
    >
      <form
        data-testid="quiz-form"
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              saveQuizAction({
                id: quiz?.id,
                weekId: Number(weekId),
                title,
                totalQuestions: Number(totalQuestions),
                passingScore: Number(passingScore),
                attemptsAllowed: Number(attemptsAllowed),
                timeLimitMinutes: timeLimit === "" ? null : Number(timeLimit),
              }),
            "Quiz saved.",
          );
        }}
      >
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">Title</span>
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="quiz-title"
            required
          />
        </label>

        <label className="text-sm">
          <span className="font-medium">Week</span>
          <select
            className={inputClass}
            value={weekId}
            onChange={(e) => setWeekId(e.target.value)}
            data-testid="quiz-week"
          >
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>
                Week {w.weekNumber} — {w.title}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="font-medium">Questions</span>
          <input
            type="number"
            min={1}
            max={100}
            className={inputClass}
            value={totalQuestions}
            onChange={(e) => setTotalQuestions(e.target.value)}
            data-testid="quiz-total-questions"
          />
        </label>

        <label className="text-sm">
          <span className="font-medium">Pass mark (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            className={inputClass}
            value={passingScore}
            onChange={(e) => setPassingScore(e.target.value)}
            data-testid="quiz-passing-score"
          />
        </label>

        <label className="text-sm">
          <span className="font-medium">Attempts allowed</span>
          <input
            type="number"
            min={1}
            max={10}
            className={inputClass}
            value={attemptsAllowed}
            onChange={(e) => setAttemptsAllowed(e.target.value)}
            data-testid="quiz-attempts"
          />
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="font-medium">Time limit (minutes)</span>
          <input
            type="number"
            min={1}
            max={600}
            className={inputClass}
            value={timeLimit}
            onChange={(e) => setTimeLimit(e.target.value)}
            placeholder="Leave empty for untimed"
            data-testid="quiz-time-limit"
          />
        </label>

        <div className="sm:col-span-2">
          <Button type="submit" loading={pending} disabled={pending} data-testid="save-quiz">
            Save quiz
          </Button>
        </div>
      </form>
      {feedback}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Question authoring
// ---------------------------------------------------------------------------

interface DraftOption {
  optionText: string;
  isCorrect: boolean;
}

export interface QuestionFormProps {
  quizId: number;
  /** Warn before editing a quiz students have already attempted. */
  hasAttempts?: boolean;
}

export function QuestionForm({ quizId, hasAttempts = false }: QuestionFormProps) {
  const { pending, run, feedback } = useActionForm();
  const [questionText, setQuestionText] = React.useState("");
  const [explanation, setExplanation] = React.useState("");
  const [opts, setOpts] = React.useState<DraftOption[]>([
    { optionText: "", isCorrect: true },
    { optionText: "", isCorrect: false },
    { optionText: "", isCorrect: false },
    { optionText: "", isCorrect: false },
  ]);

  const correctCount = opts.filter((o) => o.isCorrect).length;

  return (
    <Card title="Add a question" data-testid="question-form-card">
      {hasAttempts && (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          Students have already attempted this quiz. Editing an existing question
          replaces its options, and `answers.selected_option_id` is ON DELETE SET
          NULL — previously recorded answers for that question lose their link.
          Adding a new question does not affect past attempts.
        </p>
      )}

      <form
        data-testid="question-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              saveQuestionAction({
                quizId,
                questionText,
                // multiple_select is offered by the schema; this form authors a
                // single-answer MCQ unless more than one option is marked correct.
                type: correctCount > 1 ? "multiple_select" : "mcq",
                explanation: explanation === "" ? null : explanation,
                orderIndex: 0,
                options: opts
                  .filter((o) => o.optionText.trim() !== "")
                  .map((o, i) => ({ ...o, orderIndex: i })),
              }),
            "Question saved.",
          );
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">Question</span>
          <textarea
            rows={2}
            className={inputClass}
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            data-testid="question-text"
            required
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Options (mark at least one correct)
          </legend>
          {opts.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={o.isCorrect}
                aria-label={`Option ${i + 1} is correct`}
                onChange={(e) =>
                  setOpts((prev) =>
                    prev.map((p, j) =>
                      j === i ? { ...p, isCorrect: e.target.checked } : p,
                    ),
                  )
                }
                data-testid={`option-correct-${i}`}
              />
              <input
                className="flex-1 rounded-md border border-line bg-panel px-2 py-1 text-sm"
                value={o.optionText}
                placeholder={`Option ${i + 1}`}
                onChange={(e) =>
                  setOpts((prev) =>
                    prev.map((p, j) =>
                      j === i ? { ...p, optionText: e.target.value } : p,
                    ),
                  )
                }
                data-testid={`option-text-${i}`}
              />
            </div>
          ))}
          {correctCount === 0 && (
            <p className="text-xs text-red-700">
              An MCQ with no correct option would mark every student wrong.
            </p>
          )}
        </fieldset>

        <label className="block text-sm">
          <span className="font-medium">Explanation (shown after grading)</span>
          <textarea
            rows={2}
            className={inputClass}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            data-testid="question-explanation"
          />
        </label>

        <Button
          type="submit"
          loading={pending}
          disabled={pending || correctCount === 0}
          data-testid="save-question"
        >
          Save question
        </Button>
      </form>
      {feedback}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Assignment brief
// ---------------------------------------------------------------------------

export interface AssignmentFormProps {
  weeks: readonly { id: number; weekNumber: number; title: string }[];
  assignment?: {
    id: number;
    weekId: number;
    title: string;
    description: string;
    requirements: string[];
    googleFormUrl: string | null;
    googleSheetCsvUrl: string | null;
    dueAt: Date | string;
    latePenaltyPercentPerDay: number;
  };
}

export function AssignmentForm({ weeks, assignment }: AssignmentFormProps) {
  const { pending, run, feedback } = useActionForm();
  const [weekId, setWeekId] = React.useState(
    String(assignment?.weekId ?? weeks[0]?.id ?? ""),
  );
  const [title, setTitle] = React.useState(assignment?.title ?? "");
  const [description, setDescription] = React.useState(assignment?.description ?? "");
  const [requirements, setRequirements] = React.useState(
    (assignment?.requirements ?? []).join("\n"),
  );
  const [formUrl, setFormUrl] = React.useState(assignment?.googleFormUrl ?? "");
  const [sheetUrl, setSheetUrl] = React.useState(assignment?.googleSheetCsvUrl ?? "");
  const [dueAt, setDueAt] = React.useState(toLocalInputValue(assignment?.dueAt));
  const [latePenalty, setLatePenalty] = React.useState(
    String(assignment?.latePenaltyPercentPerDay ?? 10),
  );

  return (
    <Card
      title={assignment ? `Edit: ${assignment.title}` : "New assignment"}
      subtitle="Until a Google Form URL is set, students have nowhere to submit and the grading queue stays empty."
      data-testid="assignment-form-card"
    >
      <form
        data-testid="assignment-form"
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              saveAssignmentAction({
                id: assignment?.id,
                weekId: Number(weekId),
                title,
                description,
                requirements: requirements
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line !== ""),
                googleFormUrl: formUrl === "" ? null : formUrl,
                googleSheetCsvUrl: sheetUrl === "" ? null : sheetUrl,
                dueAt: new Date(dueAt).toISOString(),
                latePenaltyPercentPerDay: Number(latePenalty),
              }),
            "Assignment saved.",
          );
        }}
      >
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">Title</span>
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="assignment-title"
            required
          />
        </label>

        <label className="text-sm">
          <span className="font-medium">Week</span>
          <select
            className={inputClass}
            value={weekId}
            onChange={(e) => setWeekId(e.target.value)}
            data-testid="assignment-week"
          >
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>
                Week {w.weekNumber} — {w.title}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="font-medium">Late penalty (% per day)</span>
          <input
            type="number"
            min={0}
            max={100}
            className={inputClass}
            value={latePenalty}
            onChange={(e) => setLatePenalty(e.target.value)}
            data-testid="assignment-late-penalty"
          />
          <span className="text-xs text-ink-muted">Capped at 20% total by the scoring contract.</span>
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="font-medium">Description</span>
          <textarea
            rows={3}
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="assignment-description"
            required
          />
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="font-medium">Requirements (one per line)</span>
          <textarea
            rows={4}
            className={inputClass}
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            data-testid="assignment-requirements"
          />
        </label>

        <label className="text-sm">
          <span className="font-medium">Google Form URL</span>
          <input
            type="url"
            className={inputClass}
            value={formUrl}
            onChange={(e) => setFormUrl(e.target.value)}
            data-testid="assignment-form-url"
          />
        </label>

        <label className="text-sm">
          <span className="font-medium">Google Sheet CSV URL</span>
          <input
            type="url"
            className={inputClass}
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            data-testid="assignment-sheet-url"
          />
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="font-medium">
            Due at (your local time, stored as UTC)
          </span>
          <input
            type="datetime-local"
            className={inputClass}
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            data-testid="assignment-due-at"
            required
          />
        </label>

        <div className="sm:col-span-2">
          <Button type="submit" loading={pending} disabled={pending} data-testid="save-assignment">
            Save assignment
          </Button>
        </div>
      </form>
      {feedback}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

export interface DeadlineRowFormProps {
  week: { id: number; weekNumber: number; title: string; dueAt: Date | string | null };
}

export function DeadlineRowForm({ week }: DeadlineRowFormProps) {
  const { pending, run, feedback } = useActionForm();
  const [dueAt, setDueAt] = React.useState(toLocalInputValue(week.dueAt));
  const [cascade, setCascade] = React.useState(true);

  return (
    <div className="border-t border-line py-3" data-testid={`deadline-week-${week.weekNumber}`}>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              setDeadlineAction({
                weekId: week.id,
                dueAt: dueAt === "" ? null : new Date(dueAt).toISOString(),
                alsoUpdateAssignments: cascade,
              }),
            `Week ${week.weekNumber} deadline saved.`,
          );
        }}
      >
        <div className="min-w-40">
          <p className="text-sm font-medium">Week {week.weekNumber}</p>
          <p className="text-xs text-ink-muted">{week.title}</p>
        </div>

        <label className="text-sm">
          <span className="font-medium">Due at (local)</span>
          <input
            type="datetime-local"
            className={inputClass}
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            data-testid={`deadline-input-${week.weekNumber}`}
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={cascade}
            onChange={(e) => setCascade(e.target.checked)}
            data-testid={`deadline-cascade-${week.weekNumber}`}
          />
          Also move this week&apos;s assignments
        </label>

        <Button
          type="submit"
          size="sm"
          loading={pending}
          disabled={pending}
          data-testid={`save-deadline-${week.weekNumber}`}
        >
          Save
        </Button>
      </form>
      {feedback}
    </div>
  );
}

export interface CohortFormProps {
  cohort: {
    id: number;
    name: string;
    startsAt: Date | string;
    gracePeriodDays: number;
    isActive: boolean;
  };
}

export function CohortForm({ cohort }: CohortFormProps) {
  const { pending, run, feedback } = useActionForm();
  const [name, setName] = React.useState(cohort.name);
  const [startsAt, setStartsAt] = React.useState(toLocalInputValue(cohort.startsAt));
  const [grace, setGrace] = React.useState(String(cohort.gracePeriodDays));
  const [isActive, setIsActive] = React.useState(cohort.isActive);

  return (
    <Card title="Cohort configuration" data-testid="cohort-form-card">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              updateCohortAction({
                cohortId: cohort.id,
                name,
                startsAt: new Date(startsAt).toISOString(),
                gracePeriodDays: Number(grace),
                isActive,
              }),
            "Cohort saved.",
          );
        }}
      >
        <label className="text-sm">
          <span className="font-medium">Name</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="cohort-name"
          />
        </label>

        <label className="text-sm">
          <span className="font-medium">Starts at (local)</span>
          <input
            type="datetime-local"
            className={inputClass}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            data-testid="cohort-starts-at"
          />
        </label>

        <label className="text-sm">
          <span className="font-medium">Grace period (days)</span>
          <input
            type="number"
            min={0}
            max={14}
            className={inputClass}
            value={grace}
            onChange={(e) => setGrace(e.target.value)}
            data-testid="cohort-grace"
          />
        </label>

        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            data-testid="cohort-active"
          />
          Active
        </label>

        <div className="sm:col-span-2">
          <Button type="submit" loading={pending} disabled={pending} data-testid="save-cohort">
            Save cohort
          </Button>
        </div>
      </form>
      {feedback}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface AccountRowFormProps {
  account: {
    id: number;
    name: string;
    email: string;
    role: string;
    cohortId: number | null;
  };
  cohorts: readonly { id: number; name: string }[];
}

/**
 * Role and cohort for one account.
 *
 * Email and password are intentionally not editable here: the auth stream owns
 * password hashing, and silently rewriting an email reassigns someone's login.
 */
export function AccountRowForm({ account, cohorts }: AccountRowFormProps) {
  const { pending, run, feedback } = useActionForm();
  const [role, setRole] = React.useState(account.role);
  const [cohortId, setCohortId] = React.useState(
    account.cohortId === null ? "" : String(account.cohortId),
  );

  return (
    <div className="border-t border-line py-2" data-testid={`account-${account.id}`}>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              updateAccountAction({
                userId: account.id,
                role,
                cohortId: cohortId === "" ? null : Number(cohortId),
              }),
            `${account.name} updated.`,
          );
        }}
      >
        <div className="min-w-56">
          <p className="text-sm font-medium">{account.name}</p>
          <p className="text-xs text-ink-muted">{account.email}</p>
        </div>

        <label className="text-sm">
          <span className="font-medium">Role</span>
          <select
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            data-testid={`account-role-${account.id}`}
          >
            <option value="student">student</option>
            <option value="instructor">instructor</option>
            <option value="admin">admin</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="font-medium">Cohort</span>
          <select
            className={inputClass}
            value={cohortId}
            onChange={(e) => setCohortId(e.target.value)}
            data-testid={`account-cohort-${account.id}`}
          >
            <option value="">— none —</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <Button
          type="submit"
          size="sm"
          loading={pending}
          disabled={pending}
          data-testid={`save-account-${account.id}`}
        >
          Save
        </Button>
      </form>
      {feedback}
    </div>
  );
}
