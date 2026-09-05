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
import {
  extractScriptContents,
  stripDocBlocks,
  stripExampleContent,
  withDocBlocksStripped,
} from "@/lib/scanner/_helpers";

/** See the header: large enough to separate linear from quadratic, small
 *  enough that the whole sweep costs a few seconds. */
const BODY_BYTES = 24_000;

/** ~70x the slowest healthy detector, well under the broken ones. */
const PER_DETECTOR_BUDGET_MS = 200;

/**
 * Vitest's per-test timeout for the groups below, which is a different thing
 * from the budgets and must not be confused with them.
 *
 * A budget failing is the signal this file exists for and prints the detector
 * and the measurement. A timeout is just the runner giving up, and it prints
 * neither. Several groups here sweep every check over a 256 KB body, which is
 * legitimately a few seconds of honest linear work and comfortably past the
 * 5-second default, so without this the suite fails for the wrong reason on a
 * loaded machine and says nothing useful when it does.
 */
const SLOW_TEST_TIMEOUT_MS = 120_000;

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

/**
 * A library name repeated, then a long digit run that never forms a version.
 *
 * This shape is why the suite existed and still missed three cubic
 * detectors: the corpus had unbroken runs, near-miss secrets and unclosed
 * markup, but nothing that put MANY start positions in front of a lazy
 * bridge and a partially-satisfiable tail. /lodash.*?(d+.d+.d+)/
 * measured 188 ms at 2 KB and 1511 ms at 4 KB before the fix.
 */
const LAZY_BRIDGE_VERSIONS =
  "lodash.".repeat(BODY_BYTES / 28) +
  "angular.min.js.".repeat(BODY_BYTES / 60) +
  "0".repeat(BODY_BYTES / 4);

/**
 * JSON array punctuation with the keyword that would satisfy the pattern
 * deliberately absent, so the lazy bridges can never complete and every
 * opening pair is retried against every suffix. 16 KB of this measured 31 s
 * against the old api-graphql-batch-queries regex.
 */
const UNSATISFIABLE_JSON_BATCH = '"errors":[' + "[{".repeat(BODY_BYTES / 2);

/**
 * Deep element nesting. Not a regex case at all: this one made toElements
 * quadratic in TIME AND RETAINED MEMORY (24 KB cost 391 MB, ~96 KB killed
 * the process), because each text token was copied into every open element.
 * Included here because the budget this suite defends is really "no page can
 * stall the event loop", and OOM is the most complete way to fail it.
 */
const DEEP_NESTING = "<div>x".repeat(BODY_BYTES / 6);
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

/**
 * A literal some detector anchors on, followed by one long run of the
 * character class the pattern AFTER that literal also matches.
 *
 * This family was the corpus's second blind spot. Every shape above puts many
 * START POSITIONS in front of a pattern; these put ONE start position in front
 * of two adjacent runs that compete for the same characters. `\s*` next to
 * `.*`, `\s*` next to `[^,)]+`, `\d+` next to `[^"']*`: the trailing literal
 * never arrives, so the matcher proves failure once for every way of splitting
 * the run between the two, which is quadratic from a single occurrence. The
 * payload is tiny, so the 1 MB body cap is no defence at all: 2 KB of it took
 * 3.5 seconds through api-jwt-hs256-weak-secret.
 *
 * Measured on a 128 KB body before the fixes: golang-panic-trace-exposed
 * 21,561 ms, code-jwt-verify-no-secret 19,524 ms, vibe-sql-string-concat
 * 19,492 ms, cs-hardcoded-localhost-api-url 18,935 ms, open-redirect
 * 16,246 ms, rails-error-page-disclosure 1,964 ms.
 *
 * The names say which detector family the shape was found to break.
 */
