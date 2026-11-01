import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseArgs,
  evaluateGate,
  buildScanBody,
  retryAfterSeconds,
  reportRequestUrl,
  gateCounts,
  hasSummary,
  incompleteOutcome,
  describeNotChecked,
  describeProgress,
  classifyRateLimit,
  createRetryPlan,
  cancelScan,
  isScanIdSegment,
  insecureApiBase,
  BLOCKING_INCOMPLETE,
  INCOMPLETE_LABELS,
  SLOT_BACKOFF_SECONDS,
  SLOT_WAIT_CAP_SECONDS,
  REPORT_FORMATS,
  DEFAULTS,
  EXIT,
} from "./lib.mjs";

const CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "vulnradar.mjs",
);

/**
 * Run the real CLI executable against a throwaway HTTP server standing in for
 * the API. The gate logic has unit tests below, but everything between argv
 * and the exit code -- the missing-key guard, the non-200 handling, the poll
 * loop, the JSON versus human output -- only exists in vulnradar.mjs and was
 * covered by nothing. Spawning is the only way to observe process.exit.
 */
function runCli(args, { routes = {}, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    // Every request the CLI made, so a test can assert what was sent and not
    // only how the CLI reacted to the reply.
    const requests = [];
    const hits = new Map();
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        requests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: raw ? JSON.parse(raw) : undefined,
        });
        const route = Object.keys(routes).find((k) => req.url.startsWith(k));
        if (!route) {
          res.writeHead(404).end("{}");
          return;
        }
        const entry = routes[route];
        // A route may be a list of replies, served in order with the last one
        // repeated, to script a 429 followed by success.
        let reply = entry;
        if (Array.isArray(entry)) {
          const n = hits.get(route) ?? 0;
          hits.set(route, n + 1);
          reply = entry[Math.min(n, entry.length - 1)];
        }
        const { status = 200, body = {}, headers: extra = {} } = reply;
        res.writeHead(status, { "Content-Type": "application/json", ...extra });
        res.end(typeof body === "string" ? body : JSON.stringify(body));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      // Start from a copy of the ambient environment minus the token, so a
      // VULNRADAR_TOKEN set on the developer's machine cannot make the
      // missing-key test pass for the wrong reason.
      const childEnv = { ...process.env };
      delete childEnv.VULNRADAR_TOKEN;
      delete childEnv.VULNRADAR_API_BASE;
      execFile(
        process.execPath,
        [CLI, ...args, "--api-base", `http://127.0.0.1:${port}`],
        { env: { ...childEnv, ...env } },
        (err, stdout, stderr) => {
          server.close();
          if (err && typeof err.code !== "number") return reject(err);
          resolve({ code: err ? err.code : 0, stdout, stderr, requests });
        },
      );
    });
  });
}

const completed = (summary) => ({
  status: "completed",
  result: { summary },
});

test("parseArgs: defaults + command + url", () => {
  const o = parseArgs(["scan", "https://example.com"]);
  assert.equal(o.command, "scan");
  assert.equal(o.url, "https://example.com");
  assert.equal(o.crawl, false);
  assert.equal(o.maxCritical, DEFAULTS.maxCritical);
  assert.equal(o.maxMedium, -1);
  assert.equal(o.error, undefined);
});

test("parseArgs: flags", () => {
  const o = parseArgs([
    "scan",
    "https://x.com",
    "--crawl",
    "--max-high",
    "3",
    "--api-base",
    "https://self.host/api/v3",
    "--json",
  ]);
  assert.equal(o.crawl, true);
  assert.equal(o.maxHigh, 3);
  assert.equal(o.apiBase, "https://self.host/api/v3");
  assert.equal(o.json, true);
});

test("parseArgs: --api-key beats VULNRADAR_TOKEN, and env is the fallback", () => {
  process.env.VULNRADAR_TOKEN = "env-token";
  assert.equal(parseArgs(["scan", "u"]).apiKey, "env-token");
  assert.equal(
    parseArgs(["scan", "u", "--api-key", "flag-token"]).apiKey,
    "flag-token",
  );
  delete process.env.VULNRADAR_TOKEN;
});

test("parseArgs: --api-base beats VULNRADAR_API_BASE, and env beats the default", () => {
  process.env.VULNRADAR_API_BASE = "https://env.example/api/v3";
  assert.equal(parseArgs(["scan", "u"]).apiBase, "https://env.example/api/v3");
  assert.equal(
    parseArgs(["scan", "u", "--api-base", "https://flag.example/api/v3"])
      .apiBase,
    "https://flag.example/api/v3",
  );
  delete process.env.VULNRADAR_API_BASE;
  assert.equal(parseArgs(["scan", "u"]).apiBase, DEFAULTS.apiBase);
});

test("parseArgs: --crawl raises the default timeout to the crawl budget", () => {
  // The whole point of the crawl default: a crawl runs under a much larger
  // server-side budget, and the CLI used to give up at 300s and report a
  // timeout for a scan that was still running fine.
  assert.equal(parseArgs(["scan", "u"]).timeout, DEFAULTS.timeout);
  assert.equal(parseArgs(["scan", "u", "--crawl"]).timeout, 900);
});

test("parseArgs: an explicit --timeout wins over the crawl default, in either flag order", () => {
  assert.equal(
    parseArgs(["scan", "u", "--crawl", "--timeout", "60"]).timeout,
    60,
  );
  assert.equal(
    parseArgs(["scan", "u", "--timeout", "60", "--crawl"]).timeout,
    60,
  );
});

test("parseArgs: a non-numeric --timeout does not count as explicit", () => {
  // takeNumber rejects it, so the crawl default must still apply rather
  // than the run silently keeping 300 because a flag was "seen".
  const o = parseArgs(["scan", "u", "--crawl", "--timeout", "soon"]);
  assert.match(o.error, /number/);
  assert.equal(o.timeout, 900);
});

test("parseArgs: a non-numeric threshold is an error", () => {
  const o = parseArgs(["scan", "u", "--max-critical", "lots"]);
  assert.match(o.error, /number/);
});

test("parseArgs: unknown flag is an error", () => {
  assert.match(parseArgs(["scan", "u", "--nope"]).error, /Unknown flag/);
});

test("evaluateGate: passes when under thresholds", () => {
  const g = evaluateGate(
    { critical: 0, high: 0, medium: 5 },
    { maxCritical: 0, maxHigh: 0, maxMedium: -1 },
  );
  assert.equal(g.failed, false);
  assert.equal(g.reasons.length, 0);
});

test("evaluateGate: critical/high always gate", () => {
  const g = evaluateGate(
    { critical: 1, high: 2 },
    { maxCritical: 0, maxHigh: 0, maxMedium: -1 },
  );
  assert.equal(g.failed, true);
  assert.equal(g.reasons.length, 2);
});

test("evaluateGate: medium only gates when maxMedium >= 0", () => {
  const disabled = evaluateGate(
    { medium: 9 },
    { maxCritical: 0, maxHigh: 0, maxMedium: -1 },
  );
  assert.equal(disabled.failed, false);

  const enabled = evaluateGate(
    { medium: 9 },
    { maxCritical: 0, maxHigh: 0, maxMedium: 2 },
  );
  assert.equal(enabled.failed, true);
});

test("evaluateGate: reasons name the count and the threshold", () => {
  const { reasons } = evaluateGate(
    { critical: 3 },
    { maxCritical: 1, maxHigh: 0, maxMedium: -1 },
  );
  assert.deepEqual(reasons, ["3 critical finding(s) exceed the max of 1"]);
});

test("cli: exits 0 and prints the summary when findings are under the thresholds", async () => {
  const { code, stdout } = await runCli(
    [
      "scan",
      "https://target.example",
      "--api-key",
      "k",
      "--poll-interval",
      "0",
    ],
    {
      routes: {
        "/scan/status/": {
          body: completed({
            critical: 0,
            high: 0,
            medium: 4,
            low: 1,
            total: 5,
          }),
        },
        "/scan": { body: { scanId: "abc123" } },
      },
    },
  );
  assert.equal(code, 0);
  assert.match(stdout, /Started scan abc123/);
  assert.match(stdout, /critical=0 high=0 medium=4 low=1 total=5/);
});

test("cli: exits EXIT.GATE_FAILED and names every breached threshold", async () => {
  const { code, stderr } = await runCli(
    [
      "scan",
      "https://target.example",
      "--api-key",
      "k",
      "--poll-interval",
      "0",
      "--max-medium",
      "1",
    ],
    {
      routes: {
        "/scan/status/": {
          body: completed({ critical: 2, high: 1, medium: 9 }),
        },
        "/scan": { body: { scanId: "s1" } },
      },
    },
  );
  assert.equal(code, EXIT.GATE_FAILED);
  assert.match(stderr, /2 critical finding\(s\) exceed the max of 0/);
  assert.match(stderr, /1 high finding\(s\) exceed the max of 0/);
  assert.match(stderr, /9 medium finding\(s\) exceed the max of 1/);
});

test("cli: --json prints the raw result and it parses", async () => {
  const { code, stdout } = await runCli(
    [
      "scan",
      "https://target.example",
      "--api-key",
      "k",
      "--poll-interval",
      "0",
      "--json",
    ],
    {
      routes: {
        "/scan/status/": {
          body: completed({ critical: 0, high: 0, total: 0 }),
        },
        "/scan": { body: { scanId: "s2" } },
      },
    },
  );
  assert.equal(code, 0);
  // Parsed WHOLE, not carved out by index. This used to be
  // `stdout.slice(stdout.indexOf("{"), ...)` because the progress and summary
  // lines were printed to stdout around the document, which meant the CLI's
  // only machine-readable mode could not be piped into jq. That workaround
  // living here was the evidence, and it stays gone: --json means stdout is
  // the JSON and nothing else.
  assert.deepEqual(JSON.parse(stdout).summary, {
    critical: 0,
    high: 0,
    total: 0,
  });
});

