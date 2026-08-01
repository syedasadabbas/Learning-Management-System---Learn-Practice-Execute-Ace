// =============================================================================
// HOSTILE-PAYLOAD TESTS for student-authored forum content.
// -----------------------------------------------------------------------------
// Owner: forums stream.
//
// =============================================================================
// WHY EVERY ASSERTION IN THIS FILE IS AGAINST THE **DOM**, NEVER AGAINST HTML TEXT
// =============================================================================
//
// This is not a style preference. On this renderer, a string assertion is either
// WRONG or VACUOUS, and both failure modes were observed in this codebase before
// this file was written.
//
// react-markdown without `rehype-raw` renders embedded HTML as LITERAL TEXT. So
// for the payload `<img src=x onerror="alert(1)">`, the rendered markup is:
//
//     <div data-testid="lecture-content">&lt;img src=x onerror="alert(1)"&gt;</div>
//
// Read what that means for the two obvious string assertions:
//
//   * `expect(container.innerHTML).not.toContain("onerror")` — **FAILS**, on
//     output that is completely safe. The substring is present because the
//     payload is being displayed as text, which is the defence working. A
//     developer seeing this red test would "fix" it by weakening the check.
//
//   * `expect(container.innerHTML).toContain("&lt;img")` — **PASSES VACUOUSLY.**
//     It asserts that the string was escaped somewhere, which is true of
//     `escapeHtml("...")` applied to anything, including output that ALSO contains
//     a live injected element elsewhere in the tree. It proves nothing about
//     whether an `<img>` node exists.
//
// A sibling stream in this wave hit exactly the first form — a leak test matching
// ESCAPED output and therefore passing (or failing) for reasons unrelated to the
// property under test.
//
// So: every assertion here asks the DOM a structural question —
// `querySelector("img")`, `getAttribute("onerror")`, `tagName`, `href` — because
// "is there a live element?" and "does it carry an event handler?" are the actual
// security properties. The string form cannot express either.
//
// AND, because a suite of `expect(...).toBeNull()` assertions passes just as well
// against a renderer that outputs NOTHING AT ALL, this file carries two kinds of
// control:
//
//   1. POSITIVE CONTROLS — legitimate markdown still produces the elements it
//      should (`**bold**` -> <strong>, an https link -> a live <a href>). Without
//      these, `MarkdownContent` returning an empty div would pass every negative.
//   2. A DETECTION CONTROL — `describe("the assertions in this file can detect a
//      real injection")` renders the SAME payload through
//      `dangerouslySetInnerHTML` and asserts the negative assertions FAIL against
//      it. That proves the assertions are capable of seeing an injection, which is
//      the one thing a passing negative test can never demonstrate about itself.
// =============================================================================

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// NO `vi.mock("@/lib/auth")` — deliberately, and it is load-bearing that none is
// needed. These components import src/lib/forums/policy.ts, which reads the frozen
// ROLES_SATISFYING table directly rather than reaching guard.ts -> auth.ts -> pg.
// If a future edit reintroduces that import chain, this file will fail to resolve
// `next/server` and `next build` will fail on `pg` in the client bundle — the
// second of which is the real defect. See policy.ts's import comment.

import { MarkdownContent } from "@/components/course/MarkdownContent";

import { ForumPostViewer } from "./ForumPostViewer";
import { ForumTopicList } from "./ForumTopicList";
import type { PostView, TopicListItem } from "@/lib/forums/store";

// ---------------------------------------------------------------------------
// The payloads
// ---------------------------------------------------------------------------

/**
 * Each entry is a real-world XSS vector, with the property it must not have.
 *
 * Chosen to cover the four distinct injection SHAPES rather than to be a long
 * list: raw element with an event handler, raw <script>, a dangerous URL scheme
 * on a markdown link, and a dangerous scheme on a markdown image. Casing and
 * scheme variants are included because a naive "starts with javascript:" filter
 * passes `JaVaScRiPt:` and `data:text/html`.
 */
