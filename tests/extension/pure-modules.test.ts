import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  isValidUrlPattern,
  matchesUrlPattern,
} from "../../extension/src/lib/url-patterns";
import { classifyScanTarget as classifyInExtension } from "../../extension/src/lib/scan-target";
import { classifyScanTarget as classifyInApp } from "@/lib/scanner/scan-target-classify";
import {
  isScanInProgressStale,
  scanInProgressTimeLeftMs,
} from "../../extension/src/lib/scan-lifecycle";
import { VULNRADAR } from "../../extension/src/lib/constants";
import { SEVERITY_SOLID } from "../../extension/src/lib/tokens";
import extensionTokens from "../../extension/src/lib/tokens.json";

/**
 * The browser extension is a separate npm package with its own build, so it
 * has no test runner of its own and CI only typechecks, formats and builds
 * it. These suites reach into extension/src from the app's runner to cover
 * the pure modules where a regression is expensive and invisible: a wrong URL
 * pattern silences the site-alert card on the wrong host, a classification
 * drift makes the extension and the app disagree about the same URL, and a
 * stale scan record bricks the popup.
 *
 * Only modules that import nothing from webextension-polyfill can be tested
 * this way, since that package lives in extension/node_modules only.
 */

describe("extension url-patterns", () => {
  it("accepts the three documented shapes", () => {
    for (const pattern of [
      "https://example.com",
      "https://example.com/",
      "https://example.com/*",
      "https://*.example.com",
      "https://*.example.com/*",
      "http://localhost:3000",
    ]) {
      expect(isValidUrlPattern(pattern), pattern).toBe(true);
    }
  });

  it("rejects anything else, so the settings UI cannot store a pattern it will not honour", () => {
    for (const pattern of [
      "example.com",
      "https://ex*ample.com",
      "https://example.com/foo/*",
      "https://example.com/*/bar",
      "ftp://example.com",
      "",
    ]) {
      expect(isValidUrlPattern(pattern), pattern).toBe(false);
    }
  });

  it("matches an exact origin without leaking to a sibling host", () => {
    expect(
      matchesUrlPattern("https://example.com/a/b", "https://example.com"),
    ).toBe(true);
    // The dangerous direction: a mute for example.com must not silence
    // notexample.com or an attacker-controlled example.com.evil.test.
    expect(
      matchesUrlPattern("https://notexample.com/", "https://example.com"),
    ).toBe(false);
    expect(
      matchesUrlPattern(
        "https://example.com.evil.test/",
        "https://example.com",
      ),
    ).toBe(false);
    // Scheme is part of the pattern.
    expect(
      matchesUrlPattern("http://example.com/", "https://example.com"),
    ).toBe(false);
  });

  it("matches a wildcard subdomain and the bare domain, but not a suffix collision", () => {
    expect(
      matchesUrlPattern("https://api.example.com/x", "https://*.example.com"),
    ).toBe(true);
    expect(
      matchesUrlPattern("https://example.com/x", "https://*.example.com"),
    ).toBe(true);
    expect(
      matchesUrlPattern("https://evilexample.com/x", "https://*.example.com"),
    ).toBe(false);
  });
});

describe("extension scan-target classification", () => {
  // lib/scanner/scan-target-classify.ts carries an explicit comment that the
  // extension keeps its own small copy because it is a separate build. This
  // is the fixture list that keeps the two copies from drifting apart
  // unnoticed: both are asked the same URLs and must agree on scannable.
  const FIXTURES = [
    "https://example.com",
    "https://example.com/search",
    "https://blog.example.com/posts/1",
    "https://www.google.com/search?q=vulnradar",
    "https://www.google.com",
    "https://duckduckgo.com/?q=test",
    "https://www.bing.com/search?q=test",
    "https://search.brave.com/search?q=test",
    "https://github.com/search?q=test",
    "not a url at all",
    "example.com",
  ];

  it("agrees with the app's classifier on every fixture", () => {
    for (const url of FIXTURES) {
      expect(
        classifyInExtension(url).scannable,
        `extension and app disagree on ${url}`,
      ).toBe(classifyInApp(url).scannable);
    }
  });

  it("flags a search results page and passes an ordinary site", () => {
    expect(
      classifyInExtension("https://www.google.com/search?q=x").scannable,
    ).toBe(false);
    expect(classifyInExtension("https://example.com").scannable).toBe(true);
  });
});

