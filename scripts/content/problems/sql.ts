// =============================================================================
// SQL TRACK — seed data. Owner: coding-problems stream.
// ORIGINAL PROSE ONLY. See index.ts for the rule and the reasoning.
// -----------------------------------------------------------------------------
// A SQL test's `input` is the SETUP SCRIPT, not stdin — SQLite has no stdin. The
// in-browser runner (sql.js) executes it before the student's query and discards
// its output; the server path prepends it to the query. Both conventions are
// implemented in one place, `buildRunRequest` in src/lib/problems/service.ts.
//
// `expectedOutput` is written in the CANONICAL `cell|cell` form. sql.js renders a
// padded ASCII table and Piston's sqlite3 renders bare pipe-separated rows;
// `canonicaliseSqlOutput` reduces both to this form, which is why the same expected
// value grades correctly whichever backend ran the query. See
// src/lib/problems/grading.ts.
//
// AVERAGES ARE FORMATTED WITH printf, DELIBERATELY. `round(avg(x), 2)` returns a
// REAL, and the two runtimes disagree on how a whole-valued REAL prints (`85` vs
// `85.0`). `printf('%.2f', ...)` returns TEXT and is identical on both.
//
// Fixtures are deliberately tiny — three to six rows — so a student can verify the
// expected answer by reading them, which is what makes a visible test a worked
// example rather than a black box.
// =============================================================================

import type { SeedProblem } from "../../../src/lib/problems/validate";

const base = {
  track: "sql",
  language: "sql",
  execution: "browser",
  timeLimitMs: 6000,
} as const satisfies Partial<SeedProblem>;

/** Reused fixture: students and their enrolments, with scores. */
const SCHOOL = `create table students (id integer primary key, name text);
create table enrolments (student_id integer, course text, score integer);
insert into students values (1, 'Ada'), (2, 'Grace'), (3, 'Alan');
insert into enrolments values
  (1, 'CSS', 91), (1, 'HTML', 72),
  (2, 'CSS', 88), (2, 'HTML', 95),
  (3, 'HTML', 64);`;