test("cli: a non-200 from the create call is reported with its status and body", async () => {
  const { code, stderr } = await runCli(
    ["scan", "https://target.example", "--api-key", "bad"],
    {
      routes: { "/scan": { status: 401, body: { error: "Invalid API key" } } },
    },
  );
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /Failed to start scan \(HTTP 401\)/);
  assert.match(stderr, /Invalid API key/);
});

test("cli: a create response with no scanId is an error, not a hang", async () => {
  const { code, stderr } = await runCli(
    ["scan", "https://target.example", "--api-key", "k"],
    { routes: { "/scan": { body: { status: "queued" } } } },
  );
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /No scanId/);
});

test("cli: a failed scan reports the server's reason", async () => {
  const { code, stderr } = await runCli(
    [
      "scan",
      "https://target.example",
      "--api-key",
      "k",
      "--poll-interval",
      "0",
    ],
    {
      routes: {
        "/scan/status/": {
          body: { status: "failed", error: "DNS lookup failed" },
        },
        "/scan": { body: { scanId: "s3" } },
      },
    },
  );
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /Scan failed: DNS lookup failed/);
});

test("cli: no API key exits EXIT.ERROR and points at both ways to supply one", async () => {
  const { code, stderr } = await runCli(["scan", "https://target.example"]);
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /--api-key/);
  assert.match(stderr, /VULNRADAR_TOKEN/);
});

test("cli: VULNRADAR_TOKEN is accepted in place of --api-key", async () => {
  const { code } = await runCli(
    ["scan", "https://target.example", "--poll-interval", "0"],
    {
      env: { VULNRADAR_TOKEN: "env-token" },
      routes: {
        "/scan/status/": { body: completed({ critical: 0, high: 0 }) },
        "/scan": { body: { scanId: "s4" } },
      },
    },
  );
  assert.equal(code, 0);
});

test("cli: no URL exits EXIT.ERROR and prints usage", async () => {
  const { code, stderr } = await runCli(["scan", "--api-key", "k"]);
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /a URL to scan is required/);
  assert.match(stderr, /Usage:/);
});

test("cli: an unknown command is rejected by name", async () => {
  const { code, stderr } = await runCli([
    "scam",
    "https://target.example",
    "--api-key",
    "k",
  ]);
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /Unknown command: scam/);
});

test("cli: --help exits 0 with usage on stdout", async () => {
  const { code, stdout } = await runCli(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage:\n {2}vulnradar scan <url>/);
});

// ── Flag values that used to be taken silently ──────────────────────────
//
// Every one of these produced a confusing failure somewhere downstream
// rather than an error at the point the flag was typed.

test("cli: a flag given as another flag's value is rejected, not swallowed", () => {
  // `--api-key --json` set apiKey to "--json" AND consumed --json, so the
  // request went out as `Authorization: Bearer --json` and came back 401
  // with nothing to connect the two.
  const opts = parseArgs(["scan", "https://x.example", "--api-key", "--json"]);
  assert.match(opts.error ?? "", /--api-key expects a value/);
});

test("cli: a trailing value-flag is rejected rather than reported as missing", () => {
  // This one told the user "no API key. Pass --api-key" immediately after
  // they had passed --api-key.
  const opts = parseArgs(["scan", "https://x.example", "--api-key"]);
  assert.match(opts.error ?? "", /--api-key expects a value/);
});

test("cli: a negative number is still a value, not a flag", () => {
  // --max-medium -1 is the documented way to disable the medium gate, so the
  // "starts with a dash means it is a flag" rule cannot be absolute.
  const opts = parseArgs(["scan", "https://x.example", "--max-medium", "-1"]);
  assert.equal(opts.error, undefined);
  assert.equal(opts.maxMedium, -1);
});

test("cli: --timeout 0 is refused", () => {
  // The wait loop is `while (Date.now() < deadline)`, so a zero timeout never
  // polls once and reports "Timed out after 0s" on a scan the server has
  // already started and will finish.
  for (const v of ["0", "-5"]) {
    const opts = parseArgs(["scan", "https://x.example", "--timeout", v]);
    assert.match(opts.error ?? "", /--timeout must be greater than 0/);
  }
});

test("cli: --poll-interval 0 is allowed, negative is not", () => {
  // Polling fast costs nothing but requests: GET /scan/status deliberately
  // does not charge quota. Negative is meaningless.
  assert.equal(
    parseArgs(["scan", "https://x.example", "--poll-interval", "0"]).error,
    undefined,
  );
  assert.match(
    parseArgs(["scan", "https://x.example", "--poll-interval", "-1"]).error ??
      "",
    /--poll-interval must be at least 0/,
  );
});

test("cli: the FIRST bad flag is the one reported", () => {
  // Errors used to be overwritten, so with two typos only the second was
  // named and fixing it revealed the first on the next run.
  const opts = parseArgs(["scan", "https://x.example", "--typo", "--alsobad"]);
  assert.match(opts.error ?? "", /--typo/);
});

test("cli: an unknown flag with no command reports the flag, not bare usage", async () => {
  const { code, stderr } = await runCli(["--typo"], { routes: {} });
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /Unknown flag: --typo/);
});

/**
 * A server whose behaviour changes per request, which the routes map above
 * cannot express: every transient-failure case needs the second poll to
 * answer differently from the first.
 */
function runCliWithHandler(args, handler, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const childEnv = { ...process.env };
      delete childEnv.VULNRADAR_TOKEN;
      delete childEnv.VULNRADAR_API_BASE;
      execFile(
        process.execPath,
        [CLI, ...args, "--api-base", `http://127.0.0.1:${port}`],
        { env: { ...childEnv, ...env } },
        (err, stdout, stderr) => {
          server.close();
          if (err && typeof err.code !== "number") return reject(err);
          resolve({ code: err ? err.code : 0, stdout, stderr });
        },
      );
    });
  });
}

test("--timeout actually bounds a connection that is accepted and never answered", async () => {
  // Neither request carried an AbortSignal, so --timeout only decided how
  // often the loop re-read the clock. A server that accepts the socket and
  // never writes was never interrupted: the process sat there until the CI
  // runner's own timeout killed the whole job, and --timeout was silently
  // meaningless for the one failure it most needs to cover.
  const started = Date.now();
  const { code, stderr } = await runCliWithHandler(
    ["scan", "https://target.example", "--api-key", "k", "--timeout", "3"],
    () => {
      /* accept, and never respond */
    },
  );
  const elapsed = Date.now() - started;
  assert.equal(code, EXIT.ERROR);
  // Generous, but far below the "forever" this replaces.
  assert.ok(elapsed < 30_000, `took ${elapsed}ms, should give up near 3s`);
  assert.match(stderr, /timed out|Timed out/i);
});

test("one transient poll failure does not fail a scan that then succeeds", async () => {
  // A default scan polls roughly sixty times and a crawl closer to two
  // hundred, so a single 502 from a proxy used to fail the build while the
  // scan completed and landed in the user's history.
  let polls = 0;
  const { code, stdout } = await runCliWithHandler(
    [
      "scan",
      "https://target.example",
      "--api-key",
      "k",
      "--json",
      "--poll-interval",
      "0",
    ],
    (req, res) => {
      if (req.url.startsWith("/scan/status/")) {
        polls += 1;
        if (polls === 1) {
          res.writeHead(502, { "Content-Type": "text/html" });
          res.end("<html>502 Bad Gateway</html>");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "completed",
            result: {
              summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
            },
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ scanId: "abc" }));
    },
  );
  assert.equal(code, 0, "a recovered poll must not fail the run");
  assert.ok(polls >= 2, "the failed poll should have been retried");
  assert.doesNotThrow(() => JSON.parse(stdout));
});

test("a 401 while polling is fatal rather than retried", async () => {
  // The opposite case: a wrong key or somebody else's scan will not fix
  // itself, and retrying it five times just delays the message.
  let polls = 0;
  const { code, stderr } = await runCliWithHandler(
    [
      "scan",
      "https://target.example",
      "--api-key",
      "k",
      "--poll-interval",
      "0",
    ],
    (req, res) => {
      if (req.url.startsWith("/scan/status/")) {
        polls += 1;
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "nope" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ scanId: "abc" }));
    },
  );
  assert.equal(code, EXIT.ERROR);
  assert.equal(polls, 1, "an auth failure must not be retried");
  assert.match(stderr, /Not authorized/i);
});

test("--json writes a parseable document to stdout even when the run fails", async () => {
  // stdout was written on the success path only, so
  // `vulnradar scan $URL --json | jq '.summary.critical'` got empty stdin on
  // every failure. jq exits 0 on empty input, so without pipefail the shell
  // reported the pipeline as passing: the exit code, which is the whole
  // reason the CLI exists in CI, was discarded exactly when it mattered.
  const { code, stdout } = await runCli(
    ["scan", "https://target.example", "--api-key", "k", "--json"],
    { routes: { "/scan": { status: 500, body: { error: "boom" } } } },
  );
  assert.equal(code, EXIT.ERROR);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.error.length > 0);
});

