# Curriculum plan — eight new tracks, grand-quiz blueprints, coding-problem catalogue

Research output for the `curriculum-content` and `coding-problems` add-on streams.
Written 2026-07-30 by the `research-curriculum` agent. **This file is a plan, not
seed data.** No application code was written and nothing under `src/`,
`scripts/`, `CHANGELOG.log` or the existing docs was touched.

## Non-negotiables this plan obeys

1. **The owner's existing syllabus is frozen.** The 4 weeks, 12 lectures, 4
   practice quizzes and 40 MCQs in `scripts/seed-content.ts` are untouched. Every
   item below is additive. Section A's blueprints attach *new* 50-question exams
   to the four *existing* weeks; they do not modify those weeks' lectures or
   practice quizzes.
2. **Original prose only.** Every summary, step description, question intent and
   problem statement below is written from scratch. No sentence, problem
   statement or exercise body was copied from LeetCode, HackerRank, W3Schools or
   any other site. Third-party sites were read only to learn *which* topics
   matter, their conventional ordering, and their difficulty calibration. There
   are no quotations in this file, so there is nothing to attribute beyond the
   `## Sources` list.
3. **W3Schools is a link target, not a content source.** It sends
   `X-Frame-Options` and cannot be iframed (recorded in `docs/DECISIONS.md`), so
   every W3Schools URL below is an outbound deep link only. Where W3Schools has
   no page, or its page is stale, the reference is MDN or the vendor's own docs.
4. **Cybersecurity is defensive and sandboxed only**; **cryptography is browser
   `SubtleCrypto` only**. See the two constraint notes at the head of those
   tracks, and the exclusion list in `## Deliberate exclusions`.
5. **Labs run in the browser.** Every `lab` step below is satisfiable with the
   browser runners the `code-execution` stream owns — Web Worker for JavaScript,
   Pyodide for Python, `sql.js` for SQL, and a sandboxed iframe / Sandpack for
   HTML and CSS. No lab needs a server, and no lab needs Piston. C++ appears
   only in the coding-problem catalogue (Section B), never as a concept lab,
   precisely because it cannot run in the browser.

## Conventions used below

- **Slugs are globally unique** by construction: every module slug carries its
  track prefix (`oop-`, `dbms-`, `dsa-`, `pe-`, `cu-`, `llm-`, `crypto-`,
  `sec-`), and every problem slug carries its language prefix (`js-`, `py-`,
  `html-`, `css-`, `cpp-`, `sql-`, `ai-`).
- **Step kinds** are exactly the three the `interactive-learning` stream
  defines: `explain` (prose lesson), `lab` (try-it editor), `check` (inline
  question). Labs name their language and say in one line what the student
  builds.
- **Minutes** are an estimate of median completion time for a beginner-to-
  intermediate learner, including the labs.
- **Search terms** are for the `video-ingestion` harvester. This file collects
  *no* video IDs — inventing them produces embeds that 404, which
  `docs/ADDON_STREAMS.md` forbids.
- Six modules per level, three levels per track: **144 modules total**.

---

# Track 1 — Object-Oriented Programming (`oop`)

**Track summary.** Object-oriented programming is a way of splitting a program
into units that each own a piece of state and the operations allowed on it, so
that changing one unit does not require understanding all the others. This track
starts from the concrete question "what goes in one object and what goes in
another", builds up through interfaces and the SOLID principles, and finishes
with the classic design patterns as named solutions to problems the student has
already felt. Labs are JavaScript and Python, because both run in the browser and
between them cover prototype-based and class-based flavours of the same ideas.

## Beginner

#### `oop-objects-and-state` — Objects and State (30 min)
An object bundles data with the operations that read and change that data, so a
program becomes a set of collaborating parts instead of one long script.
1. `explain` State, behaviour, identity; why grouping them beats parallel arrays.
2. `lab` javascript — build an `account` object literal with a balance and deposit/withdraw functions, and watch shared mutable state change.
3. `explain` Identity versus equality: two objects with equal fields are still two objects.
4. `check` Two objects with identical fields — does `===` report them equal?
5. `lab` javascript — turn the literal into a factory function so each call returns an independent account.
6. `explain` When an object is the wrong tool: a pure calculation, or a single value.
- Refs: https://www.w3schools.com/js/js_objects.asp · https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Working_with_objects
- Search: "javascript objects explained beginner", "object state and behaviour programming"

#### `oop-classes-and-constructors` — Classes and Constructors (35 min)
A class is a template that guarantees every instance starts life with the fields
its methods assume exist.
1. `explain` Class as template, instance as value; what a constructor is for.
2. `lab` javascript — write a `Rectangle` class with a constructor and an `area()` method.
3. `explain` Constructors that validate: refusing to build an invalid object beats checking later.
4. `lab` python — write a `Rectangle` with `__init__` that raises on a negative side.
5. `check` Which runs first, the constructor body or the field assignments it performs?
6. `explain` Constructor overloading and the named-arguments alternative.
- Refs: https://www.w3schools.com/js/js_classes.asp · https://www.w3schools.com/python/python_class_init.asp · https://www.w3schools.com/cpp/cpp_constructors.asp
- Search: "javascript class constructor tutorial", "python __init__ explained"

#### `oop-methods-and-identity` — Methods, `this` and `self` (35 min)
Methods are functions that receive the object they were called on, and most
early OOP bugs are that receiver arriving as something unexpected.
1. `explain` How a method receives its object: `this` in JavaScript, explicit `self` in Python.
2. `lab` javascript — call a method through a detached reference and watch `this` become undefined.
3. `explain` Arrow functions inherit `this`; that is the fix, and also the trap.
4. `lab` javascript — repair the detached call two ways: bind, and an arrow-function wrapper.
5. `check` Why does Python make `self` an explicit first parameter?
6. `explain` Method chaining, and returning `this` deliberately.
- Refs: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this · https://www.w3schools.com/python/python_class_self.asp
- Search: "javascript this keyword methods", "python self parameter tutorial"

#### `oop-encapsulation-basics` — Encapsulation and Invariants (35 min)
Hiding a field is not secrecy for its own sake; it is how you keep a rule about
that field true no matter who is calling.
1. `explain` Invariant, public surface, private detail; the "balance never negative" example.
2. `lab` javascript — add a `#balance` private field so external code cannot set it directly.
3. `explain` Getters and setters, and why a setter that validates is not the same as a public field.
4. `lab` python — use a `@property` with a validating setter and show the direct assignment failing.
5. `check` Which of these breaks an invariant: reading a private field via a getter, or exposing the internal array by reference?
6. `explain` Leaky encapsulation: returning a mutable internal collection.
- Refs: https://www.w3schools.com/js/js_class_private.asp · https://www.w3schools.com/python/python_encapsulation.asp · https://www.w3schools.com/cpp/cpp_encapsulation.asp
- Search: "encapsulation explained programming", "javascript private class fields"

#### `oop-inheritance-first-look` — Inheritance, First Look (40 min)
Inheritance says "this kind of thing is a special case of that kind of thing",
and it is powerful exactly to the degree that claim is actually true.
1. `explain` Base and derived types; what a subclass inherits and what it must supply.
2. `lab` javascript — extend a `Shape` base with `Circle` and `Square`, calling `super()` correctly.
3. `explain` Overriding a method, and calling back into the base implementation.
4. `check` What happens if a derived constructor uses `this` before calling `super()`?
5. `lab` python — override a method and call the base version via `super()`.
6. `explain` Depth is a cost: three levels of inheritance is usually a design smell.
- Refs: https://www.w3schools.com/js/js_class_inheritance.asp · https://www.w3schools.com/python/python_inheritance.asp · https://www.w3schools.com/cpp/cpp_inheritance.asp
- Search: "inheritance oop tutorial", "super keyword javascript class"

#### `oop-polymorphism-first-look` — Polymorphism, First Look (35 min)
Polymorphism is the payoff: caller code that keeps working when you add a new
kind of thing it has never heard of.
1. `explain` One call site, many implementations; why this removes `if type ==` chains.
2. `lab` javascript — iterate a mixed array of shapes calling `area()` on each without any type test.
3. `explain` Duck typing versus declared interfaces; what each buys you.
4. `lab` python — add a third shape and confirm the reporting loop needs no edit.
5. `check` Rewrite this `switch` on a `kind` field as polymorphic dispatch — which class gains a method?
6. `explain` Where polymorphism costs you: harder to see all cases at once.
- Refs: https://www.w3schools.com/python/python_polymorphism.asp · https://www.w3schools.com/cpp/cpp_polymorphism.asp
- Search: "polymorphism explained with example", "replace switch statement with polymorphism"

## Intermediate

#### `oop-abstract-types-and-interfaces` — Abstract Types and Interfaces (40 min)
An interface is a promise about behaviour with no promise about implementation,
which is what lets two unrelated classes be substituted for each other.
1. `explain` Abstract base, interface, protocol; what each language calls the same idea.
2. `lab` python — define an abstract base class whose abstract method makes direct instantiation fail.
3. `explain` Programming to an interface: the caller depends on the shape, not the class.
4. `lab` javascript — define a duck-typed `Storage` contract and swap two implementations behind it.
5. `check` Why can an abstract class hold state while a pure interface usually cannot?
6. `explain` One-implementation interfaces: when the abstraction is not earning its keep.
- Refs: https://docs.python.org/3/library/abc.html · https://www.w3schools.com/cpp/cpp_polymorphism.asp
- Search: "abstract class vs interface", "python abstract base class abc tutorial"

#### `oop-composition-over-inheritance` — Composition over Inheritance (45 min)
Most "is-a" relationships in real code turn out to be "has-a", and rewriting
them that way removes whole categories of fragile-base-class bugs.
1. `explain` Inheritance couples you to a parent's internals; composition couples you only to its surface.
2. `lab` javascript — refactor a three-level `Employee → Manager → Director` hierarchy into a role object held by composition.
3. `explain` Delegation: forwarding a call to a collaborator you own.
4. `check` A `Stack` that extends `Array` inherits `splice`. Why is that a problem?
5. `lab` python — build the same behaviour by holding a list rather than subclassing one.
6. `explain` When inheritance is still right: a genuinely closed, stable taxonomy.
- Refs: https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Advanced_JavaScript_objects/Object-oriented_programming · https://refactoring.guru/design-patterns/composite
- Search: "composition over inheritance explained", "fragile base class problem"

#### `oop-solid-srp-and-ocp` — SOLID: Responsibility and Openness (45 min)
The first two SOLID principles are about where you put a change: one reason to
change per class, and new behaviour added rather than existing behaviour edited.
1. `explain` Single Responsibility as "one reason to change", not "one method".
2. `lab` javascript — split a class that parses, validates and emails into three collaborators.
3. `explain` Open/Closed: extend by adding a type, not by editing a conditional.
4. `lab` javascript — replace a growing `if (format === ...)` chain with a registry of formatter objects.
5. `check` Which change breaks Open/Closed: adding a new formatter class, or adding a branch to the existing chain?
6. `explain` The cost of premature extension points.
- Refs: https://refactoring.guru/design-patterns/strategy · https://refactoring.guru/refactoring/smells/bloaters
- Search: "single responsibility principle example", "open closed principle explained"

#### `oop-solid-lsp-isp-dip` — SOLID: Substitution, Segregation, Inversion (45 min)
The remaining three principles are all about not lying: a subtype must really
work where its parent did, an interface must not demand what the client cannot
give, and the direction of dependency is a choice.
1. `explain` Liskov substitution as a behavioural contract, not a compiler check.
2. `check` A `Square` that extends `Rectangle` and forces width to equal height — which caller assumption does it break?
3. `explain` Interface segregation: a fat interface forces stub methods that throw.
4. `lab` python — split a `Printer/Scanner/Fax` interface so a print-only device stops raising `NotImplementedError`.
5. `explain` Dependency inversion: both sides depend on an abstraction the caller owns.
6. `lab` javascript — inject a clock so a time-dependent method becomes testable.
- Refs: https://refactoring.guru/design-patterns/adapter · https://refactoring.guru/refactoring/smells/couplers
- Search: "liskov substitution principle square rectangle", "dependency injection explained beginner"

#### `oop-value-objects-and-equality` — Value Objects and Equality (35 min)
Some objects are defined entirely by their contents, and treating them as values
rather than entities eliminates a class of aliasing bugs.
1. `explain` Entity versus value object; identity by id versus identity by contents.
2. `lab` python — implement `__eq__` and `__hash__` on a `Money` type and use it as a dict key.
3. `explain` Immutability: why a frozen value object is safe to share.
4. `lab` javascript — implement a structural `equals()` and a `withAmount()` that returns a new instance.
5. `check` Why must two objects that compare equal also produce the same hash?
6. `explain` Primitive obsession: passing a raw number where a `Money` belongs.
- Refs: https://docs.python.org/3/reference/datamodel.html#object.__hash__ · https://refactoring.guru/refactoring/smells/primitive-obsession
- Search: "value object pattern explained", "python __eq__ and __hash__ tutorial"

#### `oop-errors-and-invariants` — Errors, Exceptions and Class Invariants (40 min)
An object's error strategy is part of its design: what it refuses, what it
reports, and what it never lets a caller observe.
1. `explain` Fail fast at the boundary; keep the invariant true for the object's whole life.
2. `lab` python — define a custom exception type and raise it from a validating constructor.
3. `explain` Exceptions versus result values; when each is the honest choice.
4. `lab` javascript — implement a `parse()` that returns a discriminated result object instead of throwing.
5. `check` Which is worse for a caller: an exception type it can catch, or a silently returned `null`?
6. `explain` Never leave a half-constructed object reachable.
- Refs: https://www.w3schools.com/python/python_try_except.asp · https://www.w3schools.com/js/js_errors.asp
- Search: "custom exception class tutorial", "fail fast validation programming"

## Advanced

#### `oop-creational-patterns` — Creational Patterns (45 min)
Factory, builder and singleton are three named answers to "construction has
become complicated", and each has a specific cost.
1. `explain` Factory method and abstract factory: choosing a class at run time.
2. `lab` javascript — write a factory that returns one of three exporter objects from a format string.
3. `explain` Builder: constructing an object that has too many optional parts.
4. `lab` python — build a fluent query builder that produces an immutable spec object.
5. `explain` Singleton, and why global mutable state makes tests order-dependent.
6. `check` Which pattern would you reach for when a constructor has eleven optional parameters?
- Refs: https://refactoring.guru/design-patterns/factory-method · https://refactoring.guru/design-patterns/builder · https://refactoring.guru/design-patterns/singleton
- Search: "factory pattern tutorial", "builder pattern explained", "singleton anti-pattern"

#### `oop-structural-patterns` — Structural Patterns (45 min)
Adapter, decorator and facade all reshape a surface without reimplementing what
is behind it.
1. `explain` Adapter: making an incompatible interface fit a client you cannot change.
2. `lab` javascript — wrap a legacy weather API in an adapter matching the app's own interface.
3. `explain` Decorator: adding behaviour by wrapping, not by subclassing.
4. `lab` javascript — layer logging and caching decorators over the same fetcher object.
5. `explain` Facade and proxy: one simple door, and a stand-in that controls access.
6. `check` Logging added to every call without touching the original class — which pattern is that?
- Refs: https://refactoring.guru/design-patterns/adapter · https://refactoring.guru/design-patterns/decorator · https://refactoring.guru/design-patterns/facade
- Search: "adapter pattern example", "decorator pattern javascript"

#### `oop-behavioural-patterns` — Behavioural Patterns (50 min)
Strategy, observer, state and template method are about who decides and who gets
told.
1. `explain` Strategy: swapping an algorithm behind a stable call.
2. `lab` python — pass three sorting strategies into one reporting function.
3. `explain` Observer: publishers that do not know their subscribers.
4. `lab` javascript — build a tiny event emitter with subscribe, emit and unsubscribe.
5. `explain` State machine as objects; template method and its inversion of control.
6. `check` A checkout that behaves differently in `cart`, `paid` and `shipped` — which pattern?
- Refs: https://refactoring.guru/design-patterns/strategy · https://refactoring.guru/design-patterns/observer · https://refactoring.guru/design-patterns/state
- Search: "observer pattern tutorial", "state pattern vs if statements"

#### `oop-generics-and-templates` — Generics, Templates and Type Parameters (40 min)
Generic types let one implementation serve many element types without giving up
the guarantee that the elements match.
1. `explain` Why an untyped container pushes type errors to run time.
2. `explain` Type parameters, constraints and variance, in plain language.
3. `lab` python — write a generic `Stack` annotated with a `TypeVar` and show a mismatched push.
4. `explain` C++ templates as compile-time code generation; the error-message cost.
5. `check` What does a bounded type parameter let a method assume about its element?
6. `explain` When a generic is over-engineering: exactly one concrete instantiation.
- Refs: https://docs.python.org/3/library/typing.html · https://www.w3schools.com/cpp/cpp_templates.asp
- Search: "generics explained programming", "c++ templates tutorial"

#### `oop-mixins-and-multiple-inheritance` — Mixins, Traits and Multiple Inheritance (40 min)
Sharing behaviour across unrelated hierarchies is a real need, and multiple
inheritance is the sharpest of the available tools.
1. `explain` The diamond problem and why method resolution order exists.
2. `lab` python — build two mixins, combine them, and print the class's MRO.
3. `explain` Mixin discipline: no state, no constructor, one capability each.
4. `lab` javascript — implement mixins by copying methods onto a prototype and note the name-collision risk.
5. `check` Two mixins define `save()`. Which one wins, and how do you find out?
6. `explain` C++ virtual inheritance in one paragraph, and why most codebases avoid it.
- Refs: https://docs.python.org/3/tutorial/classes.html#multiple-inheritance · https://www.w3schools.com/cpp/cpp_inheritance_multiple.asp
- Search: "python mro diamond problem", "mixins javascript tutorial"

#### `oop-testing-seams-and-refactoring` — Seams, Testing and Refactoring to Patterns (50 min)
A design is testable to the extent it has seams — places you can substitute a
collaborator — and most refactoring toward patterns is really seam-making.
1. `explain` Seam, stub, fake, mock; why "mock everything" produces brittle tests.
2. `lab` javascript — inject a fake HTTP client so a service test needs no network.
3. `explain` Reading code smells: long method, feature envy, shotgun surgery.
4. `lab` python — extract a class from a 60-line method and name the responsibility you found.
5. `check` Which smell does "one change forces edits in six files" describe?
6. `explain` Refactor in small steps with the tests green; never refactor and add behaviour at once.
- Refs: https://refactoring.guru/refactoring/smells · https://refactoring.guru/refactoring/techniques
- Search: "code smells explained", "dependency injection for testing"

---

# Track 2 — Database Management (`dbms`)

**Track summary.** This track teaches relational databases as a set of
guarantees you buy — uniqueness, referential integrity, atomic transactions —
and the query language you use to collect on them. It starts with reading data,
moves through schema design and normalisation, and ends with the parts that
decide whether a real application survives contact with load: indexes, query
plans, isolation levels and safe parameterised queries. Every lab runs against
an in-browser SQLite database via `sql.js`, so the SQL dialect used in labs is
SQLite; PostgreSQL-specific behaviour is called out in prose where it differs
(notably around isolation levels and `EXPLAIN`).

## Beginner

#### `dbms-what-a-database-is` — What a Database Buys You (30 min)
A database is not a file format; it is a set of guarantees about concurrent
access, durability and consistency that you would otherwise have to write
yourself.
1. `explain` Files versus a DBMS: concurrency, durability, constraints, query language.
2. `explain` Relational model in one page: relations, tuples, attributes, keys.
3. `lab` sql — open a seeded `students`/`courses` database and run your first `SELECT *`.
4. `explain` Declarative querying: you state what you want, the planner decides how.
5. `check` Which of these is the database's job rather than the application's: enforcing that no two students share an email?
6. `explain` Where a relational database is the wrong choice, briefly and honestly.
- Refs: https://www.w3schools.com/sql/sql_intro.asp · https://www.postgresql.org/docs/current/tutorial-arch.html
- Search: "what is a relational database", "dbms introduction beginner"

#### `dbms-tables-columns-and-types` — Tables, Columns and Types (35 min)
Choosing a column's type is the cheapest constraint you will ever add, and the
most expensive to change later.
1. `explain` `CREATE TABLE`, column types, `NOT NULL`, `DEFAULT`.
2. `lab` sql — create an `enrolments` table with typed columns and sensible defaults.
3. `explain` Text versus numeric versus date/time; why storing a date as text hurts later.
4. `check` A score that is always 0–100 — which type and which constraint?
5. `lab` sql — add a `CHECK` constraint and watch an out-of-range insert fail.
6. `explain` `ALTER TABLE` and why schema changes need migrations.
- Refs: https://www.w3schools.com/sql/sql_create_table.asp · https://www.w3schools.com/sql/sql_datatypes.asp · https://www.w3schools.com/sql/sql_check.asp
- Search: "sql create table tutorial", "sql data types explained"

#### `dbms-select-filter-sort` — Selecting, Filtering and Sorting (35 min)
Most real queries are a projection, a filter and an order, and getting those
three right accounts for most of day-to-day SQL.
1. `explain` `SELECT` list, `WHERE`, `ORDER BY`, `LIMIT`; why `SELECT *` is a habit to drop.
2. `lab` sql — list the ten highest-scoring enrolments with student name and score only.
3. `explain` `AND`/`OR`/`NOT` precedence and the parentheses that save you.
4. `lab` sql — filter with `IN`, `BETWEEN` and `LIKE` against the seeded data.
5. `check` Why does `WHERE score > 50 OR passed = 1 AND active = 1` surprise people?
6. `explain` `DISTINCT`, and what it costs.
- Refs: https://www.w3schools.com/sql/sql_where.asp · https://www.w3schools.com/sql/sql_orderby.asp · https://www.w3schools.com/sql/sql_operators.asp
- Search: "sql where clause tutorial", "sql order by limit example"

#### `dbms-aggregates-and-grouping` — Aggregates and Grouping (40 min)
`GROUP BY` is where SQL stops looking like row-by-row code, and where the
`WHERE`/`HAVING` distinction first bites.
1. `explain` `COUNT`, `SUM`, `AVG`, `MIN`, `MAX` over a whole table.
2. `lab` sql — compute the average score per course with `GROUP BY`.
3. `explain` `WHERE` filters rows before grouping; `HAVING` filters groups after.
4. `lab` sql — keep only courses whose average exceeds 60 using `HAVING`.
5. `check` Move a `COUNT(*) > 3` condition from `HAVING` to `WHERE` — what happens and why?
6. `explain` Aggregates and `NULL`: `COUNT(col)` versus `COUNT(*)`.
- Refs: https://www.w3schools.com/sql/sql_groupby.asp · https://www.w3schools.com/sql/sql_having.asp · https://www.w3schools.com/sql/sql_aggregate_functions.asp
- Search: "sql group by having difference", "sql aggregate functions tutorial"

#### `dbms-insert-update-delete` — Writing Data Safely (35 min)
Every write statement is one missing `WHERE` away from touching the whole table,
so the habits around writes matter more than the syntax.
1. `explain` `INSERT`, `UPDATE`, `DELETE`; the affected-row count as your receipt.
2. `lab` sql — insert three rows, then update one by primary key.
3. `explain` The missing-`WHERE` accident; run the `SELECT` first, always.
4. `lab` sql — write the `SELECT` that previews a delete, then run the delete.
5. `check` `UPDATE enrolments SET score = 0` — how many rows does that touch?
6. `explain` Upsert, and why "check then insert" races.
- Refs: https://www.w3schools.com/sql/sql_insert.asp · https://www.w3schools.com/sql/sql_update.asp · https://www.w3schools.com/sql/sql_delete.asp
- Search: "sql insert update delete tutorial", "sql upsert explained"

#### `dbms-keys-and-uniqueness` — Primary Keys and Uniqueness (35 min)
A primary key is the answer to "which row do you mean", and a unique constraint
is the only reliable way to stop duplicates under concurrency.
1. `explain` Primary key, candidate key, surrogate versus natural key.
2. `lab` sql — add a primary key and a unique index, then watch a duplicate insert fail.
3. `explain` Auto-increment identifiers and their trade-offs.
4. `check` Why is an application-level "does this email exist?" check not a substitute for a unique index?
5. `lab` sql — model a composite key on `(student_id, course_id)` and test it.
6. `explain` Keys you will regret: mutable natural keys such as email.
- Refs: https://www.w3schools.com/sql/sql_primarykey.asp · https://www.w3schools.com/sql/sql_unique.asp · https://www.w3schools.com/sql/sql_autoincrement.asp
- Search: "primary key vs unique key", "surrogate key vs natural key"

## Intermediate

#### `dbms-foreign-keys-and-integrity` — Foreign Keys and Referential Integrity (40 min)
A foreign key is a promise that the thing you point at exists, enforced by the
database rather than hoped for by the application.
1. `explain` Foreign keys, parent/child rows, orphan rows.
2. `lab` sql — declare a foreign key, then attempt an insert referencing a missing parent.
3. `explain` `ON DELETE` behaviour: restrict, cascade, set null, and when each is right.
4. `lab` sql — compare `CASCADE` and `RESTRICT` on the same delete.
5. `check` Cascading deletes on a `users` table — what could go badly wrong?
6. `explain` Why SQLite needs foreign keys switched on explicitly.
- Refs: https://www.w3schools.com/sql/sql_foreignkey.asp · https://www.postgresql.org/docs/current/tutorial-fk.html
- Search: "foreign key constraint tutorial", "on delete cascade explained"

#### `dbms-joins-in-depth` — Joins in Depth (45 min)
Joins are how a normalised schema is put back together, and the difference
between an inner and a left join is the difference between hiding and showing
missing data.
1. `explain` Inner, left, right and full joins as set pictures.
2. `lab` sql — list every student with their enrolments, including students with none.
3. `explain` Join conditions versus filters: a predicate in `ON` and the same predicate in `WHERE` are not the same for outer joins.
4. `lab` sql — move a condition from `ON` to `WHERE` on a left join and explain the row-count change.
5. `explain` Self-joins and multi-table joins; aliasing to stay sane.
6. `check` Which join do you need to find students with no enrolments at all?
- Refs: https://www.w3schools.com/sql/sql_join.asp · https://www.w3schools.com/sql/sql_join_left.asp · https://www.postgresql.org/docs/current/tutorial-join.html
- Search: "sql joins explained visually", "left join vs inner join where clause"

#### `dbms-subqueries-and-set-operations` — Subqueries and Set Operations (40 min)
Sometimes the cleanest query is a query about a query, and `EXISTS` is usually
the one you want.
1. `explain` Scalar, row and table subqueries; correlated versus uncorrelated.
2. `lab` sql — find students scoring above their course average using a correlated subquery.
3. `explain` `EXISTS` versus `IN` versus a join, and the `NULL` trap in `NOT IN`.
4. `lab` sql — rewrite a `NOT IN` that silently returns nothing as `NOT EXISTS`.
5. `explain` `UNION`, `UNION ALL`, `INTERSECT`, `EXCEPT`.
6. `check` Why can `NOT IN` against a column containing `NULL` return no rows at all?
- Refs: https://www.w3schools.com/sql/sql_exists.asp · https://www.w3schools.com/sql/sql_union.asp · https://www.w3schools.com/sql/sql_null_values.asp
- Search: "sql exists vs in performance", "correlated subquery tutorial"

#### `dbms-normalisation` — Normalisation, 1NF to 3NF (45 min)
Normalisation is a procedure for removing the redundancy that lets a database
contradict itself.
1. `explain` The update, insert and delete anomalies that redundancy causes.
2. `explain` Functional dependency; 1NF, 2NF, 3NF stated as tests you can apply.
3. `lab` sql — split a flat `enrolments_wide` table with repeating course data into three tables.
4. `explain` BCNF in one paragraph, and where 3NF is already enough.
5. `check` A table storing `course_title` next to `course_id` in every row — which normal form does it fail, and why?
6. `explain` Normalise first, denormalise later and deliberately.
- Refs: https://www.postgresql.org/docs/current/tutorial-table.html · https://www.w3schools.com/sql/sql_create_table.asp
- Search: "database normalization 1nf 2nf 3nf explained", "update anomaly database example"