const RAW_HTML_PAYLOADS = [
  // The canonical one. An <img> with an onerror handler fires without any user
  // interaction as soon as the bogus src fails to load.
  '<img src=x onerror="alert(1)">',
  // Uppercase + self-closing variants, which defeat lowercase tag filters.
  '<IMG SRC=/ onerror="alert(1)"></img>',
  "<script>alert(1)</script>",
  "<script src=https://evil.test/x.js></script>",
  "<svg onload=alert(1)></svg>",
  "<div onmouseover=alert(1)>hover me</div>",
  '<iframe src="https://evil.test"></iframe>',
  '<a href="javascript:alert(1)">click</a>',
  "<body onload=alert(1)>",
  '<input onfocus=alert(1) autofocus="">',
  // An HTML comment used to try to break out of an escaping pass.
  "<!--><img src=x onerror=alert(1)>-->",
] as const;

/** Markdown links/images whose URL carries a script-executing scheme. */
const DANGEROUS_URL_PAYLOADS = [
  "[click](javascript:alert(1))",
  "[case](JaVaScRiPt:alert(1))",
  "[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  "[vb](vbscript:alert(1))",
] as const;

const DANGEROUS_IMAGE_PAYLOADS = [
  "![boom](javascript:alert(1))",
  "![vb](vbscript:alert(1))",
] as const;

/** Every inline event-handler attribute a payload above tries to smuggle in. */
const EVENT_ATTRIBUTES = [
  "onerror",
  "onload",
  "onmouseover",
  "onfocus",
  "onclick",
  "onanimationend",
] as const;

// ---------------------------------------------------------------------------
// Reusable DOM assertions
// ---------------------------------------------------------------------------

/** No element in the tree carries an inline event-handler attribute. */
function expectNoInlineHandlers(root: HTMLElement): void {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of EVENT_ATTRIBUTES) {
      expect(
        element.getAttribute(attribute),
        `${element.tagName} carries ${attribute}`,
      ).toBeNull();
    }
  }
}

/** None of the element types a payload above tries to create exists. */
function expectNoInjectedElements(root: HTMLElement): void {
  for (const selector of ["script", "img", "svg", "iframe", "input", "object", "embed"]) {
    expect(root.querySelector(selector), `a live <${selector}> was created`).toBeNull();
  }
}

// ---------------------------------------------------------------------------
// 1. Raw HTML in a post body
// ---------------------------------------------------------------------------