test("an HTML error page is reported as one, not as a JSON parser message", async () => {
  // A captive portal or a WAF challenge is the likeliest real failure, and
  // it used to surface as `Unexpected token '<', "<!doctype "...`, with no
  // status, no URL and nothing to say the server had returned HTML.
  const { code, stderr } = await runCli(
    ["scan", "https://target.example", "--api-key", "k"],
    {
      routes: {
        "/scan": {
          status: 200,
          body: "<!doctype html><title>Checking</title>",
        },
      },
    },
  );
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /not JSON/i);
  assert.match(stderr, /doctype/i);
});

/**
 * The distinction the exit codes exist to make.
 *
 * Both of these used to exit 1, so a pipeline treating any non-zero exit as
 * "block the merge, we found a vulnerability" could not tell that apart from
 * "VulnRadar was briefly unreachable". Asserting them side by side is the
 * point: it is the difference between the two that matters, not either value
 * on its own.
 *
 * Note the route order. runCli matches with `startsWith`, so "/scan" would
 * also swallow "/scan/status/..." if it came first - the poll would be handed
 * the create response forever and the run would sit there until its timeout.
 */
test("a breached gate and a broken tool exit differently", async () => {
  const gate = await runCli(
    [
      "scan",
      "https://target.example",
      "--api-key",
      "k",
      "--poll-interval",
      "0",
    ],
    {
      routes: {
        "/scan/status/": {
          body: completed({ critical: 3, high: 0, total: 3 }),
        },
        "/scan": { body: { scanId: "s1" } },
      },
    },
  );

  const broken = await runCli(
    ["scan", "https://target.example", "--api-key", "k"],
    { routes: { "/scan": { status: 503, body: { error: "upstream down" } } } },
  );

  assert.equal(gate.code, EXIT.GATE_FAILED);
  assert.equal(broken.code, EXIT.ERROR);
  assert.notEqual(gate.code, broken.code);
});

test("--json writes a parseable document on an argument error, not only a scan error", async () => {
  // fail() was reached only from the scan paths, so an argument error wrote
  // nothing to stdout at all. `... --json | jq -e .ok` then got empty stdin,
  // and jq exits 0 on empty input, so the failed pipeline reported as a pass.
  const { code, stdout } = await runCli(["scan", "--json"], { routes: {} });

  assert.equal(code, EXIT.ERROR);
  const doc = JSON.parse(stdout.trim());
  assert.equal(doc.ok, false);
  assert.match(doc.error, /URL/i);
});

test("--help succeeds and writes usage to stdout", async () => {
  const { code, stdout } = await runCli(["--help"], { routes: {} });
  assert.equal(code, EXIT.OK);
  assert.match(stdout, /Usage:/);
});

test("parseArgs: --scanners, --public/--private and repeated --team-id", () => {
  const o = parseArgs([
    "scan",
    "u",
    "--scanners",
    "headers, ssl,,content",
    "--private",
    "--team-id",
    "7",
    "--team-id",
    "9",
    "--team-id",
    "7",
  ]);
  assert.equal(o.error, undefined);
  assert.deepEqual(o.scanners, ["headers", "ssl", "content"]);
  assert.equal(o.isPublic, false);
  assert.deepEqual(o.teamIds, [7, 9]);
});

test("parseArgs: --public with --private is an error, and team ids must be positive integers", () => {
  assert.match(
    parseArgs(["scan", "u", "--public", "--private"]).error,
    /cannot be used together/,
  );
  assert.match(
    parseArgs(["scan", "u", "--team-id", "1.5"]).error,
    /positive integer/,
  );
  assert.match(
    parseArgs(["scan", "u", "--scanners", ","]).error,
    /comma-separated/,
  );
  // Nothing leaks between calls through the shared DEFAULTS array.
  parseArgs(["scan", "u", "--team-id", "3"]);
  assert.deepEqual(parseArgs(["scan", "u"]).teamIds, []);
});

test("buildScanBody sends only what the caller set", () => {
  assert.deepEqual(buildScanBody(parseArgs(["scan", "https://x.com"])), {
    url: "https://x.com",
  });
  assert.deepEqual(
    buildScanBody(
      parseArgs([
        "scan",
        "https://x.com",
        "--scanners",
        "headers",
        "--public",
        "--team-id",
        "4",
      ]),
    ),
    {
      url: "https://x.com",
      scanners: ["headers"],
      isPublic: true,
      teamIds: [4],
    },
  );
});

test("retryAfterSeconds reads seconds and HTTP dates", () => {
  assert.equal(retryAfterSeconds("12"), 12);
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(retryAfterSeconds("Thu, 01 Jan 2026 00:00:30 GMT", now), 30);
  assert.equal(retryAfterSeconds("soon"), null);
  assert.equal(retryAfterSeconds(null), null);
});

test("the CLI sends the chosen options and identifies itself", async () => {
  const { code, requests } = await runCli(
    [
      "scan",
      "https://x.com",
      "--api-key",
      "k",
      "--scanners",
      "headers,ssl",
      "--private",
      "--team-id",
      "12",
      "--poll-interval",
      "0",
    ],
    {
      routes: {
        "/scan/status/": { body: completed({ critical: 0, high: 0 }) },
        "/scan": { body: { scanId: "s1" } },
      },
    },
  );
  assert.equal(code, EXIT.OK);
  const create = requests.find((r) => r.method === "POST");
  assert.deepEqual(create.body, {
    url: "https://x.com",
    scanners: ["headers", "ssl"],
    isPublic: false,
    teamIds: [12],
  });
  assert.match(create.headers["user-agent"], /^vulnradar-cli\/\d+\.\d+\.\d+$/);
});

test("the CLI waits out a 429 and then starts the scan", async () => {
  const { code, requests } = await runCli(
    ["scan", "https://x.com", "--api-key", "k", "--poll-interval", "0"],
    {
      routes: {
        "/scan/status/": { body: completed({ critical: 0, high: 0 }) },
        "/scan": [
          {
            status: 429,
            body: { error: "slow down" },
            headers: { "Retry-After": "0" },
          },
          { body: { scanId: "s2" } },
        ],
      },
    },
  );
  assert.equal(code, EXIT.OK);
  assert.equal(requests.filter((r) => r.method === "POST").length, 2);
});

test("--version prints the package version", async () => {
  const { code, stdout } = await runCli(["--version"]);
  assert.equal(code, EXIT.OK);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});

// --report: the CLI can pull the report formats the API has served since v3
// (SARIF for GitHub Code Scanning, Markdown, CSV, the compliance crosswalk,
// PDF). Until it could, a pipeline that wanted any of them had to curl the
// API itself with a second copy of the token.

test("parseArgs: --report and --out are read, and the triage flags are opt-in", () => {
  const o = parseArgs([
    "scan",
    "https://x.com",
    "--report",
    "SARIF",
    "--out",
    "report.sarif",
    "--apply-triage",
  ]);
  assert.equal(o.error, undefined);
  assert.equal(o.report, "sarif");
  assert.equal(o.out, "report.sarif");
  assert.equal(o.applyTriage, true);
  assert.equal(o.includeSuppressed, false);
});

test("parseArgs: an unknown --report format names the ones that exist", () => {
  const o = parseArgs(["scan", "https://x.com", "--report", "xlsx"]);
  assert.match(o.error, /sarif/);
  assert.match(o.error, /xlsx/);
});

test("parseArgs: a report flag without --report is refused, not ignored", () => {
  const triage = parseArgs(["scan", "https://x.com", "--apply-triage"]);
  assert.match(triage.error, /needs --report/);
  const withOut = parseArgs(["scan", "https://x.com", "--out", "f.json"]);
  assert.match(withOut.error, /needs --report/);
});

test("parseArgs: --include-suppressed stands alone, because it decides what the gate counts", () => {
  const o = parseArgs(["scan", "https://x.com", "--include-suppressed"]);
  assert.equal(o.error, undefined);
  assert.equal(o.includeSuppressed, true);
});

test("parseArgs: pdf and --json both require --out", () => {
  const pdf = parseArgs(["scan", "https://x.com", "--report", "pdf"]);
  assert.match(pdf.error, /needs --out/);
  assert.equal(
    parseArgs(["scan", "https://x.com", "--report", "pdf", "--out", "r.pdf"])
      .error,
    undefined,
  );

  const json = parseArgs(["scan", "https://x.com", "--report", "md", "--json"]);
  assert.match(json.error, /needs --out/);
  assert.equal(
    parseArgs([
      "scan",
      "https://x.com",
      "--report",
      "md",
      "--json",
      "--out",
      "r.md",
    ]).error,
    undefined,
  );
});

test("reportRequestUrl: sends only the triage flags that were asked for", () => {
  const plain = reportRequestUrl("https://api.example/api/v3", 7, {
    report: "sarif",
  });
  assert.equal(
    plain,
    "https://api.example/api/v3/history/7/report?format=sarif",
  );

  const triaged = reportRequestUrl("https://api.example/api/v3", 7, {
    report: "sarif",
    applyTriage: true,
    includeSuppressed: true,
  });
  assert.match(triaged, /applyTriage=true/);
  assert.match(triaged, /includeSuppressed=true/);
});

test("pdf is the only binary report format", () => {
  const binary = Object.entries(REPORT_FORMATS)
    .filter(([, meta]) => meta.binary)
    .map(([name]) => name);
  assert.deepEqual(binary, ["pdf"]);
});

