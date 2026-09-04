/**
 * The regression this file exists for: every `async-*` row on the admin
 * Engine Feedback panel rendered "Category: Unknown, Severity: Unknown".
 *
 * The async layer derives its finding ids from the finding title
 * (`async-<slug>--<hash>`), so those ids are in no registry and
 * getCheckDef() returned undefined for all ~25 of them. The catalog is
 * now the definition those findings are built from, so the id round-trips
 * back to a real category and severity. If that ever stops being true,
 * this suite fails before the panel starts lying again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// check-accuracy.ts (imported below for extractCheckId) opens the pool at
// module load, which throws without DATABASE_URL.
vi.mock("@/lib/database/db", () => ({ default: { query: vi.fn() } }));

import {
  ASYNC_CHECKS,
  asyncCheckId,
  asyncCheckVariant,
  getAsyncCheckDef,
} from "@/lib/scanner/async-check-catalog";
import { extractCheckId } from "@/lib/scanner/check-accuracy";
import { ALL_CATEGORIES } from "@/lib/scanner/types";

const SEVERITIES = ["critical", "high", "medium", "low", "info"];

// checkSPF's only network dependency. Mocked here rather than at
// dns/promises so this suite doesn't need async-checks.test.ts's whole
// tls/http mock apparatus just to build one real finding.
const mockResolveTxt = vi.fn();
vi.mock("@/lib/scanner/dns-memo", () => ({
  withDnsMemo: (fn: () => unknown) => fn(),
  resolveTxtOnce: (...args: unknown[]) => mockResolveTxt(...args),
  resolveMxOnce: vi.fn(),
  resolveNsOnce: vi.fn(),
  resolveSoaOnce: vi.fn(),
  resolveCnameOnce: vi.fn(),
  resolveCaaOnce: vi.fn(),
}));

const { checkSPF } = await import("@/lib/scanner/async-checks");

beforeEach(() => {
  mockResolveTxt.mockReset();
});

describe("async check catalog", () => {
  it("resolves a real finding id produced by a real async check", async () => {
    // No v=spf1 record at all -> "Missing SPF Record".
    mockResolveTxt.mockResolvedValue([["v=nonsense"]]);
    const findings = await checkSPF("example.com", "https://example.com/");
    expect(findings).toHaveLength(1);

    const def = getAsyncCheckDef(extractCheckId(findings[0].id));
    expect(def).toBeDefined();
    expect(def?.category).toBe("configuration");
    expect(def?.severity).toBe("medium");
    // The finding and the catalog must agree, or the panel would show one
    // severity while the report shows another.
    expect(def?.category).toBe(findings[0].category);
    expect(def?.severity).toBe(findings[0].severity);
  });

  it("keeps the id format that is already stored in scan_finding_feedback", () => {
    // `async-` + the title lowercased with non-alphanumerics collapsed to
    // dashes. Changing this orphans every feedback row already submitted.
    expect(asyncCheckId("Missing SPF Record")).toBe("async-missing-spf-record");
    expect(asyncCheckId("DMARC pct= Below 100")).toBe(
      "async-dmarc-pct-below-100",
    );
    expect(ASYNC_CHECKS.missingSpfRecord.checkId).toBe(
      "async-missing-spf-record",
    );
  });

  it("gives every catalog entry a real category and severity", () => {
    const entries = Object.values(ASYNC_CHECKS);
    expect(entries.length).toBeGreaterThan(50);
    for (const def of entries) {
      expect(SEVERITIES).toContain(def.severity);
      // active-probes is deliberately not in ALL_CATEGORIES, and no async
      // check emits into it.
      expect(ALL_CATEGORIES).toContain(def.category);
      expect(def.checkId).toBe(asyncCheckId(def.title));
    }
  });

  it("registers every entry under the id extractCheckId recovers", () => {
    for (const def of Object.values(ASYNC_CHECKS)) {
      const findingId = `${def.checkId}--z9x8`;
      expect(getAsyncCheckDef(extractCheckId(findingId))).toBe(def);
    }
  });

  it("returns undefined for an id that is not an async check", () => {
    expect(getAsyncCheckDef("hsts-missing")).toBeUndefined();
    expect(getAsyncCheckDef("async-not-a-real-check")).toBeUndefined();
  });

  it("keeps a variant's id, so a per-finding override still aggregates", () => {
    const base = ASYNC_CHECKS.expiredTlsCertificate;
    const asTls = asyncCheckVariant(base, { category: "tls" });
    expect(asTls.checkId).toBe(base.checkId);
    expect(asTls.category).toBe("tls");
    // The catalog keeps the canonical entry, not the one-off copy.
    expect(getAsyncCheckDef(base.checkId)?.category).toBe("ssl");
  });
});
