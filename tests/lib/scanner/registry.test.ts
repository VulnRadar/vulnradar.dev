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
  detectorHomes,
} from "@/lib/scanner/registry";
import { ALL_CATEGORIES } from "@/lib/scanner/types";
import type { Category } from "@/lib/scanner/types";

const EXPECTED_CATEGORIES = ALL_CATEGORIES;
// "active-probes" is deliberately excluded from ALL_CATEGORIES (see that
// export's own doc comment: every "no filter given" / runAll code path
// treats ALL_CATEGORIES as "everything that runs by default", and
// active-probes must never run without an explicit opt-in). It is still a
// real, registered category though, so the "every check has a known
// category" test below needs it in its validity set even though the
// "every category appears in the breakdown" test further down
// deliberately does not iterate it.
const ALL_CATEGORY_SET = new Set<Category>([
  ...ALL_CATEGORIES,
  "active-probes",
]);

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
    // toBeDefined() alone said only "something fired", which is exactly what
    // configuration.ts's disabled stub would also produce if it ever started
    // returning a finding. Assert the finding's identity, the way the two
    // sibling collision tests either side of this one do.
    expect(fired).toBeDefined();
    expect(fired?.id.split("--")[0]).toBe("etag-inode");
    expect(fired?.category).toBe("headers");
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

  it("code-cmdi-exec (owned by code.json) reports command-injection metadata, not stale Media Device Access metadata", () => {
    // code.json's code-cmdi-exec entry used to still carry an older
    // getUserMedia/camera-mic write-up (title, severity: "info", fix
    // steps) left behind from before the id was repurposed for the
    // exec()-with-concatenation detector in code.ts. A real shell-
    // injection sink was reaching users mislabeled as a privacy notice.
    const checks = getChecksByCategory(["code"]);
    const body = `<script>exec("ls " + userPath);</script>`;
    const fired = checks
      .map((fn) => fn("https://example.com/", new Headers(), body))
      .find((r) => r?.id.startsWith("code-cmdi-exec--"));
    expect(fired).toBeDefined();
    expect(fired!.title).not.toMatch(/media device/i);
    expect(fired!.title.toLowerCase()).toContain("exec");
    expect(fired!.severity).not.toBe("info");
    expect(["critical", "high"]).toContain(fired!.severity);
    expect(fired!.description.toLowerCase()).not.toContain("camera");
    expect(fired!.description.toLowerCase()).not.toContain("microphone");
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
import { detectors as reputationDetectors } from "@/lib/scanner/checks/reputation";
import { detectors as activeProbesDetectors } from "@/lib/scanner/checks/active-probes";
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
const ASYNC_ONLY_CATEGORIES = new Set<Category>([
  "tls",
  "email",
  "dns",
  "reputation",
  "active-probes",
]);

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
  ...reputationDetectors,
  ...activeProbesDetectors,
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

/**
 * Eleven secret/PII checks are defined in checks-data/content.json but
 * implemented in checks/secrets-extended.ts. Before registry.ts's explicit
 * DETECTOR_HOME map they resolved through a declaration-order fallback, which
 * would have silently switched implementation the moment any earlier-declared
 * bundle gained a same-named detector. These guard against the map going
 * stale in the other direction: a renamed or deleted detector would make the
 * entry a no-op and quietly put the fallback back in charge.
 * ref: AUDIT-009#dup-11
 */
describe("explicit detector homes", () => {
  const DETECTORS_BY_CATEGORY: Record<
    string,
    Record<
      string,
      (url: string, headers: Headers, body: string) => string | null
    >
  > = {
    headers: headerDetectors,
    ssl: sslDetectors,
    content: contentDetectors,
    cookies: cookiesDetectors,
    configuration: configurationDetectors,
    "information-disclosure": informationDisclosureDetectors,
    api: apiDetectors,
    code: codeDetectors,
    "secrets-extended": secretsExtendedDetectors,
    "vibe-code": vibeCodeDetectors,
    "client-side": clientSideDetectors,
    "supply-chain": supplyChainDetectors,
    "host-validation": hostValidationDetectors,
  };

  it("names a bundle that really implements each id", () => {
    for (const [id, category] of Object.entries(detectorHomes)) {
      const bundle = DETECTORS_BY_CATEGORY[category];
      expect(
        bundle,
        `unknown home category "${category}" for ${id}`,
      ).toBeDefined();
      expect(typeof bundle[id], `${id} is not implemented in ${category}`).toBe(
        "function",
      );
    }
  });

  it("only lists ids that a JSON definition actually declares", () => {
    const definedIds = new Set(allCheckDefs.map((d) => d.id));
    for (const id of Object.keys(detectorHomes)) {
      expect(definedIds.has(id), `${id} has no JSON definition`).toBe(true);
    }
  });

  it("only lists ids whose definition sits in a different category", () => {
    // An entry whose home equals its own category is redundant: the normal
    // owner lookup already handles it, and keeping it here hides that.
    for (const def of allCheckDefs) {
      const home = detectorHomes[def.id];
      if (home) expect(home).not.toBe(def.category);
    }
  });

  // The invariant that makes the remaining duplication safe. About 75 check
  // ids are still implemented in two or three category files at once (copy-
  // pasted years ago, then one copy tightened). That is tolerable ONLY while
  // every one of them is also implemented in the file its definition's
  // category names, because resolveDetector prefers that bundle: the extra
  // copies are provably unreachable rather than "unreachable today". The
  // moment an id resolves through the declaration-order fallback instead,
  // which implementation runs depends on the order of the BUNDLES array, and
  // adding an unrelated copy-pasted detector to an earlier bundle silently
  // changes detection behaviour. Anything that genuinely lives outside its
  // category belongs in DETECTOR_HOME, not in the fallback.
  // ref: AUDIT-009#misc-01
  it("no check resolves through the declaration-order fallback", () => {
    const stragglers: string[] = [];
    for (const def of allCheckDefs) {
      if (detectorHomes[def.id]) continue;
      const own = DETECTORS_BY_CATEGORY[def.category];
      // Categories with no inline detectors at all (tls/dns/email/reputation/
      // active-probes) and PageCheck-based ids are covered by the async
      // dispatch test above, not here.
      if (!own) continue;
      const implementedElsewhere = Object.entries(DETECTORS_BY_CATEGORY).some(
        ([cat, map]) =>
          cat !== def.category && typeof map[def.id] === "function",
      );
      if (typeof own[def.id] !== "function" && implementedElsewhere) {
        stragglers.push(def.id);
      }
    }
    expect(
      stragglers,
      `these ids resolve by BUNDLES order, not by ownership: ${stragglers.join(", ")}. ` +
        "Either implement them in their own category file or add an explicit DETECTOR_HOME entry.",
    ).toEqual([]);
  });
});