describe("extension scan-lifecycle deadlines", () => {
  const start = 1_800_000_000_000;

  it("treats a fresh record as live", () => {
    expect(
      isScanInProgressStale({ mode: "quick", startedAt: start }, start + 1_000),
    ).toBe(false);
  });

  it("treats a quick scan past its own ceiling as dead", () => {
    // Without this, a service worker killed mid-scan leaves the popup pinned
    // on "Scanning..." with the Scan button disabled and no way back.
    const past = start + VULNRADAR.scanTimeoutMs + 60_000;
    expect(
      isScanInProgressStale({ mode: "quick", startedAt: start }, past),
    ).toBe(true);
  });

  it("gives a crawl the longer crawl ceiling, not the quick one", () => {
    const justPastQuick = start + VULNRADAR.scanTimeoutMs + 60_000;
    expect(
      isScanInProgressStale({ mode: "deep", startedAt: start }, justPastQuick),
    ).toBe(false);
    const pastCrawl = start + VULNRADAR.crawlTimeoutMs + 60_000;
    expect(
      isScanInProgressStale({ mode: "deep", startedAt: start }, pastCrawl),
    ).toBe(true);
  });

  it("reports the remaining window and floors it at zero", () => {
    expect(
      scanInProgressTimeLeftMs({ mode: "quick", startedAt: start }, start),
    ).toBeGreaterThan(VULNRADAR.scanTimeoutMs);
    expect(
      scanInProgressTimeLeftMs(
        { mode: "quick", startedAt: start },
        start + VULNRADAR.scanTimeoutMs + 10 * 60_000,
      ),
    ).toBe(0);
  });
});

describe("extension design tokens track the app", () => {
  // The extension cannot import from lib/, which is how its palette drifted:
  // it had Tailwind blue-500 for low and gray-500 for info against the app's
  // own --severity-* values. Nothing in either build would have caught that,
  // so this reads globals.css and compares.
  function hslToHex(h: number, s: number, l: number): string {
    const sat = s / 100;
    const lum = l / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = sat * Math.min(lum, 1 - lum);
    const f = (n: number) =>
      lum - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = (v: number) =>
      Math.round(255 * v)
        .toString(16)
        .padStart(2, "0");
    return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
  }

  /**
   * globals.css declares the light ramp first (`:root`) and the dark ramp
   * second (`.dark`), so the first occurrence of each variable is light and
   * the second is dark.
   */
  function severityRamps() {
    const css = readFileSync(
      resolve(__dirname, "../../app/globals.css"),
      "utf8",
    );
    const light: Record<string, string> = {};
    const dark: Record<string, string> = {};
    for (const key of ["critical", "high", "medium", "low", "info"]) {
      const matches = [
        ...css.matchAll(
          new RegExp(
            `--severity-${key}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`,
            "g",
          ),
        ),
      ];
      expect(matches.length, `--severity-${key} declarations`).toBe(2);
      const toHex = (m: RegExpMatchArray) =>
        hslToHex(Number(m[1]), Number(m[2]), Number(m[3]));
      light[key] = toHex(matches[0]);
      dark[key] = toHex(matches[1]);
    }
    return { light, dark };
  }

  /**
   * Compared per channel with a rounding tolerance, not by string equality:
   * globals.css stores HSL and the shipped hexes (lib/config/brand.ts's
   * `severity` block, which the extension mirrors) are the canonical
   * round-numbered forms, so hsl(0 84% 60%) converts to #ef4343 against the
   * real #ef4444. A tolerance of 2 absorbs that while still catching the
   * drift this exists for: the old low was Tailwind blue-500 #3b82f6 against
   * #2a8ff4, which is 17 off on the red channel alone.
   */
  function expectClose(actual: string, expected: string, label: string) {
    const channels = (hex: string) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const a = channels(actual);
    const b = channels(expected);
    for (let i = 0; i < 3; i++) {
      expect(
        Math.abs(a[i] - b[i]),
        `${label}: ${actual} vs globals.css ${expected}`,
      ).toBeLessThanOrEqual(2);
    }
  }

  it("uses the same severity ramp as app/globals.css in both themes", () => {
    const { light, dark } = severityRamps();
    for (const key of ["critical", "high", "medium", "low", "info"] as const) {
      expectClose(
        extensionTokens.themes.light.severity[key],
        light[key],
        `light ${key}`,
      );
      expectClose(
        extensionTokens.themes.dark.severity[key],
        dark[key],
        `dark ${key}`,
      );
    }
  });

  it("exposes the dark ramp as the theme-agnostic solid colour", () => {
    expect(SEVERITY_SOLID).toEqual(extensionTokens.themes.dark.severity);
  });
});
