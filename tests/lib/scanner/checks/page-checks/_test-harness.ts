/**
 * Shared test harness for `PageCheck`-based detectors
 * (lib/scanner/checks/page-checks/**).
 *
 * Mirrors tests/lib/scanner/checks/_test-harness.ts, adapted for the newer
 * interface: a check's `run(ctx)` takes a `PageContext` built from
 * (url, headers, body) rather than the three arguments directly, and can
 * return a single `CheckHit`, an array of them, or null.
 */

import { describe, it, expect } from "vitest";
import type { PageCheck } from "@/lib/scanner/check-types";
import { requirementsMet } from "@/lib/scanner/check-types";
import { buildPageContext } from "@/lib/scanner/page-context";

export interface PageCheckFixture {
  description: string;
  url?: string;
  headers?: Record<string, string>;
  cookies?: string[];
  body?: string;
  expect?: "fire" | "skip";
  evidenceIncludes?: string;
}

export type PageCheckFixtures = Record<string, PageCheckFixture[]>;

const DEFAULT_URL = "https://example.com/";

function buildCtx(fx: PageCheckFixture) {
  const h = new Headers();
  for (const [k, v] of Object.entries(fx.headers ?? {})) {
    try {
      h.set(k, v);
    } catch {
      /* ignore invalid header name in a fixture */
    }
  }
  for (const c of fx.cookies ?? []) h.append("set-cookie", c);
  return buildPageContext(fx.url ?? DEFAULT_URL, h, fx.body ?? "");
}

export function runPageCheckTests(
  checks: PageCheck[],
  fixtures: PageCheckFixtures = {},
): void {
  const byId = new Map(checks.map((c) => [c.id, c]));

  describe("smoke", () => {
    it("exports at least one check", () => {
      expect(checks.length).toBeGreaterThan(0);
    });

    it.each(checks.map((c) => c.id))("%s has a unique, slug-safe id", (id) => {
      expect(/^[a-z0-9][a-z0-9-]*$/.test(id)).toBe(true);
    });

    // A check's `run` is only ever invoked by the engine after
    // `requirementsMet` passes (see lib/scanner/engine.ts), so `run` is
    // entitled to assume its declared `needs` hold, the same way a legacy
    // detector is entitled to assume `headers` is a real Headers object.
    // These generic smoke contexts respect that: they only call `run` when
    // the check's own `needs` say the context is usable.

    it.each(checks.map((c) => c.id))(
      "%s does not throw when its requirements are met by an empty page",
      (id) => {
        const check = byId.get(id)!;
        const ctx = buildPageContext(DEFAULT_URL, new Headers(), "");
        if (requirementsMet(check, ctx)) {
          expect(() => check.run(ctx)).not.toThrow();
        }
      },
    );

    it.each(checks.map((c) => c.id))(
      "%s does not throw against a populated adversarial page",
      (id) => {
        const check = byId.get(id)!;
        const ctx = buildPageContext(
          "https://example.com/admin/login",
          new Headers({
            "content-type": "text/html",
            "content-security-policy":
              "default-src *; script-src * 'unsafe-inline' 'unsafe-eval'",
            "set-cookie": "session=x; Path=/",
          }),
          `<html><body>
            <form action="http://example.com/login" method="post">
              <input type="password" name="pw">
            </form>
            <script src="http://cdn.example.net/lib.js"></script>
            <script>var apiKey = "AKIAIOSFODNN7EXAMPLE1234567890";</script>
            <iframe src="https://ads.example.net/x"></iframe>
          </body></html>`,
        );
        if (requirementsMet(check, ctx)) {
          expect(() => check.run(ctx)).not.toThrow();
        }
      },
    );

    it.each(checks.map((c) => c.id))(
      "%s is deterministic for the same context",
      (id) => {
        const check = byId.get(id)!;
        const ctx = buildPageContext(
          "https://example.com/admin/login",
          new Headers({
            "content-type": "text/html",
            "content-security-policy": "default-src 'self'",
            "set-cookie": "session=x; Secure; HttpOnly; SameSite=Lax; Path=/",
          }),
          `<html><body><h1>Test</h1>
            <form action="/x" method="post"><input type="password" name="pw"></form>
            <script src="/a.js"></script>
          </body></html>`,
        );
        if (!requirementsMet(check, ctx)) return;
        const a = JSON.stringify(check.run(ctx));
        const b = JSON.stringify(check.run(ctx));
        expect(a).toEqual(b);
      },
    );

    it.each(checks.map((c) => c.id))(
      "%s declares needs that are unmet by an empty page (verifies the engine will skip rather than call run)",
      (id) => {
        const check = byId.get(id)!;
        const ctx = buildPageContext(DEFAULT_URL, new Headers(), "");
        // A check is only ever invoked by the engine after requirementsMet
        // passes (see lib/scanner/engine.ts), so `run` itself is entitled to
        // assume its declared `needs` hold. This asserts the *engine's* half
        // of that contract: an empty response does not satisfy any
        // meaningful `needs`, so production code will skip the check here
        // rather than call `run` on a context it doesn't expect.
        if (check.needs && check.needs.length > 0) {
          expect(requirementsMet(check, ctx)).toBe(false);
        }
      },
    );
  });

  describe("positive cases (check must fire)", () => {
    const cases: { id: string; fx: PageCheckFixture; index: number }[] = [];
    for (const [id, fxs] of Object.entries(fixtures)) {
      fxs.forEach((fx, index) => {
        if (fx.expect === "fire") cases.push({ id, fx, index });
      });
    }
    if (cases.length === 0) {
      it("(no positive fixtures defined)", () => expect(true).toBe(true));
      return;
    }
    it.each(cases)("$id [$index] fires on: $fx.description", ({ id, fx }) => {
      const check = byId.get(id);
      expect(check, `check "${id}" is not defined`).toBeDefined();
      const ctx = buildCtx(fx);
      const result = check!.run(ctx);
      expect(
        result,
        `${id} should have fired on: ${fx.description}`,
      ).toBeTruthy();
      const hits = Array.isArray(result) ? result : [result!];
      expect(hits.length).toBeGreaterThan(0);
      if (fx.evidenceIncludes) {
        const combined = hits
          .map(
            (h) =>
              h!.evidence +
              " " +
              (h!.excerpts ?? []).map((e) => e.value).join(" "),
          )
          .join(" ")
          .toLowerCase();
        expect(combined).toContain(fx.evidenceIncludes.toLowerCase());
      }
    });
  });

  describe("negative cases (check must skip)", () => {
    const cases: { id: string; fx: PageCheckFixture; index: number }[] = [];
    for (const [id, fxs] of Object.entries(fixtures)) {
      fxs.forEach((fx, index) => {
        if (fx.expect === "skip") cases.push({ id, fx, index });
      });
    }
    if (cases.length === 0) {
      it("(no negative fixtures defined)", () => expect(true).toBe(true));
      return;
    }
    it.each(cases)("$id [$index] skips on: $fx.description", ({ id, fx }) => {
      const check = byId.get(id);
      expect(check, `check "${id}" is not defined`).toBeDefined();
      const ctx = buildCtx(fx);
      const result = check!.run(ctx);
      expect(
        result,
        `${id} should have skipped on: ${fx.description}`,
      ).toBeFalsy();
    });
  });

  describe("fixture hygiene", () => {
    it("every fixture id corresponds to a real check", () => {
      const bad = Object.keys(fixtures).filter((id) => !byId.has(id));
      expect(bad, `unknown check ids: ${bad.join(", ")}`).toEqual([]);
    });
  });
}