const RUN_SHAPES: Record<string, string> = {
  // golang-panic-trace-exposed
  panicNoTrace: "panic:" + " ".repeat(BODY_BYTES),
  // code-jwt-verify-no-secret
  jwtVerifyNoArgs: "<script>jwt.verify(" + " ".repeat(BODY_BYTES),
  // api-jwt-hs256-weak-secret
  jwtSignNoArgs: "<script>jwt.sign(" + " ".repeat(BODY_BYTES),
  // open-redirect
  windowLocationNoSource: "<script>window.location =" + " ".repeat(BODY_BYTES),
  // vibe-sql-string-concat
  sqlLiteralNoWhere: "<script>const q = 'SELECT" + " ".repeat(BODY_BYTES),
  // cs-hardcoded-localhost-api-url: a port that never ends and a quote that
  // never closes, so the digit run and the URL run trade characters.
  localhostPortNoQuote:
    '<script>endpoint="https://localhost:' + "9".repeat(BODY_BYTES),
  // rails-error-page-disclosure
  railsVersionNoApp: rep("Rails 1.1.1 "),
  // email's DKIM tag matching, which reads DNS TXT records the scanned
  // domain publishes, on the same `\s*` next to `[^;]*` shape.
  dkimTagNoValue: "v=DKIM1; t=" + " ".repeat(BODY_BYTES),
};

/**
 * Documentation-block markup, repeated and never closed.
 *
 * The corpus had no `<code`/`<pre`/`<kbd`/`<samp` in it at all, which is how
 * `<tag\b[^>]*>[\s\S]*?</tag\s*>` survived in _helpers.ts's three strippers
 * long after every detector using that shape had been fixed. One
 * `stripDocBlocks` call measured 15 ms at 16 KB and 996 ms at 128 KB.
 *
 * At this body size no SINGLE detector crosses the per-detector budget on
 * these, which is exactly the point: the strip ran once per detector, about
 * 150 times per scan, so the damage only existed in aggregate. The whole-sweep
 * budget further down is what actually catches it.
 */
