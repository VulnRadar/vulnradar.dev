import { describe, it, expect } from "vitest";
import { pageChecks } from "@/lib/scanner/checks/page-checks";
import { requirementsMet } from "@/lib/scanner/check-types";
import { buildPageContext } from "@/lib/scanner/page-context";

/**
 * No page check may be made slow by the page it is reading.
 *
 * The scanner's whole job is to fetch a document somebody else wrote, so every
 * detector runs against input chosen by the person it is pointed at. A regex
 * that backtracks catastrophically is therefore not a performance note, it is
 * a denial of service with the target holding the trigger: one crafted page
 * occupies a worker for as long as the pattern takes.
 *
 * This caught a real one. page-presigned-url-azure-sas-exposed matched a
 * storage URL with two unbounded [^\s"'<>]* runs and a [?&] between them, and
 * ? and & are both inside that class, so on a body of repeated
 * "?sv=2020-01-01" the engine tried every split point between the two runs:
 * 9.2 seconds on 256KB. It shipped the same day it was written, having passed
 * every fixture, because a fixture is a well-formed example and this class of
 * bug only appears on input nobody would write by hand.
 *
 * The shapes below are the ones that provoke backtracking: long unbroken
 * runs, a near-miss repeated thousands of times so every position is a
 * plausible start, and markup opened and never closed so a parser looking for
 * a terminator scans to the end each time.
 */

const N = 262_144; // 256KB, the order of a real page rather than a toy

/** Repeat a unit until it fills the budget. */
const rep = (unit: string) =>
  unit.repeat(Math.max(1, Math.floor(N / unit.length)));

/**
 * How far above its peers a check may sit before it is a different
 * complexity class rather than merely a slow one.
 *
 * A fixed millisecond ceiling was the obvious design and it flaked on its
 * first parallel run: this file builds 23 quarter-megabyte bodies and runs
 * every check over each, alongside four hundred other test files, so wall
 * clock here says as much about the runner load as about the code. A test
 * that fails when the machine is busy is worse than no test, because it
 * teaches people to re-run CI rather than read it.
 *
 * A ratio does not have that problem. Contention slows every check on the
 * same body equally, so it cancels, and what survives is the shape. The bug
 * this caught ran 9,235ms against a median under one, and 40x is a margin no
 * linear check has come anywhere near.
 */
const SLOWER_THAN_PEERS = 40;

/**
 * The floor under that ratio.
 *
 * With every check finishing in a millisecond or two, timer granularity
 * alone can produce a 40x ratio out of nothing. A check has to be slow in
 * absolute terms as well as relative ones before this reports it.
 */
const MIN_INTERESTING_MS = 250;

const SHAPES: Record<string, string> = {
  unbrokenRun: "a".repeat(N),
  nearMissSecrets: "api_key=AKIA".repeat(N / 12),
  unterminatedMarkup:
    `<div class="${"x".repeat(N / 5)}<script src="${"y".repeat(N / 5)}`.padEnd(
      N,
      "<",
    ),
  lazyBridgeVersions:
    "lodash.".repeat(N / 28) +
    "angular.min.js.".repeat(N / 60) +
    "0".repeat(N / 4),
  unsatisfiableJsonBatch: '"errors":[' + "[{".repeat(N / 2),
  deepNesting: "<div>x".repeat(N / 6),
  unterminatedMeta: rep('<meta name="viewport" content="'),
  unterminatedLink: rep('<link rel="stylesheet" href="http://x/a"'),
  unterminatedForm: rep('<form method="post" action="https://x.com/a"'),
  unterminatedPasswordInput: rep('<input type="password" '),
  unterminatedScript: rep('<script src="https://cdnjs.cloudflare.com/x"'),
  unterminatedIframe: rep('<iframe src="https://x.com/a"'),
  unterminatedAnchor: rep('<a target="_blank" href="http://x/a"'),
  bareOpenAngleRun: rep("<a"),
  docBlockRun: rep("<code>x"),
  // The exact shape that took 9.2 seconds: a storage host followed by the
  // SAS version parameter repeated, so every "?" is a candidate split.
  azureSasSplitPoints:
    "https://a.blob.core.windows.net/" + "?sv=2020-01-01".repeat(N / 14),
  awsSigCredentialRun:
    "?X-Amz-Signature=" +
    "a".repeat(64) +
    "&X-Amz-Credential=" +
    "A".repeat(N / 2),
  gcsSigRun: "?X-Goog-Signature=" + "a".repeat(N / 2),
  urlCreds: rep("http://a:b"),
  storageSetItem: 'localStorage.setItem("' + "token ".repeat(N / 6),
  jwtish: rep("eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ."),
  phpWarn: "Warning:" + " in " + "a".repeat(N),
  inlineScriptSecrets:
    "<script>" + rep('apiKey="AAAAAAAAAAAAAAAAAAAAAAAA"') + "</script>",
  // page-internal-path-disclosed: a path prefix repeated with no extension
  // anywhere, so every slash is a place a run of path characters could split.
  // The /opt/ one was cubic (3.3 s at 4 KB, eight times that per doubling)
  // and the other three about 20 s each at this size.
  optPathRun: rep("/opt/"),
  homePathRun: rep("/home/a"),
  varPathRun: rep("/var/www"),
  usrLocalRun: rep("/usr/local"),
};

