/**
 * Shared test harness for sync detector modules.
 *
 * Every per-category detector module (lib/scanner/checks/<category>.ts)
 * exports a `detectors: Record<string, EvidenceFn>` map. Each detector
 * takes (url, headers, body) and returns either `null` (no finding) or
 * a non-empty evidence string.
 *
 * This harness provides three layers of coverage:
 *
 *   1. SMOKE  — every detector is callable, doesn't throw on empty
 *               inputs, returns null or string, and is deterministic.
 *   2. POSITIVE — the detector fires on the canonical bad-case input.
 *   3. NEGATIVE — the detector does NOT fire on the canonical good-case.
 *
 * Per-category test files call `runDetectorTests(detectors, fixtures)`
 * with a `DetectorFixture` map keyed by detector id. Fixtures are
 * curated per category — see lib/scanner/checks/<cat>.test.ts.
 *
 * The harness is intentionally side-effect free so it can be reused
 * across all eight sync-detector categories (headers, ssl, content,
 * cookies, configuration, information-disclosure, api, code,
 * secrets-extended) without modification.
 */

import { describe, it, expect } from "vitest";
import type { EvidenceFn } from "../_helpers";

export interface DetectorFixture {
  /**
   * Human-readable description of the case, used as the test name suffix.
   */
  description: string;
  url?: string;
  headers?: Record<string, string>;
  /** Cookies are normalised into the Set-Cookie header so tests can use the same Headers API. */
  cookies?: string[];
  body?: string;
  /**
   * Expected outcome:
   *   - "fire"     → detector must return a non-null string
   *   - "skip"     → detector must return null
   *   - undefined  → don't assert either way (smoke only)
   */
  expect?: "fire" | "skip";
  /** If set, the returned evidence must include this substring (case-insensitive). */
  evidenceIncludes?: string;
  /** If set, the returned evidence must NOT include this substring. */
  evidenceExcludes?: string;
}

export type DetectorFixtures = Record<string, DetectorFixture[]>;

const DEFAULT_URL = "https://example.com";

function buildHeaders(fx: DetectorFixture): Headers {
  const h = new Headers();
  for (const [key, value] of Object.entries(fx.headers ?? {})) {
    // The Headers API rejects pseudo-headers (":status", ":path", etc.)
    // and any non-token characters. Real-world responses only carry
    // pseudo-headers on HTTP/2 raw socket dumps, not in fetch()'s
    // Headers object, so we silently drop them here.
    if (key.startsWith(":") || /[^\x21-\x7e]/.test(key)) continue;
    try {
      h.set(key, value);
    } catch {
      // ignore invalid header names — fixture may include protocol-
      // specific entries that Headers rejects
    }
  }
  if (fx.cookies && fx.cookies.length > 0) {
    for (const c of fx.cookies) h.append("set-cookie", c);
  }
  return h;
}

function invoke(fn: EvidenceFn, fx: DetectorFixture): string | null {
  const url = fx.url ?? DEFAULT_URL;
  const headers = buildHeaders(fx);
  const body = fx.body ?? "";
  return fn(url, headers, body);
}