#### `dbms-transactions-and-acid` — Transactions and ACID (45 min)
A transaction is how several writes become one event that either all happened or
none did, which is the only reason multi-table writes are safe.
1. `explain` Atomicity, consistency, isolation, durability — each as a failure it prevents.
2. `lab` sql — begin a transaction, make two writes, roll back, and confirm neither landed.
3. `explain` Commit boundaries; why quiz submission in this LMS writes attempt, answers, progress and unlock in one transaction.
4. `lab` sql — simulate a partial failure and show the rollback restoring the earlier state.
5. `check` A recorded attempt with no unlock row — which ACID property was missing?
6. `explain` Savepoints and nested transactions, briefly.
- Refs: https://www.postgresql.org/docs/current/tutorial-transactions.html · https://www.w3schools.com/sql/sql_transactions.asp
- Search: "acid properties explained", "sql transaction rollback tutorial"

#### `dbms-views-and-derived-tables` — Views, CTEs and Derived Tables (40 min)
Naming a query is a design act: it gives the rest of the system a stable shape to
depend on.
1. `explain` Views as saved queries; what they do and do not cache.
2. `lab` sql — create a `course_summary` view and query it like a table.
3. `explain` Common table expressions for readability; stacking CTEs instead of nesting subqueries.
4. `lab` sql — rewrite a three-deep nested subquery as sequential CTEs.
5. `explain` Materialised views: the trade you make for speed.
6. `check` Does creating a view store its result set?
- Refs: https://www.w3schools.com/sql/sql_view.asp · https://www.postgresql.org/docs/current/tutorial-views.html
- Search: "sql views tutorial", "common table expression with clause tutorial"

## Advanced

#### `dbms-indexes-and-query-plans` — Indexes and Query Plans (50 min)
An index is a data structure you pay for on every write to make some reads fast,
and the query plan is how you find out whether you got what you paid for.
1. `explain` B-tree indexes; selectivity; why an index on a low-cardinality column often does nothing.
2. `lab` sql — time a filtered query, add an index, and time it again on a few thousand seeded rows.
3. `explain` Reading a plan: sequential scan versus index scan; `EXPLAIN` and `EXPLAIN QUERY PLAN`.
4. `lab` sql — inspect the plan before and after the index and name the change.
5. `explain` Composite indexes and leftmost-prefix matching; covering indexes.
6. `check` Why does wrapping an indexed column in a function usually defeat the index?
- Refs: https://www.w3schools.com/sql/sql_create_index.asp · https://www.postgresql.org/docs/current/using-explain.html · https://www.postgresql.org/docs/current/indexes.html
- Search: "sql index explained b-tree", "how to read explain plan postgres"

#### `dbms-window-functions` — Window Functions (45 min)
Window functions compute per-row values that depend on other rows, which is
exactly what a leaderboard needs.
1. `explain` `OVER`, `PARTITION BY`, `ORDER BY`; how a window differs from a group.
2. `lab` sql — rank students within each course using `RANK()` and `DENSE_RANK()`.
3. `explain` `ROW_NUMBER` versus `RANK` versus `DENSE_RANK`, and tie handling.
4. `lab` sql — compute a running total of points per student with a framed `SUM`.
5. `explain` `LAG`/`LEAD` for week-over-week comparisons.
6. `check` Why can a window function keep every input row while `GROUP BY` cannot?
- Refs: https://www.postgresql.org/docs/current/tutorial-window.html · https://www.postgresql.org/docs/current/functions-window.html
- Search: "sql window functions tutorial", "rank vs dense_rank vs row_number"

#### `dbms-isolation-and-anomalies` — Isolation Levels and Concurrency Anomalies (50 min)
Concurrency bugs in databases have names, and the isolation level you choose
decides which of them you have signed up for.
1. `explain` Dirty read, non-repeatable read, phantom read, lost update.
2. `explain` Read committed, repeatable read, serialisable; what PostgreSQL actually gives you at each.
3. `lab` sql — reproduce a lost update with two interleaved read-modify-write sequences.
4. `explain` Optimistic concurrency with a version column; pessimistic locking with `SELECT ... FOR UPDATE`.
5. `lab` sql — fix the lost update using a conditional update on the version column.
6. `check` Two students starting the same exam at the same instant — which anomaly does a unique index on `(exam_id, user_id)` prevent that a read-then-write check does not?
- Refs: https://www.postgresql.org/docs/current/transaction-iso.html · https://www.postgresql.org/docs/current/explicit-locking.html
- Search: "database isolation levels explained", "lost update problem sql"

#### `dbms-read-models-and-denormalisation` — Read Models and Deliberate Denormalisation (40 min)
Denormalisation is a legitimate optimisation once you can name the read it
serves and the write that must keep it true.
1. `explain` Why a normalised schema can be too slow for a hot read path.
2. `explain` Denormalised read models; rebuild-on-event versus rebuild-on-schedule.
3. `lab` sql — build a `leaderboard` table and a statement that rebuilds it from the normalised source.
4. `explain` Staleness as a product decision, not an accident.
5. `check` A denormalised total that disagrees with its source rows — where do you look first?
6. `explain` Counter caches and the double-count hazard.
- Refs: https://www.postgresql.org/docs/current/rules-materializedviews.html · https://www.w3schools.com/sql/sql_view.asp
- Search: "denormalization database tradeoffs", "materialized view refresh strategy"

#### `dbms-parameterised-queries` — Parameterised Queries and Injection Defence (40 min)
String-concatenated SQL is the single most exploited application bug in history,
and parameter binding removes the entire class.
1. `explain` Why concatenation confuses data with code; the mental model of a bound parameter.
2. `lab` sql — run a query with bound parameters and confirm a quote in the input stays data.
3. `explain` What parameters cannot do: table and column names still need an allow-list.
4. `lab` sql — replace an interpolated `ORDER BY` with an allow-list mapping.
5. `explain` Least-privilege database accounts as defence in depth.
6. `check` Is escaping quotes a complete defence? Why not?
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html · https://www.w3schools.com/sql/sql_injection.asp · https://www.w3schools.com/sql/sql_parameterized_queries.asp
- Search: "parameterized queries tutorial", "sql injection prevention prepared statements"

#### `dbms-migrations-and-evolution` — Migrations and Schema Evolution (40 min)
A schema change is a deploy-time event with a rollback plan, not an ad-hoc
statement typed into a console.
1. `explain` Migration files, forward-only versus reversible, ordering and checksums.
2. `explain` Expand/contract: add nullable, backfill, enforce, drop — in four deploys, not one.
3. `lab` sql — perform an expand/contract rename across four ordered statements.
4. `explain` Long-running locks: why adding a `NOT NULL` column with a default used to take the table down.
5. `check` Which step of expand/contract can you not safely run while the old code is still live?
6. `explain` Idempotent seeds keyed on natural keys, as this repo's own seed does.
- Refs: https://www.postgresql.org/docs/current/sql-altertable.html · https://www.w3schools.com/sql/sql_alter.asp
- Search: "database migration best practices", "zero downtime schema change"

---

# Track 3 — Data Structures and Algorithms (`dsa`)

**Track summary.** This track builds the vocabulary that makes performance
discussable: what a structure costs to search, insert and delete, and which
algorithmic shape fits which problem. The ladder follows the ordering that has
become conventional across reference courses — complexity, arrays and searching,
elementary then divide-and-conquer sorting, linked structures, trees, heaps,
graphs, and finally dynamic programming and greedy reasoning. Every lab runs in
the browser: JavaScript in a Web Worker for the interactive visualisations,
Python via Pyodide where the code reads more clearly as pseudocode. Complexity is
introduced before any sorting algorithm, deliberately, so that every later
algorithm can be discussed in the same terms.

## Beginner

#### `dsa-complexity-first-principles` — Complexity from First Principles (40 min)
Big-O is a way of saying how the work grows when the input grows, and it is
useful precisely because it ignores constants.
1. `explain` Counting operations, not seconds; growth classes O(1), O(log n), O(n), O(n log n), O(n²).
2. `lab` javascript — instrument two loops with an operation counter and plot the counts as n grows.
3. `explain` Best, average and worst case; why worst case is the promise you make.
4. `explain` Space complexity, and the recursion stack as space.
5. `check` A nested loop where the inner loop runs a fixed 100 times — is that O(n²)?
6. `lab` javascript — classify five given snippets by their growth class.
- Refs: https://www.w3schools.com/dsa/dsa_timecomplexity_theory.php · https://www.w3schools.com/dsa/dsa_intro.php
- Search: "big o notation explained beginner", "time complexity analysis tutorial"

#### `dsa-arrays-and-traversal` — Arrays, Indexing and Traversal (35 min)
An array's superpower is constant-time access by index, and its weakness is that
inserting in the middle moves everything after it.
1. `explain` Contiguous memory, index arithmetic, why access is O(1).
2. `lab` javascript — implement insert-at-index and delete-at-index by hand and count the shifts.
3. `explain` Dynamic arrays and amortised append; the doubling trick.
4. `explain` In-place versus copying transformations, and why in-place is not always better.
5. `check` Inserting at the front of an array of n items — how many elements move?
6. `lab` python — reverse a list in place with two indices and no extra list.
- Refs: https://www.w3schools.com/dsa/dsa_data_arrays.php · https://www.w3schools.com/js/js_array_methods.asp
- Search: "array data structure explained", "dynamic array amortized analysis"

#### `dsa-search-linear-and-binary` — Linear and Binary Search (40 min)
Binary search is the first place sorting pays for itself, and it is also the
first place off-by-one errors become expensive.
1. `explain` Linear search O(n); binary search O(log n) and its sorted-input precondition.
2. `lab` javascript — implement binary search with explicit `low`/`high` and log the interval each step.
3. `explain` The three classic bugs: inclusive/exclusive bounds, midpoint overflow, non-terminating loop.
4. `lab` python — write the first-occurrence variant for an array with duplicates.
5. `check` Why does binary search fail silently on an unsorted array rather than erroring?
6. `explain` Binary search on an answer space, not just an array — a preview of the advanced level.
- Refs: https://www.w3schools.com/dsa/dsa_algo_binarysearch.php · https://www.w3schools.com/dsa/dsa_algo_linearsearch.php
- Search: "binary search tutorial off by one", "binary search first occurrence duplicates"

#### `dsa-elementary-sorts` — Elementary Sorts (40 min)
Bubble, selection and insertion sort are all O(n²), and knowing why teaches more
about loop invariants than any faster algorithm does.
1. `explain` Bubble sort and the invariant "the tail is sorted".
2. `lab` javascript — implement bubble sort with a swap counter and an early-exit flag.
3. `explain` Selection sort: fewer swaps, same comparisons.
4. `explain` Insertion sort, and why it is genuinely fast on nearly-sorted input.
5. `check` Which elementary sort would you pick for an array that is already almost sorted?
6. `lab` python — instrument all three on the same input and compare comparison counts.
- Refs: https://www.w3schools.com/dsa/dsa_algo_bubblesort.php · https://www.w3schools.com/dsa/dsa_algo_insertionsort.php · https://www.w3schools.com/dsa/dsa_algo_selectionsort.php
- Search: "bubble sort selection sort insertion sort comparison", "insertion sort nearly sorted"

#### `dsa-strings-and-two-pointers` — Strings and the Two-Pointer Idea (40 min)
Two indices moving through one sequence is the simplest way to turn a nested loop
into a single pass.
1. `explain` Strings as sequences; immutability and why repeated concatenation is quadratic.
2. `lab` javascript — check a palindrome with pointers converging from both ends.
3. `explain` Opposite-direction versus same-direction pointers; the sorted-pair-sum case.
4. `lab` python — find a pair summing to a target in a sorted list in one pass.
5. `check` What precondition does the two-pointer pair-sum rely on?
6. `explain` In-place partitioning as a two-pointer technique.
- Refs: https://www.w3schools.com/js/js_string_methods.asp · https://www.w3schools.com/dsa/dsa_data_arrays.php
- Search: "two pointer technique explained", "palindrome check two pointers"

#### `dsa-hash-maps-and-counting` — Hash Maps and Counting (40 min)
A hash map trades memory for time, and "count things in a map" solves a
surprising share of interview and real problems.
1. `explain` Hashing, buckets, collisions, why average lookup is O(1) and worst case is not.
2. `lab` javascript — build a frequency map of characters and find the first non-repeating one.
3. `explain` Sets versus maps; membership as the cheap question.
4. `lab` python — detect duplicates in one pass with a set, and state the space cost.
5. `check` Why is "sort then compare neighbours" O(n log n) where the set approach is O(n)?
6. `explain` When a hash map is the wrong answer: you need ordering, or memory is tight.
- Refs: https://www.w3schools.com/dsa/dsa_theory_hashtables.php · https://www.w3schools.com/dsa/dsa_data_hashmaps.php · https://www.w3schools.com/js/js_maps.asp
- Search: "hash table explained collisions", "frequency counter pattern javascript"

## Intermediate

#### `dsa-recursion-and-the-call-stack` — Recursion and the Call Stack (45 min)
Recursion is a loop whose state lives on the stack, and every recursive function
is a base case plus a strictly smaller subproblem.
1. `explain` Base case, recursive case, and what "strictly smaller" must mean.
2. `lab` python — write factorial and Fibonacci recursively, then print the call depth.
3. `explain` The call stack, stack overflow, and tail calls.
4. `lab` javascript — convert a recursive tree walk into an explicit stack loop.
5. `check` Naive recursive Fibonacci at n = 40 — why is it slow, in one sentence?
6. `explain` Memoisation as the one-line fix, previewing dynamic programming.
- Refs: https://www.w3schools.com/dsa/dsa_ref_memoization.php · https://docs.python.org/3/library/sys.html#sys.setrecursionlimit
- Search: "recursion call stack visualization", "memoization recursion tutorial"

#### `dsa-divide-and-conquer-sorts` — Merge Sort and Quick Sort (50 min)
Both algorithms split the problem in half; they differ in where the work goes and
in what their worst case is.
1. `explain` Divide, conquer, combine; why halving gives the log n factor.
2. `lab` javascript — implement merge sort's merge step against two sorted arrays.
3. `explain` Merge sort: stable, O(n log n) always, O(n) extra space.
4. `explain` Quick sort: partition, pivot choice, O(n²) worst case, in-place.
5. `lab` python — implement Lomuto partition and sort with it.
6. `check` Which of the two would you choose for sorting linked data, and why?
- Refs: https://www.w3schools.com/dsa/dsa_algo_mergesort.php · https://www.w3schools.com/dsa/dsa_algo_quicksort.php · https://www.w3schools.com/dsa/dsa_timecomplexity_quicksort.php
- Search: "merge sort vs quick sort explained", "quicksort partition tutorial"

#### `dsa-linked-lists` — Linked Lists (45 min)
A linked list buys O(1) insertion at a known position and pays with O(n) access
and terrible cache behaviour.
1. `explain` Nodes and references; singly, doubly, circular.
2. `lab` javascript — build a singly linked list with push, and traverse it to find a value.
3. `explain` Insertion and deletion by pointer surgery; the dummy-head trick.
4. `lab` javascript — reverse a singly linked list iteratively with three pointers.
5. `explain` Cycle detection with fast and slow pointers.
6. `check` Why can a linked list not do binary search even when sorted?
- Refs: https://www.w3schools.com/dsa/dsa_theory_linkedlists.php · https://www.w3schools.com/dsa/dsa_algo_linkedlists_operations.php
- Search: "linked list reverse iterative", "floyd cycle detection tortoise hare"

#### `dsa-stacks-queues-and-deques` — Stacks, Queues and Deques (40 min)
Restricting how you may add and remove is what makes these structures useful; the
restriction is the feature.
1. `explain` LIFO and FIFO; push/pop, enqueue/dequeue, and their O(1) guarantees.
2. `lab` javascript — validate balanced brackets using a stack.
3. `explain` Queue implemented on an array: why naive `shift()` is O(n), and the ring-buffer fix.
4. `lab` python — implement a queue with two stacks and reason about amortised cost.
5. `explain` Deque and the monotonic-deque idea, previewing sliding window.
6. `check` Undo history in an editor — stack or queue?
- Refs: https://www.w3schools.com/dsa/dsa_data_stacks.php · https://www.w3schools.com/dsa/dsa_data_queues.php · https://www.w3schools.com/cpp/cpp_deque.asp
- Search: "stack queue data structure tutorial", "balanced parentheses stack"

#### `dsa-binary-trees-and-traversal` — Binary Trees and Traversal (45 min)
A tree is the shape of hierarchical data, and its three depth-first traversals
each answer a different question.
1. `explain` Nodes, root, leaves, height, depth, balance.
2. `lab` javascript — build a small binary tree and implement in-order traversal recursively.
3. `explain` Pre-order, in-order, post-order — what each order is good for.
4. `lab` python — implement level-order traversal with a queue.
5. `explain` Array-backed heaps and the index arithmetic that makes them work.
6. `check` Which traversal must you use to delete a tree's nodes safely?
- Refs: https://www.w3schools.com/dsa/dsa_theory_trees.php · https://www.w3schools.com/dsa/dsa_algo_binarytrees_inorder.php · https://www.w3schools.com/dsa/dsa_data_binarytrees_arrayImpl.php
- Search: "binary tree traversal preorder inorder postorder", "level order traversal bfs tree"

#### `dsa-sliding-window-and-prefix-sums` — Sliding Window and Prefix Sums (45 min)
Both techniques replace recomputation with reuse: keep a running value instead of
re-summing a range you have already seen.
1. `explain` Fixed-size window: add the entering element, subtract the leaving one.
2. `lab` javascript — find the maximum sum of any k consecutive numbers in one pass.
3. `explain` Variable-size window: grow while valid, shrink while invalid.
4. `lab` python — find the longest substring with no repeated character.
5. `explain` Prefix sums for O(1) range queries; difference arrays for range updates.
6. `check` Why does a sliding window break if the array can contain negative numbers and the condition is "sum at most k"?
- Refs: https://www.w3schools.com/dsa/dsa_data_arrays.php · https://www.w3schools.com/dsa/dsa_ref_dynamic_programming.php
- Search: "sliding window technique explained", "prefix sum array tutorial"

## Advanced

#### `dsa-bsts-and-balance` — Binary Search Trees and Balance (50 min)
A binary search tree gives O(log n) operations only while it stays balanced, and
what happens when it does not is instructive.
1. `explain` BST invariant; search, insert, delete including the two-child case.
2. `lab` javascript — insert sorted input into an unbalanced BST and measure the resulting height.
3. `explain` Degenerate trees; why sorted insertion is the worst case.
4. `explain` AVL rotations and the height-difference invariant.
5. `lab` python — implement a single right rotation and verify the invariant afterwards.
6. `check` Why is in-order traversal of a BST sorted?
- Refs: https://www.w3schools.com/dsa/dsa_data_binarysearchtrees.php · https://www.w3schools.com/dsa/dsa_data_avltrees.php
- Search: "binary search tree delete two children", "avl tree rotations explained"

#### `dsa-heaps-and-priority-queues` — Heaps and Priority Queues (45 min)
A heap is the cheapest way to keep answering "what is the smallest thing left".
1. `explain` Heap property; array representation; sift-up and sift-down.
2. `lab` javascript — implement a min-heap with push and pop, and assert the property after each.
3. `explain` Heapify in O(n) versus n inserts in O(n log n).
4. `lab` python — solve top-k largest elements with a bounded heap and compare against sorting.
5. `explain` Heap sort, and where priority queues appear inside Dijkstra and Prim.
6. `check` What is the time complexity of finding the minimum in a min-heap, and of removing it?
- Refs: https://www.w3schools.com/dsa/dsa_theory_trees.php · https://docs.python.org/3/library/heapq.html
- Search: "min heap implementation tutorial", "priority queue top k elements"

#### `dsa-graphs-bfs-dfs` — Graphs, BFS and DFS (50 min)
Almost every "is there a path" or "how are these related" question is a graph
question once you name the nodes and edges.
1. `explain` Directed/undirected, weighted/unweighted; adjacency list versus matrix and their space costs.
2. `lab` javascript — build an adjacency list from an edge list and print each node's neighbours.
3. `explain` BFS with a queue: shortest path in an unweighted graph, layer by layer.
4. `lab` python — BFS the shortest number of hops between two nodes.
5. `explain` DFS with recursion or a stack; cycle detection; topological order.
6. `check` Why does BFS give shortest paths on unweighted graphs but not on weighted ones?
- Refs: https://www.w3schools.com/dsa/dsa_theory_graphs.php · https://www.w3schools.com/dsa/dsa_algo_graphs_traversal.php · https://www.w3schools.com/dsa/dsa_algo_graphs_cycledetection.php
- Search: "graph bfs dfs tutorial", "topological sort explained"

#### `dsa-shortest-paths-and-mst` — Shortest Paths and Spanning Trees (50 min)
Dijkstra, Bellman-Ford, Prim and Kruskal are four greedy algorithms whose
correctness arguments are worth understanding rather than memorising.
1. `explain` Dijkstra with a priority queue; the non-negative-weight precondition.
2. `lab` python — run Dijkstra on a small weighted graph and print the settled order.
3. `explain` Bellman-Ford, negative edges, and negative-cycle detection.
4. `explain` Minimum spanning tree; Prim grows one tree, Kruskal merges many.
5. `lab` javascript — implement Kruskal using a union-find structure.
6. `check` Which algorithm do you need if one edge weight is negative?
- Refs: https://www.w3schools.com/dsa/dsa_algo_graphs_dijkstra.php · https://www.w3schools.com/dsa/dsa_algo_graphs_bellmanford.php · https://www.w3schools.com/dsa/dsa_algo_mst_kruskal.php
- Search: "dijkstra algorithm explained", "kruskal vs prim minimum spanning tree"

#### `dsa-dynamic-programming` — Dynamic Programming (55 min)
Dynamic programming is recursion plus memory, and the hard part is naming the
state, not writing the loop.
1. `explain` Overlapping subproblems and optimal substructure as the two tests.
2. `lab` python — memoise recursive Fibonacci and compare call counts before and after.
3. `explain` Top-down memoisation versus bottom-up tabulation; the space-rolling trick.
4. `lab` javascript — solve a coin-change minimum-coins problem bottom-up.
5. `explain` 0/1 knapsack as the canonical two-dimensional state.
6. `check` For "longest increasing subsequence", what exactly does `dp[i]` mean?
- Refs: https://www.w3schools.com/dsa/dsa_ref_dynamic_programming.php · https://www.w3schools.com/dsa/dsa_ref_tabulation.php · https://www.w3schools.com/dsa/dsa_ref_knapsack.php
- Search: "dynamic programming explained memoization tabulation", "coin change dp tutorial"

#### `dsa-greedy-and-union-find` — Greedy Reasoning and Union-Find (45 min)
A greedy algorithm is only correct if you can argue that the locally best choice
never blocks the globally best one.
1. `explain` Greedy choice property; the exchange argument, in plain language.
2. `lab` javascript — solve interval scheduling by earliest finish time and test a counterexample ordering.
3. `explain` Where greedy fails: coin systems without the canonical property.
4. `explain` Union-find with path compression and union by rank.
5. `lab` python — implement union-find and count connected components.
6. `check` Why does sorting intervals by start time give the wrong answer for maximum non-overlapping intervals?
- Refs: https://www.w3schools.com/dsa/dsa_ref_greedy.php · https://www.w3schools.com/dsa/dsa_ref_huffman_coding.php
- Search: "greedy algorithm exchange argument", "union find disjoint set tutorial"

---

# Track 4 — Prompt Engineering (`pe`)

**Track summary.** Prompt engineering is the practice of getting reliable
behaviour out of a language model by being explicit about task, context, format
and evidence — and of measuring whether a change actually helped. This track is
built against Anthropic's own published prompting guidance rather than against
folk technique, and every level ends in evaluation rather than in a list of
tricks. Labs are model-free by design: they run in the browser as JavaScript
exercises over recorded model outputs and rubric scoring, so a student can
practise prompt structure, diffing and evaluation without any API key. That is a
deliberate constraint of the free stack and is stated as a limitation rather than
hidden.

> **Reference note.** W3Schools does have a generative-AI/prompt tutorial at
> `https://www.w3schools.com/gen_ai/index.php`, but its content is organised
> around ChatGPT-3.5, ChatGPT-4 and Bard and is materially out of date for 2026.
> It is listed once, for completeness, on the first beginner module only; every
> other reference in this track is Anthropic's own documentation, which is the
> authoritative and current source.

## Beginner

#### `pe-what-a-prompt-is` — What a Prompt Actually Is (30 min)
A prompt is the entire input the model conditions on — system instructions,
conversation history, retrieved documents and the current request — not just the
last sentence you typed.
1. `explain` The whole-input model: system prompt, message history, current turn.
2. `explain` Why a model has no memory between calls unless you resend it.
3. `lab` javascript — assemble a request object from parts and inspect what the model would actually receive.
4. `explain` Non-determinism: the same prompt can give different wording, and that is expected.
5. `check` If a model "forgot" something from three turns ago, what is the likeliest cause?
6. `explain` What prompt engineering cannot fix: missing information, and the wrong model for the job.
- Refs: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview · https://www.w3schools.com/gen_ai/index.php
- Search: "what is a prompt llm explained", "system prompt vs user prompt"

#### `pe-be-clear-and-direct` — Be Clear and Direct (35 min)
The single highest-return habit is to state the task, the audience and the
success criteria explicitly instead of assuming they are obvious.
1. `explain` Say what you want, for whom, and how you will judge it.
2. `lab` javascript — rewrite three vague prompts into explicit ones and score them against a supplied rubric.
3. `explain` Sequential instructions and numbered steps for multi-part tasks.
4. `explain` Negative instructions are weaker than positive ones; say what to do.
5. `check` "Make this better" — name the three things this prompt fails to specify.
6. `lab` javascript — diff two prompt versions and label each change as clarifying, constraining or formatting.
- Refs: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Search: "clear and direct prompting technique", "prompt specificity examples"

#### `pe-context-and-audience` — Adding Context That Earns Its Tokens (35 min)
Context improves output when it changes a decision the model has to make, and
wastes tokens when it does not.
1. `explain` Task context, audience, constraints, and the reason behind the request.
2. `lab` javascript — build a context block and mark each line as decision-changing or decorative.
3. `explain` Giving the *why*: a stated purpose lets the model resolve ambiguity your way.
4. `explain` Over-context: irrelevant background dilutes the instruction.
5. `check` Which of these five context lines would change the model's output?
6. `lab` javascript — trim a bloated context block to half its length without losing a constraint.
- Refs: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Search: "adding context to prompts", "prompt engineering audience specification"

#### `pe-output-format-control` — Controlling Output Format (35 min)
If a program is going to parse the output, the format must be a requirement, not
a preference.
1. `explain` Prose versus structured output; when each is appropriate.
2. `lab` javascript — write a JSON-shape specification and validate two sample outputs against it.
3. `explain` Schema-constrained output as the reliable mechanism; format instructions as the fallback.
4. `explain` Why assistant-turn prefills are no longer the answer on current models.
5. `check` Your parser crashes on a stray preamble sentence — is the fix in the prompt or the parser? Argue both.
6. `lab` javascript — write a tolerant extractor and then explain why constraining the output is still better.
- Refs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs · https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Search: "structured output json schema llm", "control llm output format"

#### `pe-examples-and-few-shot` — Examples and Few-Shot Prompting (35 min)
One well-chosen example communicates a format faster than a paragraph describing
it, and a badly chosen one teaches the wrong pattern.
1. `explain` Zero-shot, one-shot, few-shot; what examples actually convey.
2. `lab` javascript — add two examples to a classification prompt and score the change on a fixed test set.
3. `explain` Example selection: cover the edge cases, not three copies of the easy case.
4. `explain` Example contamination: the model copies incidental details you did not intend.
5. `check` Every example you supplied is two sentences long. What did you accidentally teach?
6. `lab` javascript — build a balanced example set covering all output labels.
- Refs: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Search: "few shot prompting examples", "multishot prompting tutorial"

