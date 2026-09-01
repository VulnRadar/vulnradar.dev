import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseArgs, evaluateGate, DEFAULTS } from "./lib.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "vulnradar.mjs");

/**
 * Run the real CLI executable against a throwaway HTTP server standing in for
 * the API. The gate logic has unit tests below, but everything between argv
 * and the exit code -- the missing-key guard, the non-200 handling, the poll
 * loop, the JSON versus human output -- only exists in vulnradar.mjs and was
 * covered by nothing. Spawning is the only way to observe process.exit.
 */
function runCli(args, { routes = {}, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const route = Object.keys(routes).find((k) => req.url.startsWith(k));
      if (!route) {
        res.writeHead(404).end("{}");
        return;
      }
      const { status = 200, body = {} } = routes[route];
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
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
          resolve({ code: err ? err.code : 0, stdout, stderr });
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
  assert.equal(parseArgs(["scan", "u", "--crawl", "--timeout", "60"]).timeout, 60);
  assert.equal(parseArgs(["scan", "u", "--timeout", "60", "--crawl"]).timeout, 60);
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
    ["scan", "https://target.example", "--api-key", "k", "--poll-interval", "0"],
    {
      routes: {
        "/scan/status/": { body: completed({ critical: 0, high: 0, medium: 4, low: 1, total: 5 }) },
        "/scan": { body: { scanId: "abc123" } },
      },
    },
  );
  assert.equal(code, 0);
  assert.match(stdout, /Started scan abc123/);
  assert.match(stdout, /critical=0 high=0 medium=4 low=1 total=5/);
});

test("cli: exits 1 and names every breached threshold", async () => {
  const { code, stderr } = await runCli(
    ["scan", "https://target.example", "--api-key", "k", "--poll-interval", "0", "--max-medium", "1"],
    {
      routes: {
        "/scan/status/": { body: completed({ critical: 2, high: 1, medium: 9 }) },
        "/scan": { body: { scanId: "s1" } },
      },
    },
  );
  assert.equal(code, 1);
  assert.match(stderr, /2 critical finding\(s\) exceed the max of 0/);
  assert.match(stderr, /1 high finding\(s\) exceed the max of 0/);
  assert.match(stderr, /9 medium finding\(s\) exceed the max of 1/);
});

test("cli: --json prints the raw result and it parses", async () => {
  const { code, stdout } = await runCli(
    ["scan", "https://target.example", "--api-key", "k", "--poll-interval", "0", "--json"],
    {
      routes: {
        "/scan/status/": { body: completed({ critical: 0, high: 0, total: 0 }) },
        "/scan": { body: { scanId: "s2" } },
      },
    },
  );
  assert.equal(code, 0);
  const json = stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1);
  assert.deepEqual(JSON.parse(json).summary, { critical: 0, high: 0, total: 0 });
});

test("cli: a non-200 from the create call is reported with its status and body", async () => {
  const { code, stderr } = await runCli(
    ["scan", "https://target.example", "--api-key", "bad"],
    { routes: { "/scan": { status: 401, body: { error: "Invalid API key" } } } },
  );
  assert.equal(code, 1);
  assert.match(stderr, /Failed to start scan \(HTTP 401\)/);
  assert.match(stderr, /Invalid API key/);
});

test("cli: a create response with no scanId is an error, not a hang", async () => {
  const { code, stderr } = await runCli(
    ["scan", "https://target.example", "--api-key", "k"],
    { routes: { "/scan": { body: { status: "queued" } } } },
  );
  assert.equal(code, 1);
  assert.match(stderr, /No scanId/);
});

test("cli: a failed scan reports the server's reason", async () => {
  const { code, stderr } = await runCli(
    ["scan", "https://target.example", "--api-key", "k", "--poll-interval", "0"],
    {
      routes: {
        "/scan/status/": { body: { status: "failed", error: "DNS lookup failed" } },
        "/scan": { body: { scanId: "s3" } },
      },
    },
  );
  assert.equal(code, 1);
  assert.match(stderr, /Scan failed: DNS lookup failed/);
});

test("cli: no API key exits 1 and points at both ways to supply one", async () => {
  const { code, stderr } = await runCli(["scan", "https://target.example"]);
  assert.equal(code, 1);
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

test("cli: no URL exits 1 and prints usage", async () => {
  const { code, stderr } = await runCli(["scan", "--api-key", "k"]);
  assert.equal(code, 1);
  assert.match(stderr, /a URL to scan is required/);
  assert.match(stderr, /Usage:/);
});

test("cli: an unknown command is rejected by name", async () => {
  const { code, stderr } = await runCli(["scam", "https://target.example", "--api-key", "k"]);
  assert.equal(code, 1);
  assert.match(stderr, /Unknown command: scam/);
});

test("cli: --help exits 0 with usage on stdout", async () => {
  const { code, stdout } = await runCli(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage:\n {2}vulnradar scan <url>/);
});