describe("raw HTML inside a forum post is never parsed into an element", () => {
  it.each(RAW_HTML_PAYLOADS)("%s creates no live element and no handler", (payload) => {
    const { container } = render(<MarkdownContent markdown={payload} />);

    // THE STRUCTURAL ASSERTIONS. `rehype-raw` is not enabled, so mdast's `html`
    // nodes are emitted as text and there is no element for the handler to sit on.
    expectNoInjectedElements(container);
    expectNoInlineHandlers(container);
  });

  it("the payload is DISPLAYED as text, which is the positive proof it was inert", () => {
    // This is the other half of the property. "No <img> element" would also be
    // true if the renderer silently dropped the input; asserting the characters
    // are on screen as CONTENT proves the payload became text rather than markup.
    const payload = '<img src=x onerror="alert(1)">';
    const { container } = render(<MarkdownContent markdown={payload} />);

    expect(container.querySelector("img")).toBeNull();
    // textContent, NOT innerHTML: textContent is the DOM's own view of "what does
    // a reader see", and it is unescaped, so this compares the payload to itself
    // rather than to an entity-encoded copy of itself.
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("markdown structure around a payload still renders — the renderer really ran", () => {
    // POSITIVE CONTROL. Without it, a MarkdownContent that returned null would
    // pass every negative assertion in this file.
    const { container } = render(
      <MarkdownContent markdown={"**bold** and <script>alert(1)</script>"} />,
    );
    expect(container.querySelector("strong")).not.toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("script")).toBeNull();
  });

  it("a fenced code block containing a script tag renders as code, not as script", () => {
    // The common LEGITIMATE case in a web-development course: a student pastes
    // HTML to ask why it does not work. It must display, and it must not run.
    const { container } = render(
      <MarkdownContent markdown={"```html\n<script>alert(1)</script>\n```"} />,
    );
    expect(container.querySelector("script")).toBeNull();
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("<script>alert(1)</script>");
  });
});

// ---------------------------------------------------------------------------
// 2. Dangerous URL schemes
// ---------------------------------------------------------------------------

describe("a markdown link cannot carry a script-executing URL scheme", () => {
  it.each(DANGEROUS_URL_PAYLOADS)("%s renders an anchor with a neutralised href", (payload) => {
    const { container } = render(<MarkdownContent markdown={payload} />);

    const anchor = container.querySelector("a");
    // The anchor DOES exist — react-markdown's `defaultUrlTransform` empties the
    // URL rather than dropping the element. Asserting its existence first means
    // the next assertion cannot pass because there was no anchor to check.
    expect(anchor).not.toBeNull();

    const href = anchor?.getAttribute("href") ?? "";
    expect(href).toBe("");
    // Belt and braces on the scheme, case-insensitively, so this test still fails
    // correctly if a future urlTransform lets a mangled scheme through.
    expect(/^\s*(javascript|vbscript|data):/i.test(href)).toBe(false);
  });

  it.each(DANGEROUS_IMAGE_PAYLOADS)("%s renders an image with no usable src", (payload) => {
    const { container } = render(<MarkdownContent markdown={payload} />);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    // React refuses to set an empty src attribute at all, so this is null rather
    // than "". Either is safe; asserted as "not a dangerous scheme" so the test
    // does not depend on which React chooses.
    const src = img?.getAttribute("src") ?? "";
    expect(/^\s*(javascript|vbscript|data:text\/html):/i.test(src)).toBe(false);
    expectNoInlineHandlers(container);
  });

  it("an ordinary https link is NOT neutralised — the transform is not a blanket ban", () => {
    // POSITIVE CONTROL for the URL layer. Without it, a urlTransform that emptied
    // EVERY href would pass all four negative cases above.
    const { container } = render(<MarkdownContent markdown={"[ok](https://example.com/a)"} />);
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/a");
    // The hardening MarkdownContent applies to every link, asserted here because a
    // forum is the first place the target of a link is chosen by an untrusted user.
    expect(anchor?.getAttribute("rel")).toContain("noopener");
    expect(anchor?.getAttribute("target")).toBe("_blank");
  });
});

// ---------------------------------------------------------------------------
// 3. The same payloads through the real components
// ---------------------------------------------------------------------------

/** A live post carrying `content`. */
function post(content: string | null, overrides: Partial<PostView> = {}): PostView {
  return {
    id: 1,
    authorId: 11,
    authorName: "Demo Student",
    content,
    isSolution: false,
    removed: false,
    removedByModerator: false,
    removalReason: null,
    edited: false,
    createdAt: "2026-07-31T10:00:00.000Z",
    ...overrides,
  };
}

describe("ForumPostViewer — the component a classmate's post is actually rendered by", () => {
  it("renders every raw-HTML payload inertly", () => {
    // Asserted through the COMPONENT, not only through MarkdownContent, because
    // the component is what a page mounts. A future edit that swapped in
    // dangerouslySetInnerHTML would leave the MarkdownContent tests above green.
    const posts = RAW_HTML_PAYLOADS.map((payload, index) =>
      post(payload, { id: index + 1, authorId: 11 }),
    );
    const { container } = render(<ForumPostViewer posts={posts} viewerId={11} />);

    expectNoInjectedElements(container);
    expectNoInlineHandlers(container);
    // The thread rendered at all — every payload produced a post element.
    expect(container.querySelectorAll('[data-testid^="forum-post-"]')).toHaveLength(
      RAW_HTML_PAYLOADS.length,
    );
  });

  it("an author NAME containing markup is escaped, not rendered", () => {
    // A display name is attacker-controlled too (the account stream lets a user
    // set it) and it is NOT markdown — see ForumPostViewer's header.
    const { container } = render(
      <ForumPostViewer
        posts={[post("hello", { authorName: '<img src=x onerror="alert(1)">' })]}
        viewerId={11}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("a REMOVED post's body is not rendered, and the tombstone notice is", () => {
    // The store never sends `content` for a removed row (SQL CASE), so `null` is
    // the shape the component must handle. Asserting it here means a component
    // change cannot start rendering an empty body as if it were a real post.
    const { container } = render(
      <ForumPostViewer
        posts={[
          post(null, {
            removed: true,
            removedByModerator: true,
            removalReason: "Off topic",
          }),
        ]}
        viewerId={11}
      />,
    );
    const element = container.querySelector('[data-testid="forum-post-1"]');
    expect(element?.getAttribute("data-removed")).toBe("true");
    expect(element?.getAttribute("data-removed-by")).toBe("moderator");
    expect(container.textContent).toContain("removed by a moderator");
    expect(container.textContent).toContain("Off topic");
  });

  it("a removal REASON containing markup is escaped — a moderator is not trusted either", () => {
    const { container } = render(
      <ForumPostViewer
        posts={[
          post(null, {
            removed: true,
            removedByModerator: true,
            removalReason: "<script>alert(1)</script>",
          }),
        ]}
        viewerId={11}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("an author's retraction is labelled as the author's, not as moderation", () => {
    const { container } = render(
      <ForumPostViewer posts={[post(null, { removed: true, removedByModerator: false })]} viewerId={11} />,
    );
    expect(container.textContent).toContain("removed by its author");
  });
});

describe("ForumTopicList — a thread TITLE is text, never markup and never markdown", () => {
  function topic(title: string, overrides: Partial<TopicListItem> = {}): TopicListItem {
    return {
      id: 1,
      title,
      isPinned: false,
      isLocked: false,
      authorId: 11,
      authorName: "Demo Student",
      createdAt: "2026-07-31T10:00:00.000Z",
      replyCount: 0,
      lastReplyAt: null,
      hasSolution: false,
      ...overrides,
    };
  }

  it("a markup title creates no element", () => {
    const { container } = render(
      <ForumTopicList
        weekId={1}
        viewerId={11}
        topics={[topic('<img src=x onerror="alert(1)">')]}
      />,
    );
    expectNoInjectedElements(container);
    expectNoInlineHandlers(container);
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("a title is not interpreted as markdown either", () => {
    // `**shouty**` must read as literal asterisks. If a future edit renders titles
    // through MarkdownContent, a student could borrow the emphasis the UI uses for
    // real signals (Pinned / Solved / Locked).
    const { container } = render(
      <ForumTopicList weekId={1} viewerId={11} topics={[topic("**shouty** [x](https://evil.test)")]} />,
    );
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("**shouty** [x](https://evil.test)");
    // The row's own navigation anchor is the ONLY anchor, and it points inside the
    // app — the title contributed no link.
    const anchors = Array.from(container.querySelectorAll("a"));
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe("/forums/1/1");
  });

  it("the SQL-aggregated reply count is what is displayed", () => {
    // Guards the N+1 contract at the component boundary: the number comes from
    // props. A component that started counting would have to fetch.
    const { container } = render(
      <ForumTopicList weekId={2} viewerId={11} topics={[topic("q", { replyCount: 17 })]} />,
    );
    const row = container.querySelector('[data-testid="forum-topic-1"]');
    expect(row?.getAttribute("data-reply-count")).toBe("17");
    expect(container.textContent).toContain("17 replies");
  });
});

// ---------------------------------------------------------------------------
// 4. The detection control — proof these assertions are not vacuous
// ---------------------------------------------------------------------------

describe("the assertions in this file can detect a real injection", () => {
  // WITHOUT THIS BLOCK, every negative assertion above could be passing because
  // the assertion is incapable of failing. Here the SAME payload is rendered the
  // dangerous way, and the same helpers are asserted to REJECT it.
  //
  // This is the same class of self-check as the "the route derivation itself
  // works" test in tests/unit/cross-stream-contracts.test.ts:178, which exists so
  // that a broken derivation cannot make every downstream assertion pass
  // vacuously.
  const payload = '<img src=x onerror="alert(1)">';

  it("a dangerouslySetInnerHTML render DOES create the live element", () => {
    const { container } = render(<div dangerouslySetInnerHTML={{ __html: payload }} />);
    // The element the safe path never produces.
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("img")?.getAttribute("onerror")).toBe("alert(1)");
  });

  it("expectNoInjectedElements FAILS on that render", () => {
    const { container } = render(<div dangerouslySetInnerHTML={{ __html: payload }} />);
    expect(() => expectNoInjectedElements(container)).toThrow();
  });

  it("expectNoInlineHandlers FAILS on that render", () => {
    const { container } = render(<div dangerouslySetInnerHTML={{ __html: payload }} />);
    expect(() => expectNoInlineHandlers(container)).toThrow();
  });

  it("the naive STRING assertion would have been wrong in both directions", () => {
    // Documents the trap this file's header describes, as executable evidence.
    const safe = render(<MarkdownContent markdown={payload} />).container;
    const unsafe = render(<div dangerouslySetInnerHTML={{ __html: payload }} />).container;

    // "onerror must not appear in the HTML" is present in the SAFE output (as
    // escaped display text) — so the string test flags safe output as a failure...
    expect(safe.innerHTML).toContain("onerror");
    // ...and it is equally present in the genuinely unsafe output. The substring
    // cannot separate the two cases; only the DOM question can.
    expect(unsafe.innerHTML).toContain("onerror");
    expect(safe.querySelector("img")).toBeNull();
    expect(unsafe.querySelector("img")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Mechanical guard: no unsafe HTML sink anywhere in this stream
// ---------------------------------------------------------------------------

describe("no file in this stream contains an HTML injection sink", () => {
  // Layer 3 of the defence in ForumPostViewer's header, asserted mechanically so
  // it stays true. Every argument above is void if a future edit introduces
  // `dangerouslySetInnerHTML` on a post body.
  //
  // Scoped to THIS STREAM'S directories. A repo-wide scan would fail on other
  // streams' legitimate uses and is not this file's business.
  const ROOTS = [
    join(process.cwd(), "src", "lib", "forums"),
    join(process.cwd(), "src", "components", "forums"),
    join(process.cwd(), "src", "app", "(app)", "forums"),
  ];

  function sourceFiles(dir: string): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        files.push(...sourceFiles(full));
      } else if (/\.tsx?$/.test(entry)) {
        files.push(full);
      }
    }
    return files;
  }

  const FILES = ROOTS.flatMap(sourceFiles);

  /**
   * Source with `//` and block comments removed.
   *
   * NECESSARY, not fastidious: the first run of this scan FAILED on
   * ForumPostViewer.tsx, because that file's header DISCUSSES
   * `dangerouslySetInnerHTML` and `rehype-raw` at length in order to explain why
   * neither is used. A raw substring scan cannot tell an explanation from a call,
   * so it flagged the documentation of the defence as a violation of it.
   *
   * That failure was useful — it proved the scan reads the files and can fail —
   * and it is recorded here rather than silently worked around, because the
   * obvious alternative fixes are both worse: deleting the explanation to appease
   * a grep, or adding a per-file exemption that would also excuse a real call in
   * the same file.
   *
   * LIMITATION, stated: this is a regex, not a parser. A comment marker inside a
   * string literal (`const s = "// not a comment"`) would be mis-stripped. That is
   * acceptable for a guard over ten files of our own source whose failure mode is
   * a FALSE PASS on a contrived input, and the DOM assertions in blocks 1-3 are
   * the real control — this scan exists to catch the careless case, not an
   * adversarial contributor.
   */
  function codeOf(file: string): string {
    return readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  }

  it("the file walk found this stream's sources — otherwise the scan below is vacuous", () => {
    // Same self-check as block 4. An empty file list would make the scan pass
    // while checking nothing.
    expect(FILES.length).toBeGreaterThan(5);
    expect(FILES.some((f) => f.endsWith("ForumPostViewer.tsx"))).toBe(true);
    expect(FILES.some((f) => f.endsWith("store.ts"))).toBe(true);
    expect(FILES.some((f) => f.includes("forums") && f.endsWith("page.tsx"))).toBe(true);
  });

  it.each([
    "dangerouslySetInnerHTML",
    "rehype-raw",
    "rehypeRaw",
    // `innerHTML =` and `outerHTML =` assignments are the non-React route to the
    // same sink. Matched with the space so `.innerHTML` READS (as in this very
    // test file) are not flagged.
    "innerHTML =",
    "outerHTML =",
    "document.write",
  ])("no source file references %s", (needle) => {
    const offenders = FILES.filter(
      // This test file is itself excluded: it uses dangerouslySetInnerHTML
      // DELIBERATELY, in block 4, to prove its own assertions can fail.
      (file) => !file.endsWith("xss.test.tsx") && codeOf(file).includes(needle),
    );
    expect(offenders).toEqual([]);
  });

  it("the comment stripper does not blind the scan to real code", () => {
    // The control for `codeOf`. A stripper that returned "" would make every
    // assertion above pass while reading nothing — the same vacuity trap as the
    // file walk. So: prose mentions are dropped, and a real identifier survives.
    const viewer = FILES.find((f) => f.endsWith("ForumPostViewer.tsx"))!;
    const stripped = codeOf(viewer);
    // The word appears in that file's header prose only, and is gone.
    expect(stripped).not.toContain("dangerouslySetInnerHTML");
    // ...while the code around it is intact.
    expect(stripped).toContain("MarkdownContent");
    expect(stripped).toContain("export function ForumPostViewer");
  });
});