test("cli: --report without --out prints the report to stdout", async () => {
  const { code, stdout, requests } = await runCli(
    [
      "scan",
      "https://target.example",
      "--api-key",
      "k",
      "--poll-interval",
      "0",
      "--report",
      "sarif",
      "--apply-triage",
    ],
    {
      routes: {
        "/scan/status/": { body: completed({ critical: 0, high: 0 }) },
        "/scan": { body: { scanId: "abc123" } },
        "/history/": { body: '{"runs":[]}' },
      },
    },
  );
  assert.equal(code, EXIT.OK);
  // The report and nothing else, with a trailing newline: progress lines went
  // into the same stream and made `> results.sarif` invalid.
  assert.equal(stdout, '{"runs":[]}\n');
  const report = requests.find((r) => r.url.startsWith("/history/"));
  assert.equal(
    report.url,
    "/history/abc123/report?format=sarif&applyTriage=true",
  );
  assert.equal(report.headers.authorization, "Bearer k");
});

test("cli: a failing gate still writes the --out file before it exits 1", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vulnradar-cli-"));
  const out = path.join(dir, "report.md");
  try {
    const { code, stdout } = await runCli(
      [
        "scan",
        "https://target.example",
        "--api-key",
        "k",
        "--poll-interval",
        "0",
        "--report",
        "md",
        "--out",
        out,
      ],
      {
        routes: {
          "/scan/status/": {
            body: completed({ critical: 2, high: 0, total: 2 }),
          },
          "/scan": { body: { scanId: "abc123" } },
          "/history/": { body: "# Scan report" },
        },
      },
    );
    assert.equal(code, EXIT.GATE_FAILED);
    assert.equal(readFileSync(out, "utf8"), "# Scan report");
    assert.match(stdout, /Wrote the md report/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli: a report the API refuses is an error, not a silent pass", async () => {
  const { code, stderr } = await runCli(
    [
      "scan",
      "https://target.example",
      "--api-key",
      "k",
      "--poll-interval",
      "0",
      "--report",
      "pdf",
      "--out",
      path.join(tmpdir(), "vulnradar-should-not-exist.pdf"),
    ],
    {
      routes: {
        "/scan/status/": { body: completed({ critical: 0, high: 0 }) },
        "/scan": { body: { scanId: "abc123" } },
        "/history/": {
          status: 403,
          body: { error: "PDF reports are disabled." },
        },
      },
    },
  );
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /HTTP 403/);
  assert.match(stderr, /PDF reports are disabled/);
});

// ── Shared fixtures for the gate-correctness tests below ────────────────

const CLEAN = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
const SCAN_ARGS = [
  "scan",
  "https://target.example",
  "--api-key",
  "k",
  "--poll-interval",
  "0",
];

/** A completed status body whose result carries `extra` beside its summary. */
const completedWith = (extra, summary = CLEAN) => ({
  status: "completed",
  result: { summary, ...extra },
});

/** Routes for a scan that starts and then reports `statusBody`, in the order runCli matches them. */
const routesFor = (statusBody, extra = {}) => ({
  "/scan/status/": { body: statusBody },
  "/scan": { body: { scanId: "s1" } },
  ...extra,
});

const finding = (severity, suppressed = false) => ({
  id: `${severity}-${suppressed ? "fp" : "open"}`,
  severity,
  ...(suppressed ? { suppressed: true } : {}),
});

const JSON_HEADERS = { "Content-Type": "application/json" };

// ── Incomplete scans: a pass that never looked at the page is not a pass ─

test("incompleteOutcome: only a bot challenge or an unreachable page blocks by default", () => {
  assert.deepEqual(BLOCKING_INCOMPLETE, ["bot-challenge", "page-unreachable"]);
  assert.equal(
    incompleteOutcome({ incomplete: ["bot-challenge"] }).blocking,
    true,
  );
  assert.equal(
    incompleteOutcome({ incomplete: ["dns", "page-unreachable"] }).blocking,
    true,
  );
  const benign = incompleteOutcome({ incomplete: ["dns", "crawl-time-limit"] });
  assert.equal(benign.blocking, false);
  assert.equal(benign.areas.length, 2);
  assert.equal(incompleteOutcome({}).blocking, false);
  assert.equal(incompleteOutcome({ incomplete: "dns" }).areas.length, 0);
});

test("incompleteOutcome: --fail-on-incomplete widens it, --allow-incomplete opts out", () => {
  assert.equal(
    incompleteOutcome({ incomplete: ["dns"] }, { failOnIncomplete: true })
      .blocking,
    true,
  );
  assert.equal(
    incompleteOutcome(
      { incomplete: ["bot-challenge"] },
      { allowIncomplete: true },
    ).blocking,
    false,
  );
});

test("incompleteOutcome: an unknown slug is shown as itself, a known one in words", () => {
  const { areas } = incompleteOutcome({
    incomplete: ["dns", "brand-new-area", "dns"],
  });
  assert.deepEqual(areas, [
    { slug: "dns", label: INCOMPLETE_LABELS.dns },
    { slug: "brand-new-area", label: "brand-new-area" },
  ]);
});

test("describeNotChecked: lists the areas, the page message and the redirect host", () => {
  assert.deepEqual(describeNotChecked(incompleteOutcome({})), []);
  const lines = describeNotChecked(
    incompleteOutcome({
      incomplete: ["page-unreachable"],
      pageUnreachable: {
        code: "cross_host_redirect",
        message: "The site redirects elsewhere.",
        redirectHost: "app.example.com",
      },
    }),
  );
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Not checked: The page itself/);
  assert.equal(lines[1], "Page unreachable: The site redirects elsewhere.");
  assert.match(lines[2], /app\.example\.com$/);
});

test("cli: a scan that could not fetch the page exits EXIT.INCOMPLETE and says what was skipped", async () => {
  const { code, stderr } = await runCli(SCAN_ARGS, {
    routes: routesFor(
      completedWith({
        incomplete: ["page-unreachable", "dns"],
        pageUnreachable: {
          code: "cross_host_redirect",
          message: "The site redirects to another host.",
          redirectHost: "app.example.com",
        },
      }),
    ),
  });
  assert.equal(code, EXIT.INCOMPLETE);
  assert.equal(EXIT.INCOMPLETE, 3);
  assert.match(stderr, /Not checked: The page itself/);
  assert.match(stderr, /DNS records/);
  assert.match(
    stderr,
    /Page unreachable: The site redirects to another host\./,
  );
  assert.match(stderr, /^It redirects to another host: app\.example\.com$/m);
  assert.match(stderr, /--allow-incomplete/);
});

test("cli: a bot challenge exits EXIT.INCOMPLETE, not 0 with zero findings", async () => {
  const { code, stderr } = await runCli(SCAN_ARGS, {
    routes: routesFor(completedWith({ incomplete: ["bot-challenge"] })),
  });
  assert.equal(code, EXIT.INCOMPLETE);
  assert.match(stderr, /bot challenge/);
});

test("cli: --allow-incomplete passes the scan but still says what was not checked", async () => {
  const { code, stderr } = await runCli([...SCAN_ARGS, "--allow-incomplete"], {
    routes: routesFor(completedWith({ incomplete: ["bot-challenge"] })),
  });
  assert.equal(code, EXIT.OK);
  assert.match(stderr, /Not checked: The page, its headers and its files/);
});

test("cli: an area that is not a blocking one is reported and passes, until --fail-on-incomplete", async () => {
  const routes = routesFor(completedWith({ incomplete: ["dns"] }));
  const plain = await runCli(SCAN_ARGS, { routes });
  assert.equal(plain.code, EXIT.OK);
  assert.match(plain.stderr, /Not checked: DNS records/);

  const strict = await runCli([...SCAN_ARGS, "--fail-on-incomplete"], {
    routes,
  });
  assert.equal(strict.code, EXIT.INCOMPLETE);
});

test("cli: a failed gate wins over an incomplete scan", async () => {
  const { code, stderr } = await runCli(SCAN_ARGS, {
    routes: routesFor(
      completedWith(
        { incomplete: ["bot-challenge"] },
        { ...CLEAN, critical: 1, total: 1 },
      ),
    ),
  });
  assert.equal(code, EXIT.GATE_FAILED);
  assert.match(stderr, /1 critical finding\(s\) exceed the max of 0/);
  assert.match(stderr, /Not checked:/);
});

test("cli: --json keeps stdout one document when the scan was incomplete", async () => {
  const { code, stdout, stderr } = await runCli([...SCAN_ARGS, "--json"], {
    routes: routesFor(completedWith({ incomplete: ["page-unreachable"] })),
  });
  assert.equal(code, EXIT.INCOMPLETE);
  assert.deepEqual(JSON.parse(stdout).incomplete, ["page-unreachable"]);
  assert.match(stderr, /Not checked:/);
});

test("parseArgs: --allow-incomplete and --fail-on-incomplete contradict each other", () => {
  assert.match(
    parseArgs(["scan", "u", "--allow-incomplete", "--fail-on-incomplete"])
      .error,
    /cannot be used together/,
  );
  const o = parseArgs(["scan", "u", "--fail-on-incomplete"]);
  assert.equal(o.failOnIncomplete, true);
  assert.equal(o.allowIncomplete, false);
});

// ── Suppressed findings: the gate and the report must agree ─────────────

test("gateCounts: findings marked a false positive are not counted, unless asked", () => {
  const result = {
    summary: { critical: 2, high: 1, total: 3 },
    findings: [
      finding("critical"),
      finding("critical", true),
      finding("high", true),
      finding("low"),
      { severity: "info" },
      null,
    ],
  };
  assert.deepEqual(gateCounts(result), {
    critical: 1,
    high: 0,
    medium: 0,
    low: 1,
    total: 3,
    suppressed: 2,
  });
  assert.deepEqual(gateCounts(result, { includeSuppressed: true }), {
    critical: 2,
    high: 1,
    medium: 0,
    low: 1,
    total: 5,
    suppressed: 0,
  });
});

