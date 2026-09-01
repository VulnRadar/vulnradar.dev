/**
 * Execution-time budgets for the synchronous scanner surface.
 *
 * Every other suite under tests/ asserts what a detector FINDS. Before this
 * file, not one of the ~10,000 tests bounded execution time or input size,
 * which is why a whole class of defect walked past a green suite: a quadratic
 * or backtracking regex applied to the 1 MB body cap that execute-scan.ts
 * allows. The body comes from the site being scanned, so it is
 * attacker-controlled on every scan, including the unauthenticated demo path.
 * Line coverage never noticed, because line coverage records that a line ran,
 * not that it returned.
 *
 * This is the ONE budget suite. It used to be two: the adversarial markup
 * shapes below lived in tests/lib/scanner/checks/_tag-scan-perf.test.ts, added
 * later and separately, which meant a new detector had two places it could be
 * measured and one of them was easy to miss. Both sets of shapes and both sets
 * of assertions are kept here verbatim.
 *
 * How this is built to not be flaky. The failure mode is not "a bit slower",
 * it is orders of magnitude, so the test does not need a tight budget and
 * deliberately does not have one. At the body size used here a healthy
 * detector measures 0 to 3 ms; the quadratic ones measured 1100 to 1400 ms on
 * the plain runs and 10 to 184 SECONDS on the unterminated-tag shapes. The
 * 200 ms line sits roughly seventy times above the healthy group and well
 * below the broken group, so a loaded runner cannot cross it in either
 * direction.
 *
 * The body is 24 KB rather than the real 1 MB cap for the same reason: at
 * 1 MB the quadratic detectors take tens of minutes each, which is the bug,
 * but it also makes the suite unrunnable. Quadratic cost scales with the
 * square of the input, so 24 KB reproduces the signal in about a second.
 */
import { describe, it, expect } from "vitest";
import { allChecks } from "@/lib/scanner/registry";
import { isPathDisallowed, parseRobots } from "@/lib/scanner/crawl-discovery";

/** See the header: large enough to separate linear from quadratic, small
 *  enough that the whole sweep costs a few seconds. */
const BODY_BYTES = 24_000;

/** ~70x the slowest healthy detector, well under the broken ones. */
const PER_DETECTOR_BUDGET_MS = 200;

/**
 * Detectors measured to be superlinear in body length, on this machine, on
 * a body that is one unbroken run of word characters:
 *
 *   size      phishing-lookalike   ruby-backtrace   cloudflare-r2
 *   50 KB          6,016 ms          5,500 ms         5,773 ms
 *   100 KB        23,404 ms         21,312 ms        21,105 ms
 *   200 KB        73,464 ms         67,862 ms        80,738 ms
 *
 * Four times the input for roughly twelve times the cost is the quadratic
 * signature. Extrapolated to the 1 MB body cap the scanner actually applies,
 * each of these is on the order of half an hour of blocked event loop, from a
 * page any scanned site can serve.
 *
 * They are listed here rather than silently excluded, and the test below
 * asserts the list is EXACTLY right in both directions: a fourth detector
 * going quadratic fails the run, and fixing one of these three also fails the
 * run, with a message saying to delete it from this list. A quarantine that
 * cannot go stale.
 *
 * All three original entries have since been fixed by left-anchoring the
 * leading character class (a lookbehind, so only the first position of a run
 * is eligible instead of every offset), which took each from roughly 4.6s on
 * a 50KB body to under a millisecond with detection behaviour unchanged. The
 * list is therefore empty, which is the intended steady state: it exists to
 * catch the next one, not to hold these.
 */
const KNOWN_QUADRATIC_DETECTORS: string[] = [];

/**
 * The URL and headers a body is measured against. The two groups below use
 * different ones because they were calibrated against different ones, and the
 * request context feeds detectors that key on headers rather than on the body.
 * Merging them into a single fixture would silently re-baseline every
 * assertion here, so both are kept exactly as each was measured.
 */
type ProbeContext = { url: string; headers: Headers };

const PLAIN_CONTEXT: ProbeContext = {
  url: "https://example.com/",
  headers: new Headers({
    "content-type": "text/html",
    // Header values of the same adversarial shape, since several detectors
    // match on header content rather than on the body.
    "x-powered-by": "a".repeat(4_000),
    "server-timing": `db;dur=${"9".repeat(4_000)}`,
  }),
};