#### `pe-iterate-with-evidence` — Iterating with Evidence (40 min)
Prompt engineering without a test set is guessing; the first artefact of a
serious prompt is its evaluation set.
1. `explain` Success criteria before edits; the ten-case test set as a minimum bar.
2. `lab` javascript — build a ten-case test set with expected outputs and a pass/fail scorer.
3. `explain` One change at a time; keeping a change log of prompt versions.
4. `explain` Regression: a fix that improves case 3 and breaks case 7.
5. `check` A prompt change makes one output look better. What do you not yet know?
6. `lab` javascript — score two prompt versions across the whole set and report the delta.
- Refs: https://platform.claude.com/docs/en/test-and-evaluate/develop-tests · https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview
- Search: "llm evaluation test set", "prompt iteration methodology"

## Intermediate

#### `pe-structure-with-tags` — Structuring Prompts with Tags (40 min)
Delimiting sections makes it unambiguous which text is instruction, which is
data, and which is example.
1. `explain` Why unstructured prompts blur instruction and data.
2. `lab` javascript — wrap instructions, document and examples in distinct tagged sections.
3. `explain` Consistent tag names; referring to a tag by name later in the prompt.
4. `explain` Tags as an injection boundary, previewing the advanced trust-boundary module.
5. `check` A user-supplied document contains text that looks like an instruction. Which structural choice reduces the risk?
6. `lab` javascript — restructure a flat 400-word prompt into named sections and re-score it.
- Refs: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Search: "xml tags prompt structure", "delimiting instructions and data in prompts"

#### `pe-roles-and-system-prompts` — Roles and System Prompts (40 min)
The system prompt is where durable behaviour lives; the user turn is where the
task lives, and mixing them makes both harder to change.
1. `explain` What belongs in a system prompt: role, standing constraints, tone, tool policy.
2. `lab` javascript — split a monolithic prompt into system and user parts and justify each line's placement.
3. `explain` Role prompting: what it changes and what it does not.
4. `explain` Operator instructions arriving mid-conversation, and why editing the system prompt later is costly.
5. `check` "Always answer in metric units" — system prompt or user turn?
6. `lab` javascript — write a system prompt under 150 words that encodes five standing rules.
- Refs: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices · https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Search: "system prompt design best practices", "role prompting llm"

#### `pe-reasoning-and-thinking` — Reasoning and Thinking (45 min)
Asking for reasoning helps on genuinely multi-step problems and hurts on simple
ones by adding latency and verbosity.
1. `explain` Why step-by-step reasoning improves multi-step accuracy.
2. `explain` Model-side thinking versus asking for reasoning in the visible answer.
3. `lab` javascript — compare recorded outputs with and without a reasoning request on ten arithmetic-plus-logic cases.
4. `explain` Effort as a dial: more reasoning is not monotonically better.
5. `check` A one-line factual lookup that takes 40 seconds — what would you change?
6. `explain` Overthinking and excessive exploration as real failure modes with real cost.
- Refs: https://platform.claude.com/docs/en/build-with-claude/thinking · https://platform.claude.com/docs/en/build-with-claude/effort
- Search: "chain of thought prompting explained", "extended thinking effort llm"

#### `pe-prompt-chaining` — Prompt Chaining and Decomposition (40 min)
Splitting one hard prompt into several checked steps trades tokens for
inspectability.
1. `explain` One prompt per subtask; passing a validated intermediate forward.
2. `lab` javascript — implement a three-stage extract → validate → summarise chain over fixture data.
3. `explain` Where to put the check: after every stage, or only at the boundary.
4. `explain` Chain cost: more calls, more latency, more failure points.
5. `check` One stage of your chain fails validation. What should the pipeline do, and what should it not do?
6. `lab` javascript — add a retry-once-then-escalate policy to the chain.
- Refs: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Search: "prompt chaining tutorial", "task decomposition llm pipeline"

#### `pe-long-context-placement` — Long Context and Placement (40 min)
Where you put a document relative to your instruction changes the result, and
long inputs need explicit navigation.
1. `explain` Long-context behaviour; document-then-question ordering.
2. `lab` javascript — reorder a long prompt three ways and score retrieval accuracy on fixtures.
3. `explain` Quoting first: asking for the supporting extract before the answer.
4. `explain` Caching-friendly layout: stable content first, volatile content last.
5. `check` Your prompt puts a 30-page document after the question. What would you try first?
6. `lab` javascript — restructure a prompt so its stable prefix is byte-identical across requests.
- Refs: https://platform.claude.com/docs/en/build-with-claude/context-windows · https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Search: "long context prompting tips", "prompt caching prefix stability"

#### `pe-evaluation-and-rubrics` — Evaluation and Rubrics (45 min)
A rubric turns "is it good" into a set of independently checkable claims, which
is what makes automated grading possible at all.
1. `explain` Criterion-level grading; why "the report looks good" cannot be scored.
2. `lab` javascript — write a five-criterion rubric and grade three fixture outputs against it.
3. `explain` Exact-match, structural and judged criteria; which to prefer and when.
4. `explain` Using a model as a grader, and the bias that introduces.
5. `check` Rewrite "the summary should be accurate" as two checkable criteria.
6. `lab` javascript — compute per-criterion pass rates and identify the weakest criterion.
- Refs: https://platform.claude.com/docs/en/test-and-evaluate/develop-tests
- Search: "llm evaluation rubric design", "llm as judge evaluation"

## Advanced

#### `pe-tool-use-prompting` — Prompting for Tool Use (45 min)
When a model can call tools, most behaviour problems are tool-description
problems.
1. `explain` Tool name, description and schema as prompt surface.
2. `explain` Prescriptive descriptions: state *when* to call, not only what it does.
3. `lab` javascript — rewrite three tool descriptions to include trigger conditions and score call accuracy on fixtures.
4. `explain` Under-calling and over-calling; parallel calls and why results must return together.
5. `check` A search tool is never called even though the answer needs fresh data. Name two fixes.
6. `lab` javascript — add a search-first policy line and re-measure the should-call rate.
- Refs: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview · https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Search: "tool description prompt engineering", "llm tool use triggering"

#### `pe-agentic-prompting` — Agentic Prompting and Autonomy (50 min)
An agent prompt has to say what to do without supervision, how much to ask, and
when to stop.
1. `explain` Autonomy dials: decide-and-note versus ask-first, per action class.
2. `lab` javascript — write an autonomy policy block and classify twelve actions against it.
3. `explain` Scope discipline: deliver what was asked, at the scope intended.
4. `explain` Progress reporting and the "audit each claim against evidence" rule.
5. `check` An agent reports a task complete but the tests were never run. Which prompt clause was missing?
6. `lab` javascript — add a completion-criteria clause and re-grade fixture transcripts.
- Refs: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices · https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Search: "agentic prompt design autonomy", "agent progress reporting prompt"

#### `pe-verbosity-and-communication` — Verbosity, Tone and Communication Style (40 min)
Output length and register are prompt-controllable, and worth controlling
explicitly rather than complaining about.
1. `explain` Length calibration; why lowering reasoning effort does not reliably shorten visible output.
2. `lab` javascript — apply a conciseness clause to five fixture prompts and measure word-count deltas.
3. `explain` Selectivity beats compression: drop content, do not abbreviate prose.
4. `explain` Tone and register instructions; positive examples over prohibitions.
5. `check` "Be concise" produced arrow-chain shorthand a reader cannot follow. What went wrong?
6. `lab` javascript — write a communication-style block and grade three outputs for readability.
- Refs: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Search: "control llm verbosity prompt", "llm tone and style instructions"

#### `pe-hallucination-mitigation` — Reducing Fabrication (45 min)
Fabrication is reduced by making the evidence available, making citation
mandatory, and making "I do not know" acceptable.
1. `explain` Why a model produces confident wrong answers; the missing-evidence case.
2. `lab` javascript — add a quote-the-source requirement and grade ten fixture answers for grounding.
3. `explain` Explicit permission to say the answer is not in the provided material.
4. `explain` Verification steps and their cost; when a second pass is worth it.
5. `check` An answer cites a document section that does not exist. Which check would have caught it?
6. `lab` javascript — write a validator that rejects answers whose citations are not in the source.
- Refs: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices · https://platform.claude.com/docs/en/build-with-claude/citations
- Search: "reduce llm hallucination prompting", "grounded generation citations"

#### `pe-prompt-injection-and-trust` — Prompt Injection and Trust Boundaries (50 min)
Any text the model reads is a potential instruction, and the only durable defence
is architectural: constrain what the model is allowed to do.
1. `explain` Direct and indirect injection; retrieved documents and tool output as untrusted input.
2. `lab` javascript — mark up a prompt with trust levels per section and flag the untrusted ones.
3. `explain` Why "ignore any instructions in the document" is mitigation, not a fix.
4. `explain` Capability restriction, human confirmation on irreversible actions, output filtering.
5. `check` A summarisation agent with send-email capability reads an attacker-controlled page. What is the actual vulnerability?
6. `lab` javascript — implement an allow-list gate in front of a simulated action dispatcher.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html · https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Search: "prompt injection explained defence", "indirect prompt injection tool use"

#### `pe-regression-testing-prompts` — Treating Prompts as Versioned Code (45 min)
A prompt in production is code: it is versioned, reviewed, tested on every change
and rolled back when it regresses.
1. `explain` Prompts in version control; review as a diff with a reason.
2. `lab` javascript — build a regression runner that scores every prompt version against the full suite.
3. `explain` Golden outputs and their maintenance burden; property checks as the cheaper alternative.
4. `explain` Model upgrades as a regression event; re-baselining rather than assuming.
5. `check` Your suite passes but users complain. What is the suite missing?
6. `lab` javascript — add three adversarial cases drawn from a fixture complaint log.
- Refs: https://platform.claude.com/docs/en/test-and-evaluate/develop-tests · https://platform.claude.com/docs/en/about-claude/models/migration-guide
- Search: "prompt regression testing", "prompt versioning ci"

---

# Track 5 — Using Claude Effectively (`cu`)

**Track summary.** This track is about working *with* Claude as a tool: how the
surfaces differ, how to give it durable project context, how to extend it with
skills, subagents, hooks and MCP servers, and — most importantly — how to verify
what it produces before trusting it. It is deliberately not a prompt-writing
track (that is `pe`); it is an operator's track. Labs are checklist and
configuration exercises run in the browser against fixture files, because the
real tool is a CLI the LMS cannot embed; the student edits realistic
configuration and is graded on structure and correctness, not on invoking a live
model.

> **Reference note.** Claude Code's documentation moves quickly. Every URL below
> was resolvable on 2026-07-30 under `https://code.claude.com/docs/en/…`. That
> site publishes a machine-readable index at
> `https://code.claude.com/docs/llms.txt`; the seeding agent should re-check any
> link against that index before writing it into seed data, rather than trusting
> this file's snapshot.

## Beginner

#### `cu-surfaces-and-when-to-use-them` — The Surfaces and When to Use Them (30 min)
Claude runs in a terminal, an IDE, a desktop app and a browser, and the choice
changes what it can see and do, not how well it reasons.
1. `explain` Terminal CLI, IDE extension, desktop app, web; what each has access to.
2. `explain` The same engine everywhere: shared project instructions and settings.
3. `lab` javascript — match six task descriptions to the surface best suited to each and justify one.
4. `explain` When *not* to reach for an agentic tool: a one-line question, or something you must own line by line.
5. `check` A long-running task you want to check on from a phone — which surface?
6. `explain` Subscription and account requirements at a high level.
- Refs: https://code.claude.com/docs/en/overview · https://code.claude.com/docs/en/quickstart
- Search: "claude code getting started", "claude code terminal vs ide"

#### `cu-first-session` — Your First Session (35 min)
The first useful habit is to have Claude explore and explain before it edits.
1. `explain` Starting in a project directory; what the tool reads first.
2. `explain` Explore → plan → change → verify as the default loop.
3. `lab` javascript — order eight session steps into that loop and mark the two that must not be skipped.
4. `explain` Asking for a plan before an edit; reviewing the plan as the cheap checkpoint.
5. `check` Which is cheaper to fix: a wrong plan, or a wrong 400-line diff?
6. `explain` Reading the diff yourself is not optional.
- Refs: https://code.claude.com/docs/en/quickstart · https://code.claude.com/docs/en/common-workflows
- Search: "claude code first session walkthrough", "plan mode before editing"

#### `cu-project-context` — Giving It Project Context (35 min)
Most disappointing output is missing-context output, and project context is the
cheapest thing to fix.
1. `explain` Project instruction files: coding standards, architecture decisions, preferred libraries.
2. `lab` javascript — write a 20-line project instruction file for this LMS from a supplied fact sheet.
3. `explain` What belongs there versus what belongs in the request.
4. `explain` Automatically accumulated memory, and why you should still read it.
5. `check` "Always use metric units" — project instructions or per-request?
6. `explain` Stale instructions are worse than none.
- Refs: https://code.claude.com/docs/en/memory · https://code.claude.com/docs/en/best-practices
- Search: "claude md project instructions", "claude code memory file"

#### `cu-verifying-output` — Verifying What It Produced (40 min)
The single most valuable operator skill is a verification routine you run every
time, regardless of how confident the output sounds.
1. `explain` Read the diff, run the tests, run the app; in that order.
2. `lab` javascript — review a supplied diff and identify the change that is not covered by any test.
3. `explain` Claims versus evidence: "tests pass" means you saw them pass.
4. `explain` Scope creep in a diff: unrequested refactors and how to spot them.
5. `check` A summary says a bug is fixed but no test changed. What do you do?
6. `explain` Reverting cleanly is a skill, not a failure.
- Refs: https://code.claude.com/docs/en/best-practices · https://code.claude.com/docs/en/common-workflows
- Search: "reviewing ai generated code", "verifying agent output checklist"

#### `cu-git-workflow` — Working Through Git (35 min)
Version control is what makes agentic editing safe: every change is reviewable
and every mistake is revertible.
1. `explain` Branch first, small commits, readable messages; never work directly on the default branch.
2. `lab` javascript — order a set of git operations into a safe agent-assisted workflow.
3. `explain` Reviewing an agent's commit as you would a colleague's pull request.
4. `explain` Why a clean working tree before you start is worth ten minutes.
5. `check` An agent made 30 edits across 12 files and you dislike three of them. What is your recovery path?
6. `explain` Hooks and CI as the automated half of review, previewing the intermediate level.
- Refs: https://code.claude.com/docs/en/common-workflows · https://code.claude.com/docs/en/cli-reference
- Search: "git workflow with ai coding agent", "reviewing agent commits"

#### `cu-permissions-and-safety` — Permissions and Safety Basics (35 min)
An agentic tool asks before doing dangerous things because the blast radius of a
wrong command is real.
1. `explain` The permission prompt as a security boundary, not an annoyance.
2. `explain` Allow-lists for routine read-only commands; why auto-approving writes is different.
3. `lab` javascript — classify twelve commands as safe-to-allow, ask-every-time, or never.
4. `explain` Sandboxing and isolated worktrees for risky work.
5. `check` `rm -rf` inside a repository with uncommitted work — which category, and why?
6. `explain` Secrets: never paste a credential into a prompt or an instruction file.
- Refs: https://code.claude.com/docs/en/settings · https://code.claude.com/docs/en/overview
- Search: "claude code permissions settings", "agent tool safety allowlist"

## Intermediate

#### `cu-slash-commands-and-skills` — Slash Commands and Skills (45 min)
A skill is a repeatable workflow written down once so the whole team runs it the
same way.
1. `explain` Built-in commands versus your own; what makes a workflow worth packaging.
2. `explain` Skill anatomy: a name, a description that decides when it loads, and the body.
3. `lab` javascript — write a skill definition for "review a pull request against our checklist" from a fixture checklist.
4. `explain` Description quality decides whether a skill ever triggers.
5. `check` Two skills both plausibly match a request. What determines which loads?
6. `lab` javascript — critique three skill descriptions and rewrite the weakest.
- Refs: https://code.claude.com/docs/en/skills · https://code.claude.com/docs/en/features-overview
- Search: "claude code skills tutorial", "custom slash command claude code"

#### `cu-subagents` — Subagents and Delegation (45 min)
Delegation isolates verbose work in its own context; it also multiplies cost, so
it is a judgement call.
1. `explain` What a subagent is: separate context, its own tools, a reported result.
2. `explain` Good fits — wide independent searches, parallel tracks — and bad fits.
3. `lab` javascript — decide delegate-or-not for ten tasks and give a one-line reason each.
4. `explain` Briefing precisely the first time; not re-deriving a subagent's findings.
5. `check` Three file reads and two edits — delegate or do it directly?
6. `explain` Concurrency limits and the coordination overhead nobody budgets for.
- Refs: https://code.claude.com/docs/en/sub-agents · https://code.claude.com/docs/en/workflows
- Search: "claude code subagents explained", "when to delegate to subagents"

#### `cu-hooks` — Hooks: Deterministic Automation (45 min)
Hooks are the part of the system that is not model-dependent: shell commands that
fire at defined lifecycle points, every time.
1. `explain` Lifecycle points; why a hook is deterministic where a prompt is not.
2. `lab` javascript — write a hook configuration that formats a file after every edit.
3. `explain` Pre-action hooks as a policy gate; blocking rather than warning.
4. `explain` Hook failures: fail loudly, and never leave a half-applied state.
5. `check` "Run lint before every commit" — prompt instruction or hook? Why?
6. `lab` javascript — add a pre-action hook that refuses edits to a frozen directory.
- Refs: https://code.claude.com/docs/en/hooks · https://code.claude.com/docs/en/settings
- Search: "claude code hooks tutorial", "pretooluse hook policy gate"

#### `cu-mcp-servers` — MCP Servers and External Tools (45 min)
The Model Context Protocol is how an agent reaches systems it was not built to
know about.
1. `explain` MCP in one paragraph: a standard interface between an agent and an external tool or data source.
2. `explain` Server, tool, credential; where each lives.
3. `lab` javascript — write an MCP server configuration entry from a supplied service description.
4. `explain` Credentials never belong in a prompt; they belong in the configured credential store.
5. `check` An MCP tool silently returns nothing. Name three things to check.
6. `explain` Trust: an MCP server's output is untrusted input to the model.
- Refs: https://code.claude.com/docs/en/mcp · https://code.claude.com/docs/en/mcp-quickstart
- Search: "model context protocol explained", "claude code mcp server setup"

#### `cu-settings-and-team-conventions` — Settings and Team Conventions (40 min)
Shared settings are how a team stops re-deciding the same thing in every session.
1. `explain` Settings scopes: user, project, local; which wins.
2. `lab` javascript — place five settings at the right scope and explain one placement.
3. `explain` What should be committed to the repository and what must not be.
4. `explain` Onboarding a new team member through project configuration rather than tribal knowledge.
5. `check` A personal API preference committed to the shared project settings — what breaks?
6. `explain` Reviewing configuration changes as carefully as code changes.
- Refs: https://code.claude.com/docs/en/settings · https://code.claude.com/docs/en/best-practices
- Search: "claude code settings json scopes", "team conventions ai coding tools"

#### `cu-model-selection-and-effort` — Choosing a Model and an Effort Level (45 min)
Model and effort are the two dials that most change cost, latency and quality,
and both are worth measuring rather than guessing.
1. `explain` The current model line: `claude-opus-5` and `claude-fable-5` for the hardest work, `claude-sonnet-5` for balanced work, `claude-haiku-4-5` for fast, simple, cheap work.
2. `explain` Effort levels from `low` to `max`; higher effort often means fewer total turns, not simply more tokens.
3. `lab` javascript — match eight workloads to a model and effort level and justify two.
4. `explain` Why "always use the cheapest model" is a false economy on hard tasks, and "always use the most capable" is a false economy on easy ones.
5. `check` A classification job over 50,000 short records — which model, which effort?
6. `explain` Re-baseline after any model change; never assume a prior tuning transfers.
- Refs: https://platform.claude.com/docs/en/about-claude/models/overview · https://platform.claude.com/docs/en/build-with-claude/effort
- Search: "claude model selection guide", "effort parameter cost quality tradeoff"

## Advanced

#### `cu-agent-sdk-overview` — The Agent SDK in Outline (45 min)
The Agent SDK is the coding harness packaged as a library, for when you want the
loop and the built-in tools but your own product around them.
1. `explain` Harness versus deployment: the SDK gives you the harness, you host it.
2. `explain` Built-in tools, permissions, subagents, sessions — what you get out of the box.
3. `lab` javascript — sketch the option object for an agent restricted to read-only tools.
4. `explain` How this differs from calling the Messages API with your own tools.
5. `check` You want a hosted agent with a managed sandbox. Is the Agent SDK the right layer?
6. `explain` When not to build an agent at all — a single call or a fixed workflow is often correct.
- Refs: https://code.claude.com/docs/en/agent-sdk/overview · https://code.claude.com/docs/en/overview
- Search: "claude agent sdk overview", "agent harness vs api tool use"

#### `cu-ci-automation` — Automating Review in CI (45 min)
Putting an agent in the pipeline turns a habit into a guarantee.
1. `explain` CI-triggered review and triage; the non-interactive invocation shape.
2. `lab` javascript — write a workflow definition that runs a review on every pull request.
3. `explain` Least privilege for CI credentials; why a review job should not have write access to production.
4. `explain` Signal versus noise: a reviewer that comments on everything gets muted.
5. `check` The CI reviewer flags 40 style nits per PR. What do you change — the prompt, the threshold, or both?
6. `explain` Failing the build versus leaving a comment: choose deliberately.
- Refs: https://code.claude.com/docs/en/github-actions · https://code.claude.com/docs/en/code-review
- Search: "claude code github actions review", "ai code review in ci pipeline"

#### `cu-scheduled-and-background-work` — Scheduled and Background Work (40 min)
Recurring work is where automation compounds, and where unattended failure modes
appear.
1. `explain` Scheduled runs versus in-session loops versus background agents.
2. `lab` javascript — write a schedule specification for a nightly dependency audit.
3. `explain` Unattended runs need explicit completion criteria and a place to report.
4. `explain` Idempotence: a job that runs twice must not do damage twice.
5. `check` A nightly job silently failed for six days. What was missing?
6. `explain` Cost control on recurring jobs.
- Refs: https://code.claude.com/docs/en/routines · https://code.claude.com/docs/en/scheduled-tasks
- Search: "claude code scheduled routines", "unattended agent job monitoring"

#### `cu-context-and-token-discipline` — Context and Token Discipline (45 min)
Long sessions degrade for mechanical reasons, and the fixes are mechanical too.
1. `explain` What fills a context window: file reads, tool output, transcript.
2. `explain` Compaction and context pruning; what each keeps and what each drops.
3. `lab` javascript — given a fixture transcript, mark which content is safe to drop and which is load-bearing.
4. `explain` Narrow reads over whole-file reads; targeted search over broad exploration.
5. `check` An agent re-reads the same 2,000-line file five times. What is the fix?
6. `explain` Session hygiene: start fresh for a new task rather than accreting.
- Refs: https://platform.claude.com/docs/en/build-with-claude/context-windows · https://platform.claude.com/docs/en/build-with-claude/compaction
- Search: "context window management agent", "reduce token usage coding agent"

#### `cu-multi-agent-workflows` — Multi-Agent Workflows (45 min)
Running several agents is a coordination problem before it is a capability
problem.
1. `explain` Coordinator and workers; shared filesystem, separate contexts.
2. `lab` javascript — design a three-agent split for a documentation migration and name the merge point.
3. `explain` Write conflicts and how to avoid them by partitioning ownership up front.
4. `explain` One level of delegation; why nesting coordinators goes wrong.
5. `check` Two agents both edit the same file. What did the design get wrong?
6. `explain` Cost and latency accounting for a fan-out.
- Refs: https://code.claude.com/docs/en/workflows · https://code.claude.com/docs/en/agent-view
- Search: "multi agent coding workflow", "agent fan out coordination"

#### `cu-adoption-and-review-culture` — Adoption and Review Culture (40 min)
The organisational half of the problem: what a team agrees to before it lets an
agent touch production code.
1. `explain` What must always be human-reviewed; what may be automated.
2. `lab` javascript — draft a six-clause team policy from a fixture risk list.
3. `explain` Attribution and audit trail: commits, PR descriptions, change logs.
4. `explain` Skill and instruction ownership; who maintains them and how often they are reviewed.
5. `check` An agent-authored migration reached production unreviewed. Which policy clause was missing?
6. `explain` Measuring benefit honestly: cycle time and defect rate, not lines produced.
- Refs: https://code.claude.com/docs/en/best-practices · https://code.claude.com/docs/en/settings
- Search: "ai coding tool adoption policy", "code review policy ai generated code"

---

# Track 6 — Building Applications with LLMs (`llm`)

**Track summary.** This track is the engineering counterpart to `pe`: how to put
a language model behind an API in a real application and keep it correct, cheap
and observable. It covers the shape of a request, structured output, the tool-use
loop, caching and batching, retrieval, evaluation, and the failure handling that
separates a demo from a product. Labs run entirely in the browser against
recorded fixture responses and a small mock client, so students build real
request/response handling, retry logic, tool loops and evaluation harnesses
without any API key — which is a hard requirement of this project's free stack.

> **Honest limitation to record in the seed data.** Because there is no funded
> API key in this stack, no lab in this track calls a live model. Students build
> and test the surrounding engineering against fixtures. The prose says so
> explicitly, and the advanced level ends with a checklist for the first real
> call rather than pretending one happened.

## Beginner

#### `llm-anatomy-of-a-request` — Anatomy of an API Call (35 min)
Every call to a chat model is the same handful of fields, and knowing which are
required removes most first-day confusion.
1. `explain` Model id, max output tokens, messages, optional system instructions.
2. `lab` javascript — build a request object against a mock client and inspect the serialised body.
3. `explain` The response shape: content blocks, stop reason, usage.
4. `explain` Statelessness: the server keeps nothing, you resend history.
5. `check` Which field tells you the model stopped because it hit the output cap?
6. `lab` javascript — read three fixture responses and report each stop reason.
- Refs: https://platform.claude.com/docs/en/build-with-claude/context-windows · https://platform.claude.com/docs/en/api/errors
- Search: "messages api request structure", "llm api response content blocks"

#### `llm-messages-and-roles` — Messages, Roles and History (35 min)
The message array is your conversation state, and its ordering rules are strict.
1. `explain` User and assistant turns; system instructions as a separate field.
2. `lab` javascript — implement an append-only history store and replay it into a request.
3. `explain` First turn must be a user turn; content blocks versus plain strings.
4. `explain` Trimming history: what to drop first and why never mid-tool-pair.
5. `check` Your history ends with an assistant turn and the next call errors. What is wrong?
6. `lab` javascript — write a validator that rejects a malformed history.
- Refs: https://platform.claude.com/docs/en/build-with-claude/context-windows
- Search: "conversation history llm api", "message roles user assistant system"

#### `llm-tokens-and-limits` — Tokens, Limits and Counting (35 min)
Tokens are the unit of cost and of the context window, and estimating them with
another vendor's tokenizer is simply wrong.
1. `explain` What a token is; why counts differ by content type and by model.
2. `explain` Input tokens, output tokens, the context window, the output cap.
3. `lab` javascript — call a mock token-count endpoint over five inputs and rank them by cost.
4. `explain` Why you must count with the same model you will call.
5. `check` A prompt fits the context window but the answer truncates. Which limit did you hit?
6. `explain` Budgeting: a per-request ceiling and a per-user ceiling are different controls.
- Refs: https://platform.claude.com/docs/en/build-with-claude/token-counting · https://platform.claude.com/docs/en/pricing
- Search: "count tokens api", "context window vs max tokens"