test("gateCounts: an entry that is not an object is not a finding, as in the jq filters", () => {
  const counts = gateCounts({
    summary: {},
    findings: [finding("high"), [finding("critical")], "x", 3, null],
  });
  assert.equal(counts.high, 1);
  assert.equal(counts.critical, 0);
  assert.equal(counts.total, 1);
  assert.equal(counts.suppressed, 0);
});

test("gateCounts: with no findings array it falls back to the summary", () => {
  assert.deepEqual(gateCounts({ summary: { critical: 2, medium: 4 } }), {
    critical: 2,
    high: 0,
    medium: 4,
    low: 0,
    total: 0,
    suppressed: 0,
  });
});

test("hasSummary: only an object counts", () => {
  assert.equal(hasSummary({ summary: {} }), true);
  for (const bad of [
    null,
    undefined,
    {},
    { summary: null },
    { summary: [] },
    { summary: "1" },
    "x",
  ]) {
    assert.equal(hasSummary(bad), false, JSON.stringify(bad));
  }
});

test("cli: a finding the owner marked a false positive does not fail the gate", async () => {
  const body = completedWith(
    { findings: [finding("critical", true), finding("low")] },
    { ...CLEAN, critical: 1, low: 1, total: 2 },
  );
  const { code, stdout } = await runCli(SCAN_ARGS, {
    routes: routesFor(body),
  });
  assert.equal(code, EXIT.OK);
  assert.match(stdout, /critical=0 high=0 medium=0 low=1 total=1/);
  assert.match(stdout, /1 suppressed by false-positive verdicts/);
});

test("cli: --include-suppressed counts them again", async () => {
  const body = completedWith(
    { findings: [finding("critical", true)] },
    { ...CLEAN, critical: 1, total: 1 },
  );
  const { code, stderr } = await runCli(
    [...SCAN_ARGS, "--include-suppressed"],
    { routes: routesFor(body) },
  );
  assert.equal(code, EXIT.GATE_FAILED);
  assert.match(stderr, /1 critical finding\(s\) exceed the max of 0/);
});

test("cli: a completed result with no summary object is an error, not zero findings", async () => {
  const { code, stdout, stderr } = await runCli([...SCAN_ARGS, "--json"], {
    routes: routesFor({ status: "completed", result: { findings: [] } }),
  });
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /no summary object/);
  const doc = JSON.parse(stdout);
  assert.equal(doc.ok, false);
  assert.equal(doc.scanId, "s1");
});

test("cli: a completed status with no result is reported as that, not as a timeout", async () => {
  const { code, stderr } = await runCli(SCAN_ARGS, {
    routes: routesFor({ status: "completed" }),
  });
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /no summary object/);
  assert.doesNotMatch(stderr, /Timed out/);
});

// ── Output hygiene ──────────────────────────────────────────────────────

test("cli: --report json to stdout is a document that parses", async () => {
  const { code, stdout, stderr } = await runCli(
    [...SCAN_ARGS, "--report", "json"],
    {
      routes: routesFor(completedWith({}), {
        "/history/": { body: '{"scan":{"id":1}}' },
      }),
    },
  );
  assert.equal(code, EXIT.OK);
  assert.deepEqual(JSON.parse(stdout), { scan: { id: 1 } });
  assert.match(stderr, /Started scan s1/);
  assert.match(stderr, /Scan complete:/);
});

test("cli: a report that already ends in a newline does not get a second one", async () => {
  const { stdout } = await runCli([...SCAN_ARGS, "--report", "md"], {
    routes: routesFor(completedWith({}), {
      "/history/": { body: "# Scan report\n" },
    }),
  });
  assert.equal(stdout, "# Scan report\n");
});

// ── The report step never overrides the gate ────────────────────────────

const FAILING_GATE = completedWith({}, { ...CLEAN, critical: 2, total: 2 });

test("cli: a report the API refuses does not turn a failed gate into exit 2", async () => {
  for (const status of [403, 429, 500]) {
    const { code, stderr } = await runCli(
      [
        ...SCAN_ARGS,
        "--report",
        "sarif",
        "--out",
        path.join(tmpdir(), "x.sarif"),
      ],
      {
        routes: routesFor(FAILING_GATE, {
          "/history/": { status, body: { error: "nope" } },
        }),
      },
    );
    assert.equal(code, EXIT.GATE_FAILED, `report HTTP ${status}`);
    assert.match(
      stderr,
      new RegExp(`Could not download the sarif report \\(HTTP ${status}\\)`),
    );
    assert.match(stderr, /2 critical finding\(s\)/);
  }
});

test("cli: a report body that is cut off is recorded, and the gate still decides", async () => {
  const truncated = (req, res) => {
    if (req.url.startsWith("/history/")) {
      res.writeHead(200, { "Content-Length": "500" });
      res.write("# partial");
      setTimeout(() => res.destroy(), 20);
      return;
    }
    res.writeHead(200, JSON_HEADERS);
    res.end(
      req.url.startsWith("/scan/status/")
        ? JSON.stringify(FAILING_GATE)
        : JSON.stringify({ scanId: "s1" }),
    );
  };
  const { code, stderr } = await runCliWithHandler(
    [...SCAN_ARGS, "--report", "md"],
    truncated,
  );
  assert.equal(code, EXIT.GATE_FAILED);
  assert.match(stderr, /Could not download the md report/);
});

test("cli: --json plus a failed report is still one document on stdout", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vulnradar-cli-"));
  try {
    const { code, stdout, stderr } = await runCli(
      [
        ...SCAN_ARGS,
        "--json",
        "--report",
        "md",
        "--out",
        path.join(dir, "r.md"),
      ],
      {
        routes: routesFor(completedWith({}), {
          "/history/": { status: 500, body: { error: "boom" } },
        }),
      },
    );
    assert.equal(code, EXIT.ERROR);
    const doc = JSON.parse(stdout);
    assert.equal(doc.ok, undefined, "the raw result, not a failure document");
    assert.deepEqual(doc.summary, CLEAN);
    assert.match(stderr, /Could not download the md report \(HTTP 500\)/);
    assert.equal(existsSync(path.join(dir, "r.md")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli: a report that cannot be written fails the run, but not a failed gate", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vulnradar-cli-"));
  try {
    // The path is a directory: its folder exists, so the run starts, and the
    // write fails only once there is a report to put there.
    const routes = (body) =>
      routesFor(body, { "/history/": { body: "# report" } });
    const clean = await runCli([...SCAN_ARGS, "--report", "md", "--out", dir], {
      routes: routes(completedWith({})),
    });
    assert.equal(clean.code, EXIT.ERROR);
    assert.match(clean.stderr, /Could not write/);

    const failing = await runCli(
      [...SCAN_ARGS, "--report", "md", "--out", dir],
      { routes: routes(FAILING_GATE) },
    );
    assert.equal(failing.code, EXIT.GATE_FAILED);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli: an incomplete scan outranks a report failure", async () => {
  const { code } = await runCli(
    [
      ...SCAN_ARGS,
      "--report",
      "sarif",
      "--out",
      path.join(tmpdir(), "y.sarif"),
    ],
    {
      routes: routesFor(completedWith({ incomplete: ["bot-challenge"] }), {
        "/history/": { status: 500, body: {} },
      }),
    },
  );
  assert.equal(code, EXIT.INCOMPLETE);
});

test("cli: an unexpected error in --json mode is still a failure document", async () => {
  // The create response is cut off mid-body, so reading it throws outside any
  // try block and lands in the last-resort handler.
  const { code, stdout, stderr } = await runCliWithHandler(
    ["scan", "https://target.example", "--api-key", "k", "--json"],
    (req, res) => {
      res.writeHead(200, { ...JSON_HEADERS, "Content-Length": "200" });
      res.write('{"scanId":');
      setTimeout(() => res.destroy(), 20);
    },
  );
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /Unexpected error/);
  const doc = JSON.parse(stdout);
  assert.equal(doc.ok, false);
  assert.match(doc.error, /Unexpected error/);
});

// ── failureKind and the --json failure document ─────────────────────────

test("cli: a failed scan names its kind in the message and the --json document", async () => {
  const body = {
    status: "failed",
    error: "Could not reach the target.",
    failureKind: "target_unreachable",
  };
  const human = await runCli(SCAN_ARGS, { routes: routesFor(body) });
  assert.equal(human.code, EXIT.ERROR);
  assert.match(
    human.stderr,
    /Scan failed: Could not reach the target\. \[target_unreachable\]/,
  );

  const machine = await runCli([...SCAN_ARGS, "--json"], {
    routes: routesFor(body),
  });
  const doc = JSON.parse(machine.stdout);
  assert.equal(doc.ok, false);
  assert.equal(doc.failureKind, "target_unreachable");
  assert.equal(doc.scanId, "s1");
});

test("cli: a failed scan from a server that sends no kind prints none", async () => {
  const { stderr, stdout } = await runCli([...SCAN_ARGS, "--json"], {
    routes: routesFor({ status: "failed", error: "DNS lookup failed" }),
  });
  assert.match(stderr, /Scan failed: DNS lookup failed\n/);
  assert.equal("failureKind" in JSON.parse(stdout), false);
});

test("cli: the API's statusCode on a refused start reaches the --json document", async () => {
  const { code, stdout } = await runCli(
    ["scan", "https://t.example", "--api-key", "k", "--json"],
    {
      routes: {
        "/scan": {
          status: 403,
          body: {
            error: "Verify this domain first.",
            statusCode: "DOMAIN_NOT_VERIFIED",
          },
        },
      },
    },
  );
  assert.equal(code, EXIT.ERROR);
  const doc = JSON.parse(stdout);
  assert.equal(doc.status, 403);
  assert.equal(doc.statusCode, "DOMAIN_NOT_VERIFIED");
});