const MARKUP_CONTEXT: ProbeContext = {
  // A query string and a /graphql path so the URL-keyed detectors (injection
  // parameters, GraphQL introspection) are on rather than short-circuited.
  url: "https://example.com/graphql?id=1",
  headers: new Headers({
    "content-type": "text/html",
    "x-powered-by": "a".repeat(4_000),
    "set-cookie": "a".repeat(4_000),
  }),
};

/**
 * One unbroken run of word characters with no delimiter anywhere: the classic
 * input for a `(\w+)+`-shaped pattern and the worst case for any matcher that
 * rescans from every position.
 */
const UNBROKEN_RUN = "a".repeat(BODY_BYTES);

/** Every window looks like the start of a secret and none of them completes,
 *  so a backtracking matcher backtracks at every offset. */
const NEAR_MISS_SECRETS = "api_key=AKIA".repeat(BODY_BYTES / 12);

/** An attribute and a tag that never terminate, which is what makes a
 *  `<[^>]*>`-shaped pattern scan to the end of the document from every
 *  opening angle bracket. */
const UNTERMINATED_MARKUP =
  `<div class="${"x".repeat(BODY_BYTES / 5)}<script src="${"y".repeat(BODY_BYTES / 5)}`.padEnd(
    BODY_BYTES,
    "<",
  );

/** Repeat `unit` until the body reaches the target size. */
function rep(unit: string): string {
  return unit.repeat(Math.max(1, Math.floor(BODY_BYTES / unit.length)));
}

/**
 * Each entry is a tag that never closes, repeating an attribute some detector
 * keys on. The three shapes above left this whole family unmeasured, because
 * the expensive shape is a tag that never closes AND repeats the attribute the
 * detector is looking for. That combination is what turns
 * `<tag[^>]{0,2000}ATTR[^>]{0,2000}>` quadratic: the attribute matches at many
 * offsets inside the first bounded run, and each one makes the trailing run
 * scan its full 2000 characters and back looking for a `>` that is not there.
 *
 * Measured on a 24 KB body before the fix: sensitive-meta-tags 24 SECONDS,
 * sri-stylesheet-missing 10.6 s, sql-injection-patterns 184 SECONDS, plus a
 * dozen detectors between 0.4 s and 1.5 s.
 *
 * The names say which detector family the shape was found to break.
 */
const SHAPES: Record<string, string> = {
  // sensitive-meta-tags, viewport-user-scalable-no, opengraph-injection,
  // meta-refresh, cms-fingerprinting, meta-referrer-unsafe
  unterminatedMeta: rep('<meta name="viewport" content="'),
  unterminatedMetaProperty: rep('<meta property="og:image" content="'),
  // sri-stylesheet-missing
  unterminatedLink: rep('<link rel="stylesheet" href="http://x/a"'),
  // open-form-action, sensitive-form-no-csrf, form-action-* , cache-control
  unterminatedForm: rep('<form method="post" action="https://x.com/a"'),
  // autocomplete-sensitive, password-input-no-name, weak-password-policy,
  // hidden-password-field, input-maxlength-short, password-no-paste
  unterminatedPasswordInput: rep('<input type="password" '),
  // sri-missing, outdated-js-libs, cdn-fallback-missing, third-party-script-no-sri
  unterminatedScript: rep('<script src="https://cdnjs.cloudflare.com/x"'),
  // iframe-sandbox-missing, srcdoc-iframe, iframe-third-party-without-sandbox
  unterminatedIframe: rep('<iframe src="https://x.com/a"'),
  // form-formnovalidate-bypass
  unterminatedButton: rep("<button formnovalidate "),
  // sql-injection-patterns: a SQL verb that never reaches its WHERE/VALUES
  sqlVerbNoTail: rep('<script>q = "SELECT * FROM users '),
  sqlVerbPlain: rep("SELECT * FROM "),
  // hardcoded-secrets: one unbroken alphanumeric run of near-miss key text
  nearMissKeyRun: rep("AKIAIOSFODNN7EXAMPL"),
};

/** Runs every synchronous detector once and returns the ids that blew the
 *  budget, slowest first, each with its measured time. */
function detectorsOverBudget(
  body: string,
  context: ProbeContext = PLAIN_CONTEXT,
): { id: string; ms: number }[] {
  const over: { id: string; ms: number }[] = [];
  for (const check of allChecks) {
    const started = Date.now();
    try {
      check(context.url, context.headers, body);
    } catch {
      // A throwing detector is the engine's problem, not this suite's:
      // tests/lib/scanner/engine.test.ts covers the per-check isolation.
      // The elapsed time is still meaningful, so it is still recorded.
    }
    const ms = Date.now() - started;
    if (ms > PER_DETECTOR_BUDGET_MS) {
      over.push({ id: check.checkId ?? "(anonymous)", ms });
    }
  }
  return over.sort((a, b) => b.ms - a.ms);
}

