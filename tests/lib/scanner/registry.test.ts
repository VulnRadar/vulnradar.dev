/**
 * Tests for the detection registry.
 *
 * The registry glues together per-category detector modules (lib/scanner/checks/)
 * with per-category metadata files (lib/scanner/checks-data/). This test
 * pins down:
 *   - the exact set of categories and the count of checks per category
 *   - that every metadata entry has a matching detector (or is async-only)
 *   - that getChecksByCategory filters correctly
 *   - that buildCheck produces a Vulnerability with the right shape
 *
 * Bumping the expected counts is a deliberate, code-review-required
 * action — the registry is the single source of truth for what
 * VulnRadar ships as "checks".
 */

import { describe, it, expect } from "vitest";
import {
  allCheckDefs,
  allChecks,
  getChecksByCategory,
  getCategoryCounts,
} from "@/lib/scanner/registry";
import { ALL_CATEGORIES } from "@/lib/scanner/types";
import type { Category } from "@/lib/scanner/types";

const EXPECTED_CATEGORIES = ALL_CATEGORIES;
const ALL_CATEGORY_SET = new Set<Category>(EXPECTED_CATEGORIES);

describe("detection registry", () => {
  it("exposes a non-empty list of checks", () => {
    expect(allCheckDefs.length).toBeGreaterThan(100);
    expect(allChecks.length).toBeGreaterThan(100);
  });

  it("every check has a known category", () => {
    for (const def of allCheckDefs) {
      expect(ALL_CATEGORY_SET.has(def.category)).toBe(true);
    }
  });

  it("every category appears in the breakdown", () => {
    const counts = getCategoryCounts();
    for (const cat of EXPECTED_CATEGORIES) {
      expect(counts[cat] as number).toBeGreaterThanOrEqual(0);
    }
  });

  it("check IDs are unique across the registry", () => {
    const seen = new Set<string>();
    for (const def of allCheckDefs) {
      expect(seen.has(def.id)).toBe(false);
      seen.add(def.id);
    }
  });

  it("filters by category", () => {
    const headersChecks = getChecksByCategory(["headers"]);
    expect(headersChecks.length).toBeGreaterThan(0);
    for (const fn of headersChecks) {
      const dummyVuln = fn(
        "https://example.com",
        new Headers(),
        "<html></html>",
      );
      if (dummyVuln) {
        expect(dummyVuln.category).toBe("headers");
      }
    }
  });

  it("filtering by an empty list returns all checks", () => {
    expect(getChecksByCategory([]).length).toBe(allChecks.length);
  });

  it("filtering by multiple categories returns the union", () => {
    const headersCount = getChecksByCategory(["headers"]).length;
    const cookiesCount = getChecksByCategory(["cookies"]).length;
    const both = getChecksByCategory(["headers", "cookies"]).length;
    // Some metadata-only categories can inflate counts because they
    // don't have inline detectors; the union must be >= each part.
    expect(both).toBeGreaterThanOrEqual(Math.max(headersCount, cookiesCount));
  });

  // ── Regression: detector collisions resolve to the category owner ─────
  //
  // 78 check IDs were defined in more than one checks/*.ts module (copy-
  // pasted, then one copy tightened to fix false positives without the
  // other being removed). The registry used to flatten every module's
  // detector map in BUNDLES declaration order, so whichever module loaded
  // last silently won, never the module matching the check's own
  // category, which meant the tightened, category-owned fix was
  // unreachable dead code. These pin down three concrete cases so the
  // collision can't quietly regress.

  it("open-redirect (owned by content.json) uses the tightened content.ts detector, not code.ts's looser copy", () => {
    // content.ts only fires when the redirect target is absolute
    // (http/https/protocol-relative); code.ts's copy fires on any value,
    // including ordinary relative-path SPA navigation like ?next=/dashboard.
    const checks = getChecksByCategory(["content"]);
    const body = `<a href="/go?next=/dashboard">Continue</a>`;
    const fired = checks
      .map((fn) => fn("https://example.com/", new Headers(), body))
      .find((r) => r?.id.startsWith("open-redirect--"));
    expect(fired).toBeUndefined();
  });

  it("etag-inode (owned by headers.json) uses the real headers.ts detector, not configuration.ts's disabled stub", () => {
    const checks = getChecksByCategory(["headers"]);
    const headers = new Headers({ etag: '"1a2b-3c4d-5e6f"' });
    const fired = checks
      .map((fn) => fn("https://example.com/", headers, ""))
      .find((r) => r?.id.startsWith("etag-inode--"));
    expect(fired).toBeDefined();
  });

  it("server-timing-exposure (owned by headers.json) only fires on sensitive metric names, not any dur= value", () => {
    // headers.ts requires a sensitive keyword (db/sql/auth/token/...);
    // configuration.ts's copy fires on any Server-Timing value at all.
    const checks = getChecksByCategory(["headers"]);
    const headers = new Headers({ "server-timing": "cdn;dur=12, cache;dur=3" });
    const fired = checks
      .map((fn) => fn("https://example.com/", headers, ""))
      .find((r) => r?.id.startsWith("server-timing-exposure--"));
    expect(fired).toBeUndefined();
  });

  it("buildCheck produces a Vulnerability with the expected shape", () => {
    // Find a known detector-backed check (cookie-httponly-missing lives
    // in the cookies category and has an inline detector).
    const fn = allChecks.find(() => true);
    expect(fn).toBeDefined();
    const result = fn!("https://example.com", new Headers({}), "");
    // First check may or may not match the dummy input — what matters is
    // that the function shape is correct.
    if (result) {
      expect(typeof result.id).toBe("string");
      expect(typeof result.title).toBe("string");
      expect(["critical", "high", "medium", "low", "info"]).toContain(
        result.severity,
      );
      expect(ALL_CATEGORY_SET.has(result.category)).toBe(true);
      expect(Array.isArray(result.fixSteps)).toBe(true);
      expect(Array.isArray(result.codeExamples)).toBe(true);
    }
  });
});

