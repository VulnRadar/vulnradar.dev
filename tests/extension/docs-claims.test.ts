import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SHOWN_SUPPRESS_MS,
  SNOOZE_DURATION_MS,
  VULNRADAR,
} from "../../extension/src/lib/constants";
import { NON_PUBLIC_SUFFIXES } from "../../extension/src/lib/lookup-url";
import { DEFAULT_SETTINGS } from "../../extension/src/lib/types";
import { PLANS } from "@/lib/billing/catalog";
import { escapeRegExp } from "@/lib/scanner/_helpers";

/**
 * The docs page, the README and the extension's own copy all state numbers
 * about what the extension does: how long the card stays quiet, how often a
 * site is looked up, how often auto-scan may fire. The numbers live in code;
 * the prose is written by hand, and a privacy or behaviour statement is the
 * last place a stale figure belongs. The docs page said 24 hours for a
 * suppression window that has been 4 hours since it was written.
 */

const ROOT = resolve(__dirname, "../..");
const text = (path: string) =>
  readFileSync(resolve(ROOT, path), "utf8").replace(/\s+/g, " ");

const DOCS = text("app/docs/extension/page.tsx");
const README = text("extension/README.md");
const OPTIONS = text("extension/src/options/options.ts");
const WELCOME = text("extension/src/onboarding/welcome.ts");

const HOUR = 60 * 60 * 1000;

function numberAfter(source: string, pattern: RegExp): number {
  const m = pattern.exec(source);
  expect(m, `${pattern} not found`).toBeTruthy();
  return Number(m![1]);
}

describe("docs/extension states the extension's real numbers", () => {
  it("says the card stays quiet for the suppression window, in hours", () => {
    expect(
      numberAfter(DOCS, /stays quiet on later page loads[^.]*?for (\d+) hours/),
    ).toBe(SHOWN_SUPPRESS_MS / HOUR);
  });

  it("says Snooze lasts as long as the snooze constant", () => {
    expect(SNOOZE_DURATION_MS / HOUR).toBe(24);
    expect(DOCS).toContain("Snooze 24h");
  });

  it("states the lookup interval from the throttle constant", () => {
    expect(numberAfter(DOCS, /at most once every (\d+) seconds per site/)).toBe(
      VULNRADAR.reputationThrottleMs / 1000,
    );
    expect(
      numberAfter(README, /at most once every (\d+) seconds per site/),
    ).toBe(VULNRADAR.reputationThrottleMs / 1000);
  });

  it("states the auto-scan cooldown and throttle defaults", () => {
    expect(
      numberAfter(
        DOCS,
        /at most one automatic scan of a site every (\d+) hours/,
      ),
    ).toBe(DEFAULT_SETTINGS.autoScanHostCooldownHours);
    expect(
      numberAfter(DOCS, /at most one every (\d+) seconds across all sites/),
    ).toBe(DEFAULT_SETTINGS.autoScanThrottleSeconds);
    expect(numberAfter(README, /\((\d+) hours unless you change it\)/)).toBe(
      DEFAULT_SETTINGS.autoScanHostCooldownHours,
    );
  });

  it("lists every private suffix the extension skips", () => {
    // includes() and a boolean, not toContain: a failure would otherwise print
    // the whole page source as the "received" value.
    for (const suffix of NON_PUBLIC_SUFFIXES) {
      // ".local" must not be satisfied by ".localhost", so the suffix has to end
      // where a word does.
      const named = new RegExp(`${escapeRegExp(suffix)}(?![a-z])`);
      expect(named.test(DOCS), `docs page: ${suffix}`).toBe(true);
      // The README writes them as code spans, with the leading dot.
      expect(README.includes(`\`${suffix}\``), `README: ${suffix}`).toBe(true);
    }
  });

  it("does not call the global throttle per-host, which it is not", () => {
    expect(DOCS).not.toMatch(/throttled per host/i);
  });
});

describe("the extension's own copy matches its defaults", () => {
  it("says Site Alerts is on by default, and it is", () => {
    expect(DEFAULT_SETTINGS.showScanResults).toBe(true);
    expect(DEFAULT_SETTINGS.showScanPrompts).toBe(true);
    expect(WELCOME).toContain("Site Alerts is on by default");
    expect(OPTIONS).toMatch(
      /Site Alerts<\/strong>, on unless you turn them off/,
    );
  });

  it("describes the Site Alerts lookup as origin and path, never the query", () => {
    for (const [name, source] of [
      ["welcome", WELCOME],
      ["options", OPTIONS],
      ["docs", DOCS],
      ["README", README],
    ] as const) {
      expect(source, name).toMatch(/without (?:its|the) query string/);
      expect(source, name).not.toMatch(/full URL|full page URL/i);
    }
  });

  it("states the free plan's daily scans from the plan catalog", () => {
    const free = PLANS.find((p) => p.id === "free")!;
    expect(numberAfter(WELCOME, /free tier includes (\d+) scans/)).toBe(
      free.limits.dailyScans,
    );
  });

  it("has auto-scan off by default, as the copy says", () => {
    expect(DEFAULT_SETTINGS.autoScan).toBe("off");
    expect(DOCS).toContain("Off by default");
  });
});
