// =============================================================================
// THE PREREQUISITE GRAPH — pure graph algorithms over plain edges.
// -----------------------------------------------------------------------------
// Owner: prerequisites stream.
//
// NO DATABASE, NO SESSION, NO `next/*` IMPORT, NO IMPORTS AT ALL. Everything
// here is a total function over an array of `{ courseId, prerequisiteCourseId }`
// pairs, which is what lets "A requiring B requiring A is impossible" be
// asserted as a property of a function rather than inferred from a form
// rejecting a click. That is the same split `src/lib/courses/policy.ts:6` makes
// and for the same stated reason: an authorization rule that can only be
// exercised through a page is a rule nobody can prove.
//
// -----------------------------------------------------------------------------
// EDGE DIRECTION. `{ courseId: A, prerequisiteCourseId: B }` means "to take A
// you must first have done B". Every walk in this file follows courseId ->
// prerequisiteCourseId, i.e. from a course TOWARDS the things it owes.
//
// -----------------------------------------------------------------------------
// EVERY TRAVERSAL BELOW IS CYCLE-SAFE, INCLUDING THE ONES THAT ARE NOT ABOUT
// CYCLES. `prerequisiteClosure` and `topologicalOrder` carry visited sets and
// terminate on a cyclic input rather than recursing forever. That is not
// belt-and-braces for its own sake: `insertPrerequisite` prevents cycles at
// write time and a database CHECK forbids self-edges, but a restored dump or a
// hand-written `INSERT` by a DBA is outside both, and the failure mode of an
// unguarded walk is a hung request thread on a STUDENT'S page — a student is
// then locked out of a course by an admin's data-entry mistake, with a timeout
// instead of an explanation. The visited set costs one Set per call.
// =============================================================================

/** One row of `course_prerequisites`, reduced to the two columns that matter. */
export interface PrerequisiteEdge {
  /** The course that has the requirement. */
  courseId: number;
  /** The course that must be done first. */
  prerequisiteCourseId: number;
}

/**
 * Adjacency in the direction "course -> what it requires".
 *
 * Built once per call site rather than per traversal step: the admin page runs
 * `findCycle`, `topologicalOrder` and one `prerequisiteClosure` per course over
 * the SAME edge list, and rebuilding the map inside each would make the page
 * quadratic in the number of edges for no reason.
 */
export function buildRequirementMap(
  edges: readonly PrerequisiteEdge[],
): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const edge of edges) {
    const list = map.get(edge.courseId);
    if (list) list.push(edge.prerequisiteCourseId);
    else map.set(edge.courseId, [edge.prerequisiteCourseId]);
  }
  return map;
}

/**
 * Can `from` reach `target` by following prerequisite edges?
 *
 * The primitive the cycle check is built on. "A requires B" may be added exactly
 * when B cannot already reach A — if it can, then after the insert A reaches B
 * (the new edge) and B reaches A (the existing path), which is a cycle.
 *
 * ITERATIVE, not recursive. A deep chain (a 60-course learning path is not
 * absurd) would risk a stack overflow in a recursive walk, and a stack overflow
 * inside a gate fails in whichever direction the surrounding try/catch happens
 * to point. An explicit stack cannot.
 */
export function reaches(
  requirements: Map<number, number[]>,
  from: number,
  target: number,
): boolean {
  if (from === target) return true;
  const seen = new Set<number>([from]);
  const stack: number[] = [from];

  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const next of requirements.get(node) ?? []) {
      if (next === target) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return false;
}

/**
 * Would adding `candidate` to `edges` create a cycle?
 *
 * Returns true for a SELF edge too (A requires A). That case is also forbidden
 * by the `course_prerequisites_no_self` database CHECK, so this is the second of
 * two independent defences rather than the only one — but it must be here as
 * well, because the caller needs to REFUSE with a readable reason rather than
 * surface a constraint-violation error to an admin.
 *
 * THIS FUNCTION IS NOT THE WHOLE PREVENTION. It is a decision about a snapshot
 * of the edges, and a snapshot goes stale. `insertPrerequisite` in ./store.ts
 * takes a Postgres advisory lock, re-reads the edges INSIDE the transaction and
 * calls this again before writing; without the lock two admins adding A->B and
 * B->A in the same instant would each pass a check made against edges that did
 * not yet contain the other's row. See that function's header.
 */
export function wouldCreateCycle(
  edges: readonly PrerequisiteEdge[],
  candidate: PrerequisiteEdge,
): boolean {
  if (candidate.courseId === candidate.prerequisiteCourseId) return true;
  const requirements = buildRequirementMap(edges);
  // Does the prerequisite already depend (transitively) on the course that is
  // about to require it?
  return reaches(requirements, candidate.prerequisiteCourseId, candidate.courseId);
}

/**
 * Find one cycle in `edges`, as the list of course ids around it, or null.
 *
 * THE TRIPWIRE. Nothing in the application can create a cycle (see the module
 * header and ./store.ts), so a non-null result here means the data was changed
 * by something outside the application — a restored dump, a migration, a manual
 * `INSERT`. The admin page renders it as a defect banner instead of leaving an
 * unreachable course looking like a mystery.
 *
 * Returns the cycle with the node it closes on repeated at the end
 * (`[A, B, A]`), so the caller can print it as a path without reconstructing the
 * closing edge.
 *
 * Iterative DFS with an explicit colour map. `path` mirrors the grey frontier so
 * the cycle can be sliced out of it; a plain "grey set" would prove a cycle
 * exists without being able to name it, and a banner that cannot name the cycle
 * is a banner nobody can act on.
 */