/** The path shapes, also held to an absolute line below. */
const PATH_SHAPES = ["optPathRun", "homePathRun", "varPathRun", "usrLocalRun"];

/**
 * How many times a check that crossed the line is measured again before it is
 * reported.
 *
 * docBlockRun failed about one CI run in two with page-stack-trace-disclosed
 * at 300 to 400 ms, and the check is not slow: it measures 10 to 20 ms on that
 * body, growing linearly with it. The time was the garbage collector's.
 * buildPageContext keeps about 400 MB live for a 256 KB run of unclosed
 * <code>, and a full collection of that heap costs about 260 ms on a
 * development machine. It lands on whichever check allocates first after the
 * context is built, which on that body is this one, because it is the first
 * to strip the code examples out.
 *
 * A collection pause is a fact about the heap, not about the check, so the
 * fastest of three runs is what is compared. A backtracking pattern costs the
 * same on every run and still fails; a pause lands on one run and does not.
 */
const REMEASURE_RUNS = 3;

function timeCheck(
  check: (typeof pageChecks)[number],
  ctx: ReturnType<typeof buildPageContext>,
): number {
  const started = Date.now();
  try {
    if (requirementsMet(check, ctx)) check.run(ctx);
  } catch {
    // A throwing check is the engine's problem, not this test's: it
    // is contained per check there. Only the time is measured here.
  }
  return Date.now() - started;
}

describe("page checks stay linear on a hostile page", () => {
  for (const [shape, body] of Object.entries(SHAPES)) {
    it(`no check exceeds its budget on: ${shape}`, () => {
      const headers = new Headers({
        "content-type": "text/html",
        // Header values are attacker-controlled too, and several checks
        // read them.
        "x-powered-by": "a".repeat(4_000),
        "set-cookie": "a".repeat(4_000),
      });
      const ctx = buildPageContext(
        "https://example.com/graphql?id=1",
        headers,
        body,
      );

      const timings = pageChecks.map((check) => ({
        check,
        ms: timeCheck(check, ctx),
      }));

      // Median, not mean: one catastrophic check would drag a mean up far
      // enough to hide itself behind.
      const sorted = timings.map((t) => t.ms).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const ceiling = Math.max(
        MIN_INTERESTING_MS,
        Math.max(median, 1) * SLOWER_THAN_PEERS,
      );

      const over = timings
        .filter((t) => t.ms > ceiling)
        .map(({ check, ms }) => {
          let fastest = ms;
          for (let i = 1; i < REMEASURE_RUNS && fastest > ceiling; i++) {
            fastest = Math.min(fastest, timeCheck(check, ctx));
          }
          return { id: check.id, ms: fastest };
        })
        .filter((t) => t.ms > ceiling)
        .map((t) => `${t.id} took ${t.ms}ms against a median of ${median}ms`);

      expect(
        over,
        `a page can make these checks slow, which on a scanner is a denial of service the target triggers:\n${over.join("\n")}`,
      ).toEqual([]);
    }, 120_000);
  }
});

/**
 * The path shapes against a fixed line as well as against their peers.
 *
 * The ratio above needs a median to compare with, and a check that never
 * returns gives it nothing: on optPathRun the old /opt/ pattern did not finish,
 * so the run hung rather than failed. Two seconds is far above what a linear
 * pass over 256 KB costs and far below what any of the four old patterns did.
 */
describe("internal-path patterns on path-shaped runs", () => {
  const check = pageChecks.find((c) => c.id === "page-internal-path-disclosed");

  for (const shape of PATH_SHAPES) {
    it(`page-internal-path-disclosed finishes ${shape} inside 2 seconds`, () => {
      expect(check).toBeDefined();
      const ctx = buildPageContext(
        "https://example.com/",
        new Headers({ "content-type": "text/html" }),
        SHAPES[shape],
      );
      const ms = timeCheck(check!, ctx);
      expect(ms, `took ${ms}ms on a ${N}-byte body`).toBeLessThan(2_000);
    }, 120_000);
  }
});