describe("synchronous detector time budget", () => {
  it("has exactly the known quadratic detectors over budget, no more and no fewer", () => {
    const over = detectorsOverBudget(UNBROKEN_RUN);
    const ids = over.map((o) => o.id).sort();
    const detail = over.map((o) => `${o.id}=${o.ms}ms`).join(", ");

    expect(
      ids,
      `Measured over ${PER_DETECTOR_BUDGET_MS}ms on a ${BODY_BYTES}-byte body: ${detail || "(none)"}.\n` +
        "A detector appearing here that is not in KNOWN_QUADRATIC_DETECTORS is a new quadratic or backtracking regex, and at the 1 MB body cap it is minutes of blocked event loop from any scanned page.\n" +
        "A detector missing from here that IS in that list has been fixed: delete it from the list so the guard tightens.",
    ).toEqual([...KNOWN_QUADRATIC_DETECTORS].sort());
  });

  it("keeps every other detector inside budget on near-miss secret prefixes", () => {
    const over = detectorsOverBudget(NEAR_MISS_SECRETS);
    const unexpected = over.filter(
      (o) => !KNOWN_QUADRATIC_DETECTORS.includes(o.id),
    );
    expect(
      unexpected.map((o) => `${o.id}=${o.ms}ms`),
      "A detector that is fast on a plain run of characters but slow on near-misses is backtracking, which is the same defect with a different trigger.",
    ).toEqual([]);
  });

  it("keeps every other detector inside budget on unterminated markup", () => {
    const over = detectorsOverBudget(UNTERMINATED_MARKUP);
    const unexpected = over.filter(
      (o) => !KNOWN_QUADRATIC_DETECTORS.includes(o.id),
    );
    expect(
      unexpected.map((o) => `${o.id}=${o.ms}ms`),
      "Unclosed tags make a `<[^>]*>`-shaped pattern scan to end of document from every `<`.",
    ).toEqual([]);
  });
});

describe("markup detector time budget on unterminated tags", () => {
  for (const [name, body] of Object.entries(SHAPES)) {
    it(`keeps every detector inside budget on ${name}`, () => {
      const over = detectorsOverBudget(body, MARKUP_CONTEXT);
      expect(
        over.map((o) => `${o.id}=${o.ms}ms`),
        `Over ${PER_DETECTOR_BUDGET_MS}ms on a ${BODY_BYTES}-byte body. At the 1 MB body cap execute-scan allows this is seconds to minutes of blocked event loop, from a page any scanned site can serve. Match the tag first and test attributes against the tag's own text: see lib/scanner/checks/_tag-scan.ts.`,
      ).toEqual([]);
    });
  }
});

describe("robots.txt rule matching time budget", () => {
  // The rule text comes from the scanned site, so it is attacker-controlled on
  // every crawl, and isPathDisallowed runs the whole rule set once per
  // discovered URL, so one slow rule multiplies by the crawl size. Compiling
  // each `*` to `.*` and handing the result to RegExp measured 45 ms at 5
  // wildcards, 1.5 s at 7, 9 s at 8 and 35 MINUTES at 10. The glob matcher
  // that replaced it is linear; this is the test that says so.
  it("stays linear on a wildcard-dense rule set", () => {
    // The group has to NAME the crawler: parseRobots deliberately ignores the
    // blanket `*` group (see tests/lib/scanner/crawl-discovery-robots.test.ts),
    // so a `*` group here would parse to zero rules and this test would time
    // an empty loop.
    const robots = parseRobots(
      [
        "User-agent: VulnRadar",
        `Disallow: /${"a*".repeat(10)}b`,
        `Disallow: /${"*x".repeat(12)}`,
        "Disallow: /*/*/*/*/*/*/*/*/*/*$",
      ].join("\n"),
      "VulnRadar/1.0 (Crawler)",
    );
    expect(robots.disallows.length).toBe(3);

    // Matches every rule's prefix and none of their tails: maximum
    // backtracking against a regex-compiled matcher, nothing at all against a
    // scanning one.
    const path = `/${"a".repeat(120)}`;

    const started = Date.now();
    for (let i = 0; i < 1000; i++) {
      isPathDisallowed(path, robots.disallows);
    }
    const elapsed = Date.now() - started;

    expect(
      elapsed,
      `1000 rule-set evaluations took ${elapsed}ms.`,
    ).toBeLessThan(2000);
  });
});