export function findCycle(edges: readonly PrerequisiteEdge[]): number[] | null {
  const requirements = buildRequirementMap(edges);

  // Roots: every node that appears anywhere. A cycle need not be reachable from
  // a node with outgoing edges only, so both columns are collected.
  const nodes = new Set<number>();
  for (const edge of edges) {
    nodes.add(edge.courseId);
    nodes.add(edge.prerequisiteCourseId);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<number, number>();
  for (const node of nodes) colour.set(node, WHITE);

  for (const root of nodes) {
    if (colour.get(root) !== WHITE) continue;

    const path: number[] = [];
    // `enter` distinguishes "visit this node" from "finish this node", which is
    // how an iterative DFS knows when to pop the path and paint a node black.
    const stack: Array<{ node: number; enter: boolean }> = [{ node: root, enter: true }];

    while (stack.length > 0) {
      const frame = stack.pop()!;
      if (!frame.enter) {
        colour.set(frame.node, BLACK);
        path.pop();
        continue;
      }

      if (colour.get(frame.node) === GREY) {
        // Back edge: frame.node is already on the current path.
        const start = path.indexOf(frame.node);
        return [...path.slice(start), frame.node];
      }
      if (colour.get(frame.node) === BLACK) continue;

      colour.set(frame.node, GREY);
      path.push(frame.node);
      stack.push({ node: frame.node, enter: false });
      for (const next of requirements.get(frame.node) ?? []) {
        if (colour.get(next) === BLACK) continue;
        if (colour.get(next) === GREY) {
          const start = path.indexOf(next);
          return [...path.slice(start), next];
        }
        stack.push({ node: next, enter: true });
      }
    }
  }

  return null;
}

/**
 * Every course `courseId` transitively requires, nearest requirement first.
 *
 * Breadth-first, so a caller rendering "you still need X, then Y" lists the
 * immediate blockers before the deep ones — which is the order a student can act
 * on. Excludes `courseId` itself.
 *
 * TERMINATES ON A CYCLIC INPUT. The visited set is the whole reason (see the
 * module header): this function runs on a student-facing page, and a hang there
 * is an unexplained lockout.
 */
export function prerequisiteClosure(
  edges: readonly PrerequisiteEdge[],
  courseId: number,
): number[] {
  const requirements = buildRequirementMap(edges);
  const seen = new Set<number>([courseId]);
  const out: number[] = [];
  const queue: number[] = [courseId];

  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of requirements.get(node) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      queue.push(next);
    }
  }
  return out;
}

/**
 * A recommended study order for `courseIds` — prerequisites before dependants.
 *
 * THIS IS THE "LEARNING PATHS" HALF OF FEATURE 8, AND IT IS DERIVED RATHER THAN
 * STORED. The roadmap (IMPLEMENTATION_ROADMAP.md:491) specifies a
 * `learning_paths` table holding an ordered `course_order` array. That was not
 * built, deliberately: an explicit order column and a prerequisite graph are two
 * sources of truth for the same fact, and they disagree the first time an admin
 * adds a prerequisite without re-editing the path — at which point the app shows
 * a recommended order that its own gate refuses to let the student follow. The
 * same argument `src/db/schema.access.ts:80` makes for not splitting the request
 * from the enrolment, and `src/lib/progress/unlock.ts` for refusing to store a
 * mirror of a computed fact. Flagged in the stream report as a deviation from
 * the spec rather than quietly skipped.
 *
 * Kahn's algorithm, restricted to `courseIds`: edges pointing outside the set
 * are ignored, so a partial selection still orders sensibly.
 *
 * `cycle` is non-null when the input could not be fully ordered, and `order`
 * then holds the prefix that COULD be ordered. Returning a partial answer plus
 * the defect beats throwing: the admin page still renders the usable part and
 * names the problem.
 */
export function topologicalOrder(
  edges: readonly PrerequisiteEdge[],
  courseIds: readonly number[],
): { order: number[]; cycle: number[] | null } {
  const inSet = new Set(courseIds);
  const relevant = edges.filter(
    (e) => inSet.has(e.courseId) && inSet.has(e.prerequisiteCourseId),
  );

  // outstanding[course] = how many of its prerequisites are not yet emitted.
  const outstanding = new Map<number, number>();
  // dependants[prerequisite] = courses waiting on it.
  const dependants = new Map<number, number[]>();
  for (const id of courseIds) outstanding.set(id, 0);
  for (const edge of relevant) {
    outstanding.set(edge.courseId, (outstanding.get(edge.courseId) ?? 0) + 1);
    const list = dependants.get(edge.prerequisiteCourseId);
    if (list) list.push(edge.courseId);
    else dependants.set(edge.prerequisiteCourseId, [edge.courseId]);
  }

  // Stable output: ready courses are emitted in the caller's input order, so the
  // admin page's list does not reshuffle between reloads on equal-rank courses.
  const ready = courseIds.filter((id) => (outstanding.get(id) ?? 0) === 0);
  const order: number[] = [];

  while (ready.length > 0) {
    const node = ready.shift()!;
    order.push(node);
    for (const dependant of dependants.get(node) ?? []) {
      const left = (outstanding.get(dependant) ?? 0) - 1;
      outstanding.set(dependant, left);
      if (left === 0) ready.push(dependant);
    }
  }

  if (order.length === courseIds.length) return { order, cycle: null };
  // Whatever did not come out is in, or behind, a cycle. Name it from the
  // restricted edge set so the message matches what was actually ordered.
  return { order, cycle: findCycle(relevant) };
}
