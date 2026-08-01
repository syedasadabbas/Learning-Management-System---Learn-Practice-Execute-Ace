// =============================================================================
// WEEK 4 GRAND EXAM — "Git, Deployment & Final Project".
// Blueprint: CURRICULUM_PLAN.md A.4.
// -----------------------------------------------------------------------------
// Draws on the week's three EXISTING lectures, unmodified:
//   L1 "Git Fundamentals & the Three Areas"
//   L2 "Branching, Pull Requests & Collaboration"
//   L3 "Deployment & Going Live"
//
// 30 mcq (2) + 14 code_fix (3) + 6 code_write (8) = 50 questions / 150 points.
//
// ALL PROSE IS ORIGINAL. In particular, none of these stems repeats a question
// from the owner's existing week 4 practice quiz in scripts/seed-content.ts —
// that quiz is frozen and untouched, and an exam that merely restates it would
// measure recall of one specific quiz rather than of the week.
//
// -----------------------------------------------------------------------------
// A STATED WORKAROUND, NOT AN EQUIVALENCE
// -----------------------------------------------------------------------------
// Git cannot be executed here. There is no git in a browser runtime and git is
// not a Piston language, so NOTHING in this exam runs git or observes a real
// repository. Two substitutions follow, and both are weaker than the real thing:
//
//   1. `code_fix` items need no runtime at all. The artefact is a broken command
//      sequence, .gitignore, conflict-marked file, asset path or CI workflow,
//      plus four candidate patches with exactly one correct. This grades a
//      student's READING of a repository artefact. It does not grade their
//      ability to drive git at a terminal, and it cannot.
//
//   2. `code_write` items are `javascript` over git- and deployment-DERIVED
//      TEXT: porcelain status output, commit-message conventions, conflict
//      markers, version bumping, asset-path rewriting, secret scanning. Each is
//      deterministically executable and each tests something the week actually
//      taught. None of them is evidence that the student can rebase, resolve a
//      conflict in a working tree, or recover a repository.
//
// The honest gap: a "write the git command" free-form item cannot be auto-graded,
// so it is represented as `code_fix` instead. Real git competence still needs to
// be observed in the assignment and the final project, which are unchanged.
// =============================================================================

import type { SeedExam } from "./types";

/** Reads all of stdin on both runtimes. Mirrors JS_STDIN in ../problems/prelude.ts. */
const STDIN =
  'const stdin = typeof readAll === "function" ? readAll() : require("fs").readFileSync(0, "utf8");';