// ── 429: wait for a slot, never for a spent quota ───────────────────────

test("classifyRateLimit: tells a busy slot, a spent quota and a short limit apart", () => {
  const headers = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null });
  assert.equal(
    classifyRateLimit(headers({}), { statusCode: "CONCURRENT_SCAN_LIMIT" }),
    "concurrent",
  );
  assert.equal(
    classifyRateLimit(headers({ "x-ratelimit-policy": "daily" }), {}),
    "daily",
  );
  assert.equal(
    classifyRateLimit(headers({}), { resets_at: "2026-01-02T00:00:00Z" }),
    "daily",
  );
  assert.equal(classifyRateLimit(headers({}), { error: "slow down" }), "other");
  assert.equal(classifyRateLimit(headers({}), null), "other");
});

test("createRetryPlan: waiting for a slot steps 5, 10, 20 and stops inside its cap", () => {
  assert.deepEqual(SLOT_BACKOFF_SECONDS, [5, 10, 20]);
  const waits = [];
  let waited = 0;
  for (let n = 0; ; n++) {
    const plan = createRetryPlan({
      kind: "concurrent",
      retryAfter: null,
      concurrentRetries: n,
      otherRetries: 0,
      slotWaitedSeconds: waited,
      secondsLeft: 1,
    });
    if (!plan.retry) {
      assert.match(plan.note, /no free scan slot/);
      break;
    }
    assert.equal(plan.extendsBudget, true);
    waits.push(plan.wait);
    waited += plan.wait;
  }
  assert.deepEqual(waits.slice(0, 4), [5, 10, 20, 20]);
  assert.ok(waited <= SLOT_WAIT_CAP_SECONDS, `${waited}s waited`);
});

test("createRetryPlan: a Retry-After is honoured for a slot, floored at a second, and capped", () => {
  const base = {
    kind: "concurrent",
    concurrentRetries: 0,
    otherRetries: 0,
    slotWaitedSeconds: 0,
    secondsLeft: 1,
  };
  assert.equal(createRetryPlan({ ...base, retryAfter: 15 }).wait, 15);
  assert.equal(createRetryPlan({ ...base, retryAfter: 0 }).wait, 1);
  assert.equal(createRetryPlan({ ...base, retryAfter: 600 }).retry, false);
});

test("createRetryPlan: a spent daily quota is never retried, whatever Retry-After says", () => {
  const plan = createRetryPlan({
    kind: "daily",
    retryAfter: 0,
    concurrentRetries: 0,
    otherRetries: 0,
    slotWaitedSeconds: 0,
    secondsLeft: 1000,
  });
  assert.equal(plan.retry, false);
  assert.match(plan.note, /daily scan quota/);
});

test("createRetryPlan: any other 429 needs a Retry-After that fits, at most three times", () => {
  const base = {
    kind: "other",
    concurrentRetries: 0,
    otherRetries: 0,
    slotWaitedSeconds: 0,
    secondsLeft: 100,
  };
  assert.equal(createRetryPlan({ ...base, retryAfter: 10 }).retry, true);
  assert.equal(createRetryPlan({ ...base, retryAfter: null }).retry, false);
  assert.equal(createRetryPlan({ ...base, retryAfter: 100 }).retry, false);
  assert.equal(
    createRetryPlan({ ...base, retryAfter: 1, otherRetries: 3 }).retry,
    false,
  );
});

test("cli: a busy slot is waited out even without a Retry-After, and the wait is not spent from --timeout", async () => {
  // --timeout 3 is shorter than the first backoff step (5s). If the wait came
  // out of that budget the scan would be reported as a timeout before it
  // started.
  const started = Date.now();
  const { code, requests } = await runCli([...SCAN_ARGS, "--timeout", "3"], {
    routes: routesFor(completedWith({}), {
      "/scan": [
        {
          status: 429,
          body: {
            error: "You already have 1 scan running.",
            statusCode: "CONCURRENT_SCAN_LIMIT",
          },
        },
        { body: { scanId: "s2" } },
      ],
    }),
  });
  assert.equal(code, EXIT.OK);
  assert.equal(requests.filter((r) => r.method === "POST").length, 2);
  assert.ok(
    Date.now() - started >= 4500,
    "it waited for the first backoff step",
  );
});

test("cli: a busy slot honours the Retry-After the server sends", async () => {
  const { code, stdout } = await runCli(SCAN_ARGS, {
    routes: routesFor(completedWith({}), {
      "/scan": [
        {
          status: 429,
          body: { error: "busy", statusCode: "CONCURRENT_SCAN_LIMIT" },
          headers: { "Retry-After": "1" },
        },
        { body: { scanId: "s2" } },
      ],
    }),
  });
  assert.equal(code, EXIT.OK);
  assert.match(
    stdout,
    /Another scan is already running on this account; retrying in 1s/,
  );
});

test("cli: a spent daily quota is reported and not retried", async () => {
  const { code, stderr, requests } = await runCli(SCAN_ARGS, {
    routes: {
      "/scan": {
        status: 429,
        body: {
          error: "Rate limit exceeded.",
          resets_at: "2026-01-02T00:00:00Z",
        },
        headers: { "X-RateLimit-Policy": "daily", "Retry-After": "0" },
      },
    },
  });
  assert.equal(code, EXIT.ERROR);
  assert.equal(requests.length, 1, "no second attempt");
  assert.match(stderr, /Failed to start scan \(HTTP 429\)/);
  assert.match(stderr, /daily scan quota is spent/);
});

test("cli: a 429 with no Retry-After and no busy-slot code is not retried", async () => {
  const { code, requests } = await runCli(SCAN_ARGS, {
    routes: { "/scan": { status: 429, body: { error: "slow down" } } },
  });
  assert.equal(code, EXIT.ERROR);
  assert.equal(requests.length, 1);
});

// ── Arguments ───────────────────────────────────────────────────────────

test("parseArgs: --max-critical and --max-high reject a negative, --max-medium keeps -1", () => {
  for (const flag of ["--max-critical", "--max-high"]) {
    assert.match(
      parseArgs(["scan", "u", flag, "-1"]).error,
      new RegExp(`${flag} must be at least 0, got -1`),
    );
    assert.equal(parseArgs(["scan", "u", flag, "0"]).error, undefined);
  }
  const medium = parseArgs(["scan", "u", "--max-medium", "-1"]);
  assert.equal(medium.error, undefined);
  assert.equal(medium.maxMedium, -1);
});

test("insecureApiBase: plain http is only fine to this machine", () => {
  assert.equal(insecureApiBase("https://vulnradar.dev/api/v3"), null);
  for (const loopback of [
    "http://localhost:3000/api/v3",
    "http://127.0.0.1:3000/api/v3",
    "http://127.1.2.3/api/v3",
    "http://[::1]:3000/api/v3",
    "http://app.localhost/api/v3",
  ]) {
    assert.equal(insecureApiBase(loopback), null, loopback);
  }
  assert.equal(
    insecureApiBase("http://scan.internal:8080/api/v3"),
    "scan.internal:8080",
  );
  assert.equal(insecureApiBase("not a url"), null);
});

test("parseArgs: a plain http API base is refused unless it is loopback or --allow-insecure", () => {
  const refused = parseArgs([
    "scan",
    "u",
    "--api-base",
    "http://scan.internal/api/v3",
  ]);
  assert.match(refused.error, /plain http:\/\/ to scan\.internal/);
  assert.match(refused.error, /--allow-insecure/);

  assert.equal(
    parseArgs([
      "scan",
      "u",
      "--api-base",
      "http://scan.internal/api/v3",
      "--allow-insecure",
    ]).error,
    undefined,
  );
  assert.equal(
    parseArgs(["scan", "u", "--api-base", "http://localhost:3000/api/v3"])
      .error,
    undefined,
  );
  // Help and version send nothing, so a bad base must not block them.
  assert.equal(
    parseArgs(["--help", "--api-base", "http://scan.internal/api/v3"]).error,
    undefined,
  );
});

test("cli: a plain http API base to another host exits before sending the key anywhere", async () => {
  const result = await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        CLI,
        "scan",
        "https://x.example",
        "--api-key",
        "k",
        "--api-base",
        "http://scan.internal/api/v3",
      ],
      (err, stdout, stderr) => {
        if (err && typeof err.code !== "number") return reject(err);
        resolve({ code: err ? err.code : 0, stderr });
      },
    );
  });
  assert.equal(result.code, EXIT.ERROR);
  assert.match(result.stderr, /plain http:\/\//);
});

test("cli: a negative threshold is refused before any request is made", async () => {
  const { code, stderr, requests } = await runCli(
    [...SCAN_ARGS, "--max-high", "-1"],
    { routes: routesFor(completedWith({})) },
  );
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /--max-high must be at least 0/);
  assert.equal(requests.length, 0);
});