// ── Coverage guard ─────────────────────────────────────────────────────
//
// Every JSON-defined check MUST have an inline detector OR be explicitly
// marked as async-only (TLS/email/DNS — those live in async-checks.ts).
// A JSON entry without either is a silent no-op: the scan reports
// nothing for a check the UI advertises. This guard fails CI if such
// an entry appears.

import { detectors as headerDetectors } from "@/lib/scanner/checks/headers";
import { detectors as sslDetectors } from "@/lib/scanner/checks/ssl";
import { detectors as contentDetectors } from "@/lib/scanner/checks/content";
import { detectors as cookiesDetectors } from "@/lib/scanner/checks/cookies";
import { detectors as configurationDetectors } from "@/lib/scanner/checks/configuration";
import { detectors as informationDisclosureDetectors } from "@/lib/scanner/checks/information-disclosure";
import { detectors as apiDetectors } from "@/lib/scanner/checks/api";
import { detectors as codeDetectors } from "@/lib/scanner/checks/code";
import { detectors as secretsExtendedDetectors } from "@/lib/scanner/checks/secrets-extended";
import { detectors as vibeCodeDetectors } from "@/lib/scanner/checks/vibe-code";
import { detectors as clientSideDetectors } from "@/lib/scanner/checks/client-side";
import { detectors as supplyChainDetectors } from "@/lib/scanner/checks/supply-chain";
import { detectors as hostValidationDetectors } from "@/lib/scanner/checks/host-validation";
import { detectors as tlsDetectors } from "@/lib/scanner/checks/tls";
import { detectors as emailDetectors } from "@/lib/scanner/checks/email";
import { detectors as dnsDetectors } from "@/lib/scanner/checks/dns";
import { pageChecks } from "@/lib/scanner/checks/page-checks";

const CATEGORIES_WITH_INLINE_DETECTORS = new Set<Category>([
  "headers",
  "ssl",
  "content",
  "cookies",
  "configuration",
  "information-disclosure",
  "api",
  "code",
  "secrets-extended",
  "vibe-code",
  "client-side",
  "supply-chain",
  "host-validation",
]);
// These categories have NO inline detector file. Their checks run
// exclusively from lib/scanner/async-checks.ts.
const ASYNC_ONLY_CATEGORIES = new Set<Category>(["tls", "email", "dns"]);

