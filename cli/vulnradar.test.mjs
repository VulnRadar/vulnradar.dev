import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseArgs,
  evaluateGate,
  buildScanBody,
  retryAfterSeconds,
  reportRequestUrl,
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
  for (const flag of ["--apply-triage", "--include-suppressed"]) {
    const o = parseArgs(["scan", "https://x.com", flag]);
    assert.match(o.error, /needs --report/, flag);
  }
  const withOut = parseArgs(["scan", "https://x.com", "--out", "f.json"]);
  assert.match(withOut.error, /needs --report/);
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

test("every REPORT_FORMATS entry has an extension, and pdf is the binary one", () => {
  for (const [name, meta] of Object.entries(REPORT_FORMATS)) {
    assert.ok(meta.ext, name);
  }
  assert.equal(REPORT_FORMATS.pdf.binary, true);
  assert.equal(REPORT_FORMATS.sarif.binary, undefined);
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
  assert.match(stdout, /"runs"/);
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