export const week4Exam: SeedExam = {
  weekNumber: 4,
  title: "Week 4 Grand Exam — Git, Deployment & Delivery",
  questions: [
    // =======================================================================
    // mcq 1-12 — foundational recall
    // =======================================================================
    {
      type: "mcq",
      questionText: "Name the three areas a change moves through in a Git repository, in order.",
      explanation:
        "A change starts in the working directory (the files on disk), is selected into the staging area, and is recorded permanently in the repository by a commit. The staging area is the step that exists so a commit can contain some of your changes rather than all of them.",
      options: [
        { text: "Working directory, staging area, repository", correct: true },
        { text: "Repository, working directory, staging area" },
        { text: "Local branch, remote branch, pull request" },
        { text: "Draft, review, release" },
      ],
    },
    {
      type: "mcq",
      questionText: "You have edited four files but staged only one. What will the next commit contain?",
      explanation:
        "Only the staged file. A commit records the staging area, not the working directory, which is precisely what makes it possible to commit one logical change while leaving unrelated edits for later.",
      options: [
        { text: "Only the one staged file", correct: true },
        { text: "All four files, because they are all in the repository directory" },
        { text: "Nothing — a commit requires every change to be staged" },
        { text: "The one staged file, plus any file changed since the last commit" },
      ],
    },
    {
      type: "mcq",
      questionText: "Which statement about staging a change is correct?",
      explanation:
        "Staging copies the current state of the change into the index, and that is what a later commit records. It does not create a commit, does not contact any remote, and does not lock the file — you can keep editing, and further edits are then unstaged.",
      options: [
        {
          text: "It selects the change's current state for the next commit and nothing more",
          correct: true,
        },
        { text: "It creates a commit that can be undone later" },
        { text: "It uploads the change to the remote repository" },
        { text: "It locks the file so it cannot be edited until the commit is made" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does a status report distinguish that a plain directory listing cannot?",
      explanation:
        "It separates changes that are staged for the next commit from changes that are only in the working directory, and it lists files Git is not tracking at all. Those three states are invisible to a file listing.",
      options: [
        {
          text: "Staged changes, unstaged changes, and untracked files",
          correct: true,
        },
        { text: "Which files are the largest in the repository" },
        { text: "Which commits have been pushed to the remote" },
        { text: "Which branches other people are working on" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does a one-line-per-commit history view give you that the full log does not?",
      explanation:
        "A scannable shape: one abbreviated hash and one subject per commit, so a long history can be read at a glance. It shows less per commit, not more — the full log carries the author, date and body.",
      options: [
        { text: "One abbreviated hash and subject per commit, so the shape of the history is scannable", correct: true },
        { text: "The full diff of every commit, condensed" },
        { text: "Only the commits that have not yet been pushed" },
        { text: "The commits ordered by size rather than by date" },
      ],
    },
    {
      type: "mcq",
      questionText: "Why is the imperative mood the convention for a commit subject?",
      explanation:
        "A commit describes the change it makes when applied, so \"Add pagination\" reads as an instruction the commit carries out. It also matches the messages Git generates itself, so a history written that way reads consistently.",
      options: [
        {
          text: "A commit describes the change it applies, so it reads as an instruction the commit carries out",
          correct: true,
        },
        { text: "Git rejects subjects written in the past tense" },
        { text: "The imperative mood produces shorter subjects, which Git requires" },
        { text: "It is only a convention for merge commits" },
      ],
    },
    {
      type: "mcq",
      questionText: "A commit subject should say why rather than what. Why is what the less useful half?",
      explanation:
        "The diff already records what changed, exactly and completely. The reasoning behind it exists nowhere else, so a message that restates the diff loses the only information a future reader cannot recover.",
      options: [
        { text: "The diff already records what changed; the reason exists nowhere else", correct: true },
        { text: "Git truncates any subject that names a file" },
        { text: "The reason is stored automatically in the commit metadata" },
        { text: "What changed is only relevant on the default branch" },
      ],
    },
    {
      type: "mcq",
      questionText: "What effect does adding a path to .gitignore have on a file Git is already tracking?",
      explanation:
        "None. Ignore rules only stop Git from picking up untracked files. A file already tracked keeps being tracked and keeps reporting changes until it is explicitly removed from the index — which is why an ignore rule added late does not solve a committed secret.",
      options: [
        { text: "None — it must be removed from the index before the rule takes effect", correct: true },
        { text: "The file is untracked and deleted from the repository automatically" },
        { text: "The file stops appearing in future commits but stays in the index" },
        { text: "The file's history is rewritten to remove it" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is a branch, mechanically?",
      explanation:
        "A branch is a movable pointer at one commit, and it advances as you commit. That is why creating one is instant and costs nothing: no files are copied and nothing is duplicated.",
      options: [
        { text: "A movable pointer to a commit, which advances as you commit", correct: true },
        { text: "A full copy of the project's files at a point in time" },
        { text: "A compressed archive of the commits it contains" },
        { text: "A server-side label that only the remote can create" },
      ],
    },
    {
      type: "mcq",
      questionText: "What happens to your uncommitted work when you switch branches?",
      explanation:
        "It comes with you if it does not conflict with the files the target branch changes, and Git refuses the switch if it would be overwritten. Uncommitted work is not attached to a branch, which is exactly why it is easy to lose track of.",
      options: [
        {
          text: "It follows you, unless it would be overwritten — in which case Git refuses the switch",
          correct: true,
        },
        { text: "It is committed automatically to the branch you are leaving" },
        { text: "It is always discarded" },
        { text: "It is copied to both branches" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is a pull request, in terms of what it adds to a plain merge?",
      explanation:
        "A pull request is a proposal to merge that has a place for discussion, review and automated checks before it happens. The merge itself is the same operation; the review point is what the pull request adds.",
      options: [
        { text: "A reviewable proposal to merge, with discussion and checks before the merge happens", correct: true },
        { text: "A faster merge algorithm provided by the hosting platform" },
        { text: "A way to pull someone else's commits without merging them" },
        { text: "A backup of the branch, taken before merging" },
      ],
    },
    {
      type: "mcq",
      questionText: "What do the markers <<<<<<<, ======= and >>>>>>> in a file mean?",
      explanation:
        "Git could not reconcile two changes to the same region, so it wrote both versions into the file with markers separating them. They are not comments and not a preview: the file is in a broken intermediate state until you edit it to what you want and delete all three markers.",
      options: [
        {
          text: "Git wrote both conflicting versions into the file and is waiting for you to choose",
          correct: true,
        },
        { text: "Git is showing a read-only preview and will clean them up itself" },
        { text: "The file is corrupted and must be restored from the remote" },
        { text: "They are comments recording who last edited the region" },
      ],
    },

    // =======================================================================
    // mcq 13-24 — applied reasoning
    // =======================================================================
    {
      type: "mcq",
      questionText: "Why treat the default branch as something other than a place to work?",
      explanation:
        "Because it is the branch everything else is measured against and, on a continuously deployed project, the branch that is live. Half-finished work committed there is deployed and is also what every new branch starts from.",
      options: [
        {
          text: "It is the reference every branch starts from and, with continuous deployment, what is live",
          correct: true,
        },
        { text: "Git performance degrades as the default branch gains commits" },
        { text: "The default branch cannot be merged into once it has been committed to" },
        { text: "Hosting providers refuse to deploy branches with many commits" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "This repository uses main, develop and feature/* branches. What does each one hold?",
      explanation:
        "main holds what is released, develop holds work that is integrated and staged but not yet released, and each feature/* branch holds one change in progress. The value is that every commit has an obvious home, and \"is this live?\" is answered by which branch it is on.",
      options: [
        {
          text: "main is released, develop is integrated and staged, and each feature/* branch is one change in progress",
          correct: true,
        },
        { text: "main is the newest work, develop is the archive, and feature/* branches are backups" },
        { text: "All three are equivalent; the names are only labels for humans" },
        { text: "main is for code, develop is for documentation, and feature/* is for tests" },
      ],
    },
    {
      type: "mcq",
      questionText: "Which of these is a well-chosen branch name?",
      explanation:
        "A branch name should say what the change is, so it is recognisable in a list of open branches weeks later. A name derived from the date, the author or the word \"fix\" identifies the branch to nobody, including its own author.",
      options: [
        { text: "feature/contact-form-validation", correct: true },
        { text: "feature/tuesday-afternoon-work" },
        { text: "amaras-branch-2-newest-copy" },
        { text: "fix-the-broken-thing-again" },
      ],
    },
    {
      type: "mcq",
      questionText: "What is the correct sequence for resolving a merge conflict?",
      explanation:
        "Edit the file to the state you actually want, remove every marker, stage the resolved file, then complete the merge. Choosing one side wholesale is sometimes right but is a decision, not a step — and reverting or re-cloning discards the merge instead of resolving it.",
      options: [
        {
          text: "Edit the file to the intended state, delete all markers, stage it, then complete the merge",
          correct: true,
        },
        { text: "Delete the conflicted file, then commit, then restore it from the remote" },
        { text: "Abandon the merge and re-clone the repository" },
        { text: "Commit the file as-is, then fix the markers in a follow-up commit" },
      ],
    },
    {
      type: "mcq",
      questionText: "A deployed page shows a line reading ======= partway down. What has most likely happened?",
      explanation:
        "A conflict marker was committed inside a file and deployed with it. It is visible to every visitor, which is what makes it such a recognisable mistake — and it means the conflicted region was never actually resolved.",
      options: [
        { text: "A conflict marker was left in the file, committed and deployed", correct: true },
        { text: "The hosting provider inserted a separator between deployments" },
        { text: "The file was truncated during upload" },
        { text: "A CSS border was rendered as text" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A resolution keeps only the incoming side of a conflict and discards the local side entirely. When is that wrong?",
      explanation:
        "Whenever both sides contained changes that are still wanted — which is the usual case, since a conflict means two people changed the same region for two reasons. Taking one side wholesale is fast and silently drops the other person's work.",
      options: [
        {
          text: "Whenever both sides contained wanted changes, which a conflict usually means",
          correct: true,
        },
        { text: "Never — taking the incoming side is always the safe default" },
        { text: "Only when the file is a binary file" },
        { text: "Only if the two sides came from different remotes" },
      ],
    },
    {
      type: "mcq",
      questionText: "What does static hosting deploy from a tracked branch actually do on each push?",
      explanation:
        "It checks out the pushed commit, runs whatever build the project declares, and publishes the output. The commit is the input to the pipeline, which is why the live site is a function of the repository rather than of whatever was last uploaded by hand.",
      options: [
        { text: "Checks out the pushed commit, runs the declared build, and publishes its output", correct: true },
        { text: "Copies your local working directory, including uncommitted changes" },
        { text: "Serves the repository's files directly, with no build step ever" },
        { text: "Waits for a manual upload before anything changes" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A project builds locally but the deployed site serves the pre-build source. What is the most likely cause?",
      explanation:
        "The pipeline has no build step, or publishes the wrong directory, so the sources are served instead of the output. The local machine has the built files on disk, which is exactly why the problem is invisible until deployment.",
      options: [
        { text: "The deploy configuration has no build step, or publishes the wrong output directory", correct: true },
        { text: "The hosting provider caches the first deployment permanently" },
        { text: "The repository is missing a default branch" },
        { text: "The build output must be committed to the repository to be served" },
      ],
    },
    {
      type: "mcq",
      questionText: "How should a deploy pipeline get an API key it needs at build time?",
      explanation:
        "From a secret configured in the platform and referenced by name, so the value is never in the repository and can be rotated without a commit. A literal in a tracked workflow file is a committed secret with extra steps.",
      options: [
        {
          text: "From a secret stored in the platform and referenced by name in the workflow",
          correct: true,
        },
        { text: "As a literal value in the tracked workflow file" },
        { text: "From a committed .env file, ignored only in the local checkout" },
        { text: "Encoded in base64 in the workflow file, which makes it unreadable" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A site is served from example.test/portfolio/. Which asset reference resolves correctly from a page in that directory?",
      explanation:
        "styles.css resolves against the page's own directory, so it works both locally and under a subdirectory. A leading slash resolves from the origin root — example.test/styles.css — which does not exist on that host.",
      options: [
        { text: "styles.css", correct: true },
        { text: "/styles.css" },
        { text: "/portfolio/../styles.css" },
        { text: "file:///styles.css" },
      ],
    },
    {
      type: "mcq",
      questionText: "Why does deleting a file and committing not remove its contents from the repository?",
      explanation:
        "A commit adds a new state; it does not edit the states already recorded. The earlier commits still contain the file, so anyone with the repository can read it. Removing it genuinely means rewriting history, and a leaked credential must be treated as compromised regardless.",
      options: [
        {
          text: "Earlier commits still contain it — a deletion adds a new state rather than editing old ones",
          correct: true,
        },
        { text: "It does remove it; only the remote keeps a cached copy for a while" },
        { text: "The file is removed but its name remains in the index" },
        { text: "It is removed once the branch is merged into the default branch" },
      ],
    },
    {
      type: "mcq",
      questionText: "You have committed a live API key. What is the correct first action?",
      explanation:
        "Revoke and reissue the key. It has been readable by anyone with the repository since the commit, so removing it from history is cleanup, not containment — and the history may already have been cloned or mirrored.",
      options: [
        { text: "Revoke the key and issue a new one; then clean the history", correct: true },
        { text: "Delete the file and commit, which removes it from the repository" },
        { text: "Add the file to .gitignore, which untracks it retroactively" },
        { text: "Force-push over the commit, which removes every trace of it" },
      ],
    },

    // =======================================================================
    // mcq 25-30 — edge cases and traps
    // =======================================================================
    {
      type: "mcq",
      questionText: "What makes a force-push onto a shared branch dangerous?",
      explanation:
        "It replaces the branch's history on the remote, so commits other people already have no longer exist there. Their next fetch disagrees with their local copy, and work based on the replaced commits has to be recovered by hand.",
      options: [
        {
          text: "It replaces history others already have, so their copies diverge and work can be lost",
          correct: true,
        },
        { text: "It deletes the branch's files on the remote server" },
        { text: "It is only dangerous on the default branch, never on a feature branch" },
        { text: "Nothing — Git refuses a force-push that would lose commits" },
      ],
    },
    {
      type: "mcq",
      questionText: "When is amending the previous commit the wrong choice?",
      explanation:
        "Once it has been pushed and others may have it: amending produces a different commit, so publishing it requires a force-push with all the consequences that carries. Before pushing, amending is a tidy way to fix your own last commit.",
      options: [
        { text: "Once it has been pushed and others may already have it", correct: true },
        { text: "Whenever the commit message needs changing" },
        { text: "Whenever more than one file is involved" },
        { text: "Always — amending is never correct" },
      ],
    },
    {
      type: "mcq",
      questionText: "A site redirects HTTP to HTTPS but sends no HSTS header. What remains possible?",
      explanation:
        "The first request of a session still goes out over plain HTTP and can be intercepted before the redirect is ever received. HSTS tells the browser to use HTTPS for subsequent visits without asking, closing that first-request window.",
      options: [
        {
          text: "The initial plain-HTTP request can be intercepted before the redirect reaches the browser",
          correct: true,
        },
        { text: "Nothing — a redirect is equivalent to HSTS" },
        { text: "The certificate can be downgraded to a weaker cipher" },
        { text: "Search engines will index the HTTP version instead" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "A project passes every check on the developer's machine but is broken for a first-time visitor. Which check would have caught it before launch?",
      explanation:
        "Loading the deployed URL in a fresh session — a private window or a different device — with the console open. A local machine has warm caches and files on disk, so an asset that only exists locally, or a path that only resolves locally, keeps working there and nowhere else.",
      options: [
        {
          text: "Loading the deployed URL in a fresh private window with the console open",
          correct: true,
        },
        { text: "Re-running the local development server one more time" },
        { text: "Checking the repository has no uncommitted changes" },
        { text: "Confirming the README is up to date" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "Why is \"it works when I open index.html from my desktop\" not evidence that a site will deploy correctly?",
      explanation:
        "A file opened from disk uses the file scheme, where the origin root is the filesystem and case sensitivity may differ from the server's. Root-relative paths, fetch calls and case-mismatched filenames all behave differently once the same files are served over HTTP.",
      options: [
        {
          text: "The file scheme resolves paths and enforces case differently from an HTTP server",
          correct: true,
        },
        { text: "Browsers disable CSS when a page is opened from disk" },
        { text: "Opening from disk always uses a cached copy of the page" },
        { text: "There is no difference; the two are equivalent" },
      ],
    },
    {
      type: "mcq",
      questionText:
        "What is the practical difference between downloading remote commits and downloading-and-integrating them?",
      explanation:
        "Downloading alone leaves your working branch exactly as it was, so you can inspect what arrived before deciding. The combined operation also merges or rebases it into your current branch, which can produce a conflict you were not expecting mid-task.",
      options: [
        {
          text: "Downloading alone changes nothing locally; the combined operation also merges into your branch",
          correct: true,
        },
        { text: "Downloading alone is the only one that can produce a conflict" },
        { text: "They are the same operation with different names" },
        { text: "Downloading alone works on branches; the combined one works only on tags" },
      ],
    },

    // =======================================================================
    // code_fix 31-38 — applied (broken artefacts; no runtime required)
    // =======================================================================
    {
      type: "code_fix",
      questionText:
        "The author expects both edited files in the commit, but only one lands. What is the correct fix?",
      explanation:
        "Only nav.html was staged, and a commit records the staging area. Staging footer.html before committing is the fix. Repeating the commit with a message changes nothing, --amend after the fact still commits nothing new, and a push cannot add a file that was never committed.",
      language: "bash",
      starterCode: `git add nav.html
# footer.html was also edited
git commit -m "Align nav and footer spacing"`,
      options: [
        { text: "Stage footer.html as well before committing", correct: true },
        { text: "Run the commit command a second time" },
        { text: "Run the commit with --amend and no other change" },
        { text: "Push the branch, which will include the unstaged file" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This commit message will be useless to whoever reads the history in six months. What is the correct fix?",
      explanation:
        "The subject restates the diff, which the diff already shows, in the past tense. A subject in the imperative mood that gives the reason carries the one thing the diff cannot. Listing files, leading with a date, or saying only that something was updated all make it less informative.",
      language: "text",
      starterCode: `changed styles.css and header.html, added 12 lines removed 4`,
      options: [
        { text: "Rewrite it as: Fix header overlap on narrow viewports", correct: true },
        { text: "Rewrite it as: Updated styles.css and header.html" },
        { text: "Rewrite it as: 2026-07-30 header and stylesheet" },
        { text: "Rewrite it as: update the code as discussed" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "Every deploy adds thousands of generated files to the repository. What is the correct fix to this .gitignore?",
      explanation:
        "The build output directory is not ignored, so it is committed on every build. Adding it is the fix. A blanket rule on all directories would ignore the source too, ignoring the lockfile removes something that must be tracked, and a comment changes nothing.",
      language: "gitignore",
      starterCode: `node_modules/
.env
.DS_Store
# the build writes its output to dist/`,
      options: [
        { text: "Add a dist/ line to the file", correct: true },
        { text: "Add a */ line to ignore every directory" },
        { text: "Add package-lock.json to the file" },
        { text: "Move the comment above node_modules/" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This sequence commits a file holding live credentials. What is the correct fix?",
      explanation:
        "Staging everything sweeps in an untracked secret. Ignoring the file first — before it is ever staged — keeps it out of the index, and the credentials should be revoked if the commit was already published. Committing then deleting leaves the secret in history, and an ignore rule added afterwards has no effect on a tracked file.",
      language: "bash",
      starterCode: `# the working directory contains .env with a live database URL
git add .
git commit -m "Add deploy configuration"`,
      options: [
        { text: "Add .env to .gitignore before staging, and stage the intended files explicitly", correct: true },
        { text: "Commit as written, then delete .env and commit again" },
        { text: "Commit as written, then add .env to .gitignore" },
        { text: "Rename .env to env.txt before staging" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "The previous commit is already pushed and a teammate has pulled it. The author now wants to include one more file. What is the correct fix?",
      explanation:
        "Amending rewrites the published commit, so it can only be shared by force-pushing over history a teammate already has. A new commit adds the file without disturbing anything. Reverting then re-committing is a noisy way to reach the same place, and a plain push of an amended commit is simply rejected.",
      language: "bash",
      starterCode: `git add legal.html
git commit --amend --no-edit
git push`,
      options: [
        { text: "Make a new commit for legal.html instead of amending", correct: true },
        { text: "Keep the amend and add --force to the push" },
        { text: "Revert the previous commit, then re-commit both files together" },
        { text: "Keep the amend and push to a differently named branch" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This work went straight onto the default branch, which is continuously deployed. What is the correct fix for next time?",
      explanation:
        "Unreviewed, unfinished work committed to the deployed branch is live immediately. Branching first, then opening a pull request, gives the change a review point and keeps the default branch releasable. Committing without pushing only delays it, a local-only branch is not reviewable, and disabling deployment removes the safety net rather than the mistake.",
      language: "bash",
      starterCode: `git switch main
git add .
git commit -m "Start rebuilding the pricing page"
git push`,
      options: [
        {
          text: "Create a feature branch first, push that, and open a pull request",
          correct: true,
        },
        { text: "Commit on main but do not push until the work is finished" },
        { text: "Create the feature branch but never push it, merging locally instead" },
        { text: "Turn off continuous deployment so pushes to main are not published" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "Three weeks later nobody can tell what this branch was for. What is the correct fix?",
      explanation:
        "A name derived from the date or the author identifies the branch to nobody. Naming it after the change makes it recognisable in a list of open branches. Adding a number, the author's name or the word \"new\" adds characters without adding meaning.",
      language: "bash",
      starterCode: `git switch -c amara-tuesday-2`,
      options: [
        { text: "Rename it to feature/pricing-table-responsive", correct: true },
        { text: "Rename it to amara-tuesday-3-final" },
        { text: "Rename it to feature/new-changes" },
        { text: "Rename it to amara/latest-work" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This resolution compiles and the markers are gone, but the reviewer says work has been lost. What is the correct fix?",
      explanation:
        "Both sides changed the same block for different reasons — one added the aria-label, the other changed the destination — and the resolution kept only one. The correct resolution combines both intents. Reinstating the markers, keeping the other side alone, or deleting the element all still lose one of the two changes.",
      language: "html",
      starterCode: `<!-- ours:   <a href="/pricing" aria-label="See pricing">Pricing</a> -->
<!-- theirs: <a href="/plans">Pricing</a> -->
<!-- committed resolution: -->
<a href="/plans">Pricing</a>`,
      options: [
        {
          text: "Combine both intents: <a href=\"/plans\" aria-label=\"See pricing\">Pricing</a>",
          correct: true,
        },
        { text: "Keep only our side: <a href=\"/pricing\" aria-label=\"See pricing\">Pricing</a>" },
        { text: "Restore the conflict markers and let the reviewer choose" },
        { text: "Remove the link and leave plain text: Pricing" },
      ],
    },

    // =======================================================================
    // code_fix 39-44 — subtle defect
    // =======================================================================
    {
      type: "code_fix",
      questionText:
        "This file was committed and deployed in this state. What is the correct fix?",
      explanation:
        "All three conflict markers are still in the file, so the visitor sees them and neither version was actually chosen. The fix is to edit the region to the intended content and remove every marker before committing. Deleting only the middle marker leaves both versions concatenated, commenting them out leaves the duplication, and CSS cannot hide a decision that was never made.",
      language: "html",
      starterCode: `<footer>
<<<<<<< HEAD
  <p>Copyright 2026 Field Guide</p>
=======
  <p>&copy; 2026 Field Guide. All rights reserved.</p>
>>>>>>> feature/footer-legal
</footer>`,
      options: [
        {
          text: "Choose the intended paragraph, delete all three markers and the unwanted version, then commit",
          correct: true,
        },
        { text: "Delete the ======= line and keep both paragraphs" },
        { text: "Wrap the markers in HTML comments so they do not render" },
        { text: "Add a CSS rule hiding any paragraph containing angle brackets" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "A teammate's branch has moved on and this branch will not push. What is the correct fix?",
      explanation:
        "The remote has commits this branch does not, so the push is rejected. Integrating them and merging through review is the fix. Force-pushing discards the teammate's commits, deleting the remote branch is the same loss by another route, and a duplicate branch abandons the review history.",
      language: "bash",
      starterCode: `git push
# ! [rejected] shared-feature -> shared-feature (fetch first)
git push --force`,
      options: [
        {
          text: "Fetch and integrate the remote commits, resolve any conflict, then push normally",
          correct: true,
        },
        { text: "Keep the force-push; the local branch is the newer one" },
        { text: "Delete the remote branch and push this one in its place" },
        { text: "Push to a new branch name and abandon the shared one" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "Every asset 404s once the site is deployed to example.test/portfolio/, though it works locally. What is the correct fix?",
      explanation:
        "Every reference has a leading slash, so it resolves from the origin root rather than from the project subdirectory. Making them page-relative works in both places. Hardcoding the subdirectory breaks local development and any move, a base tag with an absolute path repeats the mistake, and a redirect cannot invent files at the root.",
      language: "html",
      starterCode: `<link rel="stylesheet" href="/styles.css" />
<script src="/app.js" defer></script>
<img src="/images/hero.jpg" alt="Harbour at dawn" />`,
      options: [
        { text: "Drop the leading slashes so each reference resolves from the page's own directory", correct: true },
        { text: "Prefix each reference with /portfolio/" },
        { text: "Add <base href=\"/\" /> to the head" },
        { text: "Configure the host to redirect /portfolio/styles.css to /styles.css" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This workflow deploys the repository's sources rather than the built site. What is the correct fix?",
      explanation:
        "There is no build step, so the publish step uploads the source directory. Running the build and publishing its output directory is the fix. Committing the build output puts generated files under version control, renaming the source directory does not build anything, and caching does not produce output that was never created.",
      language: "yaml",
      starterCode: `steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: "20"
  - run: npm ci
  - name: Publish
    uses: actions/upload-pages-artifact@v3
    with:
      path: ./src`,
      options: [
        { text: "Add a run: npm run build step and publish the build output directory instead of ./src", correct: true },
        { text: "Commit the build output to the repository and keep publishing ./src" },
        { text: "Rename ./src to ./dist in the publish step and change nothing else" },
        { text: "Add a cache step for node_modules before the publish step" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This workflow file is tracked in the repository. What is the correct fix?",
      explanation:
        "The token is a literal in a tracked file, so it is a committed secret readable by anyone with the repository, and it must be rotated. Referencing a configured secret by name keeps the value out of the history. Base64 is an encoding, not protection; a second file is still tracked; and a comment protects nothing.",
      language: "yaml",
      starterCode: `env:
  DEPLOY_TOKEN: "dp_live_9f21c7ae4b6d40518c3e"
steps:
  - run: npx deploy-cli --token "$DEPLOY_TOKEN"`,
      options: [
        {
          text: "Replace the literal with a reference to a secret configured in the platform, and rotate the leaked token",
          correct: true,
        },
        { text: "Base64-encode the token so it is not readable at a glance" },
        { text: "Move the literal into a separate tokens.yml file in the repository" },
        { text: "Add a comment warning readers not to copy the token" },
      ],
    },
    {
      type: "code_fix",
      questionText:
        "This configuration redirects HTTP to HTTPS, but the first request of a session is still exposed. What is the correct fix?",
      explanation:
        "A redirect can only act after the plain-HTTP request has already been sent. An HSTS response header tells the browser to use HTTPS itself on later visits, closing that window. Changing the status code, adding a meta refresh, or serving both schemes all leave the first request in the clear.",
      language: "yaml",
      starterCode: `redirects:
  - from: "http://example.test/*"
    to: "https://example.test/:splat"
    status: 301
headers:
  - for: "/*"
    values:
      X-Content-Type-Options: nosniff`,
      options: [
        {
          text: "Add a Strict-Transport-Security response header with a max-age",
          correct: true,
        },
        { text: "Change the redirect status from 301 to 302" },
        { text: "Add a meta refresh to every page pointing at the HTTPS URL" },
        { text: "Serve the site on both HTTP and HTTPS and let the browser choose" },
      ],
    },

    // =======================================================================
    // code_write 45-47 — applied (JavaScript over git-DERIVED text)
    // =======================================================================
    {
      type: "code_write",
      questionText:
        "Standard input holds porcelain status output: each line is a two-character status field, a space, then a path. The first character is the staged status and the second is the working-tree status; a space means unchanged and ? means untracked. A rename line reads as 'old -> new' and should be reported by its NEW path. Print a one-line JSON object with keys staged and unstaged, in that order, each an array of paths in the order they appear. Untracked files belong to neither list.",
      explanation:
        "Reading porcelain output is how the three areas stop being a diagram and become something a student can point at: the first column IS the staging area and the second IS the working directory. The untracked case is what catches an implementation that treats any non-space character as a change.",
      language: "javascript",
      starterCode: `${STDIN}
const lines = stdin.replace(/\\r/g, "").split("\\n").filter((line) => line.length > 0);

// Each line: two status characters, a space, then the path.
// TODO: print JSON.stringify({ staged, unstaged }).
`,
      tests: [
        {
          name: "mixed statuses, untracked excluded from both lists",
          input: "M  a.txt\n M b.txt\nMM c.txt\n?? d.txt",
          expected: '{"staged":["a.txt","c.txt"],"unstaged":["b.txt","c.txt"]}',
        },
        {
          name: "a rename is reported by its new path",
          input: "R  old-name.txt -> new-name.txt",
          expected: '{"staged":["new-name.txt"],"unstaged":[]}',
        },
        {
          name: "a staged addition with a later edit appears in both lists",
          input: "AM notes.md",
          expected: '{"staged":["notes.md"],"unstaged":["notes.md"]}',
        },
        {
          name: "edge case: an empty tree yields two empty arrays",
          input: "",
          expected: '{"staged":[],"unstaged":[]}',
        },
        {
          name: "edge case: only untracked files yields two empty arrays",
          input: "?? draft.txt\n?? scratch/",
          expected: '{"staged":[],"unstaged":[]}',
        },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Standard input holds a complete commit message. Validate it against this convention and print exactly one result word. Checks, in this order: the message must not be empty (empty); the subject — the first line — must be at most 50 characters (too-long); the subject must not end with a full stop (trailing-period); the subject's first word must not end in ed or ing, since the subject is written in the imperative mood (not-imperative); and if there is a body, the second line must be blank (missing-blank-line). Print ok if every check passes.",
      explanation:
        "The convention the lecture stated, made checkable. The ed/ing test is a deliberately crude stand-in for mood — it is stated as the rule so the item is deterministic, and it catches the two forms students actually write. The ordering matters because a message can break several rules at once and the report must be stable.",
      language: "javascript",
      starterCode: `${STDIN}
const message = stdin.replace(/\\r/g, "");
const lines = message.split("\\n");

// TODO: print exactly one of:
// empty | too-long | trailing-period | not-imperative | missing-blank-line | ok
`,
      tests: [
        {
          name: "a compliant message with a body",
          input: "Fix nav overlap on narrow viewports\n\nThe absolute positioning fought the flex row below 480px.",
          expected: "ok",
        },
        {
          name: "a subject of exactly 50 characters is accepted",
          input: "Fix the header overlap that appears on small scr",
          expected: "ok",
        },
        {
          name: "an over-length subject is reported",
          input:
            "Fix the header overlap that appears on small screens and also tidy the footer spacing",
          expected: "too-long",
        },
        { name: "a past-tense subject is not imperative", input: "Added the contact form", expected: "not-imperative" },
        { name: "a gerund subject is not imperative", input: "Fixing the footer spacing", expected: "not-imperative" },
        {
          name: "a body with no blank line before it is reported",
          input: "Fix footer spacing\nThe margin collapsed against the last card.",
          expected: "missing-blank-line",
        },
        { name: "edge case: an empty message", input: "", expected: "empty" },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Standard input holds a file's text. Print the number of conflicted regions still in it — that is, the number of lines beginning with seven less-than characters. Lines inside a fenced code block, delimited by lines of three backticks, must NOT be counted: a tutorial that shows a conflict is not a conflict.",
      explanation:
        "Detecting leftover markers is the check that should have run before the commit in the code_fix item earlier in this exam. The code-fence exclusion is the whole difficulty: a naive scan flags every document that teaches conflict resolution, and a checker that cries wolf gets switched off.",
      language: "javascript",
      starterCode: `${STDIN}
const lines = stdin.replace(/\\r/g, "").split("\\n");

// A line of three backticks opens or closes a fenced block.
// TODO: print the number of conflicted regions outside fenced blocks.
`,
      tests: [
        {
          name: "one region with all three marker kinds",
          input: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature/x",
          expected: "1",
        },
        {
          name: "two separate conflicted regions",
          input:
            "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> f\nmiddle\n<<<<<<< HEAD\nc\n=======\nd\n>>>>>>> f",
          expected: "2",
        },
        {
          name: "markers inside a fenced block are not counted",
          input: "Example:\n```\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> f\n```\nEnd.",
          expected: "0",
        },
        {
          name: "a real conflict outside a fence is still counted alongside a fenced example",
          input: "```\n<<<<<<< HEAD\n```\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> f",
          expected: "1",
        },
        { name: "edge case: a clean file", input: "All resolved.\nNothing to see.", expected: "0" },
        { name: "edge case: an empty file", input: "", expected: "0" },
      ],
    },

    // =======================================================================
    // code_write 48-50 — synthesis
    // =======================================================================
    {
      type: "code_write",
      questionText:
        "The first input line is a current version as major.minor.patch. Every later line is a commit subject. Print the next version under these rules: if any subject contains BREAKING CHANGE or its type ends with an exclamation mark, bump major and zero minor and patch; otherwise if any subject starts with feat, bump minor and zero patch; otherwise if any subject starts with fix, bump patch; otherwise print the current version unchanged.",
      explanation:
        "A release decision derived from the history, which is the payoff for writing commit subjects to a convention in the first place. The empty-commit-list case must print the current version rather than a bump, because releasing an unchanged version number is the failure this rule exists to prevent.",
      language: "javascript",
      starterCode: `${STDIN}
const lines = stdin.replace(/\\r/g, "").split("\\n");
const current = lines[0].trim();
const commits = lines.slice(1).filter((line) => line.trim().length > 0);

// TODO: print the next version as major.minor.patch
`,
      tests: [
        {
          name: "fixes only bump the patch",
          input: "1.4.2\nfix: correct the footer year\nchore: update dependencies",
          expected: "1.4.3",
        },
        {
          name: "a feature bumps the minor and zeroes the patch",
          input: "1.4.2\nfix: correct the footer year\nfeat: add a contact form",
          expected: "1.5.0",
        },
        {
          name: "a breaking-change footer bumps the major and zeroes the rest",
          input: "1.4.2\nfeat: new theme API\n\nBREAKING CHANGE: theme tokens renamed",
          expected: "2.0.0",
        },
        {
          name: "an exclamation mark on the type is also breaking",
          input: "0.9.7\nrefactor!: drop the legacy exports",
          expected: "1.0.0",
        },
        {
          name: "edge case: no commits leaves the version unchanged",
          input: "1.4.2",
          expected: "1.4.2",
        },
        {
          name: "edge case: only non-bumping commits leave the version unchanged",
          input: "2.0.0\ndocs: expand the README\nstyle: reformat the stylesheet",
          expected: "2.0.0",
        },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Standard input holds HTML text. Rewrite every root-relative href and src value — one beginning with a single slash — into a page-relative one by removing that leading slash. Leave untouched any value that is an absolute URL with a scheme, a protocol-relative URL beginning with two slashes, or already relative. Print the rewritten text exactly, with no other changes.",
      explanation:
        "The deployment bug from lecture 3, written as the fix rather than described. The two values that must survive untouched are what make it more than a search and replace: two slashes means another host, and a scheme means another host as well, so stripping the slash there would break a working reference.",
      language: "javascript",
      starterCode: `${STDIN}
const html = stdin.replace(/\\r/g, "");

// TODO: print the rewritten HTML.
`,
      tests: [
        {
          name: "href and src are both rewritten",
          input: '<link href="/styles.css" /><script src="/app.js"></script>',
          expected: '<link href="styles.css" /><script src="app.js"></script>',
        },
        {
          name: "an absolute URL with a scheme is left untouched",
          input: '<a href="https://example.test/help">Help</a>',
          expected: '<a href="https://example.test/help">Help</a>',
        },
        {
          name: "a protocol-relative URL is left untouched",
          input: '<script src="//cdn.example.test/lib.js"></script>',
          expected: '<script src="//cdn.example.test/lib.js"></script>',
        },
        {
          name: "a nested root-relative path keeps its inner slashes",
          input: '<img src="/images/hero.jpg" alt="Harbour" />',
          expected: '<img src="images/hero.jpg" alt="Harbour" />',
        },
        {
          name: "edge case: an already-relative path is unchanged",
          input: '<link href="styles.css" /><img src="./hero.jpg" alt="" />',
          expected: '<link href="styles.css" /><img src="./hero.jpg" alt="" />',
        },
        { name: "edge case: empty input prints nothing", input: "", expected: "" },
      ],
    },
    {
      type: "code_write",
      questionText:
        "Standard input holds diff text. Count the ADDED lines — those beginning with a single plus, not the +++ file header — that look like a committed secret. A line counts if it contains a database connection string with a scheme of postgres:// or mysql://, or a quoted literal of 20 or more characters made only of letters, digits, underscores and hyphens. A line does NOT count if it also contains any of REPLACE_ME, YOUR_, EXAMPLE or xxxx, in any case. Print the count.",
      explanation:
        "The last item on the pre-launch checklist, made mechanical. The placeholder exclusion is the point: a scanner that flags the sample value in a template is one nobody will keep running, and the whole value of a secret scan is that it is still switched on the day it matters.",
      language: "javascript",
      starterCode: `${STDIN}
const lines = stdin.replace(/\\r/g, "").split("\\n");

// Only added lines count, and +++ is a file header, not an addition.
// TODO: print how many added lines look like a committed secret.
`,
      tests: [
        {
          name: "a connection string in an added line is flagged",
          input:
            '--- a/.env\n+++ b/.env\n+DATABASE_URL=postgres://admin:s3cret@db.example.test:5432/app',
          expected: "1",
        },
        {
          name: "a long token-shaped quoted literal is flagged",
          input: '+++ b/config.js\n+const token = "dp_live_9f21c7ae4b6d40518c3e";',
          expected: "1",
        },
        {
          name: "removed lines and file headers are not counted",
          input:
            '--- a/config.js\n+++ b/config.js\n-const token = "dp_live_9f21c7ae4b6d40518c3e";\n+const token = readEnv("TOKEN");',
          expected: "0",
        },
        {
          name: "two offending added lines are both counted",
          input:
            '+DATABASE_URL=mysql://root:hunter2@127.0.0.1:3306/shop\n+const key = "sk_live_4a7b2c9d1e8f3g6h5j0k";',
          expected: "2",
        },
        {
          name: "edge case: a placeholder must not be flagged",
          input: '+const token = "REPLACE_ME_WITH_YOUR_TOKEN_VALUE";\n+DATABASE_URL=postgres://user:xxxx@localhost:5432/example',
          expected: "0",
        },
        { name: "edge case: a clean diff", input: "--- a/README.md\n+++ b/README.md\n+Run npm ci first.", expected: "0" },
      ],
    },
  ],
};