test("cli: --out creates its folder before the scan, and writes the report into it", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vulnradar-cli-"));
  const out = path.join(dir, "nested", "missing", "report.md");
  try {
    const { code } = await runCli(
      [...SCAN_ARGS, "--report", "md", "--out", out],
      {
        routes: routesFor(completedWith({}), {
          "/history/": { body: "# Scan report" },
        }),
      },
    );
    assert.equal(code, EXIT.OK);
    assert.equal(readFileSync(out, "utf8"), "# Scan report");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli: an --out folder that cannot be created is refused before the scan is started", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vulnradar-cli-"));
  try {
    const blocker = path.join(dir, "blocker");
    writeFileSync(blocker, "a file where a folder is needed");
    const { code, stderr, requests } = await runCli(
      [
        ...SCAN_ARGS,
        "--report",
        "md",
        "--out",
        path.join(blocker, "sub", "r.md"),
      ],
      { routes: routesFor(completedWith({})) },
    );
    assert.equal(code, EXIT.ERROR);
    assert.match(stderr, /Could not create the folder/);
    assert.equal(requests.length, 0, "no scan was started and charged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Polling ─────────────────────────────────────────────────────────────

test("describeProgress: names the category and the count, and nothing when there is none", () => {
  assert.equal(
    describeProgress({
      currentCategory: "headers",
      categoriesCompleted: 1,
      categoriesTotal: 5,
    }),
    "Scanning: headers (1/5)",
  );
  assert.equal(describeProgress({ currentCategory: "ssl" }), "Scanning: ssl");
  assert.equal(describeProgress({ status: "running" }), null);
});

/** A poll sequence: the nth status request gets entry n, the last one repeating. */
function pollingHandler(sequence, hits = { polls: 0 }) {
  return (req, res) => {
    if (req.url.startsWith("/scan/status/")) {
      const entry = sequence[Math.min(hits.polls, sequence.length - 1)];
      hits.polls += 1;
      res.writeHead(entry.status ?? 200, JSON_HEADERS);
      res.end(
        typeof entry.body === "string"
          ? entry.body
          : JSON.stringify(entry.body),
      );
      return;
    }
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify({ scanId: "s1" }));
  };
}

test("cli: a progress line appears when the category moves, not on every poll", async () => {
  const running = (category, done) => ({
    body: {
      status: "running",
      currentCategory: category,
      categoriesCompleted: done,
      categoriesTotal: 5,
    },
  });
  const { code, stdout } = await runCliWithHandler(
    SCAN_ARGS,
    pollingHandler([
      running("headers", 1),
      running("headers", 1),
      running("ssl", 2),
      { body: completedWith({}) },
    ]),
  );
  assert.equal(code, EXIT.OK);
  assert.equal(stdout.match(/Scanning: headers \(1\/5\)/g)?.length, 1);
  assert.equal(stdout.match(/Scanning: ssl \(2\/5\)/g)?.length, 1);
});

test("cli: progress goes to stderr under --json, so stdout stays one document", async () => {
  const { stdout, stderr } = await runCliWithHandler(
    [...SCAN_ARGS, "--json"],
    pollingHandler([
      {
        body: {
          status: "running",
          currentCategory: "dns",
          categoriesCompleted: 0,
          categoriesTotal: 3,
        },
      },
      { body: completedWith({}) },
    ]),
  );
  assert.match(stderr, /Scanning: dns \(0\/3\)/);
  assert.deepEqual(JSON.parse(stdout).summary, CLEAN);
});

test("cli: one last poll after the deadline finds a scan that finished meanwhile, and sleeping never overshoots it", async () => {
  const hits = { polls: 0 };
  const started = Date.now();
  const { code } = await runCliWithHandler(
    [
      "scan",
      "https://target.example",
      "--api-key",
      "k",
      "--timeout",
      "1",
      "--poll-interval",
      "5",
    ],
    pollingHandler(
      [{ body: { status: "running" } }, { body: completedWith({}) }],
      hits,
    ),
  );
  assert.equal(code, EXIT.OK);
  assert.equal(hits.polls, 2);
  // The 5s interval was clamped to the 1s that was left.
  assert.ok(Date.now() - started < 4500, "slept past the deadline");
});

test("cli: a timeout says the scan is still running, unless --cancel-on-timeout stopped it", async () => {
  const deletes = [];
  const handler = (req, res) => {
    if (req.method === "DELETE") {
      deletes.push(req.url);
      res.writeHead(200, JSON_HEADERS);
      res.end('{"status":"failed","cancelled":true}');
      return;
    }
    pollingHandler([{ body: { status: "running" } }])(req, res);
  };
  const args = [
    "scan",
    "https://target.example",
    "--api-key",
    "k",
    "--timeout",
    "1",
    "--poll-interval",
    "1",
  ];

  const left = await runCliWithHandler(args, handler);
  assert.equal(left.code, EXIT.ERROR);
  assert.match(left.stderr, /Timed out after 1s waiting for scan s1/);
  assert.match(left.stderr, /still running on the server/);
  assert.deepEqual(deletes, []);

  const cancelled = await runCliWithHandler(
    [...args, "--cancel-on-timeout"],
    handler,
  );
  assert.equal(cancelled.code, EXIT.ERROR);
  assert.match(cancelled.stderr, /Cancelled scan s1/);
  assert.deepEqual(deletes, ["/scan/status/s1"]);
});

test("cli: the API's 'Scan not found' 404 ends the wait at once", async () => {
  const hits = { polls: 0 };
  const { code, stderr } = await runCliWithHandler(
    SCAN_ARGS,
    pollingHandler([{ status: 404, body: { error: "Scan not found" } }], hits),
  );
  assert.equal(code, EXIT.ERROR);
  assert.equal(hits.polls, 1, "not retried");
  assert.match(stderr, /Scan s1 not found \(deleted while polling\?\)/);
});

test("cli: a bare 404 from a gateway is still retried", async () => {
  const hits = { polls: 0 };
  const { code } = await runCliWithHandler(
    SCAN_ARGS,
    pollingHandler(
      [
        { status: 404, body: "<html>not found</html>" },
        { body: completedWith({}) },
      ],
      hits,
    ),
  );
  assert.equal(code, EXIT.OK);
  assert.equal(hits.polls, 2);
});

test("cli: a poll answered with a page that is not JSON is described, with a snippet", async () => {
  const { code, stderr } = await runCliWithHandler(
    SCAN_ARGS,
    pollingHandler([{ body: "<html>captive portal</html>" }]),
  );
  assert.equal(code, EXIT.ERROR);
  assert.match(stderr, /Lost contact with the API while polling scan s1/);
  assert.match(stderr, /not JSON: <html>captive portal<\/html>/);
});

// ── Cancelling on a signal ──────────────────────────────────────────────

test("cancelScan: a DELETE that works, a scan already finished, a refusal and an unreachable server", async () => {
  const statuses = [200, 409, 404, 500];
  const seen = [];
  const server = createServer((req, res) => {
    seen.push([req.method, req.url, req.headers.authorization]);
    res.writeHead(statuses[seen.length - 1], JSON_HEADERS);
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: "Bearer k" };
  try {
    const ok = await cancelScan(base, "7", headers);
    assert.deepEqual([ok.settled, ok.message], [true, "Cancelled scan 7."]);
    assert.equal((await cancelScan(base, "7", headers)).settled, true);
    assert.equal((await cancelScan(base, "7", headers)).settled, true);
    const refused = await cancelScan(base, "7", headers);
    assert.equal(refused.settled, false);
    assert.match(refused.message, /HTTP 500/);
    assert.deepEqual(seen[0], ["DELETE", "/scan/status/7", "Bearer k"]);
  } finally {
    server.close();
  }
  const gone = await cancelScan(base, "7", headers, 500);
  assert.equal(gone.settled, false);
  assert.match(gone.message, /Could not cancel scan 7/);
});

test("cancelScan: a server that never answers is given up on after the timeout", async () => {
  const server = createServer(() => {
    /* accept, never respond */
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const started = Date.now();
    const out = await cancelScan(
      `http://127.0.0.1:${server.address().port}`,
      "7",
      {},
      150,
    );
    assert.equal(out.settled, false);
    assert.match(out.message, /timed out/);
    assert.ok(Date.now() - started < 3000);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

/**
 * Start the CLI against a handler and hand back the live child, for the tests
 * that need to signal it mid-run.
 */
function spawnCli(args, handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const childEnv = { ...process.env };
      delete childEnv.VULNRADAR_TOKEN;
      delete childEnv.VULNRADAR_API_BASE;
      const child = spawn(
        process.execPath,
        [CLI, ...args, "--api-base", `http://127.0.0.1:${port}`],
        { env: childEnv },
      );
      const out = { stdout: "", stderr: "" };
      child.stdout.on("data", (d) => (out.stdout += d));
      child.stderr.on("data", (d) => (out.stderr += d));
      const done = new Promise((r) =>
        child.on("close", (code) => {
          server.closeAllConnections?.();
          server.close();
          r({ code, ...out });
        }),
      );
      resolve({ child, done, out });
    });
  });
}

async function waitFor(predicate, ms = 10_000) {
  const until = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > until) throw new Error("timed out waiting for the CLI");
    await new Promise((r) => setTimeout(r, 20));
  }
}

// Windows has no POSIX signals to deliver to a child: kill() ends it without
// running any handler, so there is nothing to observe there.
for (const [signal, code] of [
  ["SIGTERM", EXIT.SIGTERM],
  ["SIGINT", EXIT.SIGINT],
]) {
  test(
    `cli: ${signal} cancels the scan it started and exits ${code}`,
    { skip: process.platform === "win32" },
    async () => {
      const deletes = [];
      const { child, done, out } = await spawnCli(
        [...SCAN_ARGS, "--poll-interval", "1"],
        (req, res) => {
          if (req.method === "DELETE") {
            deletes.push(req.url);
            res.writeHead(200, JSON_HEADERS);
            res.end('{"status":"failed","cancelled":true}');
            return;
          }
          pollingHandler([{ body: { status: "running" } }])(req, res);
        },
      );
      await waitFor(() => out.stdout.includes("Started scan s1"));
      child.kill(signal);
      const result = await done;
      assert.equal(result.code, code);
      assert.deepEqual(deletes, ["/scan/status/s1"]);
      assert.match(
        result.stderr,
        new RegExp(`Received ${signal}, cancelling scan s1`),
      );
      assert.match(result.stderr, /Cancelled scan s1/);
    },
  );
}