#### `llm-streaming-basics` — Streaming (35 min)
Streaming is a latency and a timeout strategy, not a feature; long outputs need
it.
1. `explain` Event stream shape: start, deltas, stop; accumulating text safely.
2. `lab` javascript — consume a fixture event stream and render partial text as it arrives.
3. `explain` Why large output caps require streaming to avoid HTTP timeouts.
4. `explain` Getting the final complete message after streaming, rather than reassembling by hand.
5. `check` Your stream ends mid-sentence with no error. What do you check first?
6. `lab` javascript — handle an interrupted stream without leaving the UI in a half state.
- Refs: https://platform.claude.com/docs/en/build-with-claude/streaming
- Search: "llm streaming sse tutorial", "streaming partial response ui"

#### `llm-errors-and-retries` — Errors, Rate Limits and Retries (40 min)
The difference between a demo and a product is mostly what happens on the
unhappy path.
1. `explain` Status classes: bad request, auth, rate limit, server error, overload.
2. `explain` Retryable versus not; exponential backoff with jitter; honouring a retry-after header.
3. `lab` javascript — implement a retry wrapper over a mock client that fails with a rate limit twice.
4. `explain` Never throwing at the caller in a grading path — every failure is a value with a reason.
5. `check` A 400 retried five times — what did that accomplish?
6. `lab` javascript — return a discriminated failure result instead of throwing, and test each branch.
- Refs: https://platform.claude.com/docs/en/api/errors · https://platform.claude.com/docs/en/api/rate-limits
- Search: "api retry exponential backoff jitter", "rate limit 429 handling"

#### `llm-classification-and-extraction` — Classification and Extraction (40 min)
The highest-value first LLM feature is almost always turning messy text into a
small, typed value.
1. `explain` Single-call tasks: classify, extract, summarise, rewrite.
2. `lab` javascript — build a classifier over fixture support tickets with a fixed label set and score accuracy.
3. `explain` Closed label sets and why a free-text label breaks your database.
4. `explain` Confidence and abstention: an "unknown" label is a feature.
5. `check` The model invents a nineteenth label. Which design choice would have prevented it?
6. `lab` javascript — add an unknown-label path and re-score.
- Refs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Search: "llm text classification api", "structured extraction from text llm"

## Intermediate

#### `llm-structured-outputs` — Structured Outputs (45 min)
If a program consumes the output, constrain the output — do not parse hopefully.
1. `explain` Schema-constrained responses versus format instructions; which guarantees what.
2. `lab` javascript — define a JSON schema and validate fixture responses against it, failing loudly.
3. `explain` Schema limits: what a constrained schema can and cannot express.
4. `explain` Strict tool schemas as the same idea applied to tool arguments.
5. `check` The schema allows a field the database rejects. Where do you enforce it?
6. `lab` javascript — add client-side validation for a constraint the schema cannot express.
- Refs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Search: "json schema structured output llm", "strict tool use schema"

#### `llm-tool-use-loop` — The Tool-Use Loop (50 min)
Tool use is a loop with strict pairing rules, and most bugs are pairing bugs.
1. `explain` The cycle: model requests a tool, you execute, you return a result, repeat until done.
2. `lab` javascript — implement the loop against a mock client and two fixture tools.
3. `explain` Parallel tool calls: execute concurrently, return all results in one turn.
4. `explain` Errors as tool results with an error flag, never as dropped results.
5. `check` You split two tool results across two turns. What behaviour degrades?
6. `lab` javascript — add a max-iteration bound and a clean termination report.
- Refs: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Search: "tool use agentic loop implementation", "parallel tool calls handling"

#### `llm-prompt-caching` — Prompt Caching (45 min)
Caching is a prefix match, so the whole design question is what you put first.
1. `explain` Prefix matching; render order; why one changed byte invalidates everything after it.
2. `lab` javascript — reorder a prompt so its stable prefix is byte-identical and verify with a mock cache reporter.
3. `explain` Silent invalidators: timestamps, unsorted serialisation, per-user ids in the system prompt.
4. `explain` Reading cache creation and cache read counts to confirm it works.
5. `check` Cache reads are always zero across identical requests. Name three suspects.
6. `lab` javascript — audit a fixture prompt builder and remove the invalidator.
- Refs: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Search: "prompt caching prefix invalidation", "cache read input tokens"

#### `llm-batching-and-cost` — Batching and Cost Control (40 min)
Latency-insensitive work should never be paid for at interactive prices.
1. `explain` Batch submission, polling, results keyed by your own identifier.
2. `lab` javascript — build a batch submitter over a mock endpoint and reconcile out-of-order results by id.
3. `explain` Why results arrive in any order and keying by position is a bug.
4. `explain` Cost model: input versus output pricing, cached reads, batch discount.
5. `check` A nightly enrichment job running through the interactive path — what would you change?
6. `lab` javascript — compute the projected monthly cost of two designs from fixture usage data.
- Refs: https://platform.claude.com/docs/en/build-with-claude/batch-processing · https://platform.claude.com/docs/en/pricing
- Search: "message batches api tutorial", "llm cost optimization strategies"

#### `llm-retrieval-basics` — Retrieval and Grounding (50 min)
Retrieval-augmented generation is a search problem wearing an LLM hat, and the
search half is usually where it fails.
1. `explain` Chunking, indexing, retrieving, and putting the evidence in the prompt.
2. `lab` javascript — implement keyword retrieval over a fixture corpus and measure recall at 5.
3. `explain` Why bad retrieval cannot be fixed by better prompting.
4. `explain` Citations: requiring the model to point at the chunk it used.
5. `check` The right document exists but was never retrieved. Which half of the system do you fix?
6. `lab` javascript — add a citation validator that rejects answers citing absent chunks.
- Refs: https://platform.claude.com/docs/en/build-with-claude/citations · https://platform.claude.com/docs/en/build-with-claude/files
- Search: "rag retrieval augmented generation tutorial", "chunking strategy rag"

#### `llm-evaluation-harness` — An Evaluation Harness (45 min)
You cannot ship an LLM feature you cannot measure, and the harness is cheaper to
build early.
1. `explain` Test set, scorer, report; deterministic checks before judged ones.
2. `lab` javascript — build a runner that scores fixture cases and prints per-criterion pass rates.
3. `explain` Model-as-judge and its biases; when a human sample is required.
4. `explain` Tracking cost and latency alongside quality, in the same report.
5. `check` Quality is up 4% and cost is up 300%. Did the change succeed?
6. `lab` javascript — add cost and latency columns to the report and re-rank two variants.
- Refs: https://platform.claude.com/docs/en/test-and-evaluate/develop-tests
- Search: "llm evaluation harness build", "offline eval llm feature"

## Advanced

#### `llm-agent-loop-design` — Designing an Agent Loop (50 min)
Before building an agent, decide whether the task actually needs one; most do
not.
1. `explain` Single call, workflow, agent: three tiers and the cost of each.
2. `explain` The four questions — complexity, value, viability, cost of error.
3. `lab` javascript — classify eight features into the right tier with a one-line justification each.
4. `explain` Tool surface design: broad tools for reach, dedicated tools for gating and rendering.
5. `check` A fixed three-step pipeline built as a free-running agent — what did that cost you?
6. `lab` javascript — convert an over-built agent fixture into a deterministic workflow.
- Refs: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Search: "should i build an agent llm", "agent vs workflow architecture"

#### `llm-context-management` — Context Management in Long Runs (45 min)
Long-running sessions need an explicit plan for what leaves the context and how.
1. `explain` Compaction (summarise) versus context editing (prune); what each preserves.
2. `lab` javascript — implement a pruning policy over a fixture transcript and assert nothing load-bearing is dropped.
3. `explain` Preserving server-supplied state blocks exactly as received.
4. `explain` Cross-session persistence: writing durable notes rather than relying on history.
5. `check` You extracted only the text from each response and appended that. What broke?
6. `lab` javascript — write a round-trip test proving your history store preserves block structure.
- Refs: https://platform.claude.com/docs/en/build-with-claude/compaction · https://platform.claude.com/docs/en/build-with-claude/context-editing
- Search: "context compaction long conversation", "context editing clear tool results"

#### `llm-multi-agent-patterns` — Multi-Agent Patterns (45 min)
Fan-out is a real speed-up and a real cost multiplier; the shape of the
coordination decides which dominates.
1. `explain` Coordinator/worker, writer/verifier, and pipeline shapes.
2. `lab` javascript — implement a coordinator over three mock workers and merge their results deterministically.
3. `explain` Independent work only; shared mutable state is where fan-out fails.
4. `explain` One level of delegation; capping concurrency deliberately.
5. `check` Two workers produced contradictory answers. Whose job is it to resolve that?
6. `lab` javascript — add a verifier stage that rejects a merged result failing a stated invariant.
- Refs: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Search: "multi agent llm orchestration patterns", "writer verifier pattern llm"

#### `llm-guardrails-and-refusals` — Guardrails, Refusals and Degradation (45 min)
A production feature must behave sensibly when the model declines, the backend is
down, or the rate limit bites.
1. `explain` Refusal as a normal outcome to branch on, not an exception to swallow.
2. `lab` javascript — handle a fixture refusal response without indexing into empty content.
3. `explain` Graceful degradation: a fallback path, a queued retry, or an honest error — never a silently wrong result.
4. `explain` Why a rate-limited grading call must be deferred to a human rather than scored zero, as this repo's exam design requires.
5. `check` Your code reads the first content block unconditionally. On which response does it crash?
6. `lab` javascript — implement the defer-to-human branch and test all four failure reasons.
- Refs: https://platform.claude.com/docs/en/api/errors · https://platform.claude.com/docs/en/about-claude/models/migration-guide
- Search: "handle llm refusal stop reason", "graceful degradation llm feature"

#### `llm-security-for-llm-apps` — Security for LLM Applications (50 min)
An LLM feature adds an untrusted-input surface and, if it has tools, an
untrusted-action surface.
1. `explain` Trust boundaries: user input, retrieved documents, tool output — all untrusted.
2. `explain` Output handling: never render model output as HTML without encoding, never execute it.
3. `lab` javascript — sanitise a fixture model response before inserting it into a page and prove the injected script does not run.
4. `explain` Capability restriction, confirmation on irreversible actions, and audit logging.
5. `explain` Secrets never enter a prompt, a message history or a memory file.
6. `check` A summariser with email-send capability reads attacker-controlled text. Where is the vulnerability, and what removes it?
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- Search: "llm application security owasp", "prompt injection tool capability restriction"

#### `llm-productionising-a-feature` — Productionising an LLM Feature (50 min)
The last mile: observability, rollout, cost ceilings, and a checklist for the
first real call.
1. `explain` What to log — request id, model, usage, latency, outcome — and what never to log.
2. `lab` javascript — implement a structured logger over the mock client and produce a usage report.
3. `explain` Progressive rollout, kill switch, and per-tenant quotas.
4. `explain` Model upgrades as a regression event; pinning and re-baselining.
5. `check` Costs tripled overnight with no code change. Which three logs tell you why?
6. `explain` The first-real-call checklist: key handling, spend cap, timeout, retry policy, evaluation gate.
- Refs: https://platform.claude.com/docs/en/api/rate-limits · https://platform.claude.com/docs/en/about-claude/models/migration-guide
- Search: "llm observability logging production", "llm feature rollout kill switch"

---

# Track 7 — Applied Cryptography (`crypto`)

**Track summary.** This track teaches the correct use of cryptographic
primitives and — just as importantly — the specific ways correct primitives are
misused: ECB mode leaking structure, an IV reused across messages, a comparison
that leaks a secret through its timing, a key derived from a password with no
work factor. Every lab uses the browser's native `SubtleCrypto` and
`crypto.getRandomValues()`; nothing depends on a server, a library or a paid
service.

> **Standing safety note that must appear in the seed prose of every lab in this
> track.** Where a lab implements a primitive by hand, it is doing so *only* to
> make a failure visible. **Hand-rolled cryptography is never production-ready
> and no lab output in this track should be used to protect real data.** The
> production answer is always: use a vetted implementation, at a standard
> parameter set, through a high-level interface. Two modules deliberately build
> broken constructions (`crypto-ecb-patterning` and
> `crypto-timing-safe-comparison`); both carry that warning inline, both operate
> only on data the student generates in their own browser, and neither targets
> anything outside the page.

## Beginner

#### `crypto-goals-and-non-goals` — What Cryptography Does and Does Not Do (30 min)
Cryptography provides confidentiality, integrity and authenticity — and provides
none of them if the surrounding system hands the key to the wrong person.
1. `explain` Confidentiality, integrity, authenticity, non-repudiation, stated as questions each answers.
2. `explain` What cryptography cannot do: fix a compromised endpoint, hide metadata, or replace access control.
3. `lab` javascript — match six requirements to the property each needs and mark the one that needs none.
4. `explain` Kerckhoffs's principle: the algorithm is public, the key is the secret.
5. `check` "Our data is encrypted at rest" — what does that claim not tell you?
6. `explain` Why you should never design your own protocol, stated once and meant.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html · https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
- Search: "cryptography goals confidentiality integrity", "kerckhoffs principle explained"

#### `crypto-randomness` — Randomness That Is Actually Random (35 min)
A cryptographic system is only as unpredictable as its random numbers, and the
convenient random function is the wrong one.
1. `explain` Pseudo-random versus cryptographically secure; predictability as the attack.
2. `lab` javascript — generate bytes with `crypto.getRandomValues()` into a typed array and hex-encode them.
3. `explain` Why `Math.random()` must never generate a token, a key or a salt.
4. `explain` Entropy, and the practical size of a token (128 bits is the usual floor).
5. `check` A password-reset token generated from the current timestamp — what is the attack?
6. `lab` javascript — generate a 32-byte token and a UUID, and state what each is appropriate for.
- Refs: https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues · https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
- Search: "cryptographically secure random javascript", "math.random not secure tokens"

#### `crypto-hashing` — Hashing with SubtleCrypto (35 min)
A hash is a one-way fingerprint: cheap to compute, infeasible to reverse, and
identical for identical input — which is both its use and its limit.
1. `explain` Properties of a cryptographic hash: deterministic, fixed-length, preimage- and collision-resistant.
2. `lab` javascript — hash a string with SHA-256 via `crypto.subtle.digest` and render the hex digest.
3. `explain` Avalanche behaviour: one changed bit changes roughly half the output.
4. `lab` javascript — hash two nearly identical strings and count the differing hex characters.
5. `explain` Why MD5 and SHA-1 are retired, and what "collision-resistant" stopped meaning for them.
6. `check` Is hashing a password with plain SHA-256 sufficient? Why not?
- Refs: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest · https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- Search: "sha-256 subtlecrypto digest tutorial", "cryptographic hash properties explained"

#### `crypto-encoding-is-not-encryption` — Encoding Is Not Encryption (30 min)
Base64 and hex are transport conveniences with no secrecy whatsoever, and
confusing them with encryption is a recurring real-world breach cause.
1. `explain` Encoding, encryption, hashing — three different jobs, one common confusion.
2. `lab` javascript — Base64-encode a string, decode it in one line, and observe that no key was involved.
3. `explain` Why encoded data in a cookie or a URL is plaintext for the purposes of threat modelling.
4. `explain` Byte handling in the browser: `TextEncoder`, `ArrayBuffer`, typed arrays.
5. `check` A support ticket says "the token is encrypted, it looks like gibberish". What do you check?
6. `explain` Obfuscation as a speed bump, honestly labelled.
- Refs: https://developer.mozilla.org/en-US/docs/Glossary/Base64 · https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder
- Search: "base64 is not encryption", "textencoder arraybuffer javascript"

#### `crypto-hmac-and-integrity` — HMAC and Message Integrity (40 min)
A hash proves nothing about who produced it; an HMAC proves the sender knew a
shared key.
1. `explain` Integrity versus authenticity; why a bare hash appended to a message is forgeable.
2. `lab` javascript — import a key with `crypto.subtle.importKey` and sign a message with HMAC-SHA-256.
3. `explain` Verification with `crypto.subtle.verify` rather than comparing hex strings by hand.
4. `lab` javascript — tamper with one byte of the message and watch verification fail.
5. `explain` Where HMAC shows up: webhook signatures, signed cookies, download integrity.
6. `check` Why is `hash(secret + message)` weaker than HMAC?
- Refs: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/sign · https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify
- Search: "hmac sha256 web crypto tutorial", "webhook signature verification hmac"

#### `crypto-password-storage-concepts` — Password Storage, Conceptually (40 min)
Passwords are not encrypted, they are slowly hashed with a per-user salt, and the
slowness is the entire point.
1. `explain` Never store plaintext, never encrypt (a decryptable password is a stored password).
2. `explain` Salt defeats precomputation; work factor defeats brute force.
3. `explain` The current recommended families — Argon2id, scrypt, bcrypt — and what each parameter controls.
4. `lab` javascript — derive a key from a password with PBKDF2 at two iteration counts and time both.
5. `explain` Why this repo uses bcrypt server-side and why PBKDF2 in the browser is a teaching device, not the production path.
6. `check` Two users share a password; their stored hashes differ. Which mechanism caused that?
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html · https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey
- Search: "password hashing bcrypt argon2 explained", "salt and work factor password storage"

## Intermediate

#### `crypto-symmetric-encryption-aes-gcm` — Symmetric Encryption with AES-GCM (45 min)
AES-GCM gives you confidentiality and integrity in one operation, which is why it
is the default recommendation rather than plain AES.
1. `explain` Symmetric keys; block ciphers; what a mode of operation adds.
2. `lab` javascript — generate an AES-GCM key with `generateKey`, encrypt a message, decrypt it back.
3. `explain` Authenticated encryption: the tag that makes tampering detectable.
4. `lab` javascript — flip one ciphertext byte and observe decryption throwing rather than returning garbage.
5. `explain` Additional authenticated data, and what it is for.
6. `check` Decryption "succeeded" and returned nonsense — which property was your cipher mode missing?
- Refs: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt · https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/generateKey
- Search: "aes-gcm web crypto tutorial", "authenticated encryption explained"

#### `crypto-ivs-and-nonces` — IVs and Nonces, and Reusing Them (45 min)
An initialisation vector is public but must never repeat under the same key, and
GCM in particular fails catastrophically when it does.
1. `explain` What an IV/nonce is for; why it is public and why it must be unique.
2. `lab` javascript — encrypt two different messages with the same key and the *same* IV, then XOR the two ciphertexts and observe the relationship between plaintexts leaking.
3. `explain` Why GCM nonce reuse is worse than CBC IV reuse — it can compromise the authentication key.
4. `lab` javascript — fix the lab by generating a fresh random 12-byte nonce per message.
5. `explain` Nonce strategies: random versus counter, and the storage each requires.
6. `check` Your code hard-codes a 12-byte IV as a constant. What exactly have you given away?
- Refs: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt · https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- Search: "iv reuse aes gcm attack", "nonce uniqueness requirement encryption"

#### `crypto-key-derivation` — Key Derivation from Passwords (45 min)
A password is not a key; a key derivation function is what turns one into the
other at a cost you choose.
1. `explain` KDF versus hash; work factor, salt, output length.
2. `lab` javascript — derive an AES-GCM key from a passphrase with PBKDF2 and use it to encrypt a note.
3. `explain` Iteration counts, and why a number chosen in 2015 is now too low.
4. `explain` Memory-hard functions and why Argon2id is preferred where available.
5. `check` The same passphrase and the same salt produce a different key. What went wrong?
6. `explain` Storing the salt and parameters alongside the ciphertext — they are not secrets.
- Refs: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey · https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Search: "pbkdf2 derivekey web crypto", "key derivation function explained"

#### `crypto-ecb-patterning` — Why ECB Leaks (40 min)
ECB mode is the clearest demonstration in cryptography that "encrypted" is not a
binary property.
1. `explain` Block modes; ECB encrypts each block independently, so identical blocks encrypt identically.
2. `lab` javascript — build a toy block cipher over an image's pixel data in ECB fashion in a canvas and observe the original shape remaining visible. **Prose must state: this construction is a teaching artefact and is not production cryptography.**
3. `explain` Repeat with CBC/CTR-style chaining and observe the structure disappearing.
4. `explain` Why real systems still ship ECB: a default parameter nobody changed.
5. `check` Two database rows with identical plaintext produce identical ciphertext. Which mode is in use?
6. `explain` The rule this replaces: use an AEAD mode, do not choose a raw block mode.
- Refs: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt · https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- Search: "ecb mode penguin image explanation", "block cipher modes of operation compared"

#### `crypto-timing-safe-comparison` — Timing-Safe Comparison (40 min)
A comparison that returns early leaks how much of a secret you guessed
correctly, one byte at a time.
1. `explain` Side channels; why `===` on secrets is a measurable oracle.
2. `lab` javascript — implement an early-return comparison, time it over many guesses in a Web Worker, and plot the correlation between shared-prefix length and elapsed time. **Prose must state: this measures the student's own in-page function only; it is not directed at any external service.**
3. `explain` Constant-time comparison: fixed-length XOR accumulation, no early exit.
4. `lab` javascript — implement the constant-time version and show the timing signal disappearing.
5. `explain` Why the practical fix is usually to compare HMACs of both values instead.
6. `check` Your token check compares strings with `===`. What is the concrete risk, and what is the one-line fix?
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html · https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify
- Search: "timing attack string comparison", "constant time comparison implementation"

#### `crypto-asymmetric-and-signatures` — Asymmetric Keys and Signatures (50 min)
Public-key cryptography separates the ability to verify from the ability to sign,
which is what makes third-party trust possible.
1. `explain` Key pairs; encryption with the public key, signing with the private key.
2. `lab` javascript — generate an ECDSA key pair, sign a payload, and verify it with the public key alone.
3. `explain` Why asymmetric encryption is used to move symmetric keys rather than bulk data.
4. `lab` javascript — export the public key as JWK and verify a signature using only the exported key.
5. `explain` Certificates and chains of trust in one paragraph.
6. `check` You verified a valid signature. What have you learned about the signer, and what have you not?
- Refs: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/generateKey · https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/exportKey
- Search: "ecdsa sign verify web crypto", "public key cryptography explained beginner"

## Advanced

#### `crypto-aead-failure-modes` — AEAD Failure Modes (45 min)
Even with an authenticated cipher there are ways to lose: unauthenticated
metadata, truncated tags, and treating decryption failure as recoverable.
1. `explain` What the tag covers and what it does not; the role of additional authenticated data.
2. `lab` javascript — encrypt with a record id as AAD, then swap two records' ciphertexts and observe verification failing.
3. `explain` Confused-deputy risks when context is not bound into the ciphertext.
4. `explain` Truncated tags, and why shortening them to save bytes is a bad trade.
5. `check` Two encrypted records swapped between users and both decrypt successfully. What was not authenticated?
6. `explain` Decryption failure is a hard stop, never a fallback to plaintext.
- Refs: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/decrypt · https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- Search: "aead additional authenticated data usage", "ciphertext swapping attack"

#### `crypto-key-management` — Key Management Lifecycle (50 min)
Most cryptographic failures in production are key-management failures, not
algorithm failures.
1. `explain` Generation, storage, distribution, rotation, revocation, destruction.
2. `explain` Key hierarchies: a data key wrapped by a key-encryption key.
3. `lab` javascript — wrap an AES key with `wrapKey`, then unwrap and use it, and note that the wrapped form is safe to store.
4. `explain` Rotation without re-encrypting everything: versioned keys and lazy re-wrap.
5. `check` A key was committed to git two years ago. What is the full remediation, in order?
6. `explain` Secrets in environment variables and dedicated stores; never in source, prompts or logs.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html · https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/wrapKey
- Search: "key management lifecycle best practices", "key wrapping kek dek"

#### `crypto-signed-tokens` — Signed Tokens Done Right (50 min)
A signed token is a small protocol, and its known failure modes are all
verification failures.
1. `explain` Structure of a signed token: header, claims, signature; what is readable versus what is protected.
2. `lab` javascript — build and verify a compact signed token with HMAC-SHA-256, checking expiry, audience and issuer.
3. `explain` Algorithm confusion and the `none` algorithm: never trust the token to name its own verification method.
4. `lab` javascript — attempt verification with an attacker-supplied algorithm field and show the allow-list rejecting it.
5. `explain` Revocation is hard: short lifetimes, refresh tokens, server-side deny lists.
6. `check` A token verifies but the user was deactivated an hour ago. Which design property is missing?
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- Search: "jwt algorithm confusion attack", "signed token verification best practices"

#### `crypto-transport-security` — Transport Security in One Lesson (40 min)
TLS is the one protocol every application depends on and almost nobody reads;
knowing its shape prevents a category of mistakes.
1. `explain` Handshake in outline: negotiate, authenticate the server, agree a session key.
2. `explain` Certificate validation: chain, hostname, expiry — and why disabling verification "temporarily" is how breaches start.
3. `explain` Forward secrecy, and why session keys are ephemeral.
4. `lab` javascript — inspect a fixture certificate chain object and identify the three checks a client must perform.
5. `check` A client library option named `rejectUnauthorized: false` — what exactly does that permit?
6. `explain` HSTS and why "redirect HTTP to HTTPS" alone is insufficient.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html · https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security
- Search: "tls handshake explained simply", "certificate validation hostname check"

#### `crypto-protocol-mistakes` — Protocol Mistakes, Read as Case Studies (45 min)
The recurring lesson across published cryptographic failures is that the
primitive was fine and the composition was not.
1. `explain` Padding-oracle style failures: distinguishable error responses leak plaintext.
2. `explain` Downgrade and negotiation attacks: accepting the weakest option offered.
3. `explain` Replay: a valid message accepted twice; nonces and timestamps as the defence.
4. `lab` javascript — add replay protection to a fixture signed-message verifier using a nonce cache and a time window.
5. `check` Distinct error messages for "bad padding" and "bad MAC" — why does that matter?
6. `explain` The uniform-error rule, and why timing must be uniform too.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- Search: "padding oracle attack explained", "replay attack prevention nonce"

#### `crypto-secure-note-capstone` — Capstone: A Secure Note in the Browser (55 min)
One end-to-end build that composes everything: derive, encrypt, authenticate,
store, rotate.
1. `explain` Requirements and threat model for a passphrase-locked note stored in `localStorage`.
2. `lab` javascript — derive a key with PBKDF2 (random salt), encrypt with AES-GCM (fresh nonce), store salt + nonce + ciphertext as one record.
3. `lab` javascript — implement unlock, including a uniform failure message for wrong passphrase and corrupted data.
4. `explain` What this design does not protect against: a compromised browser, a keylogger, or a weak passphrase.
5. `lab` javascript — implement passphrase change by re-deriving and re-encrypting, and prove the old passphrase stops working.
6. `check` List the three values stored in plaintext alongside the ciphertext and say why each is safe to store.
- Refs: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API · https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- Search: "web crypto encrypt localstorage tutorial", "passphrase derived encryption browser"

---

# Track 8 — Defensive Cybersecurity (`sec`)

**Track summary.** This track teaches students to build software that resists
attack: validating input at the boundary, encoding output for its destination,
modelling authorisation explicitly, hardening HTTP responses, storing credentials
correctly, and logging enough to notice a problem. It is organised around the
OWASP Cheat Sheet Series because that is the maintained, vendor-neutral reference
for exactly these controls.

> **Scope constraint, non-negotiable.** Every module is **defensive and
> sandboxed**. There is no operational exploitation anywhere in this track: no
> scanning, no attacks against real or third-party systems, no credential
> attacks, no traffic interception, no malware. The single module that
> demonstrates an attack — `sec-xss-lab-own-fixture` — runs against a fixture
> page the LMS itself serves, inside a `sandbox`-attributed iframe with no
> network access, using a payload the student types into their own browser. Its
> purpose is to show that output encoding works. Modules that could not be taught
> this way were dropped rather than softened; see `## Deliberate exclusions`.

## Beginner