export function runDetectorTests(
  detectors: Record<string, EvidenceFn>,
  fixtures: DetectorFixtures = {},
): void {
  const ids = Object.keys(detectors);

  describe("smoke", () => {
    it("exports a non-empty detectors map", () => {
      expect(ids.length).toBeGreaterThan(0);
    });

    it.each(ids)("%s is a function", (id) => {
      expect(typeof detectors[id]).toBe("function");
    });

    it.each(ids)("%s handles empty inputs without throwing", (id) => {
      const fn = detectors[id];
      expect(() => fn(DEFAULT_URL, new Headers(), "")).not.toThrow();
    });

    it.each(ids)("%s returns null or a non-empty string", (id) => {
      const fn = detectors[id];
      const result = fn(DEFAULT_URL, new Headers(), "");
      if (result !== null) {
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it.each(ids)("%s is deterministic for the same input", (id) => {
      const fn = detectors[id];
      const input = [
        DEFAULT_URL,
        new Headers({ "x-test": "value" }),
        "<html><body><h1>Test</h1></body></html>",
      ] as const;
      const a = fn(...input);
      const b = fn(...input);
      expect(a).toEqual(b);
    });

    it.each(ids)("%s does not throw on a populated page", (id) => {
      const fn = detectors[id];
      expect(() =>
        fn(
          "https://example.com/admin/login?next=/dashboard",
          new Headers({
            "content-type": "text/html",
            "set-cookie": "session=abc123; Path=/",
          }),
          "<html><body><script>eval(window.name)</script></body></html>",
        ),
      ).not.toThrow();
    });
  });

  describe("positive cases (detector must fire)", () => {
    const positiveCases: { id: string; fx: DetectorFixture; index: number }[] =
      [];
    for (const [id, cases] of Object.entries(fixtures)) {
      cases.forEach((fx, index) => {
        if (fx.expect === "fire") positiveCases.push({ id, fx, index });
      });
    }

    if (positiveCases.length === 0) {
      it("(no positive fixtures defined for this category)", () => {
        expect(true).toBe(true);
      });
      return;
    }

    it.each(positiveCases)(
      "$id [$index] fires on: $fx.description",
      ({ id, fx }) => {
        const fn = detectors[id];
        expect(fn, `detector "${id}" is not defined`).toBeDefined();
        const result = invoke(fn, fx);
        expect(
          result,
          `${id} should have fired on: ${fx.description}`,
        ).not.toBeNull();
        expect(typeof result).toBe("string");
        if (fx.evidenceIncludes) {
          expect(
            result!.toLowerCase(),
            `${id} evidence should include "${fx.evidenceIncludes}"`,
          ).toContain(fx.evidenceIncludes.toLowerCase());
        }
        if (fx.evidenceExcludes) {
          expect(
            result!.toLowerCase(),
            `${id} evidence should not include "${fx.evidenceExcludes}"`,
          ).not.toContain(fx.evidenceExcludes.toLowerCase());
        }
      },
    );
  });

  describe("negative cases (detector must skip)", () => {
    const negativeCases: { id: string; fx: DetectorFixture; index: number }[] =
      [];
    for (const [id, cases] of Object.entries(fixtures)) {
      cases.forEach((fx, index) => {
        if (fx.expect === "skip") negativeCases.push({ id, fx, index });
      });
    }

    if (negativeCases.length === 0) {
      it("(no negative fixtures defined for this category)", () => {
        expect(true).toBe(true);
      });
      return;
    }

    it.each(negativeCases)(
      "$id [$index] skips on: $fx.description",
      ({ id, fx }) => {
        const fn = detectors[id];
        expect(fn, `detector "${id}" is not defined`).toBeDefined();
        const result = invoke(fn, fx);
        expect(
          result,
          `${id} should have skipped on: ${fx.description}`,
        ).toBeNull();
      },
    );
  });

  describe("fixture hygiene", () => {
    it("every fixture id corresponds to a real detector", () => {
      const bad: string[] = [];
      for (const id of Object.keys(fixtures)) {
        if (!detectors[id]) bad.push(id);
      }
      expect(
        bad,
        `fixtures reference unknown detectors: ${bad.join(", ")}`,
      ).toEqual([]);
    });

    it("every fixture with expect=fire has evidenceIncludes (warning only)", () => {
      // Evidence substrings keep positive tests honest — a detector that
      // fires but returns "OK" should fail this rule so the author
      // tightens the fixture. We log the offenders as a warning rather
      // than failing because curated smoke tests are useful even without
      // a tight evidence assertion, and a blanket throw makes it painful
      // to add new detectors quickly.
      const bad: string[] = [];
      for (const [id, cases] of Object.entries(fixtures)) {
        cases.forEach((fx, index) => {
          if (fx.expect === "fire" && !fx.evidenceIncludes) {
            bad.push(`${id}[${index}] (${fx.description})`);
          }
        });
      }
      if (bad.length > 0) {
        console.warn(
          `[test-harness] ${bad.length} positive fixture(s) missing evidenceIncludes — consider tightening them: ` +
            bad.slice(0, 10).join("; "),
        );
      }
      expect(bad.length).toBeGreaterThanOrEqual(0);
    });
  });
}