test(
  "cli: --json prints a failure document when it is interrupted",
  { skip: process.platform === "win32" },
  async () => {
    const { child, done, out } = await spawnCli(
      [...SCAN_ARGS, "--poll-interval", "1", "--json"],
      (req, res) => {
        if (req.method === "DELETE") {
          res.writeHead(409, JSON_HEADERS);
          res.end("{}");
          return;
        }
        pollingHandler([{ body: { status: "running" } }])(req, res);
      },
    );
    await waitFor(() => out.stderr.includes("Started scan s1"));
    child.kill("SIGTERM");
    const result = await done;
    assert.equal(result.code, EXIT.SIGTERM);
    const doc = JSON.parse(result.stdout);
    assert.equal(doc.ok, false);
    assert.equal(doc.signal, "SIGTERM");
    assert.equal(doc.scanId, "s1");
  },
);

// ── A signal on the "Started scan" line, and what the CLI sends where ────

/**
 * Run the CLI with a preload that delivers `signal` to the process the moment
 * the "Started scan" line is written, which is the earliest a caller watching
 * the output can react to it.
 *
 * The line used to be printed before the SIGINT and SIGTERM handlers were
 * installed, so a signal in that window took the default action: the process
 * died and the scan kept the account's concurrency slot. The POSIX signal
 * tests above caught it about one run in two, depending on the scheduler.
 * Emitting the signal event from inside the write makes the window exact and
 * deterministic, and it runs on Windows too, where a real signal cannot be
 * delivered to a child.
 */
function runCliSignalledOnStart(args, handler, signal) {
  const dir = mkdtempSync(path.join(tmpdir(), "vulnradar-cli-preload-"));
  const preload = path.join(dir, "signal-on-start.mjs");
  writeFileSync(
    preload,
    `let fired = false;
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
    const done = write(chunk, ...rest);
    if (!fired && String(chunk).includes("Started scan ")) {
      fired = true;
      process.emit(${JSON.stringify(signal)}, ${JSON.stringify(signal)});
    }
    return done;
  };
}
`,
  );
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const childEnv = { ...process.env };
      delete childEnv.VULNRADAR_TOKEN;
      delete childEnv.VULNRADAR_API_BASE;
      execFile(
        process.execPath,
        [
          "--import",
          pathToFileURL(preload).href,
          CLI,
          ...args,
          "--api-base",
          `http://127.0.0.1:${port}`,
        ],
        { env: childEnv },
        (err, stdout, stderr) => {
          server.closeAllConnections?.();
          server.close();
          rmSync(dir, { recursive: true, force: true });
          if (err && typeof err.code !== "number") return reject(err);
          resolve({ code: err ? err.code : 0, stdout, stderr });
        },
      );
    });
  });
}

for (const [signal, code] of [
  ["SIGTERM", EXIT.SIGTERM],
  ["SIGINT", EXIT.SIGINT],
]) {
  test(`cli: a ${signal} that lands on the "Started scan" line still cancels the scan`, async () => {
    const deletes = [];
    const result = await runCliSignalledOnStart(
      [...SCAN_ARGS, "--poll-interval", "1", "--timeout", "4"],
      (req, res) => {
        if (req.method === "DELETE") {
          deletes.push(req.url);
          res.writeHead(200, JSON_HEADERS);
          res.end('{"status":"failed","cancelled":true}');
          return;
        }
        pollingHandler([{ body: { status: "running" } }])(req, res);
      },
      signal,
    );
    assert.equal(result.code, code, result.stderr);
    assert.deepEqual(deletes, ["/scan/status/s1"]);
    assert.match(result.stderr, /Cancelled scan s1/);
  });
}

// The only file the CLI ever read was its own package.json, for the version
// in the User-Agent header, and that read is what made every request look to
// a code scanner like "network request depends on file data". The version now
// arrives as a JSON module import, so nothing read from disk at run time can
// reach a request. A readFileSync coming back would bring the alerts with it.
test("the CLI reads no file at run time, so nothing from disk reaches a request", () => {
  const source = readFileSync(CLI, "utf8");
  assert.doesNotMatch(source, /\breadFileSync\b|\breadFile\b|createReadStream/);
  const lib = readFileSync(path.join(path.dirname(CLI), "lib.mjs"), "utf8");
  assert.doesNotMatch(lib, /\bnode:fs\b|\breadFileSync\b|\breadFile\b/);
});

test("--version and the User-Agent carry the version in cli/package.json", async () => {
  const { version } = JSON.parse(
    readFileSync(path.join(path.dirname(CLI), "package.json"), "utf8"),
  );
  const printed = await runCli(["--version"]);
  assert.equal(printed.stdout.trim(), version);
  const { requests } = await runCli(SCAN_ARGS, {
    routes: routesFor(completedWith({})),
  });
  assert.ok(requests.length > 0);
  for (const r of requests) {
    assert.equal(r.headers["user-agent"], `vulnradar-cli/${version}`);
  }
});

// The scan id comes from the API's reply and is put into the next URL. Read
// raw, an id with a "/" or ".." in it was resolved as a path, so a reply of
// "../../keys/5" sent the status polls, the report download and the cancel
// DELETE, all with the Bearer key, to a path outside the scan endpoints. The
// id is one path segment, and it is encoded as one.
test("cli: a scan id from the API stays one path segment in every request it makes", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vulnradar-cli-"));
  const out = path.join(dir, "report.md");
  try {
    const { code, requests } = await runCli(
      [...SCAN_ARGS, "--report", "md", "--out", out],
      {
        routes: {
          "/scan/status/": { body: completedWith({}) },
          "/scan": { body: { scanId: "../../keys/5" } },
          "/history/": { body: "# Scan report" },
        },
      },
    );
    const urls = requests.map((r) => r.url);
    assert.equal(code, EXIT.OK, urls.join(", "));
    assert.ok(
      urls.includes("/scan/status/..%2F..%2Fkeys%2F5"),
      urls.join(", "),
    );
    assert.ok(
      urls.includes("/history/..%2F..%2Fkeys%2F5/report?format=md"),
      urls.join(", "),
    );
    assert.ok(!urls.some((u) => u.startsWith("/keys")), urls.join(", "));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reportRequestUrl and cancelScan encode the scan id as one path segment", async () => {
  assert.equal(
    reportRequestUrl("https://api.example/api/v3", "../../keys/5", {
      report: "sarif",
    }),
    "https://api.example/api/v3/history/..%2F..%2Fkeys%2F5/report?format=sarif",
  );
  const seen = [];
  const server = createServer((req, res) => {
    seen.push([req.method, req.url]);
    res.writeHead(200, JSON_HEADERS);
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await cancelScan(
      `http://127.0.0.1:${server.address().port}`,
      "../../keys/5",
      {},
    );
    assert.deepEqual(seen, [["DELETE", "/scan/status/..%2F..%2Fkeys%2F5"]]);
  } finally {
    server.close();
  }
});

// Encoding leaves "." alone, and the URL parser resolves a "." or ".." segment
// before the request is sent, so those two ids are refused outright.
test("isScanIdSegment refuses the ids encoding cannot keep in their segment", () => {
  for (const id of [
    "s1",
    "0123456789abcdef0123456789abcdef",
    42,
    "../../keys/5",
  ]) {
    assert.equal(isScanIdSegment(id), true, JSON.stringify(id));
  }
  for (const id of [".", "..", "", null, undefined, true, {}, ["s1"]]) {
    assert.equal(isScanIdSegment(id), false, JSON.stringify(id));
  }
});

for (const scanId of ["..", "."]) {
  test(`cli: a scan id of "${scanId}" is refused before any request uses it`, async () => {
    const { code, stderr, requests } = await runCli(
      [...SCAN_ARGS, "--timeout", "3"],
      {
        routes: {
          "/scan/status/": { body: completedWith({}) },
          "/scan": { body: { scanId } },
        },
      },
    );
    assert.equal(code, EXIT.ERROR, stderr);
    assert.match(stderr, /scan id that cannot be used in a URL/);
    assert.deepEqual(
      requests.map((r) => `${r.method} ${r.url}`),
      ["POST /scan"],
    );
  });
}

// The report is written to the path the user named with --out and nowhere
// else. A file name in the reply (Content-Disposition, as the web download
// uses) is the server's suggestion for a browser, and following it would let
// the reply choose where on the CI runner's disk a file lands.
test("cli: the report goes to --out, never to a file name the reply suggests", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vulnradar-cli-"));
  const out = path.join(dir, "named-by-user.md");
  try {
    const { code } = await runCli(
      [...SCAN_ARGS, "--report", "md", "--out", out],
      {
        routes: routesFor(completedWith({}), {
          "/history/": {
            body: "# Scan report",
            headers: {
              "Content-Disposition":
                'attachment; filename="../suggested-by-server.md"',
            },
          },
        }),
      },
    );
    assert.equal(code, EXIT.OK);
    assert.equal(readFileSync(out, "utf8"), "# Scan report");
    assert.equal(existsSync(path.join(dir, "suggested-by-server.md")), false);
    assert.equal(
      existsSync(path.join(path.dirname(dir), "suggested-by-server.md")),
      false,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
