/**
 * A page about a vulnerability is not a page with one.
 *
 * The self-scan (tests/selfscan) found over 120 checks firing on this
 * product's own public pages, a dozen at critical, and nearly all of them on
 * the check catalog and the docs: pages that name dangerous APIs in headings,
 * paragraphs, link text, data attributes and a meta description, show them in
 * code blocks, and on a Next.js site carry all of that a second time in the
 * flight payload. These tests pin both halves of the fix: the documentation
 * page reports nothing a blank page would not, and the page that really runs
 * the same code still reports it.
 */
import { describe, it, expect } from "vitest";
import { runSyncChecks } from "@/lib/scanner/engine";
import { checkIdOf } from "@/lib/scanner/dedupe";
import { stripProse, withProseStripped } from "@/lib/scanner/_helpers";

const URL = "https://docs.example.com/guide";

/** The code a vulnerable page runs, and a documentation page quotes. */
const SNIPPETS = [
  `document.getElementById("out").innerHTML = location.hash;`,
  `document.write(location.search);`,
  `localStorage.setItem("token", response.token);`,
  `sessionStorage.setItem("password", form.password.value);`,
  `window.addEventListener("message", function (e) { run(e.data); });`,
  `parent.postMessage(secretData, "*");`,
  `navigator.clipboard.writeText(text);`,
  `navigator.geolocation.getCurrentPosition(onPosition);`,
  `navigator.mediaDevices.getUserMedia({ video: true });`,
  `new WebSocket("ws://feed.example.com/live");`,
  `if (hmac(payload) === signature) { grant(); }`,
  `const token = Math.random().toString(36);`,
  `fetch(req.query.url);`,
  `exec("convert " + req.body.file);`,
  `create_function('$a', 'return $a;');`,
  `JSON.parse(userInput);`,
  `setTimeout("tick()", 100);`,
  `eval(atob(payload));`,
];

/** What React, and any templating engine, does to text and attribute values. */
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** How a documentation page, or a security blog, presents the same code. */
function documentationPage(): string {
  const prose = SNIPPETS.map(
    (s) => `
      <section>
        <h2 id="x">${escapeHtml(s)} is dangerous</h2>
        <p>Never write <strong>${escapeHtml(s)}</strong> in production.</p>
        <a href="/checks/example" title="${escapeHtml(s)}" data-check="${escapeHtml(s)}">${escapeHtml(s)}</a>
        <pre><code>${escapeHtml(s)}</code></pre>
      </section>`,
  ).join("");
  // The Next.js flight payload carries the page text as a JS string literal.
  const flight = `<script>self.__next_f.push([1,${JSON.stringify(SNIPPETS.join("\n"))}])</script>`;
  return `<!DOCTYPE html><html><head>
    <meta name="description" content="${escapeHtml(SNIPPETS.join(" "))}">
    <script type="application/ld+json">${JSON.stringify({ text: SNIPPETS.join(" ") })}</script>
    </head><body><main>${prose}</main>${flight}</body></html>`;
}

/** The same code, actually shipped. */
function vulnerablePage(): string {
  return `<!DOCTYPE html><html><head><title>App</title></head><body>
    <button onclick="document.write(location.hash)">Open</button>
    <script>
      ${SNIPPETS.join("\n      ")}
    </script>
  </body></html>`;
}

/** Every check that fired, including ones merged into another finding. */
function checkIds(body: string): Set<string> {
  const { findings } = runSyncChecks(
    URL,
    new Headers({ "content-type": "text/html" }),
    body,
  );
  return new Set(
    findings.flatMap((f) => [checkIdOf(f), ...(f.alsoReportedBy ?? [])]),
  );
}

describe("a page about a vulnerability", () => {
  it("reports nothing a blank page would not", () => {
    const blank = checkIds(
      "<!DOCTYPE html><html><head><title>x</title></head><body><main><p>Hello</p></main></body></html>",
    );
    const extra = [...checkIds(documentationPage())].filter(
      (id) => !blank.has(id),
    );
    expect(extra).toEqual([]);
  });

  it("while the page that runs the same code still reports it", () => {
    const fired = checkIds(vulnerablePage());
    // One check per family of snippet above, each of which read the whole
    // response before the prose view and so must still see real script.
    for (const id of [
      "dom-xss-sinks",
      "localstorage-sensitive-data",
      "code-auth-sessionstorage-passwords",
      "postmessage-no-origin-check",
      "postmessage-wildcard",
      "clipboard-access",
      "geolocation-usage",
      "webcam-microphone-access",
      "websocket-unencrypted",
      "code-timing-hmac-equality",
      "code-ssrf-fetch-user-input",
      "code-deser-base64-eval",
      "code-eval-setinterval-string",
      "dangerous-html-attrs",
    ]) {
      expect(fired.has(id), `${id} should fire on shipped code`).toBe(true);
    }
  });
});