const DOC_BLOCK_SHAPES: Record<string, string> = {
  unterminatedCode: rep("<code>x"),
  unterminatedPre: rep("<pre>x"),
  unterminatedKbd: rep("<kbd>x"),
  unterminatedScriptOpen: rep("<script>x"),
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

  it("keeps every detector inside budget on lazy-bridge version strings", () => {
    const over = detectorsOverBudget(LAZY_BRIDGE_VERSIONS);
    const unexpected = over.filter(
      (o) => !KNOWN_QUADRATIC_DETECTORS.includes(o.id),
    );
    expect(
      unexpected.map((o) => `${o.id}=${o.ms}ms`),
      "A floating `.*?` between a fixed name and a version group is cubic: " +
        "every occurrence of the name is a start position, and the version " +
        "group consumes a digit run and backtracks out at each one. Bound " +
        "the gap and require a real separator before the version.",
    ).toEqual([]);
  });

  it("keeps every detector inside budget on unsatisfiable JSON batch syntax", () => {
    const over = detectorsOverBudget(UNSATISFIABLE_JSON_BATCH);
    const unexpected = over.filter(
      (o) => !KNOWN_QUADRATIC_DETECTORS.includes(o.id),
    );
    expect(
      unexpected.map((o) => `${o.id}=${o.ms}ms`),
      "Lazy bridges that can never be satisfied are the worst case, not the " +
        "best one: the matcher proves failure from every start position. " +
        "Anchor on the keyword with indexOf before matching structure.",
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

describe("detector time budget on a literal followed by one long run", () => {
  for (const [name, body] of Object.entries(RUN_SHAPES)) {
    it(
      `keeps every detector inside budget on ${name}`,
      () => {
        const over = detectorsOverBudget(body, MARKUP_CONTEXT);
        expect(
          over.map((o) => `${o.id}=${o.ms}ms`),
          `Over ${PER_DETECTOR_BUDGET_MS}ms on a ${BODY_BYTES}-byte body. Two adjacent runs that match the same characters, with the literal after them never arriving, is quadratic from a SINGLE occurrence: the matcher proves failure once per way of splitting the run. Fold the whitespace into the class that already matches it and bound the run, so no two parts of the pattern can claim the same character.`,
        ).toEqual([]);
      },
      SLOW_TEST_TIMEOUT_MS,
    );
  }
});

describe("detector time budget on documentation-block markup", () => {
  for (const [name, body] of Object.entries(DOC_BLOCK_SHAPES)) {
    it(
      `keeps every detector inside budget on ${name}`,
      () => {
        const over = detectorsOverBudget(body, MARKUP_CONTEXT);
        expect(
          over.map((o) => `${o.id}=${o.ms}ms`),
          `Over ${PER_DETECTOR_BUDGET_MS}ms on a ${BODY_BYTES}-byte body. Strip <code>/<pre>/<kbd>/<samp> regions through lib/scanner/checks/_tag-scan.ts's stripTagElements, not a local <tag\\b[^>]*>[\\s\\S]*?</tag\\s*> of your own: that shape rescans the rest of the document from every opening tag the page never closes.`,
        ).toEqual([]);
      },
      SLOW_TEST_TIMEOUT_MS,
    );
  }
});

/**
 * A second, larger body size, because three of the defects this suite now
 * guards are invisible at 24 KB.
 *
 * The 24 KB body was chosen so that a quadratic REGEX shows up in about a
 * second. Two other shapes in the same family have much smaller constants and
 * need more input before they separate from a healthy linear detector:
 *
 * - a quadratic `indexOf` loop (form-method-get-sensitive rescanned the whole
 *   remainder for every <form>): 50 ms at 24 KB, 5,679 ms at 256 KB.
 * - a bounded run with a 2000x constant (`<[a-z][a-z0-9]*[^>]{0,2000}ATTR`,
 *   which pays a full 2000-character scan for every `<` in a document that
 *   contains no `>` at all): 107 ms at 24 KB, 1,146 ms at 256 KB.
 *
 * Also measured over budget here before the fixes, and not by the 24 KB group:
 * the CSP family through getEffectiveCsp (csp-missing, csp-no-default-src,
 * csp-base-uri-missing, csp-frame-src-missing, csp-form-action-missing) at
 * about 3,100 ms each, sql-error-in-page at 3,112 ms, sql-error-exposure at
 * 3,083 ms, target-blank-no-noopener at 1,128 ms and
 * code-clickjack-target-blank-js-href at 1,102 ms.
 *
 * The budget is looser than the 24 KB one for the obvious reason: a healthy
 * detector's honest cost scales with the body. The slowest healthy detector
 * measured 122 ms here, so 500 ms is about four times the healthy ceiling and
 * two to thirty times below everything listed above.
 */
const LARGE_BODY_BYTES = 262_144;
const LARGE_BUDGET_MS = 500;

const LARGE_SHAPES: Record<string, string> = (() => {
  const big = (unit: string) =>
    unit.repeat(Math.max(1, Math.floor(LARGE_BODY_BYTES / unit.length)));
  // Distinct URLs, because the quadratic here was `body.indexOf(tag)` from
  // zero for every tag: identical tags all resolve on the first one and cost
  // nothing.
  let distinctMeta = "";
  for (let i = 0; distinctMeta.length < LARGE_BODY_BYTES; i++) {
    distinctMeta += `<meta http-equiv="refresh" content="0;url=https://evil${i}.example/">`;
  }
  return {
    // form-method-get-sensitive
    formOpenNoClose: big("<form>"),
    // inline-style-attr, target-blank-no-noopener,
    // code-clickjack-target-blank-js-href: `<` with no `>` anywhere
    bareOpenAngleRun: big("<a"),
    // open-redirect-meta-refresh-confirmed
    metaRefreshDistinct: distinctMeta,
    // sql-error-in-page, sql-error-exposure, and the three stripper helpers
    docBlockRun: big("<code>x"),
    // the CSP family, through getEffectiveCsp
    unterminatedMeta: big('<meta name="viewport" content="'),
    unterminatedPasswordInput: big('<input type="password" '),
  };
})();

describe("detector time budget on a large body", () => {
  for (const [name, body] of Object.entries(LARGE_SHAPES)) {
    it(
      `keeps every detector inside budget on ${name}`,
      () => {
        const over: { id: string; ms: number }[] = [];
        for (const check of allChecks) {
          const started = Date.now();
          try {
            check(MARKUP_CONTEXT.url, MARKUP_CONTEXT.headers, body);
          } catch {
            // Same reasoning as detectorsOverBudget: a throwing detector is
            // engine.test.ts's problem, and its elapsed time still counts.
          }
          const ms = Date.now() - started;
          if (ms > LARGE_BUDGET_MS) over.push({ id: check.checkId ?? "?", ms });
        }
        expect(
          over.sort((a, b) => b.ms - a.ms).map((o) => `${o.id}=${o.ms}ms`),
          `Over ${LARGE_BUDGET_MS}ms on a ${LARGE_BODY_BYTES}-byte body, against the 1 MB body cap execute-scan allows. A detector that passes the 24 KB budgets above and fails here is superlinear with a small constant, or linear with a large one; both are seconds of blocked event loop at the cap.`,
        ).toEqual([]);
      },
      SLOW_TEST_TIMEOUT_MS,
    );
  }
});

/**
 * The whole check set, once, over one body.
 *
 * This is the budget the per-detector ones structurally cannot express. The
 * three strippers in lib/scanner/_helpers.ts are called by every detector in
 * api.ts, supply-chain.ts and vibe-code.ts through their wrapper maps: exactly
 * 150 detectors, each stripping the same body again. At 24 KB one quadratic
 * strip is about 33 ms, comfortably inside the 200 ms per-detector line, and
 * no individual detector ever looked slow. Summed, the same body cost 4,155 ms
 * across those three modules alone.
 *
 * So the guard has to be on the total. Calibration, on the same machine as
 * every other number in this file: the slowest healthy shape sweeps all of
 * allChecks in 145 ms, and the defect above is 4,155 ms for three modules or
 * roughly 1,600 ms for api.ts on its own. 1000 ms sits about seven times above
 * the healthy ceiling and below any single module reintroducing it.
 */
const WHOLE_SWEEP_BUDGET_MS = 1000;

describe("whole-sweep time budget", () => {
  const everyShape: Record<string, string> = {
    unbrokenRun: UNBROKEN_RUN,
    nearMissSecrets: NEAR_MISS_SECRETS,
    unterminatedMarkup: UNTERMINATED_MARKUP,
    lazyBridgeVersions: LAZY_BRIDGE_VERSIONS,
    unsatisfiableJsonBatch: UNSATISFIABLE_JSON_BATCH,
    deepNesting: DEEP_NESTING,
    ...SHAPES,
    ...RUN_SHAPES,
    ...DOC_BLOCK_SHAPES,
  };

  for (const [name, body] of Object.entries(everyShape)) {
    it(
      `sweeps every check over ${name} inside budget`,
      () => {
        const started = Date.now();
        for (const check of allChecks) {
          try {
            check(MARKUP_CONTEXT.url, MARKUP_CONTEXT.headers, body);
          } catch {
            // Not this suite's concern; see detectorsOverBudget.
          }
        }
        const elapsed = Date.now() - started;
        expect(
          elapsed,
          `One pass of all ${allChecks.length} checks over a ${BODY_BYTES}-byte body took ${elapsed}ms.\n` +
            "Nothing here need be slow on its own for this to fail: work repeated once per detector is invisible to a per-detector budget and is what this line exists to catch. Check for a helper being recomputed inside a wrapper map rather than once per body.",
        ).toBeLessThan(WHOLE_SWEEP_BUDGET_MS);
      },
      SLOW_TEST_TIMEOUT_MS,
    );
  }
});

describe("response-body strippers", () => {
  // These are called from the wrapper maps of three detector modules and from
  // detectors that need script content, so they run on every scan. They each
  // carried the `<tag\b[^>]*>[\s\S]*?</tag\s*>` shape: on a body of
  // `"<code>x"` repeated, stripDocBlocks measured 15 ms at 16 KB, 75 ms at
  // 32 KB, 266 ms at 64 KB and 996 ms at 128 KB, four times the cost for
  // twice the input. Linear now, at 2 to 7 ms on the largest of those.
  const STRIPPER_BODY_BYTES = 131_072;
  const STRIPPER_BUDGET_MS = 100;
  const codeRun = "<code>x".repeat(Math.floor(STRIPPER_BODY_BYTES / 7));
  const scriptRun = "<script>x".repeat(Math.floor(STRIPPER_BODY_BYTES / 9));

  const cases: [string, () => unknown][] = [
    ["stripDocBlocks", () => stripDocBlocks(codeRun)],
    ["stripExampleContent", () => stripExampleContent(codeRun)],
    ["extractScriptContents", () => extractScriptContents(scriptRun)],
  ];

  for (const [name, run] of cases) {
    it(
      `${name} stays linear on unterminated tags`,
      () => {
        const started = Date.now();
        run();
        const elapsed = Date.now() - started;
        expect(
          elapsed,
          `${name} took ${elapsed}ms on a ${STRIPPER_BODY_BYTES}-byte body. Route it through lib/scanner/checks/_tag-scan.ts rather than reintroducing a lazy tag-pair regex.`,
        ).toBeLessThan(STRIPPER_BUDGET_MS);
      },
      SLOW_TEST_TIMEOUT_MS,
    );
  }

  it("still removes the regions it is meant to remove", () => {
    expect(stripDocBlocks("a<code>secret</code>b")).toBe("ab");
    expect(stripDocBlocks("a<pre class='x'>secret</pre >b")).toBe("ab");
    // <script> is deliberately left alone here: vibe-code.ts's detectors need
    // to see genuine inline script content.
    expect(stripDocBlocks("a<script>keep</script>b")).toBe(
      "a<script>keep</script>b",
    );
    // `<codex>` is not a `<code>` tag, which is what the `\b` meant.
    expect(stripDocBlocks("a<codex>keep</codex>b")).toBe(
      "a<codex>keep</codex>b",
    );
    // An opening tag that never closes ends the sweep rather than eating the
    // rest of the document.
    expect(stripDocBlocks("a<code>tail")).toBe("a<code>tail");

    expect(stripExampleContent("a<script>x</script>b<code>y</code>c")).toBe(
      "abc",
    );
    expect(
      extractScriptContents("<script>one</script>x<script>two</script>"),
    ).toEqual(["one", "two"]);
  });

  it("memoises on the body it was last given without ever serving a stale strip", () => {
    // The strip is hoisted out of the per-detector wrapper by a one-entry
    // memo, which is the whole reason 150 detectors cost one strip instead of
    // 150. The risk a memo adds is serving the previous body's result, so
    // alternate two bodies and demand the right answer every time.
    const seen: string[] = [];
    const record = withDocBlocksStripped({
      first: (_u, _h, body) => {
        seen.push(body);
        return null;
      },
      second: (_u, _h, body) => {
        seen.push(body);
        return null;
      },
    });
    const url = "https://example.com/";
    const headers = new Headers();
    const a = "alpha<code>hidden-a</code>tail";
    const b = "beta<pre>hidden-b</pre>tail";

    for (const body of [a, b, a, b, b, a]) {
      record.first(url, headers, body);
      record.second(url, headers, body);
    }

    expect(seen).toEqual([
      "alphatail",
      "alphatail",
      "betatail",
      "betatail",
      "alphatail",
      "alphatail",
      "betatail",
      "betatail",
      "betatail",
      "betatail",
      "alphatail",
      "alphatail",
    ]);
  });
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
