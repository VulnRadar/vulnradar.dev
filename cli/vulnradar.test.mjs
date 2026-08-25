import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, evaluateGate, DEFAULTS } from "./lib.mjs";

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