#### `sec-threat-modelling-basics` — Threat Modelling Basics (35 min)
Security work starts with naming what you are protecting and from whom, because
a control with no threat behind it is decoration.
1. `explain` Assets, actors, entry points, trust boundaries.
2. `explain` A lightweight four-question model: what are we building, what can go wrong, what will we do, did it work.
3. `lab` javascript — draw the trust boundaries of this LMS from a supplied component list and mark each crossing.
4. `explain` Risk as likelihood times impact; why "possible" is not the same as "worth fixing first".
5. `check` Which is the higher-priority finding: a self-XSS in an admin-only page, or missing authorisation on a public POST route?
6. `explain` Threat modelling is a 30-minute exercise, not a document nobody reads.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html
- Search: "threat modeling for developers", "trust boundary diagram explained"

#### `sec-input-validation` — Input Validation at the Boundary (40 min)
Validate on the server, against an allow-list, as close to the entry point as
possible — and treat every client-side check as a convenience only.
1. `explain` Allow-list versus deny-list; why deny-lists are always incomplete.
2. `lab` javascript — write a schema-style validator for a registration payload rejecting everything not explicitly permitted.
3. `explain` Type, range, length, format, and canonicalisation before comparison.
4. `explain` Client-side validation is UX; server-side validation is security.
5. `check` A form validated in the browser and posted directly with a script — what stops the bad value?
6. `lab` javascript — add length and range bounds and prove the oversized input is rejected.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
- Search: "input validation allowlist server side", "mass assignment vulnerability explained"

#### `sec-output-encoding` — Output Encoding and Contexts (40 min)
Injection is a failure to distinguish data from code, and encoding for the exact
destination context is the fix.
1. `explain` The same string is dangerous differently in HTML text, an attribute, JavaScript, a URL and CSS.
2. `lab` javascript — render the same untrusted string into five contexts and encode each correctly.
3. `explain` `textContent` versus `innerHTML`: why the safe API is the default choice.
4. `explain` Templating engines that auto-escape, and the one escape hatch that undoes it.
5. `check` A value escaped for HTML text and then inserted into an `onclick` attribute — why is that still unsafe?
6. `explain` Encode at output, not at input; storing pre-encoded data creates its own bugs.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html · https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent
- Search: "output encoding contexts xss prevention", "textcontent vs innerhtml safety"

#### `sec-authentication-fundamentals` — Authentication Fundamentals (40 min)
Authentication is a system, not a password field: enrolment, verification,
recovery and lockout all have to hold together.
1. `explain` Identifier, credential, verification; why the credential is never stored recoverably.
2. `explain` Slow hashing with a per-user salt; the parameters and why they change over time.
3. `lab` javascript — implement a login check against fixture records that never reveals which factor was wrong.
4. `explain` Account enumeration: identical responses and comparable timing for unknown users.
5. `check` "No account with that email" on the login page — what did you just publish?
6. `explain` Lockout and rate limiting; multi-factor in one paragraph.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Search: "authentication best practices owasp", "prevent account enumeration login"

#### `sec-session-management` — Session Management (40 min)
Once a user is authenticated, everything depends on the session being
unguessable, correctly scoped and genuinely revocable.
1. `explain` Session identifier properties: high entropy, server-controlled, rotated on privilege change.
2. `lab` javascript — set cookie attributes correctly on a fixture response and explain each of `HttpOnly`, `Secure`, `SameSite`, `Path`.
3. `explain` Fixation and rotation: why the session id must change at login.
4. `explain` Expiry: idle timeout versus absolute lifetime; logout that actually invalidates.
5. `check` A stolen session cookie should not permit a permanent takeover. Which additional control ensures that?
6. `explain` Why this repo's password change requires the current password even with a valid session.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- Search: "session cookie httponly secure samesite", "session fixation prevention"

#### `sec-secrets-and-configuration` — Secrets and Configuration (35 min)
A leaked credential is the cheapest possible breach, and the controls are almost
entirely procedural.
1. `explain` What counts as a secret; why a config value and a secret need different handling.
2. `lab` javascript — audit a fixture repository listing and flag every file that must not contain a secret.
3. `explain` Environment variables, secret stores, and least-privilege scoping.
4. `explain` Rotation after exposure; why deleting the commit is not rotation.
5. `check` A database URL was pasted into a chat log. What is the remediation, in order?
6. `explain` This repo's own two recorded examples: the shared demo password and the connection string shared in chat.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- Search: "secrets management developers", "rotate leaked credentials procedure"

## Intermediate

#### `sec-authorization-modelling` — Modelling Authorisation (50 min)
Broken access control is consistently the most common serious web vulnerability,
and it is a modelling failure rather than a coding one.
1. `explain` Authentication versus authorisation; role-based and resource-based checks.
2. `explain` Deny by default; a route with no stated policy is a bug, not a default-allow.
3. `lab` javascript — build a route-to-policy table over a fixture route list and make an unclassified route a hard error.
4. `explain` Object-level checks: "is this submission yours" is not answered by "are you a student".
5. `check` A student changes an id in a URL and reads another student's feedback. Which control was missing?
6. `explain` Why a server action is a public POST target and must be guarded like a route.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Access_Control_Cheat_Sheet.html
- Search: "broken access control explained", "idor prevention object level authorization"