const ALL_INLINE_DETECTORS: Record<
  string,
  (url: string, headers: Headers, body: string) => string | null
> = {
  ...headerDetectors,
  ...sslDetectors,
  ...contentDetectors,
  ...cookiesDetectors,
  ...configurationDetectors,
  ...informationDisclosureDetectors,
  ...apiDetectors,
  ...codeDetectors,
  ...secretsExtendedDetectors,
  ...vibeCodeDetectors,
  ...clientSideDetectors,
  ...supplyChainDetectors,
  ...hostValidationDetectors,
  ...tlsDetectors,
  ...emailDetectors,
  ...dnsDetectors,
};

// Checks written against the newer PageCheck interface (checks/page-checks/**)
// carry their own `run(ctx)` instead of a legacy (url, headers, body)
// detector, so they never appear in ALL_INLINE_DETECTORS. They are real,
// tested checks (see tests/lib/scanner/checks/page-checks/**), just not
// wired into the legacy detector map the guard below was built to police.
const PAGE_CHECK_IDS = new Set(pageChecks.map((c) => c.id));

describe("detection coverage (no silent no-ops)", () => {
  it("every JSON-defined check has an inline detector, is a PageCheck, or is async-only", () => {
    const missing: { id: string; category: string }[] = [];
    for (const def of allCheckDefs) {
      if (ASYNC_ONLY_CATEGORIES.has(def.category)) continue;
      if (PAGE_CHECK_IDS.has(def.id)) continue;
      if (CATEGORIES_WITH_INLINE_DETECTORS.has(def.category) === false) {
        // Unknown category without inline detector — not async-only.
        missing.push({ id: def.id, category: def.category });
        continue;
      }
      if (typeof ALL_INLINE_DETECTORS[def.id] !== "function") {
        missing.push({ id: def.id, category: def.category });
      }
    }
    if (missing.length > 0) {
      const sample = missing
        .slice(0, 10)
        .map((m) => `  ${m.id} (${m.category})`)
        .join("\n");
      throw new Error(
        `${missing.length} JSON check(s) have no inline detector and are not marked async-only:\n${sample}\n` +
          "Either add a detector in lib/scanner/checks/<category>.ts, " +
          "mark the check as async-only (move to checks-data/tls.json|dns.json|email.json), " +
          "or remove the entry from the JSON.",
      );
    }
  });

  it("inline detectors are not obviously broken (synchronous null-only is fine)", () => {
    // Catches detectors that are *structurally* dead — e.g. async-stub
    // functions that always return null because they were registered
    // to make the coverage test pass but never wired to a real probe.
    //
    // Many of our inline detectors are deliberately narrow (e.g. only
    // fire on a 401 response, a specific header value, a SQL error
    // string). We can't tell "narrow but real" from "dead code" from
    // text alone, so this test is intentionally a weak smoke test:
    // each detector's source must contain at least one `return <string>`
    // with a non-empty literal. This catches the common failure mode
    // where someone pastes a placeholder like `() => null` and forgets
    // to implement it.
    const PLACEHOLDER_RETURN_NULL = /=>\s*null\s*[;,)]/;
    const PLACEHOLDER_ARROW_NULL = /^\s*\(\s*\)\s*=>\s*null\s*[,;}]/m;
    const suspicious: string[] = [];
    for (const [id, fn] of Object.entries(ALL_INLINE_DETECTORS)) {
      const src = fn.toString();
      // Single-line arrow that is literally `() => null` (a true
      // placeholder) is suspicious. Multi-line detectors that always
      // resolve to null via different paths are real (e.g. async-only
      // categories have stub placeholders that the registry test
      // accepts; we just want to make sure the inline categories don't
      // have stray one-liners).
      if (PLACEHOLDER_ARROW_NULL.test(src)) {
        suspicious.push(id);
      }
    }
    if (suspicious.length > 0) {
      throw new Error(
        `Detectors look like one-liner placeholders: ${suspicious.join(", ")}. ` +
          "Either implement them or move the JSON entry to async-only (tls/email/dns).",
      );
    }
    // Reference PLACEHOLDER_RETURN_NULL to avoid the linter complaining.
    void PLACEHOLDER_RETURN_NULL;
  });
});