describe("stripProse", () => {
  it("returns a response that is not markup unchanged", () => {
    const js = `const a = document.write(location.hash); // <b>`;
    expect(stripProse(js)).toBe(js);
    expect(stripProse(`{"a":"<p>x</p>"}`)).toBe(`{"a":"<p>x</p>"}`);
  });

  it("drops text, comments, examples, data scripts and prose attributes", () => {
    const view = stripProse(
      `<html><body><h1 title="eval(x)">eval(x)</h1><!-- eval(x) -->` +
        `<pre>eval(x)</pre><textarea>eval(x)</textarea>` +
        `<script type="application/ld+json">{"a":"eval(x)"}</script>` +
        `<script>self.__next_f.push([1,"eval(x)"])</script>` +
        `<div data-check="eval(x)" aria-label="eval(x)"></div></body></html>`,
    );
    expect(view).not.toContain("eval(x)");
  });

  it("keeps tags, behavioural attributes, authored script and style", () => {
    const view = stripProse(
      `<html><body><a href="javascript:eval(a)" onclick="eval(b)">t</a>` +
        `<script src="/app.js" integrity="sha384-x"></script>` +
        `<script>eval(c)</script><style>.x{color:red}</style>` +
        `<form action="http://example.com/login" method="post"><input name="csrf_token" type="hidden"></form>` +
        `<img data-src="https://cdn.example.com/a.png"></body></html>`,
    );
    for (const kept of [
      `href="javascript:eval(a)"`,
      `onclick="eval(b)"`,
      `<script src="/app.js" integrity="sha384-x"></script>`,
      `<script>eval(c)</script>`,
      `.x{color:red}`,
      `action="http://example.com/login"`,
      `name="csrf_token"`,
      `data-src="https://cdn.example.com/a.png"`,
    ]) {
      expect(view).toContain(kept);
    }
  });

  it("stays linear on hostile markup", () => {
    for (const body of [
      "<a".repeat(60_000),
      "<script>x".repeat(20_000),
      `<p title="${"a".repeat(100_000)}`,
      "<!--x".repeat(30_000),
      "<" + "a < b ".repeat(30_000),
    ]) {
      const started = Date.now();
      stripProse(body);
      expect(Date.now() - started).toBeLessThan(250);
    }
  });

  it("memoises on the body it was last given without serving a stale view", () => {
    const seen: string[] = [];
    const wrapped = withProseStripped({
      one: (_u, _h, body) => {
        seen.push(body);
        return null;
      },
    });
    const a = `<html><body><p>alpha</p><script>A()</script></body></html>`;
    const b = `<html><body><p>beta</p><script>B()</script></body></html>`;
    for (const body of [a, b, a]) wrapped.one(URL, new Headers(), body);
    expect(seen[0]).toContain("A()");
    expect(seen[1]).toContain("B()");
    expect(seen[2]).toContain("A()");
    expect(seen.join("")).not.toMatch(/alpha|beta/);
  });
});

describe("stripProse on a hostile opening", () => {
  // CodeQL js/redos, alert 200. Deciding whether a body is HTML used a regex
  // with a repeated lazy comment group, which backtracked exponentially on a
  // run of comments followed by anything that is not an element.
  it("decides in linear time on a page of comments with no element after them", () => {
    const body = "<!--a-->".repeat(500) + "x";
    const started = performance.now();
    expect(stripProse(body)).toBe(body);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("still reads a document that opens with comments as HTML", () => {
    const body =
      "<!-- build 42 --> <!-- another -->\n<!doctype html><html><body><p>eval(x) is documented here</p></body></html>";
    expect(stripProse(body)).not.toContain("documented here");
  });

  it("does not treat an unterminated comment as HTML", () => {
    const body = "<!-- never closed <html><body>text</body></html>";
    expect(stripProse(body)).toBe(body);
  });
});