#### `sec-secure-headers-and-csp` — Secure Headers and Content Security Policy (45 min)
Response headers are cheap, high-leverage defence in depth, and CSP is the one
that takes real design effort.
1. `explain` The core set: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors`.
2. `lab` javascript — write a header set for this LMS from a supplied requirement list and justify each.
3. `explain` CSP mechanics: sources, nonces, why `unsafe-inline` gives most of the protection away.
4. `explain` Report-only mode as the safe rollout path.
5. `check` Why can W3Schools' "Try it Yourself" not be iframed here, and which header causes that?
6. `explain` Headers are not a substitute for encoding; they are a second line.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- Search: "content security policy tutorial nonce", "security headers explained"

#### `sec-injection-defence` — Injection Defence Across Interpreters (45 min)
SQL, shell, template and header injection are one bug with four costumes.
1. `explain` The single root cause: untrusted data reaching an interpreter as code.
2. `lab` sql — rewrite three concatenated queries as parameterised ones and confirm quoted input stays data.
3. `explain` What parameters cannot protect: identifiers, `ORDER BY` columns — use an allow-list.
4. `explain` Command injection and why building shell strings is the wrong shape entirely.
5. `check` Escaping quotes as a defence — name the case where it fails.
6. `explain` Least-privilege database accounts, and why the app user should not own DDL.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- Search: "sql injection prevention parameterized", "command injection prevention"

#### `sec-csrf-and-state-changing-requests` — CSRF and State-Changing Requests (40 min)
A cookie-authenticated write endpoint will be submitted by someone else's page
unless you make that impossible.
1. `explain` How a cross-site state-changing request works, from the victim's browser.
2. `explain` `SameSite` cookies as the modern baseline; anti-forgery tokens as the explicit defence.
3. `lab` javascript — add a per-session token to a fixture form handler and reject the mismatched submission.
4. `explain` Safe versus unsafe methods; why `GET` must never change state.
5. `check` A logout implemented as a `GET` link — what can an attacker do with that?
6. `explain` Why token-in-header APIs are less exposed, and where they are not.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html · https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie/SameSite
- Search: "csrf explained prevention", "samesite cookie csrf protection"

#### `sec-logging-and-monitoring` — Logging and Monitoring (40 min)
You cannot respond to what you cannot see, and you must not log what you should
never store.
1. `explain` What to log: authentication outcomes, authorisation denials, admin actions, with actor and timestamp.
2. `explain` What never to log: passwords, tokens, full card data, secrets, and needless personal data.
3. `lab` javascript — implement a redacting logger and prove a token never reaches the output.
4. `explain` Log injection: newline-forged entries, and encoding log fields.
5. `check` A breach is suspected; the logs show requests but not which user made them. What was missing?
6. `explain` Alerting thresholds, and why a log nobody reads is not a control.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- Search: "security logging best practices", "log injection prevention"

#### `sec-dependencies-and-supply-chain` — Dependencies and Supply Chain Hygiene (40 min)
Most of the code you ship was written by strangers, and treating that as a
managed risk is the whole discipline.
1. `explain` Direct and transitive dependencies; the lockfile as the record of what you actually ship.
2. `lab` javascript — read a fixture advisory report and triage four findings by reachability and severity.
3. `explain` Pinning, updating on a cadence, and why "latest" in production is a liability.
4. `explain` Typosquatting and install scripts; why adding a dependency is a trust decision.
5. `check` A critical advisory in a package used only by a build tool — same priority as one in the request path?
6. `explain` Reviewing a dependency addition in code review, as a normal expectation.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html
- Search: "software supply chain security basics", "npm audit triage reachability"

## Advanced

#### `sec-xss-lab-own-fixture` — XSS, Demonstrated Against Our Own Fixture (50 min)
The only way to be sure encoding works is to watch an unencoded sink execute and
an encoded one refuse.
1. `explain` Stored, reflected and DOM-based XSS; the sink is what decides.
2. `lab` javascript — inside a `sandbox`-attributed, network-less iframe serving an LMS-owned fixture page, insert a student-typed payload into an `innerHTML` sink and observe it executing. **Prose must state: this fixture is served by this application for this exercise; never direct a payload at a system you do not own.**
3. `lab` javascript — switch the same sink to `textContent` and confirm the identical payload becomes inert text.
4. `explain` DOM sinks inventory: `innerHTML`, `outerHTML`, `document.write`, `eval`, `srcdoc`, event-handler attributes.
5. `explain` Layered defence: encoding, then CSP, then a safe-by-default templating layer.
6. `check` The payload no longer executes after adding CSP but the sink is still `innerHTML`. Are you fixed? Argue it.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html · https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox
- Search: "dom based xss sinks explained", "iframe sandbox attribute security"

#### `sec-access-control-review` — Reviewing Access Control on Our Own App (50 min)
A structured review of an application you own is the highest-yield security
exercise there is.
1. `explain` Building the route inventory: method, path, actor, resource, policy.
2. `lab` javascript — complete an access-control matrix from a fixture route list and highlight every gap.
3. `explain` Horizontal versus vertical escalation, with a concrete example of each.
4. `explain` Hidden write surfaces: server actions, webhooks, cron endpoints, ingestion routes.
5. `check` An ingestion endpoint that writes rows and has no stated authorisation — severity, and what an attacker gains?
6. `explain` Making an unclassified route a compile-time error rather than a runtime surprise.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Access_Control_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- Search: "access control matrix review", "privilege escalation horizontal vertical"

#### `sec-abuse-resistance` — Rate Limiting and Abuse Resistance (45 min)
Availability and cost are security properties too, and shared third-party
services make that concrete.
1. `explain` Rate limiting dimensions: per user, per IP, per resource; token bucket versus fixed window.
2. `lab` javascript — implement a token-bucket limiter and prove a burst is shaped rather than dropped wholesale.
3. `explain` Fairness: one user must not be able to exhaust a shared free-tier quota for a cohort.
4. `explain` Expensive endpoints: password reset, code execution, exports.
5. `check` A shared public code-execution service returns 429 during an exam. What must the application do, and what must it never do?
6. `explain` Backpressure and honest failure messages over silent degradation.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html · https://platform.claude.com/docs/en/api/rate-limits
- Search: "rate limiting token bucket implementation", "abuse prevention expensive endpoints"

#### `sec-secure-sdlc-and-review` — Secure Development and Code Review (45 min)
Security that lives only in a pre-launch audit arrives too late to be cheap.
1. `explain` Where controls attach: design review, code review, CI checks, pre-release gate.
2. `lab` javascript — review a fixture diff against a six-item security checklist and write findings with file, scenario and severity.
3. `explain` Writing a finding that gets fixed: concrete scenario, not a category name.
4. `explain` Static analysis and secret scanning in CI; false positives as a budget item.
5. `check` "Possible XSS in dashboard" — rewrite this finding so a developer can act on it.
6. `explain` Regression tests for security fixes, so the bug cannot silently return.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- Search: "secure code review checklist", "secure sdlc practices"

#### `sec-incident-response-tabletop` — Incident Response, on Paper (45 min)
Deciding who does what during an incident is work that must happen before the
incident.
1. `explain` Phases: prepare, detect, contain, eradicate, recover, learn.
2. `explain` Roles and communication; a single decision-maker and a written timeline.
3. `lab` javascript — walk a fixture scenario (a leaked instructor credential) and produce an ordered action list.
4. `explain` Containment versus evidence preservation, and the tension between them.
5. `check` The first instinct is to delete the compromised account. What might that destroy?
6. `explain` Blameless post-incident review, and turning findings into controls.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- Search: "incident response phases explained", "tabletop exercise security"

#### `sec-privacy-and-data-minimisation` — Privacy and Data Minimisation (40 min)
The data you never collected cannot leak, which is the cheapest privacy control
available.
1. `explain` Personal data, purpose limitation, minimisation, retention.
2. `lab` javascript — audit a fixture schema and mark each column as necessary, useful or unjustified.
3. `explain` Third-party processors: what leaves your system and where it is disclosed.
4. `explain` Deletion and export as engineering requirements, not policy statements.
5. `check` A live-editor preview rendered by an external service — what belongs in the cohort's privacy notice?
6. `explain` Logging and analytics as the usual accidental collectors.
- Refs: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html
- Search: "data minimisation privacy by design", "personal data retention policy engineering"

---

# Section A — Grand-quiz blueprints

Four exams, one per **existing** week. The weeks, their titles and their three
lecture titles below were read from `scripts/seed-content.ts` and are quoted from
that file's own data, not invented; nothing in those weeks is modified by these
blueprints. Each exam is a new `quizzes` row with `kind = 'grand'`.

## A.0 — The shape shared by all four exams

| Property | Value |
|---|---|
| Questions | **50** |
| Duration | **120 minutes** (server-computed `deadline_at`, never client-supplied) |
| Attempts | **1** (enforced by the unique index, not a read-then-write check) |
| Total points | **150** |
| Pass reference | 60% = 90 points; percentage = points ÷ 1.5 |
| Negative marking | none; `awarded` clamped to `[0, max_points]`; score is the SUM |

### Type × count × points — the arithmetic

| Type | Count | Points each | Subtotal |
|---|---:|---:|---:|
| `mcq` | 30 | 2 | **60** |
| `code_fix` (broken code + candidate fixes) | 14 | 3 | **42** |
| `code_write` (free-form, test-graded) | 6 | 8 | **48** |
| **Total** | **50** | — | **150** |

- Question count: 30 + 14 + 6 = **50** ✓
- Point total: (30 × 2) + (14 × 3) + (6 × 8) = 60 + 42 + 48 = **150** ✓

**Why 150 and not 100.** Three integer weights that keep a free-form coding item
worth four MCQs, with no fractional points anywhere, and a total that divides
cleanly by 1.5 into a percentage. A grand quiz is scored independently of
`WEEK_MAX`; the weekly aggregate must consume it through
`src/lib/contracts/scoring.ts` and must not introduce a second copy of that
arithmetic.

### Topic distribution across each week's three real lectures

| Type | L1 | L2 | L3 | Total |
|---|---:|---:|---:|---:|
| `mcq` | 10 | 10 | 10 | 30 |
| `code_fix` | 5 | 5 | 4 | 14 |
| `code_write` | 2 | 2 | 2 | 6 |
| **Questions** | **17** | **17** | **16** | **50** |
| **Points** | **51** | **51** | **48** | **150** |

Per-lecture point check: L1 = 20 + 15 + 16 = 51; L2 = 20 + 15 + 16 = 51;
L3 = 20 + 12 + 16 = 48. Sum = **150** ✓

### Difficulty curve (identical structure in all four exams)

Items are ordered easy → hard so a student who runs out of time loses the items
they were least likely to earn.

| Item range | Type | Band | Count | Points |
|---|---|---|---:|---:|
| 1–12 | `mcq` | foundational recall | 12 | 24 |
| 13–24 | `mcq` | applied reasoning | 12 | 24 |
| 25–30 | `mcq` | edge cases / traps | 6 | 12 |
| 31–38 | `code_fix` | applied | 8 | 24 |
| 39–44 | `code_fix` | subtle defect | 6 | 18 |
| 45–47 | `code_write` | applied | 3 | 24 |
| 48–50 | `code_write` | synthesis | 3 | 24 |
| **Total** | — | — | **50** | **150** |

Band check: 12 + 12 + 6 + 8 + 6 + 3 + 3 = **50** ✓ ·
24 + 24 + 12 + 24 + 18 + 24 + 24 = **150** ✓
Difficulty mix by count: easy 12 (24%), medium 23 (46%), hard 15 (30%).

### Time budget check

30 × 1.5 min + 14 × 2.5 min + 6 × 6.0 min = 45 + 35 + 36 = **116 minutes** of
the 120 available. That leaves four minutes of slack, which is deliberately thin:
the exam is meant to be time-pressured but completable.

### Authoring rules the seeding agent must enforce

- Exactly one option flagged correct per `mcq`, and per `code_fix` (a `code_fix`
  item is a broken snippet plus four candidate patches, exactly one of which is
  correct; the three distractors must each be a *plausible* fix that fails for a
  stated reason recorded in the explanation).
- Every `code_write` item carries **at least one** test; the blueprints below
  specify three or more test shapes each so hidden tests exist beyond the visible
  ones.
- Every question has `points > 0` and the four exams each total exactly 50
  questions — assert both before touching the database, as
  `scripts/seed-content.ts` already does for the practice quizzes.
- `code_write` items are graded through the shared execution surface. On
  `rate_limited` or `backend_unavailable` they are **deferred to instructor
  grading**, never scored zero, and the displayed total is labelled provisional
  while any deferred item remains.

---

## A.1 — Week 1 exam · "HTML5 Foundations"

Existing lectures this exam draws on:
**L1** "How the Web Works & Your First HTML Document" ·
**L2** "Semantic Structure, Text & Media" ·
**L3** "Links, Lists, Tables & Accessible Forms"

**Languages.** `code_fix` and `code_write` items are `html` (with a small number
of `code_fix` items over HTTP header/response text, which needs no runtime).
`code_write` items are graded by parsing the submitted markup and asserting
structural and accessibility properties — no rendering engine required.

| Slot | Lecture | Focus |
|---|---|---|
| mcq 1–4 | L1 | request/response cycle; what the browser does with the first document; DOM as parse result; the role of `<!DOCTYPE html>` |
| mcq 5–7 | L1 | required `<head>` metadata: charset, viewport, title; standards vs quirks consequences |
| mcq 8–10 | L1 | how CSS, JS and images become additional requests; absolute vs relative resolution |
| mcq 11–14 | L2 | landmark elements and what each region means; why `<div>` conveys nothing |
| mcq 15–17 | L2 | heading outline rules; one `<h1>`; skipped levels as missing content |
| mcq 18–20 | L2 | `alt` text: descriptive, empty-but-present, and omitted — three different outcomes |
| mcq 21–24 | L3 | label/input pairing via `for`/`id`; why placeholder is not a label; `required` and input types |
| mcq 25–27 | L3 (traps) | table semantics: `<th scope>`, `<caption>`, and tables-for-layout |
| mcq 28–30 | L1–L3 (traps) | link targets and `rel="noopener noreferrer"`; nesting rules; validity vs rendering-anyway |
| code_fix 31–35 | L1 (5) | missing doctype; missing charset; missing viewport; title outside `<head>`; unclosed element changing the tree |
| code_fix 36–40 | L2 (5) | `<div>` where a landmark belongs; heading level skipped; decorative image with a verbose `alt`; informative image with `alt=""`; `<b>` used where `<strong>` is meant |
| code_fix 41–44 | L3 (4) | `for` not matching `id`; placeholder used as the only label; header cells without `scope`; a submit control outside its form |
| code_write 45 | L1 | Write a minimal valid document skeleton for a named page. Tests: doctype present and first; `lang` attribute non-empty; charset meta present; exactly one `<title>` with the given text. |
| code_write 46 | L1 | Write a page whose stylesheet and script references resolve from a subdirectory-hosted site. Tests: no reference begins with `/`; both references present; script placed so it does not block first paint. |
| code_write 47 | L2 | Mark up a supplied article outline with correct landmarks and heading levels. Tests: exactly one `<h1>`; no skipped level; `<main>` present exactly once; every `<img>` has an `alt` attribute. |
| code_write 48 | L2 | Mark up a media block: one informative image and one decorative image. Tests: informative `alt` non-empty; decorative `alt` present and empty; no `alt` attribute missing. |
| code_write 49 | L3 | Build an accessible sign-up form for three named fields plus a submit control. Tests: every input has an `id`; every input has a label whose `for` matches; `type` values correct per field; submit control inside the form. |
| code_write 50 | L3 | Build a data table for supplied results. Tests: `<caption>` present; every header cell has a `scope`; row/column counts match the data; no layout-only nesting. |

Counts: 30 + 14 + 6 = **50**; points 60 + 42 + 48 = **150**.

---

## A.2 — Week 2 exam · "CSS3 & Responsive Design"

Existing lectures this exam draws on:
**L1** "Selectors, the Cascade & Specificity" ·
**L2** "Flexbox & CSS Grid" ·
**L3** "Mobile-First Responsive Design"

**Languages.** `code_fix` and `code_write` items are `css` (a handful pair a
fixed HTML fragment with a CSS answer). `code_write` items are graded by parsing
the declaration set and asserting the required properties, values and at-rule
structure — deterministic, and no layout engine required.

| Slot | Lecture | Focus |
|---|---|---|
| mcq 1–4 | L1 | selector types; the cascade's resolution order; source order at equal specificity |
| mcq 5–7 | L1 | specificity arithmetic: id vs class vs element; where `!important` sits |
| mcq 8–10 | L1 | box model: content-box vs border-box; what `width: 100%` plus padding does |
| mcq 11–14 | L2 | Flexbox main vs cross axis; what `justify-content` and `align-items` control |
| mcq 15–17 | L2 | `flex-direction: column` swapping the meaning of both alignment properties |
| mcq 18–20 | L2 | Grid: `repeat(auto-fit, minmax(...))`, `1fr`, `gap`; when Grid beats Flexbox |
| mcq 21–24 | L3 | mobile-first ordering; why `min-width` queries add rather than undo |
| mcq 25–27 | L3 (traps) | `rem` vs `px` breakpoints and user font-size settings |
| mcq 28–30 | L1–L3 (traps) | inheritance vs cascade; specificity of a compound selector; a media query that never matches |
| code_fix 31–35 | L1 (5) | a rule overridden and "not working"; a class expected to beat an id; missing global `border-box`; a typo'd selector matching nothing; a shorthand silently resetting a longhand |
| code_fix 36–40 | L2 (5) | centring attempted with `text-align` on a flex parent; `align-items` used where `justify-content` was meant; a column flex container with the axes confused; a grid with a fixed column count breaking on small screens; `gap` applied to the wrong element |
| code_fix 41–44 | L3 (4) | a desktop-first `max-width` chain that has to be undone; a `px` breakpoint that ignores user font size; a missing viewport meta rendering all queries inert; a horizontal overflow at 320 px |
| code_write 45 | L1 | Write a rule set achieving a stated visual result with the lowest specificity that works. Tests: `box-sizing: border-box` applied; no `!important`; no id selectors; required declarations present. |
| code_write 46 | L1 | Given three conflicting rules, write a fourth that wins without `!important`. Tests: computed winner is the new rule; `!important` absent; specificity within a stated ceiling. |
| code_write 47 | L2 | Centre a card both axes with Flexbox. Tests: `display: flex`; both `justify-content` and `align-items` set to a centring value; no absolute positioning; no fixed pixel offsets. |
| code_write 48 | L2 | Build a responsive card grid with no media query. Tests: `display: grid`; `repeat(auto-fit, minmax(...))` present; a `gap` declared; no fixed column count. |
| code_write 49 | L3 | Write mobile-first styles for a one-column-to-two-column layout. Tests: base rules contain no media query; exactly one `min-width` query; breakpoint expressed in `rem`; no `max-width` query. |
| code_write 50 | L3 | Fix a layout that overflows horizontally at 320 px and prove it. Tests: no fixed width exceeding the viewport; images capped with `max-width: 100%`; long content given a wrapping or scroll container. |

Counts: 30 + 14 + 6 = **50**; points 60 + 42 + 48 = **150**.

---

## A.3 — Week 3 exam · "JavaScript Fundamentals"

Existing lectures this exam draws on:
**L1** "Values, Types & Functions" ·
**L2** "Arrays, Objects & the DOM" ·
**L3** "Events & Asynchronous JavaScript"

**Languages.** All `code_fix` and `code_write` items are `javascript`. This is
the one week where free-form items are graded by genuinely executing student code
against tests — in the browser Web Worker for practice and through the shared
execution surface at submission.

| Slot | Lecture | Focus |
|---|---|---|
| mcq 1–4 | L1 | `let`/`const` vs `var`; block versus function scope; hoisting consequences in loops |
| mcq 5–7 | L1 | `==` versus `===`; coercion outcomes; when `NaN` appears |
| mcq 8–10 | L1 | function declarations, expressions, arrow functions; arrow functions and `this` |
| mcq 11–14 | L2 | `map`/`filter`/`reduce` return values; mutation versus transformation |
| mcq 15–17 | L2 | `querySelector` versus `getElementById`; live versus static collections |
| mcq 18–20 | L2 | `textContent` versus `innerHTML` and the injection consequence |
| mcq 21–24 | L3 | event flow, `preventDefault`, delegation on a dynamic list |
| mcq 25–27 | L3 (traps) | `fetch` resolving on a 404; the missing `res.ok` check; `await` inside a non-async function |
| mcq 28–30 | L1–L3 (traps) | closure captured in a loop; `sort` comparing numbers as strings; `Promise.all` failing fast |
| code_fix 31–35 | L1 (5) | `var` in a loop producing the wrong captured value; `==` accepting an empty string; a function returning `undefined` because of a newline before the value; a reassigned `const`; a shadowed parameter |
| code_fix 36–40 | L2 (5) | `map` used where `forEach` was intended and the result discarded; a `reduce` with no initial value on an empty array; a mutation where a copy was required; `innerHTML` with user text; a wrong array index off by one |
| code_fix 41–44 | L3 (4) | missing `event.preventDefault()` reloading the page; a `fetch` without a status check; an unhandled rejection; a listener attached before the element exists |
| code_write 45 | L1 | Write a pure function returning a derived value from primitives. Tests: happy path; zero/empty input; negative input; type of the return value. |
| code_write 46 | L1 | Write a strict-equality comparison helper that never coerces. Tests: same type and value; same value different type; `NaN` handling; `null` versus `undefined`. |
| code_write 47 | L2 | Transform an array of records into a summary object with `map`/`filter`/`reduce`. Tests: correct summary for a mixed array; empty array; input array unmodified afterwards; no `for` loop present. |
| code_write 48 | L2 | Implement a counter that updates a supplied DOM node safely. Tests: increments correctly; renders through `textContent`; no `innerHTML` in the submission; handles repeated rapid calls. |
| code_write 49 | L3 | Write an async fetch wrapper returning a discriminated result. Tests: success path; a 404 producing a failure result rather than throwing; a network error producing a failure result; the failure reason is distinguishable. |
| code_write 50 | L3 | Implement submit handling with validation and no page reload. Tests: `preventDefault` called; invalid input rejected with a message; valid input passed through; handler safe to attach twice. |

Counts: 30 + 14 + 6 = **50**; points 60 + 42 + 48 = **150**.

---

## A.4 — Week 4 exam · "Git, Deployment & Final Project"

Existing lectures this exam draws on:
**L1** "Git Fundamentals & the Three Areas" ·
**L2** "Branching, Pull Requests & Collaboration" ·
**L3** "Deployment & Going Live"

> **Design constraint, stated plainly.** Git is not executable in a browser
> runtime and is not a Piston language, so this week cannot be graded by running
> git. Two consequences, both deliberate:
>
> 1. **`code_fix` items need no runtime at all** — the format is a broken
>    artefact plus four candidate patches, exactly one correct. For this week the
>    artefacts are command sequences, `.gitignore` files, merge-conflict-marked
>    files, relative asset paths and CI workflow YAML. These are the most
>    faithful possible representation of the week's real content.
> 2. **`code_write` items are `javascript`** and operate on git- and
>    deployment-*derived text*: parsing `git status --porcelain` output, validating
>    a commit-message convention, computing a version bump, rewriting
>    root-relative paths, detecting leftover conflict markers, and scanning a diff
>    for committed secrets. Each is deterministically test-gradeable in the
>    browser and each tests something the lecture actually taught. This is the
>    honest available design; a "write the git command" free-form item cannot be
>    auto-graded and is therefore represented as `code_fix` instead.

| Slot | Lecture | Focus |
|---|---|---|
| mcq 1–4 | L1 | working directory, staging area, repository; what `git add` does and does not do |
| mcq 5–7 | L1 | what `git status` and `git log --oneline` report; committing a subset of changes |
| mcq 8–10 | L1 | commit-message convention: imperative mood, why over what |
| mcq 11–14 | L2 | branch creation and switching; why the default branch is not a workspace |
| mcq 15–17 | L2 | pull requests as the review point; `main`/`develop`/`feature/*` as used by this repo |
| mcq 18–20 | L2 | conflict markers, resolution, and what a committed marker looks like |
| mcq 21–24 | L3 | static hosting and continuous deployment from a tracked branch |
| mcq 25–27 | L3 (traps) | root-relative versus page-relative paths on a subdirectory-hosted site |
| mcq 28–30 | L1–L3 (traps) | secrets in history; the pre-launch checklist; why deleting a file does not remove it from history |
| code_fix 31–35 | L1 (5) | `git commit` expected to include unstaged work; a commit message describing the diff instead of the reason; a `.gitignore` that misses a build directory; `git add .` sweeping in a secret; an amend used where a new commit was correct |
| code_fix 36–40 | L2 (5) | work committed directly to the default branch; a branch name that says nothing; a resolution that deletes the wrong side; a file committed with conflict markers still in it; a force-push proposed where a merge was correct |
| code_fix 41–44 | L3 (4) | `/styles.css` breaking on a subdirectory-hosted site; a missing build step in the deploy workflow; a secret injected as a literal in CI YAML; a redirect to HTTPS without HSTS |
| code_write 45 | L1 | Parse `git status --porcelain` text and return staged and unstaged file lists. Tests: mixed statuses; renames; an empty tree; untracked files excluded from staged. |
| code_write 46 | L1 | Validate a commit message against a stated convention. Tests: a compliant message; a wrong-mood subject; an over-length subject; a missing blank line before the body. |
| code_write 47 | L2 | Detect leftover conflict markers in a file's text. Tests: all three marker kinds; a false-positive candidate inside a code fence; a clean file; multiple conflicted regions. |
| code_write 48 | L2 | Given a list of commits, compute the next semantic version. Tests: patch only; a feature present; a breaking change present; an empty commit list. |
| code_write 49 | L3 | Rewrite root-relative asset paths to page-relative ones. Tests: `href` and `src` both handled; an external absolute URL left untouched; a protocol-relative URL left untouched; an already-relative path unchanged. |
| code_write 50 | L3 | Scan supplied diff text for committed secrets against stated patterns. Tests: a connection string; a token-shaped literal; a false-positive placeholder that must not be flagged; a clean diff. |

Counts: 30 + 14 + 6 = **50**; points 60 + 42 + 48 = **150**.

### Section A totals

4 exams × 50 questions = **200 questions**; 4 × 150 = **600 points**;
by type across all four exams: 120 `mcq` (240 pts) + 56 `code_fix` (168 pts) +
24 `code_write` (192 pts) = 200 questions / 600 points ✓

---

# Section B — Coding-problem catalogue

Seven tracks × three levels × eight problems = **168 problems**. Every statement
below is original wording. The *patterns* are standard and not ownable; the
*phrasing* is this file's own. No problem is a renamed copy of a specific
third-party exercise — where a pattern is conventionally taught with a well-known
framing, the framing here is deliberately different (different domain, different
input shape, or a different reported result) so that no external statement is
being reused.

**Format.** Each entry is: slug · title · pattern · one-line task · language ·
suggested test-case shapes · progressive hints. Test-case shapes describe what to
test, not literal fixtures; the implementing stream writes the fixtures and keeps
the hidden ones out of every client payload. Completion is derived from a passing
`coding_attempts` row, never from a `solved` flag.

---

## B.1 — JavaScript (`js-`)

### Beginner

- `js-even-odd-split` · **Split by Parity** · pattern: single-pass partition · Return two lists from one list of integers: those divisible by two and those not. · javascript · tests: mixed list · all even · all odd · empty list · hints: (1) You need two accumulators, not one. (2) The remainder operator answers the question in one expression. (3) Push into whichever accumulator the test selects; return both.
- `js-running-total` · **Running Total** · pattern: fold / reduce · Given a list of numbers, return a list of the same length where each position holds the sum of everything up to and including it. · javascript · tests: positive numbers · includes negatives · single element · empty list · hints: (1) Each output depends on the previous output, not on re-summing. (2) Keep one carried variable. (3) The first output equals the first input.
- `js-vowel-tally` · **Vowel Tally** · pattern: character counting · Count how many vowels a string contains, case-insensitively. · javascript · tests: mixed case · no vowels · empty string · non-letter characters present · hints: (1) Normalise case once, before you loop. (2) A set of vowels makes the membership test one call. (3) Non-letters simply are not in the set.
- `js-longest-word` · **Longest Word** · pattern: linear scan with best-so-far · Return the longest whitespace-separated word in a sentence; on a tie return the earliest. · javascript · tests: clear winner · tie · single word · trailing and repeated spaces · hints: (1) Split, then track the best you have seen. (2) Use strict greater-than so ties keep the earlier word. (3) Filter out empty pieces produced by repeated spaces.
- `js-title-case` · **Title Case a Phrase** · pattern: map over tokens · Capitalise the first letter of every word in a phrase and lowercase the rest. · javascript · tests: all lowercase input · all uppercase input · single word · empty string · hints: (1) Work word by word. (2) The first character and the remainder are handled differently. (3) Rejoin with a single space only if the original spacing does not matter — check the spec.
- `js-fizz-report` · **Divisibility Report** · pattern: conditional mapping · For each integer from 1 to n, report the word for divisibility by three, by five, by both, or the number itself. · javascript · tests: n = 15 · n = 1 · n = 0 · a value divisible by both · hints: (1) Test the "both" case first or you will never reach it. (2) Build a list, do not print. (3) n = 0 should produce an empty list, not an error.
- `js-array-flatten-one` · **Flatten One Level** · pattern: accumulate nested items · Given a list whose elements may themselves be lists, produce a list flattened by exactly one level. · javascript · tests: mixed nesting · no nesting · deeply nested (only one level removed) · empty inner lists · hints: (1) Only one level — do not recurse. (2) Check each element's type before spreading it. (3) An empty inner list contributes nothing.
- `js-unique-preserve-order` · **Unique, Order Preserved** · pattern: set-based deduplication · Remove duplicate values from a list while keeping the first occurrence of each in place. · javascript · tests: duplicates adjacent · duplicates separated · all identical · empty list · hints: (1) A set answers "have I seen this". (2) Build the output as you scan; do not sort. (3) Adding to the set and pushing to the output happen together.

### Intermediate

- `js-pair-sum-lookup` · **Find a Pair Summing to a Target** · pattern: hash-map complement lookup · Given a list of integers and a target, return the two positions whose values add to the target, or report that none exist. · javascript · tests: exactly one pair · no pair · duplicate values forming the pair · negative numbers · hints: (1) The nested-loop version works; find the version that scans once. (2) As you visit each value, ask whether its complement has already been seen. (3) Store value → position as you go, and check before you store.
- `js-window-max-sum` · **Best Fixed Window** · pattern: fixed-size sliding window · Return the largest sum obtainable from any k consecutive numbers in a list. · javascript · tests: k smaller than the list · k equal to the list length · k larger than the list · negatives present · hints: (1) Compute the first window directly. (2) Moving the window adds one number and removes one. (3) k larger than the list is an error case the spec must define.
- `js-longest-unique-run` · **Longest Run Without Repeats** · pattern: variable-size sliding window · Return the length of the longest stretch of a string containing no repeated character. · javascript · tests: all distinct · all identical · repeats far apart · empty string · hints: (1) Two indices define the current stretch. (2) On a repeat, move the left index past the previous occurrence. (3) Remember the best length seen, not just the current one.
- `js-group-by-key` · **Group Records by Field** · pattern: hash-map bucketing · Group a list of objects into buckets keyed by a named field's value. · javascript · tests: several buckets · one bucket · missing field on a record · empty list · hints: (1) The result is an object of arrays. (2) Create the bucket the first time you need it. (3) Decide explicitly what a missing field does — do not let it become the string "undefined" by accident.
- `js-bracket-balance` · **Balanced Delimiters** · pattern: stack matching · Decide whether a string's round, square and curly delimiters are correctly nested and closed. · javascript · tests: balanced nesting · wrong closing type · unclosed opener · unmatched closer first · hints: (1) A stack remembers what must close next. (2) A closer must match the top of the stack, not just any opener. (3) A non-empty stack at the end is a failure.
- `js-debounce-calls` · **Debounce a Function** · pattern: timer-based rate control · Wrap a function so that rapid repeated calls result in a single invocation after a quiet period. · javascript · tests: burst of calls yields one invocation · spaced calls yield several · latest arguments are the ones used · cancelling before the delay · hints: (1) Keep the pending timer id in the closure. (2) Every new call clears the previous timer. (3) The arguments you keep are the most recent ones.
- `js-deep-equal` · **Structural Equality** · pattern: recursive comparison · Decide whether two nested values are structurally equal. · javascript · tests: equal nested objects · different key order · different lengths · `null` versus missing key · hints: (1) Compare types first, then structure. (2) Objects need the same key count and every key matching. (3) Arrays and objects need different length checks — do not conflate them.
- `js-paginate` · **Paginate a List** · pattern: index arithmetic with bounds · Return the requested page of a list given a page number and a page size, plus the total page count. · javascript · tests: first page · last partial page · page beyond the end · page size larger than the list · hints: (1) Start index is derived from page number and size. (2) Guard against a page beyond the end rather than returning garbage. (3) Total page count rounds up.

### Advanced

- `js-lru-store` · **Least-Recently-Used Store** · pattern: map plus recency ordering · Implement a fixed-capacity key/value store that evicts the least recently used entry when full. · javascript · tests: eviction order after reads · overwrite of an existing key · capacity of one · reads that promote recency · hints: (1) A read must count as use, not just a write. (2) Insertion-ordered maps give you recency for free if you delete and re-set. (3) Evict before inserting, not after.
- `js-event-emitter` · **Event Emitter** · pattern: observer registry · Implement subscribe, unsubscribe and emit for named events, with multiple listeners per event. · javascript · tests: several listeners called in order · unsubscribe during emit · emit with no listeners · the same listener added twice · hints: (1) The registry is a map from name to listener list. (2) Iterate over a copy so unsubscribing mid-emit is safe. (3) Decide and document whether duplicate registration means one call or two.
- `js-async-pool` · **Bounded Concurrency Runner** · pattern: worker pool over promises · Run a list of asynchronous tasks with at most n in flight at any moment and return results in input order. · javascript · tests: fewer tasks than the limit · more tasks than the limit · one task rejecting · empty task list · hints: (1) Results must be ordered by input index, not by completion. (2) Start a replacement task the moment one finishes. (3) Decide whether one rejection aborts the rest and implement that consistently.
- `js-retry-with-backoff` · **Retry with Backoff** · pattern: bounded retry loop · Wrap an async operation with retries, exponential delay and a maximum attempt count. · javascript · tests: success first try · success on the third try · exhausted attempts · a non-retryable error surfacing immediately · hints: (1) Not every failure should be retried — classify first. (2) Delay grows per attempt; add jitter to avoid synchronised retries. (3) On exhaustion, report the last error and the attempt count.
- `js-template-render` · **Safe Template Renderer** · pattern: parse and substitute with escaping · Replace named placeholders in a template string with supplied values, escaping each value for HTML text. · javascript · tests: several placeholders · a value containing angle brackets and quotes · a missing key · a literal placeholder-like sequence that must not be substituted · hints: (1) Escape the value, never the template. (2) A missing key must be an explicit decision, not `undefined` in the output. (3) Escaping is per destination context — this one is HTML text.
- `js-immutable-update` · **Immutable Nested Update** · pattern: structural sharing · Return a new object with one deeply nested field changed and every untouched branch shared. · javascript · tests: two-level path · path that does not exist · original object unmodified · array element in the path · hints: (1) Copy only the nodes on the path. (2) The original must be unchanged — assert that in your own test first. (3) Arrays on the path need array copies, not object copies.
- `js-topological-order` · **Dependency Order** · pattern: topological sort with cycle detection · Given tasks and their prerequisites, return a valid execution order or report a cycle. · javascript · tests: linear chain · diamond dependency · cycle present · isolated nodes · hints: (1) Count incoming edges per node. (2) Repeatedly take a node with none left. (3) If nodes remain but none has zero incoming edges, you have a cycle.
- `js-diff-lists` · **List Difference Report** · pattern: two-set comparison keyed by identity · Compare two lists of records by a key field and report additions, removals and changes. · javascript · tests: pure additions · pure removals · a changed field · reordered but unchanged · hints: (1) Index both sides by key before comparing. (2) Reordering alone is not a change. (3) "Changed" needs a field-level comparison, not object identity.

---

## B.2 — Python (`py-`)

### Beginner

- `py-sum-of-digits` · **Sum of Digits** · pattern: digit extraction loop · Return the sum of the decimal digits of a non-negative integer. · python · tests: multi-digit · single digit · zero · a value with a zero digit inside it · hints: (1) Modulo ten gives you the last digit. (2) Integer division removes it. (3) Zero must return zero, not loop forever.
- `py-count-words` · **Word Frequencies** · pattern: dictionary counting · Return a mapping from each word in a sentence to how many times it appears, case-insensitively. · python · tests: repeated words · all distinct · punctuation attached to words · empty string · hints: (1) Normalise case before counting. (2) Decide how punctuation is handled and say so. (3) A default-valued mapping removes the "first time" branch.
- `py-list-stats` · **Basic Statistics** · pattern: single-pass aggregation · Return the minimum, maximum and mean of a list of numbers. · python · tests: mixed values · single element · all equal · empty list raises or returns a defined value · hints: (1) One pass can compute all three. (2) Decide the empty-list behaviour before you write the loop. (3) The mean is a float even when the inputs are integers.
- `py-reverse-in-place` · **Reverse a List in Place** · pattern: two-pointer swap · Reverse a list without creating a second list. · python · tests: even length · odd length · single element · empty list · hints: (1) One index from each end, moving inward. (2) Stop when they meet. (3) The middle element of an odd-length list needs no swap.
- `py-clean-csv-row` · **Clean a Delimited Row** · pattern: split, strip, coerce · Turn a comma-separated line into a list of trimmed values, converting numeric-looking fields to numbers. · python · tests: mixed types · surrounding whitespace · an empty field · a field that looks numeric but is not · hints: (1) Split first, then clean each field. (2) A try/except around conversion is clearer than a pattern test. (3) An empty field is not zero unless the spec says so.
- `py-temperature-band` · **Classify a Measurement** · pattern: branching over ranges · Given a temperature in degrees Celsius, return the band it falls into from a defined set of ranges. · python · tests: each band · an exact boundary value · a value below the lowest band · a value above the highest · hints: (1) Order your comparisons so no value matches twice. (2) Boundaries belong to exactly one band — decide which. (3) Return a value; do not print.
- `py-set-operations` · **Compare Two Collections** · pattern: set algebra · Report items present in both collections, only in the first, and only in the second. · python · tests: overlap present · no overlap · identical collections · one collection empty · hints: (1) Convert to sets once. (2) Intersection and difference are single operations. (3) Difference is not symmetric — you need both directions.
- `py-nested-lookup` · **Safe Nested Lookup** · pattern: guarded traversal · Given a nested mapping and a path of keys, return the value at that path or a supplied default. · python · tests: full path exists · path breaks halfway · path is empty · an intermediate value is not a mapping · hints: (1) Walk the path one key at a time. (2) Stop as soon as a step fails. (3) A non-mapping intermediate is a miss, not a crash.

### Intermediate

- `py-anagram-groups` · **Group Rearrangements** · pattern: canonical-key hashing · Group words that are rearrangements of one another. · python · tests: several groups · no group larger than one · differing cases · empty input · hints: (1) Two rearrangements share something canonical. (2) Sorted letters make a usable key. (3) Group into a mapping from key to word list.
- `py-merge-intervals` · **Merge Overlapping Ranges** · pattern: sort then sweep · Given a list of numeric ranges, return the minimal list of merged non-overlapping ranges. · python · tests: overlapping pairs · touching but not overlapping · fully contained range · single range · hints: (1) Sort by start before anything else. (2) Extend the current range while the next one starts inside it. (3) Decide whether touching ranges merge and be consistent.
- `py-binary-search-first` · **First Position of a Value** · pattern: binary search variant · In a sorted list with duplicates, return the index of the first occurrence of a value, or report absence. · python · tests: value present multiple times · present once · absent · empty list · hints: (1) Standard binary search finds *some* occurrence. (2) On a match, keep searching left rather than returning. (3) Prove termination on your bounds before trusting the result.
- `py-matrix-rotate` · **Rotate a Square Grid** · pattern: index transformation in place · Rotate a square grid a quarter turn clockwise without allocating a second grid. · python · tests: 1×1 · 2×2 · 3×3 · 4×4 · hints: (1) Transposing and then reversing each row achieves it. (2) Transpose by swapping across the diagonal only once per pair. (3) Verify with a grid whose values are all distinct.
- `py-flatten-deep` · **Flatten Fully** · pattern: recursion over nested structure · Flatten an arbitrarily nested list of numbers into a single flat list. · python · tests: deep nesting · already flat · empty inner lists · a single scalar · hints: (1) Each element is either a scalar or a list. (2) Recurse on lists, append scalars. (3) Guard against a non-list top-level input.
- `py-lru-cache-decorator` · **Memoise a Function** · pattern: caching decorator · Write a decorator that caches a pure function's results by its arguments. · python · tests: repeated call served from cache · different arguments computed separately · unhashable argument handled · cache size respected · hints: (1) The arguments tuple is the key. (2) A wrapper closure holds the cache. (3) Unhashable arguments must not crash — decide the fallback.
- `py-validate-schema` · **Validate a Record** · pattern: declarative validation · Given a field specification, validate a record and return the list of violations. · python · tests: valid record · missing required field · wrong type · value out of range · hints: (1) Collect all violations; do not stop at the first. (2) Each rule is independent — that makes them testable. (3) An unexpected extra field is a policy decision, not an oversight.
- `py-top-k` · **Top K Items** · pattern: bounded heap · Return the k largest values from a list, in descending order. · python · tests: k smaller than the list · k equal to the list length · k larger than the list · ties present · hints: (1) Sorting works but does more than needed. (2) A heap of size k bounds the memory. (3) Define the tie ordering rather than leaving it to chance.

### Advanced

- `py-word-ladder` · **Shortest Transformation Chain** · pattern: breadth-first search over implicit graph · Given a start word, a target word and a dictionary, return the fewest single-letter changes needed to get from start to target. · python · tests: reachable in a few steps · unreachable · start equals target · dictionary missing the target · hints: (1) Words are nodes; a one-letter difference is an edge. (2) BFS gives the fewest steps; DFS does not. (3) Mark words as visited when you enqueue, not when you dequeue.
- `py-edit-distance` · **Minimum Edits Between Strings** · pattern: two-dimensional dynamic programming · Return the fewest single-character insertions, deletions or substitutions that turn one string into another. · python · tests: identical strings · one empty string · single substitution · full rewrite · hints: (1) Define your table cell in words before you write any loop. (2) Row zero and column zero are the base cases. (3) Three predecessors feed each cell.
- `py-coin-combinations` · **Ways to Make an Amount** · pattern: one-dimensional dynamic programming · Count the distinct combinations of given denominations that sum to a target amount. · python · tests: reachable amount · unreachable amount · amount zero · a single denomination · hints: (1) Amount zero has exactly one combination — the empty one. (2) Iterate denominations outside and amounts inside to count combinations, not permutations. (3) Swapping the loop order changes the answer; know which you want.
- `py-schedule-tasks` · **Maximum Non-Overlapping Tasks** · pattern: greedy by earliest finish · Given tasks with start and end times, return the largest set that can run without overlap. · python · tests: nested tasks · identical times · already sorted input · single task · hints: (1) Sorting by start time gives the wrong answer — try a counterexample. (2) Sort by finish time and take greedily. (3) A task is compatible if it starts no earlier than the last finish.
- `py-union-find-components` · **Count Connected Groups** · pattern: disjoint-set union · Given items and pairwise links, count the number of connected groups. · python · tests: fully connected · fully disconnected · duplicate links · a self-link · hints: (1) Each item starts as its own group. (2) Union reduces the count only when the roots differ. (3) Path compression keeps the repeated lookups cheap.
- `py-dijkstra-path` · **Cheapest Route** · pattern: Dijkstra with a priority queue · Given a weighted graph with non-negative weights, return the cheapest total cost from a source to a destination. · python · tests: unique cheapest path · two equal-cost paths · destination unreachable · a graph with a single node · hints: (1) Always settle the cheapest unsettled node next. (2) A node may be pushed several times; skip it if already settled. (3) Non-negative weights are a precondition, not a detail.
- `py-lis-length` · **Longest Increasing Run (Non-Contiguous)** · pattern: dynamic programming with binary search · Return the length of the longest strictly increasing subsequence of a list. · python · tests: strictly increasing input · strictly decreasing input · plateau of equal values · single element · hints: (1) State the meaning of your table entry precisely. (2) The quadratic version is a fine first solution. (3) The faster version maintains the smallest possible tail for each length.
- `py-stream-median` · **Running Median** · pattern: two heaps · Report the median after each value in a stream of numbers. · python · tests: odd count · even count · sorted input · reversed input · hints: (1) Keep the lower half and the upper half separately. (2) A max-heap and a min-heap keep both halves ordered at the boundary. (3) Rebalance so the size difference never exceeds one.

---

## B.3 — HTML (`html-`)

Graded by parsing the submitted markup and asserting structural, semantic and
accessibility properties. No rendering engine is required, which is what makes
these deterministically test-gradeable in the browser.

### Beginner

- `html-valid-skeleton` · **A Valid Document Skeleton** · pattern: required document structure · Produce a minimal standards-mode document with a language, a character set and a given title. · html · tests: doctype first · `lang` non-empty · charset meta present · exactly one `<title>` with the given text · hints: (1) The doctype is not a tag and must come first. (2) Metadata lives in the head, content in the body. (3) One title, and it is not an `<h1>`.
- `html-heading-outline` · **A Correct Heading Outline** · pattern: hierarchical document outline · Mark up a supplied outline using heading levels with no gaps. · html · tests: exactly one `<h1>` · no skipped level · order matches the outline · no heading used for styling only · hints: (1) Heading level is meaning, not size. (2) Never jump from `h2` to `h4`. (3) If you want smaller text, that is a CSS problem.
- `html-image-alts` · **Alt Text, Three Ways** · pattern: alternative text semantics · Mark up one informative image, one decorative image and one image that is also a link. · html · tests: informative `alt` non-empty · decorative `alt` present and empty · no image missing `alt` · the linked image's text describes the destination · hints: (1) Empty and absent are not the same. (2) Decorative means assistive technology should skip it. (3) For a linked image the alternative text describes where it goes.
- `html-list-structures` · **Ordered, Unordered, Described** · pattern: choosing the right list · Represent three supplied data sets as an ordered list, an unordered list and a description list. · html · tests: correct element per data set · only list items as direct children · description list pairs balanced · no nested list broken · hints: (1) Order matters only in one of the three. (2) A description list pairs terms with descriptions. (3) Only list-item elements may be direct children of a list.
- `html-link-targets` · **Links That Behave** · pattern: safe outbound linking · Produce an internal link, an outbound link opened in a new tab, and a link to a document download. · html · tests: outbound link carries `rel="noopener noreferrer"` · internal link is page-relative · link text is descriptive · no "click here" text · hints: (1) A new tab needs the security attribute. (2) Link text must make sense read out of context. (3) Relative paths survive being hosted in a subdirectory.
- `html-labelled-form` · **A Labelled Form** · pattern: label/control association · Build a form with three named fields, each correctly labelled, plus a submit control. · html · tests: every control has an `id` · every label's `for` matches · appropriate `type` per field · submit control inside the form · hints: (1) The `for` value is the control's `id`, not its name. (2) Placeholder text is not a label. (3) The right input type gives you validation and the right mobile keyboard for free.
- `html-data-table` · **A Data Table** · pattern: tabular semantics · Represent supplied results as a table with a caption and scoped header cells. · html · tests: `<caption>` present · every header cell scoped · row and column counts match the data · no layout-only nesting · hints: (1) A caption describes the table, not the page. (2) `scope` tells assistive technology which cells a header governs. (3) Tables are for data; layout is CSS's job.
- `html-landmarks` · **Page Landmarks** · pattern: semantic regions · Wrap a supplied page's regions in the correct landmark elements. · html · tests: exactly one `<main>` · navigation wrapped in `<nav>` · footer content in `<footer>` · no landmark replaced by a `<div>` · hints: (1) Each landmark answers "what is this region". (2) Only one main region per page. (3) A `<div>` conveys nothing to a screen reader.

### Intermediate

- `html-accessible-error-summary` · **Form Errors Announced** · pattern: accessible error reporting · Extend a form so validation errors are associated with their fields and announced. · html · tests: each error referenced by its field · error container is a live region · invalid state marked on the control · error text is specific, not generic · hints: (1) Associate the message with the control, do not just place it nearby. (2) A live region is how a change gets announced. (3) "Invalid input" tells the user nothing actionable.
- `html-progressive-media` · **Responsive Images** · pattern: multiple sources with fallback · Provide a responsive image with several widths and a single-source fallback. · html · tests: multiple candidate widths declared · a sizes hint present · fallback source present · alternative text present · hints: (1) The browser chooses; you describe the options. (2) Without a sizes hint the choice is made on bad information. (3) The fallback must work when nothing else does.
- `html-nested-navigation` · **A Nested Navigation Menu** · pattern: hierarchical navigation markup · Build a two-level navigation menu that is keyboard-reachable and marks the current page. · html · tests: nested lists structurally valid · current page marked · every item reachable by keyboard order · no interactive element inside another · hints: (1) A menu is a list of links, not a pile of divs. (2) Marking the current page is a real accessibility requirement. (3) Nesting a button inside a link is invalid and confusing.
- `html-metadata-and-sharing` · **Document Metadata** · pattern: head metadata completeness · Populate a document head with the metadata a page needs to be indexed and shared correctly. · html · tests: charset first in the head · viewport present · description present and non-duplicate · canonical reference present · hints: (1) Character set declaration comes before anything that could contain text. (2) A missing viewport makes every media query irrelevant. (3) Canonical resolves duplicate-URL ambiguity.
- `html-form-validation-attrs` · **Native Validation** · pattern: declarative constraint attributes · Express supplied field constraints using native validation attributes only. · html · tests: required fields marked · numeric bounds expressed · pattern constraint present where specified · no JavaScript in the submission · hints: (1) The platform validates before your code runs. (2) A pattern constraint needs an accompanying human-readable hint. (3) Native validation is a convenience — the server still validates.
- `html-iframe-embedding` · **Embedding Safely** · pattern: sandboxed embedding · Embed third-party content with the narrowest capability set that still works, and provide a fallback link. · html · tests: sandbox attribute present · title attribute present · a visible fallback link exists · no unnecessary capability granted · hints: (1) Start with everything denied and add back only what is needed. (2) An embed needs an accessible name. (3) Some sites refuse to be embedded at all — that is what the fallback is for.
- `html-semantic-article` · **A Semantic Article** · pattern: content semantics beyond landmarks · Mark up an article with time, quotations, abbreviations, emphasis and citations correctly. · html · tests: machine-readable date present · block quotation cites its source · abbreviation expanded on first use · emphasis versus importance used correctly · hints: (1) A displayed date and a machine-readable date are both needed. (2) Emphasis and importance are different elements with different meanings. (3) A quotation without a source is an assertion.
- `html-skip-and-focus` · **Skip Link and Focus Order** · pattern: keyboard navigation structure · Add a skip link and ensure the document's focus order matches its reading order. · html · tests: skip link is the first focusable element · its target exists and is focusable · no positive tab index used · focus order matches document order · hints: (1) The skip link must come first in the document, not just look first. (2) Its target needs to be able to receive focus. (3) Positive tab indexes fight the browser and lose.

### Advanced

- `html-accessible-dialog` · **An Accessible Dialog** · pattern: modal semantics and focus management · Mark up a modal dialog with the correct role, an accessible name, and a defined focus entry point. · html · tests: dialog role present · accessible name associated · initial focus target identified · background content marked inert or hidden · hints: (1) A dialog needs a name derived from its own heading. (2) Focus must enter the dialog and not escape behind it. (3) Content behind a modal should not be reachable.
- `html-data-table-complex` · **A Table With Merged Headers** · pattern: complex tabular relationships · Represent a two-level header table so that every data cell's headers are unambiguous. · html · tests: header/data relationships resolvable · spans consistent with the grid · caption and summary present · no header cell without an association · hints: (1) Column spans and row spans must add up to a rectangle. (2) With two header levels, `scope` alone may not be enough. (3) If you cannot explain a cell's headers, neither can assistive technology.
- `html-form-multistep` · **A Multi-Step Form** · pattern: grouped controls with progress · Build a three-step form using field groups, a legend per group, and a stated position in the sequence. · html · tests: each step is a labelled group · one legend per group · position communicated in text, not colour alone · no control outside a group · hints: (1) A group of related controls needs a group element and a legend. (2) Progress must be conveyed textually. (3) Colour alone is never sufficient information.
- `html-microdata-listing` · **Structured Data for a Listing** · pattern: machine-readable annotation · Annotate a course listing so its title, provider, dates and price are machine-readable. · html · tests: required properties present · types consistent · dates machine-readable · no annotation contradicting the visible text · hints: (1) Annotate what is visible; do not invent data. (2) Types and properties come in matched sets. (3) A mismatch between markup and visible content is a defect, not an optimisation.
- `html-content-security-friendly` · **Markup That Survives a Strict Policy** · pattern: no inline behaviour · Rewrite a page containing inline event handlers and inline styles so it works under a strict content policy. · html · tests: no inline event handler attributes · no inline style attributes · behaviour referenced from external files · functionality preserved in the reference build · hints: (1) Inline handlers are the first thing a strict policy blocks. (2) Behaviour belongs in a script file, appearance in a stylesheet. (3) If it only works with the policy relaxed, it does not work.
- `html-email-safe-fragment` · **A Constrained-Renderer Fragment** · pattern: markup under a restricted feature set · Produce a content fragment that renders acceptably where modern layout features are unavailable. · html · tests: no reliance on the unavailable features · content readable in document order · alternative text present · no external dependency required · hints: (1) Assume the renderer supports very little. (2) Document order is your only reliable layout. (3) Degrade to readable, not to broken.
- `html-i18n-document` · **A Document in Two Languages** · pattern: language and direction annotation · Mark up a document whose body is in one language and whose quotations are in another, including a right-to-left passage. · html · tests: document language declared · per-element language overrides present · direction declared where it changes · no direction inherited incorrectly · hints: (1) Language is declared once at the document level and overridden per element. (2) Direction is separate from language. (3) A wrongly inherited direction reorders punctuation visibly.
- `html-audit-and-repair` · **Audit and Repair a Page** · pattern: systematic accessibility repair · Given a page with eight seeded defects, repair all of them and list each defect you fixed. · html · tests: each seeded defect resolved · no new defect introduced · the written list matches the changes · document remains valid · hints: (1) Work from a checklist so you do not stop at the obvious three. (2) Fix the cause, not the symptom. (3) Your written list is part of the answer.

---

## B.4 — CSS (`css-`)

Graded by parsing the submitted declarations and asserting the presence, absence
and values of specific properties, selectors and at-rules — deterministic, and
runnable in the browser with no layout engine.

### Beginner

- `css-selector-targets` · **Target Exactly These Elements** · pattern: selector precision · Write selectors that match a stated set of elements and nothing else. · css · tests: required elements matched · excluded elements unmatched · no id selector used · no universal selector used · hints: (1) Describe the elements in words first, then translate. (2) Combinators narrow more cheaply than adding classes. (3) The lowest specificity that works is the right answer.
- `css-box-sizing` · **Fix the Overflow** · pattern: box model correction · Make a full-width element with padding and a border fit inside its parent. · css · tests: `box-sizing: border-box` applied globally · no negative margins · element width does not exceed the parent · padding retained · hints: (1) By default width excludes padding and border. (2) Set the box model once, globally. (3) Do not fix arithmetic by subtracting pixels by hand.
- `css-typography-scale` · **A Readable Type Scale** · pattern: relative units and rhythm · Define a heading and body type scale in relative units with a stated line height. · css · tests: no absolute pixel font sizes · line height unitless · scale monotonic · root size not overridden below the default · hints: (1) Relative units respect the user's chosen size. (2) A unitless line height scales with the font. (3) Never shrink the root size to make a design fit.
- `css-colour-and-contrast` · **Accessible Colour Pairs** · pattern: contrast-aware colour choice · Define text and background colours meeting a stated contrast ratio for three components. · css · tests: each pair meets the stated ratio · colour not the only state indicator · custom properties used for the palette · no hard-coded duplicate colour values · hints: (1) Compute the ratio; do not eyeball it. (2) State must be visible without colour perception. (3) Name your colours once and reuse them.
- `css-flex-row` · **A Toolbar Row** · pattern: one-dimensional layout · Lay out a toolbar with items grouped left and right, vertically centred. · css · tests: `display: flex` present · main-axis distribution set · cross-axis centring set · no absolute positioning · hints: (1) Main axis and cross axis are different properties. (2) Grouping can be done with an auto margin. (3) Centring vertically is a cross-axis job.
- `css-centre-a-card` · **Centre a Card** · pattern: two-axis centring · Centre a card both horizontally and vertically in a full-height stage. · css · tests: centring achieved through flex or grid · no transform-based hack · stage has a defined height · card size unconstrained · hints: (1) Both axes, one container. (2) The stage needs a height for vertical centring to mean anything. (3) The card should not need a fixed size.
- `css-grid-gallery` · **A Card Grid** · pattern: intrinsic responsive grid · Build a card grid that adapts its column count with no media query. · css · tests: `display: grid` present · `repeat(auto-fit, minmax(...))` present · a `gap` declared · no fixed column count · hints: (1) Let the tracks decide how many fit. (2) A minimum track size prevents unreadably narrow cards. (3) `gap` replaces margin arithmetic.
- `css-hover-and-focus` · **Interactive States** · pattern: state styling completeness · Style hover, focus-visible, active and disabled states for a button. · css · tests: all four states styled · focus indicator visible and not removed · disabled state not relying on colour alone · no outline removed without replacement · hints: (1) Keyboard users need a visible focus indicator. (2) Removing the outline without replacing it is an accessibility regression. (3) Disabled must be perceivable without colour.

### Intermediate

- `css-specificity-battle` · **Win Without `!important`** · pattern: cascade resolution · Given three conflicting rules, add a fourth that wins under a stated specificity ceiling. · css · tests: your rule wins · `!important` absent · specificity within the ceiling · other elements unaffected · hints: (1) Compute the specificity of each existing rule first. (2) Source order breaks ties at equal specificity. (3) A more specific selector is not the only lever.
- `css-mobile-first-layout` · **Mobile-First Two Columns** · pattern: progressive enhancement with media queries · Write styles that are single-column by default and two-column above a stated width. · css · tests: base rules contain no media query · exactly one `min-width` query · breakpoint in relative units · no `max-width` query · hints: (1) Base styles are the small screen. (2) Each query adds capability rather than undoing it. (3) A relative breakpoint respects the user's font size.
- `css-sticky-header` · **A Sticky Header** · pattern: positioning contexts · Make a header stick to the top while scrolling without overlapping focused content. · css · tests: sticky positioning used · offset defined · scroll-margin applied to anchor targets · no fixed positioning that breaks small screens · hints: (1) Sticky needs an offset to have any effect. (2) Anchored links land under a sticky header unless you compensate. (3) Fixed and sticky are different mechanisms.
- `css-custom-properties-theme` · **A Themeable Palette** · pattern: custom properties and scoping · Define a palette in custom properties and provide a dark variant driven by user preference. · css · tests: palette defined once at the root · components reference variables only · a preference-based override present · no colour value duplicated across components · hints: (1) Declare once, consume everywhere. (2) The override changes the variables, not the components. (3) Both preference directions need to work.
- `css-truncate-and-wrap` · **Long Content That Behaves** · pattern: overflow control · Ensure long words, long URLs and wide tables do not break the page layout. · css · tests: no horizontal page overflow · long words wrap or break · wide table scrolls inside its own container · truncation shows an indicator · hints: (1) The page must never scroll horizontally. (2) Wide content scrolls inside its own container. (3) Truncation without an indicator hides information silently.
- `css-form-layout` · **A Form That Reflows** · pattern: grid-based form layout · Lay out a label-and-field form that becomes side-by-side above a breakpoint and stacked below it. · css · tests: stacked by default · side-by-side above the breakpoint · labels aligned with their controls · no fixed heights · hints: (1) A two-column grid describes label and control cleanly. (2) Stacked is the base, side-by-side is the enhancement. (3) Fixed heights break as soon as text wraps.
- `css-print-stylesheet` · **A Print Stylesheet** · pattern: media-specific styling · Provide print styles that hide navigation, expand link destinations and avoid awkward page breaks. · css · tests: print media query present · navigation hidden in print · link destinations shown · page-break rules applied to headings · hints: (1) Print is a medium with different constraints, not a smaller screen. (2) A link's destination is invisible on paper unless you print it. (3) Keep a heading with the content it introduces.
- `css-reduced-motion` · **Respect Reduced Motion** · pattern: preference-aware animation · Animate a component, then degrade it to a static equivalent for users who prefer reduced motion. · css · tests: animation present by default · reduced-motion query present · static variant still conveys the same information · no information lost in the static variant · hints: (1) Degrade to a static diagram, not to nothing. (2) Removing information is not the same as removing motion. (3) The preference query is the mechanism; the design decision is yours.

### Advanced

- `css-container-queries` · **Component-Level Responsiveness** · pattern: container-based sizing · Make a card component change layout based on its container's width rather than the viewport's. · css · tests: container declared · container query present · component correct at two container widths · no viewport media query used for this component · hints: (1) A component reused in a sidebar and a main column cannot rely on the viewport. (2) The container must opt in before it can be queried. (3) Viewport queries are the wrong tool here on purpose.
- `css-layered-cascade` · **Order the Cascade Deliberately** · pattern: cascade layers · Organise reset, framework and component styles so precedence is explicit and specificity wars stop. · css · tests: layers declared in a stated order · component rules win without raised specificity · no `!important` · unlayered rules accounted for · hints: (1) Layer order beats specificity across layers. (2) Declare the order once, up front. (3) Unlayered rules do not behave like the last layer — know where they sit.
- `css-grid-template-areas` · **A Named-Area Page Layout** · pattern: two-dimensional named layout · Build a page layout using named grid areas that rearranges at two breakpoints. · css · tests: area names consistent across breakpoints · every child assigned an area · no orphaned area name · layout valid at all three sizes · hints: (1) Name the regions once and re-arrange the template. (2) Every child needs an area or it will be placed implicitly. (3) An area named in the template with no occupant is a bug.
- `css-subgrid-alignment` · **Align Across Cards** · pattern: nested grid alignment · Make headings, bodies and footers align across sibling cards of differing content lengths. · css · tests: rows align across siblings · no fixed heights · works with one card and with many · content length variation handled · hints: (1) Independent grids cannot align to each other. (2) The child must participate in the parent's tracks. (3) Fixed heights are the failure you are avoiding.
- `css-scroll-driven-progress` · **A Scroll Progress Indicator** · pattern: scroll-linked animation with fallback · Show reading progress driven by scroll position, degrading gracefully where unsupported. · css · tests: progress indicator present · scroll-linked mechanism used where supported · static or scripted fallback defined · reduced-motion respected · hints: (1) Feature-detect rather than assume. (2) The fallback must still convey progress. (3) Motion preference applies here too.
- `css-logical-properties` · **Direction-Agnostic Spacing** · pattern: logical properties for internationalisation · Rewrite a component's physical spacing and alignment so it works in both reading directions. · css · tests: no physical left/right spacing properties · logical equivalents used · layout correct in both directions · no direction hard-coded · hints: (1) "Start" and "end" replace "left" and "right". (2) Text alignment has logical values too. (3) Test by flipping the document direction, not by reading the code.
- `css-performance-budget` · **Cheap Animation** · pattern: compositor-friendly animation · Animate a component using only properties that avoid layout and paint work, and justify each choice. · css · tests: no animated layout-triggering property · transform and opacity used · will-change applied sparingly and removed · animation duration within the stated budget · hints: (1) Animating width and top forces layout on every frame. (2) Transform and opacity are the cheap pair. (3) `will-change` left on permanently is its own cost.
- `css-audit-and-refactor` · **Audit and Refactor a Stylesheet** · pattern: systematic stylesheet repair · Given a stylesheet with ten seeded problems, fix all of them and record each fix with its reason. · css · tests: each seeded problem resolved · specificity reduced overall · no `!important` remaining · written reasons match the changes · hints: (1) Work from a checklist: specificity, duplication, magic numbers, dead rules. (2) Reduce specificity rather than matching it. (3) The written justification is part of the answer.

---

## B.5 — C++ (`cpp-`)

> **Execution note.** C++ cannot run in the browser under this stack. These
> problems execute through the shared server-side execution surface when it is
> available; when it is not, each is presented read-only with its reference
> solution and its test expectations, and no attempt is recorded. Every problem
> below is therefore written to be *readable and reasoned about* even when it
> cannot be run — the statements avoid dependence on interactive iteration.

### Beginner

- `cpp-swap-without-temp` · **Swap Two Values** · pattern: references and parameter passing · Write a function that exchanges two integers through references. · cpp · tests: distinct values · equal values · negative values · called twice in sequence · hints: (1) Pass by reference, not by value. (2) A temporary is fine; clarity beats cleverness. (3) Equal values must still leave both variables valid.
- `cpp-vector-sum-average` · **Sum and Average of a Vector** · pattern: range iteration · Return the sum and the mean of a vector of integers. · cpp · tests: several values · single value · empty vector · values that overflow a narrow type · hints: (1) A range-based loop reads more clearly than an index loop. (2) The mean is not an integer. (3) Decide the empty-vector behaviour explicitly.
- `cpp-string-reverse` · **Reverse a String in Place** · pattern: two-pointer swap · Reverse a `std::string` without allocating a second string. · cpp · tests: even length · odd length · empty string · single character · hints: (1) Indices from both ends, moving inward. (2) Stop when they meet or cross. (3) No new string means no new allocation.
- `cpp-count-occurrences` · **Count Occurrences** · pattern: linear scan with a counter · Count how many times a value appears in a vector. · cpp · tests: several occurrences · none · all elements equal · empty vector · hints: (1) One pass, one counter. (2) Compare values, not iterators. (3) Zero occurrences is a valid answer, not an error.
- `cpp-min-max-pair` · **Smallest and Largest** · pattern: single-pass extremes · Return the minimum and maximum of a vector in one traversal. · cpp · tests: mixed values · sorted ascending · sorted descending · single element · hints: (1) Initialise from the first element, not from an arbitrary sentinel. (2) One pass can maintain both. (3) A single element is both the minimum and the maximum.
- `cpp-struct-sort` · **Sort Records by Field** · pattern: comparator with `std::sort` · Sort a vector of records by one field ascending, breaking ties on a second field. · cpp · tests: distinct primary keys · ties on the primary key · already sorted · reverse sorted · hints: (1) Provide a comparator rather than reordering by hand. (2) A strict weak ordering must be consistent — never return true for equal elements. (3) Ties are where a bad comparator shows up.
- `cpp-map-word-count` · **Word Frequencies with a Map** · pattern: associative counting · Count word frequencies in a sentence using `std::map`. · cpp · tests: repeated words · all distinct · empty input · mixed case · hints: (1) Indexing a map inserts a default-constructed value — that is useful here. (2) Decide whether case matters and normalise once. (3) Iterating a `std::map` gives you keys in order for free.
- `cpp-matrix-transpose` · **Transpose a Matrix** · pattern: nested index transformation · Return the transpose of a rectangular matrix of integers. · cpp · tests: square matrix · wider than tall · taller than wide · single row · hints: (1) The result's dimensions are swapped. (2) Element `(i, j)` becomes `(j, i)`. (3) A non-square matrix cannot be transposed in place.

### Intermediate

- `cpp-rule-of-three` · **A Resource-Owning Class** · pattern: copy semantics and ownership · Implement a class owning a heap buffer with correct construction, copy, assignment and destruction. · cpp · tests: copy produces an independent buffer · self-assignment safe · destruction releases once · assignment does not leak the old buffer · hints: (1) A shallow copy means two owners and one double free. (2) Self-assignment must not destroy the source. (3) Release the old resource before or after acquiring the new one — but only once.
- `cpp-move-semantics` · **Make It Movable** · pattern: move construction and assignment · Add move operations to a resource-owning class so transfers do not copy. · cpp · tests: move leaves the source valid and empty · moved-from object safely destructible · move assignment releases the old resource · no copy occurs in a move · hints: (1) A moved-from object must be valid, just unspecified. (2) Null the source's pointer after transferring it. (3) If a copy happens, your overload is not being selected — check the value category.
- `cpp-templated-stack` · **A Generic Stack** · pattern: class template · Implement a stack template with push, pop, top, size and empty. · cpp · tests: integers · strings · pop on an empty stack behaves as specified · size tracks correctly across operations · hints: (1) One implementation, many element types. (2) Decide what popping an empty stack does and document it. (3) Returning by reference and returning by value have different lifetime consequences.
- `cpp-iterator-based-algorithm` · **Write an Algorithm Over Iterators** · pattern: iterator-generic algorithm · Write a function taking a begin/end pair that returns the count of elements satisfying a predicate. · cpp · tests: vector · list · empty range · a predicate matching everything · hints: (1) Take the range, not the container. (2) Do not assume random access. (3) The predicate is a parameter, not a hard-coded condition.
- `cpp-smart-pointer-tree` · **A Tree With Owning Nodes** · pattern: unique ownership with smart pointers · Build a binary tree whose children are uniquely owned and traverse it in order. · cpp · tests: balanced tree · left-only chain · single node · empty tree · hints: (1) A parent owns its children exclusively. (2) Unique ownership means no manual delete anywhere. (3) An empty tree is a null root, not a special node.
- `cpp-operator-overload-vector2` · **A Two-Dimensional Vector Type** · pattern: operator overloading with value semantics · Implement a small vector type with addition, subtraction, scalar multiplication and equality. · cpp · tests: component-wise arithmetic · scalar multiplication · equality on equal values · chained expressions · hints: (1) Arithmetic operators should return a new value, not mutate. (2) Equality on floating point needs a stated tolerance. (3) Chaining only works if each operator returns by value.
- `cpp-exception-safety` · **A Function That Does Not Leak** · pattern: RAII and exception safety · Rewrite a function that allocates two resources so neither leaks when the second allocation fails. · cpp · tests: both allocations succeed · second allocation throws · exception propagates · no resource leaked in any path · hints: (1) Ownership belongs to an object with a destructor, not to a raw pointer. (2) The stack unwinds and runs destructors — use that. (3) A `try/catch` that cleans up by hand is the shape you are replacing.
- `cpp-stl-composition` · **Solve It With the Standard Library** · pattern: algorithm composition · Given a vector of records, produce a sorted, deduplicated summary using standard algorithms rather than hand-written loops. · cpp · tests: duplicates present · already sorted · empty input · all elements identical · hints: (1) Deduplication after sorting is a two-step idiom. (2) Removing does not shrink the container by itself. (3) If you wrote a nested loop, there is probably an algorithm for it.

### Advanced

- `cpp-lru-cache` · **Least-Recently-Used Cache** · pattern: hash map plus intrusive list · Implement a fixed-capacity cache with constant-time get and put and correct eviction. · cpp · tests: eviction order after reads · overwrite of an existing key · capacity of one · interleaved reads and writes · hints: (1) A list gives you O(1) reordering; a map gives you O(1) lookup. (2) Store list iterators in the map. (3) A read must move the entry to the most-recent end.
- `cpp-thread-safe-queue` · **A Thread-Safe Queue** · pattern: mutex and condition variable · Implement a bounded queue safe for one producer and one consumer, blocking when empty or full. · cpp · tests: producer faster than consumer · consumer faster than producer · shutdown while blocked · no lost or duplicated item · hints: (1) A condition variable needs a predicate, not just a notify. (2) Spurious wakeups mean you must re-check in a loop. (3) Shutdown must wake every blocked waiter.
- `cpp-custom-allocator` · **A Pool Allocator** · pattern: memory pooling · Implement a fixed-block pool allocator and use it for a container of small objects. · cpp · tests: allocate and free repeatedly · exhaust the pool · alignment respected · no use-after-free in the free list · hints: (1) A free list can live inside the unused blocks themselves. (2) Alignment is a correctness requirement, not an optimisation. (3) Exhaustion must be reported, not undefined.
- `cpp-crtp-static-polymorphism` · **Static Polymorphism** · pattern: compile-time polymorphism via a template base · Provide a shared interface across types without virtual dispatch. · cpp · tests: two derived types share the base behaviour · no virtual table used · behaviour resolved at compile time · a derived type failing to implement the hook fails to compile · hints: (1) The base is templated on the derived type. (2) The base casts itself to the derived type to call the hook. (3) A missing hook should be a compile error, and that is the point.
- `cpp-template-metaprogram` · **Compile-Time Computation** · pattern: constant evaluation · Compute a value at compile time and prove it is available in a context requiring a constant. · cpp · tests: value correct for several inputs · usable as an array size · usable in a static assertion · recursion depth within limits · hints: (1) A constant expression is evaluated during compilation. (2) A static assertion is your proof. (3) Depth limits are real; keep the recursion shallow.
- `cpp-string-view-refactor` · **Avoid Needless Copies** · pattern: non-owning views · Refactor a function set that copies strings into one that borrows them, and state the lifetime rule it now depends on. · cpp · tests: behaviour unchanged · no copy in the hot path · a dangling-view case identified in writing · temporary argument handled correctly · hints: (1) A view does not own its characters. (2) Returning a view to a local is a dangling reference. (3) Write the lifetime precondition down; it is now part of the contract.
- `cpp-graph-dijkstra` · **Cheapest Route in a Weighted Graph** · pattern: Dijkstra with a priority queue · Return the cheapest cost from a source to every other node in a non-negatively weighted graph. · cpp · tests: connected graph · disconnected node · two equal-cost routes · single node · hints: (1) A min-priority queue over (cost, node) drives the order. (2) Skip a node already settled instead of re-expanding it. (3) Unreachable nodes need a defined reported value.
- `cpp-profile-and-optimise` · **Make It Faster Without Changing What It Does** · pattern: measured optimisation · Given a correct but slow function and a stated budget, reduce its runtime and record what you changed and why. · cpp · tests: output identical to the reference for every case · runtime within the budget · no undefined behaviour introduced · written justification matches the diff · hints: (1) Measure before you change anything. (2) Algorithmic change beats micro-optimisation almost always. (3) An optimisation that changes the output is a bug, not a win.

---

## B.6 — SQL (`sql-`)

All problems run against an in-browser SQLite database seeded from a fixed
fixture schema (students, courses, enrolments, submissions, scores). Grading
compares the returned result set, order-sensitively where the problem specifies
an ordering.

### Beginner

- `sql-list-active-students` · **Filter and Project** · pattern: projection with a predicate · Return the names and email addresses of active students, alphabetically by name. · sql · tests: mixed active and inactive · none active · all active · duplicate names · hints: (1) Select only the two columns asked for. (2) The ordering is part of the requirement. (3) Do not assume the source table is already ordered.
- `sql-count-per-course` · **Count Rows per Group** · pattern: grouped count · Return each course's title and the number of students enrolled. · sql · tests: courses with enrolments · a course with none · one course only · a student enrolled twice · hints: (1) The grouping column must appear in the select list. (2) A course with no enrolments needs an outer join to appear at all. (3) Decide whether a duplicate enrolment counts once or twice.
- `sql-average-score` · **Average with a Filter** · pattern: aggregate over a filtered set · Return the mean score per course, excluding ungraded enrolments. · sql · tests: mixed graded and ungraded · a course with no graded rows · a single graded row · all ungraded · hints: (1) Exclude before you aggregate. (2) An aggregate over no rows is not zero. (3) `COUNT(col)` and `COUNT(*)` differ when nulls are present.
- `sql-top-scorers` · **Top N by Value** · pattern: order and limit · Return the ten highest scores with the student's name, highest first. · sql · tests: more than ten rows · fewer than ten rows · ties at the boundary · no rows · hints: (1) Order descending, then limit. (2) Ties at the cut-off need a stated secondary ordering. (3) Fewer rows than the limit is not an error.
- `sql-insert-enrolment` · **Insert a Row Safely** · pattern: insert with constraint awareness · Insert an enrolment and ensure a duplicate enrolment cannot be created. · sql · tests: new enrolment succeeds · duplicate rejected · missing course rejected · required column omitted rejected · hints: (1) The constraint, not the application, is what makes this reliable. (2) A missing parent must fail on the foreign key. (3) Check the affected-row count.
- `sql-update-with-where` · **Update Exactly One Row** · pattern: targeted update · Set one enrolment's score, touching no other row. · sql · tests: target updated · exactly one row affected · non-matching key affects nothing · omitted predicate must be rejected by review · hints: (1) Write the matching `SELECT` first. (2) The affected-row count is your confirmation. (3) A predicate that matches everything is the accident to avoid.
- `sql-null-handling` · **Report Missing Data** · pattern: null semantics · List enrolments with no recorded score, and separately those with a score of zero. · sql · tests: nulls present · zeros present · both present · neither present · hints: (1) A null is not equal to anything, including another null. (2) Equality does not test for absence. (3) Zero and unknown are different facts.
- `sql-date-range` · **Rows Within a Period** · pattern: range predicate on dates · Return submissions made within a stated date range, inclusive of both ends. · sql · tests: rows inside the range · rows exactly on each boundary · rows outside · no rows · hints: (1) Inclusive means both boundaries are inside. (2) A timestamp compared to a date can silently exclude the last day. (3) State the time zone assumption.

### Intermediate

- `sql-students-without-submissions` · **Find the Absent Rows** · pattern: anti-join · List students who have submitted nothing for a given assignment. · sql · tests: some students missing submissions · all submitted · none submitted · a student with a submission for a different assignment · hints: (1) An inner join hides exactly what you are looking for. (2) An outer join plus a null test, or a `NOT EXISTS`, both work. (3) `NOT IN` will bite you if the inner column can be null.
- `sql-above-course-average` · **Above the Group Average** · pattern: correlated subquery · List enrolments whose score exceeds the mean score of their own course. · sql · tests: several courses · one course · a course where nobody exceeds the mean · a course with one enrolment · hints: (1) The comparison value depends on the row's course. (2) A correlated subquery or a joined aggregate both express it. (3) A single-row course cannot exceed its own mean.
- `sql-latest-per-group` · **Most Recent Row per Group** · pattern: greatest-n-per-group · For each student, return their most recent submission. · sql · tests: multiple submissions per student · one submission · ties on timestamp · a student with none · hints: (1) Grouping to find the maximum loses the other columns. (2) Join the aggregate back, or use a window function. (3) Decide the tie-breaking rule explicitly.
- `sql-multi-join-report` · **A Three-Table Report** · pattern: multi-table join with aliasing · Produce a report of student name, course title and score across three tables, including students with no enrolment. · sql · tests: full data · a student with no enrolment · a course with no enrolment · duplicate names across students · hints: (1) Alias every table; unqualified columns become ambiguous fast. (2) The outer join must be on the side you want preserved. (3) Moving a predicate into `WHERE` will undo your outer join.
- `sql-conditional-aggregate` · **Count by Condition in One Pass** · pattern: conditional aggregation · Per course, return counts of passing, failing and ungraded enrolments in a single row each. · sql · tests: all three categories present · only one category · a course with none · boundary score exactly at the threshold · hints: (1) A conditional expression inside an aggregate gives you a per-category count. (2) Three separate queries is the answer you are replacing. (3) The threshold boundary belongs to exactly one category.
- `sql-normalise-wide-table` · **Split a Denormalised Table** · pattern: schema decomposition · Given a flat table containing repeated course data, write the statements that create normalised tables and populate them without losing rows. · sql · tests: row counts reconcile · no duplicate course rows · foreign keys satisfied · re-running the migration is idempotent · hints: (1) Extract the distinct entity first. (2) Then reference it, then drop the redundancy. (3) Idempotence means running it twice creates nothing new.
- `sql-transaction-transfer` · **An All-or-Nothing Update** · pattern: transactional write · Move points between two records so that a failure leaves neither changed. · sql · tests: both updates succeed · second update fails and the first is rolled back · balance invariant holds after every case · concurrent attempt does not double-apply · hints: (1) Both writes are one event. (2) A rollback must restore the exact earlier state. (3) Enforce the invariant in the database, not only in the statement order.
- `sql-view-for-dashboard` · **A View for the Dashboard** · pattern: named query as an interface · Create a view exposing per-student totals and pass status, and query it. · sql · tests: view returns correct totals · a student with no enrolments appears · view survives a source-row change · querying the view needs no joins · hints: (1) The view is the contract the dashboard depends on. (2) A view does not store its result set. (3) A student with no data is still a student.

### Advanced

- `sql-window-ranking` · **Rank Within Groups** · pattern: window function ranking · Rank students within each course, handling ties without gaps. · sql · tests: distinct scores · ties present · a course with one student · a course with none · hints: (1) `PARTITION BY` scopes the ranking. (2) Gapless ranking and gapped ranking are different functions. (3) A window keeps every input row; a group does not.
- `sql-running-totals` · **Cumulative Points Over Time** · pattern: windowed running aggregate · For each student, return a running total of points ordered by submission date. · sql · tests: several submissions · a single submission · ties on date · a student with none · hints: (1) Order inside the window, not only in the outer query. (2) The default frame runs from the start to the current row. (3) Ties on the ordering key change the running value at that step — define it.
- `sql-gap-detection` · **Find the Gaps** · pattern: lag/lead comparison · Identify students who missed a week by comparing consecutive submission weeks. · sql · tests: a single gap · several gaps · no gaps · one submission only · hints: (1) Compare each row to its predecessor within the student's partition. (2) The first row has no predecessor — decide what that means. (3) A gap is a difference greater than one, not a missing row you can see directly.
- `sql-pivot-report` · **A Per-Week Matrix** · pattern: pivot via conditional aggregation · Produce one row per student with a column per week showing that week's score. · sql · tests: all weeks present · a missing week · a student with no scores · an extra week beyond the expected set · hints: (1) A fixed column set means fixed conditional expressions. (2) A missing week must render as absent, not as zero. (3) A dynamic column count is not something a single static query can do.
- `sql-index-and-plan` · **Make a Query Fast and Prove It** · pattern: index design against a plan · Given a slow filtered and ordered query, add the index that fixes it and show the plan change. · sql · tests: results identical before and after · plan changes from a scan to an index use · runtime within the stated budget · no redundant index added · hints: (1) The filter and the ordering can often be served by one composite index. (2) Column order in the index matters. (3) Wrapping the column in a function defeats it.
- `sql-concurrency-safe-claim` · **Claim a Row Exactly Once** · pattern: atomic claim under concurrency · Let one of several concurrent workers claim a pending job, with no job claimed twice. · sql · tests: single worker · two workers racing · no pending jobs · a worker that crashes after claiming · hints: (1) A read followed by a write is not atomic. (2) A conditional update that only matches unclaimed rows is. (3) The affected-row count tells you whether you won.
- `sql-audit-trail` · **An Append-Only Audit Table** · pattern: immutable event log · Design and populate an audit table recording every score change, and query the history of one enrolment. · sql · tests: an insert recorded · an update recorded with before and after · history ordered correctly · no audit row ever modified · hints: (1) Append only; never update an audit row. (2) Record who and when alongside what. (3) The history query is ordered by the recorded time, not by the row id.
- `sql-recursive-hierarchy` · **Walk a Hierarchy** · pattern: recursive common table expression · Given prerequisite relationships between courses, return the full prerequisite chain for a course. · sql · tests: linear chain · branching prerequisites · no prerequisites · a cycle present · hints: (1) A recursive CTE has an anchor and a recursive part. (2) Track depth so you can order the output. (3) A cycle will not terminate unless you guard against revisiting.

---

## B.7 — Agentic AI (`ai-`)

> **Language and execution note.** These problems teach agentic mechanics —
> tool-call loops, retries, schema validation, evaluation, injection defence —
> and are implemented in `javascript` against a **mock client and recorded
> fixtures** that ship with the problem. No problem in this track calls a live
> model, because the free stack has no funded key. That is a real limitation and
> the problem prose says so; what is being graded is the engineering around the
> model, which is where the defects actually live.

### Beginner

- `ai-build-request` · **Assemble a Request** · pattern: object construction against a contract · Build a well-formed model request from separate task, system and history inputs. · javascript · tests: required fields present · first turn is a user turn · system text kept out of the message array · empty history handled · hints: (1) System instructions are a separate field, not a message. (2) The first message must be a user turn. (3) Validate before sending, not after failing.
- `ai-parse-response` · **Read a Response Safely** · pattern: defensive response handling · Extract the text from a response without assuming the first content block is text. · javascript · tests: text-only response · response with a leading non-text block · empty content array · a refusal-shaped response · hints: (1) Content is a list of typed blocks. (2) Filter by type before reading. (3) An empty list must not throw.
- `ai-stop-reason-branch` · **Branch on the Stop Reason** · pattern: exhaustive outcome handling · Return a distinct outcome for each of four stop reasons in a fixture set. · javascript · tests: normal completion · output cap reached · tool requested · declined request · hints: (1) Read the stop reason before the content. (2) Each reason needs its own action, not a shared fallback. (3) An unhandled reason should be loud, not silent.
- `ai-history-store` · **An Append-Only History Store** · pattern: ordered state accumulation · Implement a conversation store that appends turns and replays them in order. · javascript · tests: alternating turns · consecutive same-role turns · replay preserves block structure · empty store · hints: (1) Append the whole content, not just the text. (2) Replaying must produce exactly what was stored. (3) Write the round-trip test first.
- `ai-token-budget` · **Stay Within a Budget** · pattern: bounded accumulation · Given per-item token counts and a budget, select the largest ordered prefix that fits. · javascript · tests: all items fit · none fit · exactly at the budget · a single oversized item · hints: (1) Accumulate and stop; do not sort. (2) Exactly at the budget is inside it. (3) One item larger than the whole budget is a defined case.
- `ai-classify-with-labels` · **Classify Into a Closed Set** · pattern: constrained output validation · Map fixture model outputs onto a fixed label set, rejecting anything outside it. · javascript · tests: valid label · a label with different casing · an invented label · an empty output · hints: (1) The label set is the contract. (2) Normalise before comparing, then compare against the set. (3) An invented label is a failure, not a new category.
- `ai-redact-secrets` · **Never Log a Secret** · pattern: output redaction · Implement a logger that records request metadata while redacting anything matching secret patterns. · javascript · tests: a token-shaped value redacted · a connection string redacted · a benign value untouched · nested object values covered · hints: (1) Redact on the way out, not at the call site. (2) Walk nested structures; secrets hide one level down. (3) A false negative here is a leak.
- `ai-prompt-assembly-order` · **Cache-Friendly Assembly** · pattern: stable prefix construction · Assemble a prompt so its stable prefix is byte-identical across repeated calls. · javascript · tests: two calls produce identical prefixes · a timestamp does not appear in the prefix · key order deterministic · volatile content placed last · hints: (1) Stable first, volatile last. (2) Serialise object keys in a fixed order. (3) One changed byte in the prefix costs you everything after it.

### Intermediate

- `ai-tool-loop` · **Implement the Tool Loop** · pattern: request/execute/return cycle · Drive a fixture conversation through tool calls until completion. · javascript · tests: one tool call · several sequential calls · no tool call at all · an iteration cap reached · hints: (1) Append the full assistant content before adding results. (2) Every tool request needs a matching result with its identifier. (3) Bound the loop; an unbounded loop is a bug.
- `ai-parallel-tool-results` · **Return Parallel Results Together** · pattern: batched tool-result turn · Execute several tool calls concurrently and return all results in one turn. · javascript · tests: two calls · one call failing · results returned in a single turn · order preserved per identifier · hints: (1) Concurrency is fine; splitting the results turn is not. (2) A failed tool returns an error-flagged result, never nothing. (3) Match by identifier, not by position.
- `ai-retry-classifier` · **Retry Only What Should Be Retried** · pattern: error classification with backoff · Wrap a mock client so retryable failures back off and non-retryable ones surface immediately. · javascript · tests: rate limit retried · server error retried · bad request not retried · attempts exhausted · hints: (1) Classify before you retry. (2) Honour a supplied retry delay over your own. (3) On exhaustion report the last error and the attempt count.
- `ai-schema-validate` · **Validate a Structured Output** · pattern: schema enforcement at the boundary · Validate fixture responses against a declared schema and reject violations with a specific reason. · javascript · tests: valid object · missing required field · wrong type · extra unexpected field · hints: (1) Validate at the boundary, once. (2) The rejection reason must name the field. (3) Decide the policy for extra fields rather than ignoring them.
- `ai-eval-harness` · **Score a Prompt Version** · pattern: test-set scoring · Build a runner that scores fixture cases against a rubric and reports per-criterion pass rates. · javascript · tests: all pass · all fail · mixed results · an empty test set · hints: (1) Score per criterion, then aggregate. (2) Report the weakest criterion, not just the total. (3) An empty set is a defined result, not a division by zero.
- `ai-cost-report` · **Report What It Cost** · pattern: usage aggregation · Aggregate fixture usage records into a cost and latency report per model. · javascript · tests: single model · several models · cached reads present · zero usage · hints: (1) Input, output and cached reads are priced differently. (2) Group by model before totalling. (3) Report latency percentiles, not only the mean.
- `ai-defer-not-zero` · **Defer, Do Not Score Zero** · pattern: failure-aware grading · Grade fixture code submissions such that an execution-backend failure defers to a human instead of awarding zero. · javascript · tests: correct submission scored · wrong submission scored zero · backend unavailable deferred · rate limited deferred · hints: (1) A wrong answer and an unavailable backend are different facts. (2) Deferred items must be counted and reported. (3) The displayed total is provisional while any item is deferred.
- `ai-context-prune` · **Prune a Transcript** · pattern: policy-driven context reduction · Reduce a fixture transcript below a token budget without dropping load-bearing content. · javascript · tests: budget met · a tool request/result pair never split · the most recent turns preserved · nothing dropped when already within budget · hints: (1) Oldest tool output is the cheapest thing to drop. (2) Never split a request from its result. (3) If it already fits, change nothing.

### Advanced

- `ai-agent-loop-bounded` · **A Bounded Agent Loop** · pattern: terminating agent loop with reporting · Implement a loop with an iteration cap, a token budget and a clean termination report over fixture turns. · javascript · tests: completes normally · hits the iteration cap · hits the token budget · terminates on an unrecoverable error · hints: (1) Every exit path needs a reported reason. (2) Two independent limits mean two independent checks. (3) A loop that ends silently is indistinguishable from success.
- `ai-injection-gate` · **Gate the Dangerous Actions** · pattern: capability allow-list · Implement an action dispatcher that only executes allow-listed actions and requires confirmation for irreversible ones. · javascript · tests: allow-listed action executes · unknown action rejected · irreversible action requires confirmation · an instruction embedded in retrieved text does not reach the dispatcher · hints: (1) The model proposes, the dispatcher decides. (2) Deny by default. (3) Text from a document is data, whatever it says about itself.
- `ai-multi-agent-merge` · **Coordinate and Merge** · pattern: coordinator over independent workers · Fan work out to three mock workers and merge their results deterministically, reporting conflicts. · javascript · tests: independent results merged · two workers disagreeing · one worker failing · a single worker · hints: (1) Partition ownership up front so conflicts are rare. (2) Merge order must not change the result. (3) A disagreement is a reportable outcome, not an averaging problem.
- `ai-verifier-stage` · **Add a Verifier** · pattern: writer/verifier pipeline · Add a verification stage that rejects a merged result violating a stated invariant, and route the rejection back. · javascript · tests: valid result accepted · invariant violated once then fixed · violated repeatedly until the cap · verifier itself failing · hints: (1) The verifier checks the invariant, not the style. (2) Bound the retry loop. (3) A verifier that always passes is not a verifier.
- `ai-rag-pipeline` · **Retrieve, Ground, Cite** · pattern: retrieval with citation validation · Build a retrieval pipeline over a fixture corpus that requires and validates citations. · javascript · tests: correct chunk retrieved and cited · a citation to an absent chunk rejected · nothing relevant retrieved · several chunks cited · hints: (1) Retrieval quality bounds answer quality. (2) An unvalidated citation is decoration. (3) "Nothing found" must be an answerable outcome.
- `ai-regression-suite` · **A Prompt Regression Suite** · pattern: versioned scoring with a gate · Score several prompt versions against a suite and fail the gate on any per-criterion regression. · javascript · tests: improvement passes · overall improvement with one criterion regressing fails · no change passes · a new criterion added mid-suite · hints: (1) Overall improvement can hide a regression. (2) Gate per criterion, not on the total. (3) A changed suite is not comparable to an old run — record the suite version.
- `ai-observability` · **Instrument the Whole Path** · pattern: structured tracing · Emit a structured trace per request covering model, usage, latency, outcome and deferred count, without logging content. · javascript · tests: fields present on every path · no prompt or completion text logged · failures traced too · trace joinable by request identifier · hints: (1) Instrument the failure paths, not just the happy one. (2) Metadata is loggable; content generally is not. (3) A trace you cannot join is a trace you cannot use.
- `ai-end-to-end-feature` · **Ship One Feature** · pattern: full-stack composition of the track · Compose request building, tool loop, validation, retries, evaluation, redaction and tracing into one fixture-backed feature with a written first-real-call checklist. · javascript · tests: happy path end to end · each failure branch handled · no secret logged · the written checklist covers key handling, spend cap, timeout, retry policy and evaluation gate · hints: (1) Reuse the pieces you already built; do not rewrite them. (2) Every failure branch needs a test, not a comment. (3) The checklist is graded — it is the part that makes the first real call safe.

---

# Deliberate exclusions

Stated so the owner can see what was left out and why, rather than discovering a
silent gap later.

## Cybersecurity — excluded, and the reason

The W3Schools cyber-security tutorial (read for topic ordering only) devotes
roughly half its chapters to offensive material. Every one of the following was
**dropped**, not softened, because it cannot be taught without either operational
attack capability or a target the student does not own:

| Excluded topic | Reason |
|---|---|
| Network mapping and port scanning | Scanning is an operational act against a network; there is no defensible sandbox for it inside an LMS, and a "practice target" normalises pointing scanners at things. |
| Network-layer attacks (spoofing, poisoning, interception) | Requires either a lab network we do not have or techniques that are only useful offensively. The defensive substance — transport security, header hardening — is covered in `crypto-transport-security` and `sec-secure-headers-and-csp`. |
| Wi-Fi attacks | Same reason, plus the only realistic targets are third-party networks. |
| Password cracking and credential attacks | Teaching cracking tooling to a beginner cohort has no defensive payoff that `sec-authentication-fundamentals` and `crypto-password-storage-concepts` do not already deliver. |
| Penetration testing methodology and social engineering | Both are people-and-authorisation practices, not code practices; taught badly they produce exactly the behaviour the constraint forbids. Threat modelling (`sec-threat-modelling-basics`) covers the useful analytic half. |
| Cyber-crime economics, monetisation, dark web | Interesting context, zero defensive skill, and it invites curiosity in a direction the course should not point interns. |
| Malware analysis / reverse engineering | Needs an isolated analysis environment this stack cannot provide safely. |

What replaced them: the eighteen `sec-` modules are all controls the student can
implement in this codebase — validation, encoding, authorisation modelling,
headers and CSP, session and secret handling, logging, dependency hygiene, rate
limiting, review process, incident procedure, and privacy. The one attack
demonstration (`sec-xss-lab-own-fixture`) targets a fixture page this application
itself serves, inside a sandboxed iframe, and exists specifically to prove that
output encoding works.

## Cryptography — bounded rather than excluded

No module implements a production cipher, no module presents hand-rolled
cryptography as usable, and the two modules that build deliberately broken
constructions (`crypto-ecb-patterning`, `crypto-timing-safe-comparison`) operate
only on data the student generates in their own browser. Also excluded:
certificate-authority operation, key-escrow schemes, and anything requiring a
hardware security module — all out of reach of a browser-only stack, and all
better learned after the fundamentals here.

## Other exclusions

- **No video IDs.** This file collects search terms only. Inventing IDs produces
  embeds that 404, which `docs/ADDON_STREAMS.md` forbids.
- **No live model calls** anywhere in the `pe`, `cu`, `llm` or `ai-` material,
  because there is no funded key in this stack. Every lab and problem in those
  areas is fixture-backed, and the prose says so rather than implying otherwise.
- **C++ concept labs.** C++ appears only in the problem catalogue, never as an
  interactive-learning lab, because it cannot run in the browser and the
  `interactive-learning` contract requires labs that work with no server.

---

# Thin spots and honest caveats

Flagged deliberately. A track named as thin is more useful to the owner than a
padded one.

1. **Prompt engineering, Claude usage and building-with-LLMs are the thinnest
   three tracks by *practice quality*, not by structure.** The ladders are solid
   and grounded in Anthropic's own current documentation, but without a funded
   API key every lab is a fixture exercise. A student finishes `llm` able to
   build a correct client, a tool loop, a retry policy and an evaluation harness
   — and has never seen a real model response. That is a genuine gap, and the
   cheapest fix is one funded key with a hard spend cap, not a curriculum change.
2. **`cu` (Claude usage) will age fastest.** Claude Code's surface changes on a
   scale of weeks. Every URL was resolvable on 2026-07-30, but the seeding agent
   should re-verify each against `https://code.claude.com/docs/llms.txt` before
   writing seed data, and the track should carry a "verified on" date visible to
   staff.
3. **Prompt engineering has no good third-party link target.** W3Schools' own
   generative-AI tutorial is organised around ChatGPT-3.5, ChatGPT-4 and Bard and
   is materially stale; it is referenced once, for completeness, and every other
   reference in the track is Anthropic documentation. There is therefore less
   link diversity in `pe` than in any other track.
4. **DBMS labs are SQLite, the production database is PostgreSQL.** `sql.js` is
   the only free in-browser SQL engine, so labs run SQLite. Three areas differ
   materially — isolation-level semantics, `EXPLAIN` output, and window-function
   coverage — and each is called out in prose where it appears. A student who
   only does the labs will not have seen a real PostgreSQL plan.
5. **Week 4's exam cannot execute git.** Section A.4 documents the workaround
   (`code_fix` over artefacts, `code_write` in JavaScript over git-derived text).
   It is a sound design but it is a workaround, and the owner should know that
   the Week 4 exam tests reasoning about git rather than use of git.
6. **CSS and HTML grading is structural, not visual.** Free-form CSS and HTML
   items are graded by parsing declarations and markup, not by rendering and
   comparing pixels. That makes them deterministic and browser-runnable, and it
   also means a student can satisfy every assertion and still produce something
   ugly. Visual quality remains a human-graded concern.
7. **DSA advanced level is broad.** Six modules cover BSTs, heaps, graphs,
   shortest paths, dynamic programming and greedy reasoning. Each is defensible as
   one module, but any one of dynamic programming or graphs could reasonably be a
   whole level of its own. If the cohort struggles, splitting `dsa-dynamic-programming`
   into a foundations module and a sequences/grids module is the first change to
   make (the slug `dsa-dp-on-sequences-and-grids` is reserved for exactly that).
8. **OOP labs are JavaScript and Python only.** Static typing, interfaces as a
   compile-time contract, and templates are discussed in prose with C++ and
   Python references but not practised in a compiled language, because no compiled
   language runs in the browser. The C++ problem track partially covers this, but
   only if server-side execution is available.
9. **No difficulty calibration data.** The difficulty bands in Section A and the
   beginner/intermediate/advanced split throughout are researched judgement
   against conventional course ordering, not measured against this cohort. First
   run should collect per-item pass rates and re-band.
10. **This content has not been reviewed against the owner's syllabus.** As
    `docs/ADDON_STREAMS.md` requires stating plainly: this material was authored
    from `appConfig.course.description`, the existing `scripts/seed-content.ts`,
    and general curriculum knowledge — **not** from the owner's original syllabus
    document, which has still not been supplied. It needs review before a cohort
    sees it.

---

# Sources

Every URL below was fetched or searched on **2026-07-30** and is recorded so the
structure of this plan can be audited. Sites were read to learn topic coverage,
conventional ordering and difficulty calibration, and to collect exact deep-link
targets. No content was copied.

## Repository files read (authoritative for the frozen syllabus)

- `scripts/seed-content.ts` — the four existing weeks, twelve lecture titles, four practice quizzes, forty MCQs, and the existing W3Schools link set. Source of every week and lecture title in Section A.
- `docs/ADDON_STREAMS.md` — stream contracts, prohibitions, the file-ownership matrix.
- `docs/DECISIONS.md` — the W3Schools `X-Frame-Options` finding, the driver decision, the two outstanding `TODO(content)` items, the `TODO(security)` demo-password item.
- `FREE_STACK.md` — browser runners, Piston, keyless oEmbed, `SubtleCrypto`.

## Reached successfully

**W3Schools (topic ordering and deep-link targets only)**
- DSA tutorial index — https://www.w3schools.com/dsa/index.php (full 67-page sidebar enumerated; the `dsa-*.php` links used above come from it)
- Cyber Security tutorial index — https://www.w3schools.com/cybersecurity/index.php (used to decide what to exclude; see `## Deliberate exclusions`)
- SQL tutorial index — https://www.w3schools.com/sql/default.asp (both the SQL and SQL Database sections enumerated)
- C++ tutorial — https://www.w3schools.com/cpp/default.asp (OOP/classes and STL sections enumerated)
- Python classes/OOP — https://www.w3schools.com/python/python_classes.asp
- Python exercises index — https://www.w3schools.com/python/python_exercises.asp
- JavaScript exercises index — https://www.w3schools.com/js/js_exercises.asp
- Generative-AI / prompt tutorial — https://www.w3schools.com/gen_ai/index.php (**stale**: organised around ChatGPT-3.5, ChatGPT-4 and Bard; referenced once and flagged)

**MDN**
- https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto (all eleven method pages enumerated)
- https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues (confirmed; related `Crypto`, `randomUUID`, `Web_Crypto_API` pages listed)

**OWASP Cheat Sheet Series**
- https://cheatsheetseries.owasp.org/ (index; exact page paths confirmed for input validation, XSS prevention, DOM-based XSS prevention, password storage, authentication, authorization, session management, SQL injection prevention, HTTP headers, content security policy, secrets management, cryptographic storage, key management, logging, threat modeling, mass assignment, access control)

**PostgreSQL**
- https://www.postgresql.org/docs/current/tutorial.html (Parts I tutorial chapters enumerated, including joins, views, foreign keys, transactions, window functions)

**Anthropic — platform documentation**
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices (full section list extracted: general principles, be clear and direct, add context, use examples, structure with XML tags, give Claude a role, long-context prompting, output and formatting, verbosity, format control, migrating away from prefills, tool use, parallel tool calling, thinking and reasoning, agentic systems, long-horizon reasoning, autonomy and safety, research and information gathering, subagent orchestration, chain complex prompts, overeagerness, minimising hallucinations, capability-specific tips, migration considerations). **This page is the backbone of the `pe` track's ladder.**

**Anthropic — Claude Code documentation**
- https://code.claude.com/docs/en/overview (navigation and feature URLs extracted: quickstart, memory, skills, hooks, sub-agents, mcp, mcp-quickstart, settings, cli-reference, common-workflows, best-practices, agent-sdk/overview, github-actions, code-review, routines, scheduled-tasks, workflows, agent-view, desktop, claude-code-on-the-web, vs-code, jetbrains, troubleshooting)
- https://code.claude.com/docs/llms.txt — the machine-readable index the overview page points at; **the seeding agent should re-verify links against this before writing seed data.**

**Bundled skill documentation (authoritative, read in full)**
- The `claude-api` skill's bundled reference — used for the current model line (`claude-fable-5`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`), effort levels, adaptive thinking, structured outputs, prompt-caching prefix semantics, tool-use loop rules, batching, refusal handling, and error/retry classification. Everything the `llm` and `cu` tracks assert about API behaviour comes from here rather than from recollection.

**Search results consulted for cross-checking a topic ladder**
- Design patterns / SOLID catalogue orientation — https://refactoring.guru/ and its catalogue pages (`design-patterns/factory-method`, `builder`, `singleton`, `adapter`, `decorator`, `facade`, `strategy`, `observer`, `state`, `composite`, and `refactoring/smells`). Used to confirm the conventional grouping into creational/structural/behavioural and the standard smell vocabulary.

## Failed, redirected, or partially answered — recorded rather than guessed

1. **`docs.claude.com` 302-redirects to `platform.claude.com`.** The first fetch
   of `https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/overview`
   returned a cross-host redirect and was refetched at the new host. Any older
   `docs.claude.com` URL in the codebase will redirect; prefer
   `platform.claude.com` (API) and `code.claude.com` (Claude Code).
2. **One `WebSearch` call failed on an invalid parameter** and was re-run
   successfully. No content was lost.
3. **PostgreSQL: no dedicated tutorial chapters exist for data types,
   constraints, indexes, functions or `EXPLAIN`.** The tutorial index does not
   list them; they live in Part II of the manual. For those four modules the
   references point at the specific manual pages
   (`sql-altertable`, `indexes`, `using-explain`, `transaction-iso`,
   `explicit-locking`, `functions-window`, `rules-materializedviews`) rather than
   at tutorial chapters. **These specific manual URLs were constructed from the
   manual's known stable path scheme and were not individually fetched** — the
   seeding agent should confirm each resolves before writing it into seed data.
4. **A dedicated Claude Code "slash commands" documentation page URL was not
   confirmed.** The overview page links skills, hooks, sub-agents, MCP, settings
   and the CLI reference by exact path, but slash commands are described inline
   rather than linked. The `cu-slash-commands-and-skills` module therefore
   references `/docs/en/skills` and `/docs/en/features-overview`; the latter came
   from a search result rather than from the overview navigation and should be
   verified against `llms.txt`.
5. **The `claude-prompting-best-practices` page exceeded the fetch size limit**
   (57.6 KB) and was persisted to a scratch file, from which the section headings
   and internal links were extracted by search rather than read end to end. The
   ladder above reflects its section structure faithfully; individual paragraphs
   were not read in full and nothing from it is quoted.
6. **No difficulty-calibration data was obtainable** from any source. Exercise
   counts were visible (W3Schools lists 83 JavaScript and 99 Python exercises) but
   per-item difficulty is not published anywhere reachable. The beginner /
   intermediate / advanced split and the Section A difficulty bands are therefore
   researched judgement, not measurement — see thin spot 9.