export const sqlProblems: SeedProblem[] = [
  // =========================================================================
  // BEGINNER
  // =========================================================================
  {
    ...base,
    slug: "sql-passing-scores",
    title: "List the passing scores",
    level: "beginner",
    isInterview: false,
    statement: [
      "A table `enrolments` holds `student_id`, `course` and `score`.",
      "",
      "Select `course` and `score` for every row scoring 70 or more. Order by `score`",
      "highest first, then by `course` alphabetically.",
      "",
      "Return only those two columns, in that order.",
    ].join("\n"),
    hints: [
      "`WHERE` filters rows before anything else happens, so put the score condition there.",
      "`ORDER BY score DESC, course ASC` reads left to right: the second key only breaks ties in the first.",
    ],
    tags: ["select", "where", "order-by"],
    starterCode: "select course, score\nfrom enrolments\n-- TODO: filter and order\n;",
    referenceSolution: "select course, score\nfrom enrolments\nwhere score >= 70\norder by score desc, course asc;",
    tests: [
      {
        name: "the shared fixture",
        input: SCHOOL,
        expectedOutput: "HTML|95\nCSS|91\nCSS|88\nHTML|72",
        hidden: false,
      },
      {
        name: "a row exactly on the boundary is included",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', 70), (2, 'CSS', 69);`,
        expectedOutput: "CSS|70",
        hidden: false,
      },
      {
        name: "nothing passes",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', 10);`,
        expectedOutput: "",
        hidden: true,
      },
      {
        name: "a tie on score is broken by course",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'HTML', 80), (2, 'CSS', 80);`,
        expectedOutput: "CSS|80\nHTML|80",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "sql-count-enrolments",
    title: "Count the enrolments",
    level: "beginner",
    isInterview: false,
    statement: [
      "A table `enrolments` holds `student_id`, `course` and `score`.",
      "",
      "Return a single row with a single column holding the number of rows in the table.",
    ].join("\n"),
    hints: [
      "`count(*)` counts rows. `count(column)` counts rows where that column is not null — a different question.",
      "An aggregate with no `GROUP BY` collapses the whole table to one row.",
    ],
    tags: ["aggregate", "count"],
    starterCode: "select /* TODO */ from enrolments;",
    referenceSolution: "select count(*) as total from enrolments;",
    tests: [
      { name: "the shared fixture", input: SCHOOL, expectedOutput: "5", hidden: false },
      {
        name: "an empty table counts zero",
        input: "create table enrolments (student_id integer, course text, score integer);",
        expectedOutput: "0",
        hidden: false,
      },
      {
        name: "one row",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', 50);`,
        expectedOutput: "1",
        hidden: true,
      },
      {
        name: "a null score still counts as a row",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', null), (2, 'CSS', 60);`,
        expectedOutput: "2",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "sql-distinct-courses",
    title: "Which courses have anyone on them",
    level: "beginner",
    isInterview: false,
    statement: [
      "A table `enrolments` holds `student_id`, `course` and `score`.",
      "",
      "Return each distinct `course` exactly once, ordered alphabetically. One column.",
    ].join("\n"),
    hints: [
      "`DISTINCT` applies to the whole select list, not to one column — selecting two columns would give distinct PAIRS.",
      "`GROUP BY course` would produce the same rows here; `DISTINCT` says the intent more directly.",
    ],
    tags: ["select", "distinct"],
    starterCode: "select course\nfrom enrolments\n-- TODO: remove duplicates and order\n;",
    referenceSolution: "select distinct course\nfrom enrolments\norder by course;",
    tests: [
      { name: "the shared fixture", input: SCHOOL, expectedOutput: "CSS\nHTML", hidden: false },
      {
        name: "every row is the same course",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'JS', 10), (2, 'JS', 20);`,
        expectedOutput: "JS",
        hidden: false,
      },
      {
        name: "three courses, out of order in the table",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'SQL', 1), (2, 'CSS', 1), (3, 'HTML', 1);`,
        expectedOutput: "CSS\nHTML\nSQL",
        hidden: true,
      },
      {
        name: "an empty table returns nothing",
        input: "create table enrolments (student_id integer, course text, score integer);",
        expectedOutput: "",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "sql-second-highest-score",
    title: "Second highest distinct score",
    level: "beginner",
    isInterview: true,
    statement: [
      "A table `enrolments` holds `student_id`, `course` and `score`.",
      "",
      "Return one row with one column: the second highest DISTINCT score, or `-1` when",
      "there is no second distinct score.",
      "",
      "Returning `-1` rather than a null is deliberate — every SQLite build renders a",
      "null differently, and a caller that has to guess is a caller that will guess",
      "wrong.",
    ].join("\n"),
    hints: [
      "`LIMIT 1 OFFSET 1` on a descending list of distinct scores gets you the second one.",
      "A bare `LIMIT` returns NO ROW when there is nothing to return. Wrap it in `select (…)` to get one row holding a null, then turn that null into -1 with `ifnull`.",
    ],
    tags: ["subquery", "limit", "nulls"],
    starterCode: "-- TODO: return the second highest distinct score, or -1\nselect -1 as second;",
    referenceSolution:
      "select ifnull((\n  select distinct score\n  from enrolments\n  order by score desc\n  limit 1 offset 1\n), -1) as second;",
    tests: [
      { name: "the shared fixture", input: SCHOOL, expectedOutput: "91", hidden: false },
      {
        name: "every score is the same, so there is no second",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', 50), (2, 'CSS', 50);`,
        expectedOutput: "-1",
        hidden: false,
      },
      {
        name: "duplicates of the top score are ignored",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', 90), (2, 'CSS', 90), (3, 'CSS', 70);`,
        expectedOutput: "70",
        hidden: true,
      },
      {
        name: "an empty table returns -1, not an empty result",
        input: "create table enrolments (student_id integer, course text, score integer);",
        expectedOutput: "-1",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "sql-missing-city",
    title: "Rows with a missing value",
    level: "beginner",
    isInterview: true,
    statement: [
      "A table `members` holds `name` and `city`, and `city` may be null.",
      "",
      "Return the `name` of every member whose city is missing, ordered alphabetically.",
      "One column.",
    ].join("\n"),
    hints: [
      "`city = null` is never true — comparing anything with null yields null, not false. Use `IS NULL`.",
      "An empty string is not a null: a member whose city is `''` has a city, it is just blank.",
    ],
    tags: ["nulls", "where"],
    starterCode: "select name\nfrom members\n-- TODO: keep only the members with no city\norder by name;",
    referenceSolution: "select name\nfrom members\nwhere city is null\norder by name;",
    tests: [
      {
        name: "two of four are missing",
        input: `create table members (name text, city text);
insert into members values ('Ada', null), ('Grace', 'Baltimore'), ('Alan', null), ('Katherine', 'Hampton');`,
        expectedOutput: "Ada\nAlan",
        hidden: false,
      },
      {
        name: "an empty string is not a null",
        input: `create table members (name text, city text);
insert into members values ('Ada', ''), ('Grace', null);`,
        expectedOutput: "Grace",
        hidden: false,
      },
      {
        name: "nothing is missing",
        input: `create table members (name text, city text);
insert into members values ('Ada', 'London');`,
        expectedOutput: "",
        hidden: true,
      },
      {
        name: "everything is missing",
        input: `create table members (name text, city text);
insert into members values ('Zoe', null), ('Ada', null);`,
        expectedOutput: "Ada\nZoe",
        hidden: true,
      },
    ],
  },

  // =========================================================================
  // INTERMEDIATE
  // =========================================================================
  {
    ...base,
    slug: "sql-average-per-course",
    title: "Average score per course",
    level: "intermediate",
    isInterview: false,
    statement: [
      "A table `enrolments` holds `student_id`, `course` and `score`.",
      "",
      "Return `course` and its average score, keeping only courses with at least two",
      "enrolments. Order by `course`.",
      "",
      "Format the average with `printf('%.2f', …)` so it always shows two decimal",
      "places.",
    ].join("\n"),
    hints: [
      "`WHERE` filters rows and runs before grouping; `HAVING` filters GROUPS and runs after. The two-enrolment rule is a group condition.",
      "`printf('%.2f', avg(score))` returns text, which prints identically on every SQLite build — `round()` returns a number whose formatting varies.",
    ],
    tags: ["group-by", "having", "aggregate"],
    starterCode: "select course, printf('%.2f', avg(score)) as average\nfrom enrolments\n-- TODO: group, filter the groups, order\n;",
    referenceSolution:
      "select course, printf('%.2f', avg(score)) as average\nfrom enrolments\ngroup by course\nhaving count(*) >= 2\norder by course;",
    tests: [
      { name: "the shared fixture", input: SCHOOL, expectedOutput: "CSS|89.50\nHTML|77.00", hidden: false },
      {
        name: "a course with one enrolment is dropped",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', 80), (2, 'CSS', 90), (3, 'SQL', 100);`,
        expectedOutput: "CSS|85.00",
        hidden: false,
      },
      {
        name: "no course qualifies",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', 80), (2, 'SQL', 90);`,
        expectedOutput: "",
        hidden: true,
      },
      {
        name: "an average that needs rounding",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'JS', 70), (2, 'JS', 71), (3, 'JS', 73);`,
        expectedOutput: "JS|71.33",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "sql-join-names-to-courses",
    title: "Put the names back on the enrolments",
    level: "intermediate",
    isInterview: false,
    statement: [
      "`students` holds `id` and `name`. `enrolments` holds `student_id`, `course` and",
      "`score`.",
      "",
      "Return each student's `name` with the `course` they are on, ordered by name then",
      "course. Two columns.",
    ].join("\n"),
    hints: [
      "The join condition belongs in `ON`: it says which rows correspond, not which rows you want.",
      "An inner join drops students with no enrolments. That is correct here — the next problem is about finding them.",
    ],
    tags: ["join", "order-by"],
    starterCode: "select s.name, e.course\nfrom students s\n-- TODO: join enrolments and order\n;",
    referenceSolution:
      "select s.name, e.course\nfrom students s\njoin enrolments e on e.student_id = s.id\norder by s.name, e.course;",
    tests: [
      {
        name: "the shared fixture",
        input: SCHOOL,
        expectedOutput: "Ada|CSS\nAda|HTML\nAlan|HTML\nGrace|CSS\nGrace|HTML",
        hidden: false,
      },
      {
        name: "one student, one course",
        input: `create table students (id integer primary key, name text);
create table enrolments (student_id integer, course text, score integer);
insert into students values (1, 'Ada');
insert into enrolments values (1, 'SQL', 100);`,
        expectedOutput: "Ada|SQL",
        hidden: false,
      },
      {
        name: "a student with no enrolments does not appear",
        input: `create table students (id integer primary key, name text);
create table enrolments (student_id integer, course text, score integer);
insert into students values (1, 'Ada'), (2, 'Grace');
insert into enrolments values (1, 'SQL', 100);`,
        expectedOutput: "Ada|SQL",
        hidden: true,
      },
      {
        name: "an enrolment pointing at nobody does not appear either",
        input: `create table students (id integer primary key, name text);
create table enrolments (student_id integer, course text, score integer);
insert into students values (1, 'Ada');
insert into enrolments values (99, 'SQL', 100);`,
        expectedOutput: "",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "sql-students-with-no-enrolments",
    title: "Students who have signed up for nothing",
    level: "intermediate",
    isInterview: false,
    statement: [
      "`students` holds `id` and `name`. `enrolments` holds `student_id`, `course` and",
      "`score`.",
      "",
      "Return the `name` of every student with no enrolment at all, ordered",
      "alphabetically. One column.",
    ].join("\n"),
    hints: [
      "A left join keeps every student and fills the enrolment columns with nulls where there is no match. Those nulls are what you filter on.",
      "The filter must be in `WHERE` and must test a column from the RIGHT table — putting it in `ON` would change which rows match rather than which rows survive.",
    ],
    tags: ["left-join", "nulls"],
    starterCode: "select s.name\nfrom students s\n-- TODO: keep the students with no matching enrolment\norder by s.name;",
    referenceSolution:
      "select s.name\nfrom students s\nleft join enrolments e on e.student_id = s.id\nwhere e.student_id is null\norder by s.name;",
    tests: [
      { name: "the shared fixture has none", input: SCHOOL, expectedOutput: "", hidden: true },
      {
        name: "one student is unenrolled",
        input: `create table students (id integer primary key, name text);
create table enrolments (student_id integer, course text, score integer);
insert into students values (1, 'Ada'), (2, 'Grace');
insert into enrolments values (1, 'SQL', 100);`,
        expectedOutput: "Grace",
        hidden: false,
      },
      {
        name: "nobody is enrolled",
        input: `create table students (id integer primary key, name text);
create table enrolments (student_id integer, course text, score integer);
insert into students values (2, 'Zoe'), (1, 'Ada');`,
        expectedOutput: "Ada\nZoe",
        hidden: false,
      },
      {
        name: "a student with several enrolments is not listed",
        input: `create table students (id integer primary key, name text);
create table enrolments (student_id integer, course text, score integer);
insert into students values (1, 'Ada');
insert into enrolments values (1, 'SQL', 1), (1, 'CSS', 2);`,
        expectedOutput: "",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "sql-above-course-average",
    title: "Scores above their own course average",
    level: "intermediate",
    isInterview: true,
    statement: [
      "A table `enrolments` holds `student_id`, `course` and `score`.",
      "",
      "Return `course` and `score` for every row scoring strictly above the average for",
      "ITS OWN course. Order by `course`, then `score` descending.",
    ].join("\n"),
    hints: [
      "The average you are comparing against depends on the row you are looking at, which is what makes the subquery correlated.",
      "Inside the subquery, alias the outer table so `e.course` and the inner `course` are distinguishable.",
    ],
    tags: ["correlated-subquery", "aggregate"],
    starterCode: "select course, score\nfrom enrolments e\n-- TODO: keep rows above their own course average\n;",
    referenceSolution: [
      "select course, score",
      "from enrolments e",
      "where score > (",
      "  select avg(score) from enrolments peers where peers.course = e.course",
      ")",
      "order by course, score desc;",
    ].join("\n"),
    tests: [
      { name: "the shared fixture", input: SCHOOL, expectedOutput: "CSS|91\nHTML|95", hidden: false },
      {
        name: "every score equals the average, so nothing is above it",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', 80), (2, 'CSS', 80);`,
        expectedOutput: "",
        hidden: true,
      },
      {
        name: "each course is judged separately",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', 10), (2, 'CSS', 20), (3, 'SQL', 90), (4, 'SQL', 100);`,
        expectedOutput: "CSS|20\nSQL|100",
        hidden: false,
      },
      {
        name: "a course with one row can never be above its own average",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'JS', 99);`,
        expectedOutput: "",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "sql-not-enrolled-in-course",
    title: "Who is not on the CSS course",
    level: "intermediate",
    isInterview: true,
    statement: [
      "`students` holds `id` and `name`. `enrolments` holds `student_id`, `course` and",
      "`score`.",
      "",
      "Return the `name` of every student with no enrolment on the course `CSS`, ordered",
      "alphabetically. One column.",
      "",
      "Write it with `NOT EXISTS`. A `NOT IN` against a column that can hold nulls",
      "returns no rows at all, which is the trap this problem is about.",
    ].join("\n"),
    hints: [
      "`NOT EXISTS` asks whether the inner query finds anything, and is unaffected by nulls inside it.",
      "The inner query needs both conditions: the same student, and the course you are excluding.",
    ],
    tags: ["not-exists", "subquery", "nulls"],
    starterCode: "select name\nfrom students s\n-- TODO: exclude students who have a CSS enrolment\norder by name;",
    referenceSolution: [
      "select name",
      "from students s",
      "where not exists (",
      "  select 1 from enrolments e where e.student_id = s.id and e.course = 'CSS'",
      ")",
      "order by name;",
    ].join("\n"),
    tests: [
      { name: "the shared fixture", input: SCHOOL, expectedOutput: "Alan", hidden: false },
      {
        name: "everyone is on CSS",
        input: `create table students (id integer primary key, name text);
create table enrolments (student_id integer, course text, score integer);
insert into students values (1, 'Ada');
insert into enrolments values (1, 'CSS', 80);`,
        expectedOutput: "",
        hidden: true,
      },
      {
        name: "a null student_id in the enrolments does not hide everyone",
        input: `create table students (id integer primary key, name text);
create table enrolments (student_id integer, course text, score integer);
insert into students values (1, 'Ada'), (2, 'Grace');
insert into enrolments values (null, 'CSS', 50), (1, 'CSS', 60);`,
        expectedOutput: "Grace",
        hidden: false,
      },
      {
        name: "an enrolment on another course does not count",
        input: `create table students (id integer primary key, name text);
create table enrolments (student_id integer, course text, score integer);
insert into students values (1, 'Ada');
insert into enrolments values (1, 'HTML', 60);`,
        expectedOutput: "Ada",
        hidden: true,
      },
    ],
  },

  // =========================================================================
  // ADVANCED
  // =========================================================================
  {
    ...base,
    slug: "sql-rank-within-course",
    title: "Rank each student within their course",
    level: "advanced",
    isInterview: false,
    statement: [
      "A table `enrolments` holds `student_id`, `course` and `score`.",
      "",
      "Return `course`, `student_id` and the student's rank within that course by score,",
      "highest first. Equal scores share a rank. Order by `course`, then rank, then",
      "`student_id`.",
    ].join("\n"),
    hints: [
      "`rank() over (partition by course order by score desc)` restarts the numbering for each course.",
      "`rank` leaves a gap after a tie and `dense_rank` does not. This problem wants shared ranks; either is acceptable until a gap appears, so pick deliberately.",
    ],
    tags: ["window-function", "rank"],
    starterCode: "select course, student_id, /* TODO: the rank */ 1 as position\nfrom enrolments\norder by course, position, student_id;",
    referenceSolution: [
      "select course,",
      "       student_id,",
      "       rank() over (partition by course order by score desc) as position",
      "from enrolments",
      "order by course, position, student_id;",
    ].join("\n"),
    tests: [
      {
        name: "the shared fixture",
        input: SCHOOL,
        expectedOutput: "CSS|1|1\nCSS|2|2\nHTML|2|1\nHTML|1|2\nHTML|3|3",
        hidden: false,
      },
      {
        name: "a tie shares a rank",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', 90), (2, 'CSS', 90), (3, 'CSS', 80);`,
        expectedOutput: "CSS|1|1\nCSS|2|1\nCSS|3|3",
        hidden: false,
      },
      {
        name: "one row per course",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', 50), (2, 'SQL', 10);`,
        expectedOutput: "CSS|1|1\nSQL|2|1",
        hidden: true,
      },
      {
        name: "an empty table returns nothing",
        input: "create table enrolments (student_id integer, course text, score integer);",
        expectedOutput: "",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "sql-running-total",
    title: "Running total of points",
    level: "advanced",
    isInterview: false,
    statement: [
      "A table `awards` holds `week` and `points`, one row per week, weeks ascending",
      "from 1 with no gaps.",
      "",
      "Return `week`, `points` and the total awarded up to and including that week,",
      "ordered by `week`.",
    ].join("\n"),
    hints: [
      "`sum(points) over (order by week)` accumulates: an `ORDER BY` inside `OVER` implies a frame running from the start to the current row.",
      "Without the `ORDER BY` inside `OVER`, the frame is the whole partition and every row gets the grand total.",
    ],
    tags: ["window-function", "running-total"],
    starterCode: "select week, points, /* TODO: the running total */ points as total\nfrom awards\norder by week;",
    referenceSolution: [
      "select week,",
      "       points,",
      "       sum(points) over (order by week) as total",
      "from awards",
      "order by week;",
    ].join("\n"),
    tests: [
      {
        name: "four weeks",
        input: `create table awards (week integer, points integer);
insert into awards values (1, 10), (2, 5), (3, 0), (4, 20);`,
        expectedOutput: "1|10|10\n2|5|15\n3|0|15\n4|20|35",
        hidden: false,
      },
      {
        name: "one week",
        input: `create table awards (week integer, points integer);
insert into awards values (1, 7);`,
        expectedOutput: "1|7|7",
        hidden: false,
      },
      {
        name: "a penalty reduces the running total",
        input: `create table awards (week integer, points integer);
insert into awards values (1, 10), (2, -4);`,
        expectedOutput: "1|10|10\n2|-4|6",
        hidden: true,
      },
      {
        name: "rows inserted out of order still accumulate by week",
        input: `create table awards (week integer, points integer);
insert into awards values (2, 5), (1, 10);`,
        expectedOutput: "1|10|10\n2|5|15",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "sql-latest-row-per-key",
    title: "Keep only the latest reading per sensor",
    level: "advanced",
    isInterview: false,
    statement: [
      "A table `readings` holds `sensor`, `taken_at` (text, sortable) and `value`.",
      "",
      "Return `sensor` and `value` for each sensor's most recent reading, ordered by",
      "`sensor`. When a sensor has two readings at the same `taken_at`, keep the larger",
      "`value`.",
    ].join("\n"),
    hints: [
      "Number the rows within each sensor with `row_number() over (partition by sensor order by taken_at desc, value desc)`, then keep number 1.",
      "A window function cannot go in `WHERE` — it is computed after filtering. Wrap the numbered query in a subquery and filter outside it.",
    ],
    tags: ["window-function", "row-number", "deduplication"],
    starterCode: "-- TODO: number the rows per sensor, then keep the first of each\nselect sensor, value from readings order by sensor;",
    referenceSolution: [
      "select sensor, value",
      "from (",
      "  select sensor,",
      "         value,",
      "         row_number() over (partition by sensor order by taken_at desc, value desc) as n",
      "  from readings",
      ")",
      "where n = 1",
      "order by sensor;",
    ].join("\n"),
    tests: [
      {
        name: "two sensors, two readings each",
        input: `create table readings (sensor text, taken_at text, value integer);
insert into readings values
  ('a', '2026-01-01', 1), ('a', '2026-01-02', 2),
  ('b', '2026-01-01', 9), ('b', '2026-01-03', 4);`,
        expectedOutput: "a|2\nb|4",
        hidden: false,
      },
      {
        name: "a tie on time keeps the larger value",
        input: `create table readings (sensor text, taken_at text, value integer);
insert into readings values ('a', '2026-01-01', 3), ('a', '2026-01-01', 8);`,
        expectedOutput: "a|8",
        hidden: false,
      },
      {
        name: "a sensor with one reading",
        input: `create table readings (sensor text, taken_at text, value integer);
insert into readings values ('z', '2026-05-05', 42);`,
        expectedOutput: "z|42",
        hidden: true,
      },
      {
        name: "sensors come back in name order, not insertion order",
        input: `create table readings (sensor text, taken_at text, value integer);
insert into readings values ('m', '2026-01-01', 1), ('c', '2026-01-01', 2);`,
        expectedOutput: "c|2\nm|1",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "sql-find-week-gaps",
    title: "Find the missing weeks",
    level: "advanced",
    isInterview: true,
    statement: [
      "A table `attendance` holds `week`, ascending, with no duplicates but possibly",
      "with gaps.",
      "",
      "Return one row per gap: the week before the gap and the week after it, as",
      "`from_week` and `to_week`, ordered by `from_week`. A gap exists whenever two",
      "recorded weeks are not consecutive.",
    ].join("\n"),
    hints: [
      "`lag(week) over (order by week)` gives you the previous row's week alongside the current one.",
      "A window function cannot be used in `WHERE`, so compute it in a subquery and compare `week - previous > 1` outside.",
    ],
    tags: ["window-function", "lag", "gaps"],
    starterCode: "-- TODO: pair each week with the previous one, then keep the non-consecutive pairs\nselect week as from_week, week as to_week from attendance;",
    referenceSolution: [
      "select previous as from_week, week as to_week",
      "from (",
      "  select week, lag(week) over (order by week) as previous",
      "  from attendance",
      ")",
      "where previous is not null and week - previous > 1",
      "order by from_week;",
    ].join("\n"),
    tests: [
      {
        name: "one gap in the middle",
        input: `create table attendance (week integer);
insert into attendance values (1), (2), (5), (6);`,
        expectedOutput: "2|5",
        hidden: false,
      },
      {
        name: "no gaps",
        input: `create table attendance (week integer);
insert into attendance values (1), (2), (3);`,
        expectedOutput: "",
        hidden: true,
      },
      {
        name: "two gaps",
        input: `create table attendance (week integer);
insert into attendance values (1), (3), (7);`,
        expectedOutput: "1|3\n3|7",
        hidden: false,
      },
      {
        name: "a single week cannot have a gap",
        input: `create table attendance (week integer);
insert into attendance values (4);`,
        expectedOutput: "",
        hidden: true,
      },
    ],
  },
  {
    ...base,
    slug: "sql-top-two-per-course",
    title: "Top two scores in each course",
    level: "advanced",
    isInterview: true,
    statement: [
      "A table `enrolments` holds `student_id`, `course` and `score`.",
      "",
      "Return `course`, `student_id` and `score` for the two highest scores in each",
      "course. Ties share a position, so a course can return more than two rows when",
      "its second place is tied. Order by `course`, `score` descending, `student_id`.",
    ].join("\n"),
    hints: [
      "`dense_rank()` is the right function here: it assigns the same number to a tie and does NOT skip the next number, so `<= 2` means 'first or second place'.",
      "`rank()` would skip: three students tied at the top would push the next score to position 4 and it would vanish from the result.",
    ],
    tags: ["window-function", "dense-rank", "top-n-per-group"],
    starterCode: "-- TODO: rank within each course, then keep the top two positions\nselect course, student_id, score from enrolments;",
    referenceSolution: [
      "select course, student_id, score",
      "from (",
      "  select course,",
      "         student_id,",
      "         score,",
      "         dense_rank() over (partition by course order by score desc) as position",
      "  from enrolments",
      ")",
      "where position <= 2",
      "order by course, score desc, student_id;",
    ].join("\n"),
    tests: [
      {
        name: "the shared fixture",
        input: SCHOOL,
        expectedOutput: "CSS|1|91\nCSS|2|88\nHTML|2|95\nHTML|1|72",
        hidden: false,
      },
      {
        name: "a tie for second returns three rows",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'CSS', 90), (2, 'CSS', 80), (3, 'CSS', 80), (4, 'CSS', 70);`,
        expectedOutput: "CSS|1|90\nCSS|2|80\nCSS|3|80",
        hidden: false,
      },
      {
        name: "a course with one student",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'SQL', 60);`,
        expectedOutput: "SQL|1|60",
        hidden: true,
      },
      {
        name: "everyone tied at the top still leaves room for second place",
        input: `create table enrolments (student_id integer, course text, score integer);
insert into enrolments values (1, 'JS', 50), (2, 'JS', 50), (3, 'JS', 40);`,
        expectedOutput: "JS|1|50\nJS|2|50\nJS|3|40",
        hidden: true,
      },
    ],
  },
];
