/**
 * Tests for lib/tags/auto-tags.ts: the deterministic category/CWE/severity
 * -> tag rules (computeAutoTags) and their persistence (saveAutoTags), plus
 * the layered auto-tag design's other two pieces added alongside the ~50
 * rule taxonomy expansion:
 *   - loadPromotedRules/invalidatePromotedRulesCache: admin-promoted rules
 *     from `promoted_auto_tag_rules`, merged into computeAutoTags via its
 *     `extraRules` parameter.
 *   - maybeSuggestAiTag: the fire-and-forget AI follow-up saveAutoTags'
 *     callers invoke with the tags saveAutoTags just computed, which only
 *     ever does anything when those tags are exactly ["Needs Hardening"].
 *
 * Mocks only the database pool (the boundary saveAutoTags/loadPromotedRules
 * actually cross) and lib/ai/auto-tag-suggest.ts (maybeSuggestAiTag's own
 * dynamic import, so this file doesn't need to exercise a real AI call --
 * that module has its own dedicated test suite). computeAutoTags itself is
 * pure and exercised directly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Category, Severity, Vulnerability } from "@/lib/scanner/types";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGenerateAutoTagSuggestions = vi.fn();
vi.mock("@/lib/ai/auto-tag-suggest", () => ({
  generateAutoTagSuggestions: (...args: unknown[]) =>
    mockGenerateAutoTagSuggestions(...args),
}));

const {
  computeAutoTags,
  saveAutoTags,
  maybeSuggestAiTag,
  invalidatePromotedRulesCache,
} = await import("@/lib/tags/auto-tags");

/** Empty promoted-rules result -- the default shape loadPromotedRules' SELECT resolves to unless a test overrides it. */
const NO_PROMOTED_RULES = { rows: [], rowCount: 0 };

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue(NO_PROMOTED_RULES);
  mockGenerateAutoTagSuggestions.mockReset();
  mockGenerateAutoTagSuggestions.mockResolvedValue([]);
  invalidatePromotedRulesCache();
});

/** Minimal, fully-formed Vulnerability with sensible defaults, overridable per test. */
function mkFinding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "finding-1",
    title: "Test finding",
    severity: "medium",
    category: "headers",
    description: "desc",
    evidence: "evidence",
    riskImpact: "risk",
    explanation: "explanation",
    fixSteps: [],
    codeExamples: [],
    ...overrides,
  };
}

function withCwe(
  cwe: string,
  severity: Severity,
  category: Category = "headers",
) {
  return mkFinding({ cwe, severity, category });
}

/** One severity rank below `s`, for "does not fire below threshold" checks. medium -> low, high -> medium. */
function oneBelow(s: Severity): Severity {
  return s === "high" ? "medium" : "low";
}

describe("computeAutoTags: holistic tags", () => {
  it("tags an empty findings array as Clean and nothing else", () => {
    expect(computeAutoTags([])).toEqual(["Clean"]);
  });

  it("never returns Clean when there is at least one finding", () => {
    const tags = computeAutoTags([mkFinding()]);
    expect(tags).not.toContain("Clean");
  });

  it("falls back to Needs Hardening for findings that match no rule and aren't critical", () => {
    // A medium-severity finding with no cwe and a category no rule covers.
    const tags = computeAutoTags([
      mkFinding({ severity: "medium", category: "dns", cwe: undefined }),
    ]);
    expect(tags).toEqual(["Needs Hardening"]);
  });

  it("tags Clean instead of Needs Hardening when every unmatched finding is info-severity", () => {
    const tags = computeAutoTags([
      mkFinding({ severity: "info", category: "dns", cwe: undefined }),
      mkFinding({ severity: "info", category: "tls", cwe: undefined }),
    ]);
    expect(tags).toEqual(["Clean"]);
  });

  it("still falls back to Needs Hardening when info findings are mixed with a non-info unmatched finding", () => {
    const tags = computeAutoTags([
      mkFinding({ severity: "info", category: "dns", cwe: undefined }),
      mkFinding({ severity: "low", category: "dns", cwe: undefined }),
    ]);
    expect(tags).toEqual(["Needs Hardening"]);
  });

  it("never falls back to Needs Hardening once any specific rule matches", () => {
    const tags = computeAutoTags([
      withCwe("CWE-798", "critical", "secrets-extended"),
    ]);
    expect(tags).not.toContain("Needs Hardening");
  });

  it("tags Critical Exposure whenever any finding is critical severity, regardless of category", () => {
    const tags = computeAutoTags([
      mkFinding({ severity: "critical", category: "dns" }),
    ]);
    expect(tags).toContain("Critical Exposure");
  });

  it("does not tag Critical Exposure when nothing is critical severity", () => {
    const tags = computeAutoTags([mkFinding({ severity: "high" })]);
    expect(tags).not.toContain("Critical Exposure");
  });

  it("does not fall back to Needs Hardening for an unmatched critical finding -- Critical Exposure alone already covers it", () => {
    // A critical finding with no cwe/category any rule covers: Critical
    // Exposure already makes tags non-empty, so the "at least one finding,
    // nothing else matched" fallback never fires for it.
    const tags = computeAutoTags([
      mkFinding({ severity: "critical", category: "dns", cwe: undefined }),
    ]);
    expect(tags).toEqual(["Critical Exposure"]);
  });
});

describe("computeAutoTags: single-CWE rules (minSeverity threshold both sides)", () => {
  // Every rule below is a plain `cwes: [CWE]`, no `categories`, matched
  // regardless of the finding's own category (see findingQualifies) --
  // withCwe's default "headers" category is irrelevant to any of these.
  const SIMPLE_CWE_RULES: {
    cwe: string;
    tag: string;
    minSeverity: Severity;
  }[] = [
    { cwe: "CWE-78", tag: "Command Injection Risk", minSeverity: "medium" },
    { cwe: "CWE-90", tag: "LDAP Injection Risk", minSeverity: "high" },
    { cwe: "CWE-89", tag: "SQL Injection Risk", minSeverity: "medium" },
    { cwe: "CWE-94", tag: "Code Injection Risk", minSeverity: "medium" },
    { cwe: "CWE-1336", tag: "Template Injection Risk", minSeverity: "high" },
    { cwe: "CWE-611", tag: "XXE Risk", minSeverity: "medium" },
    { cwe: "CWE-502", tag: "Insecure Deserialization", minSeverity: "high" },
    { cwe: "CWE-22", tag: "Path Traversal Risk", minSeverity: "high" },
    { cwe: "CWE-1392", tag: "Default Credentials", minSeverity: "high" },
    { cwe: "CWE-347", tag: "JWT Signature Bypass", minSeverity: "high" },
    { cwe: "CWE-79", tag: "XSS Risk", minSeverity: "high" },
    { cwe: "CWE-1321", tag: "Prototype Pollution Risk", minSeverity: "medium" },
    { cwe: "CWE-915", tag: "Mass Assignment Risk", minSeverity: "high" },
    { cwe: "CWE-287", tag: "Weak Authentication", minSeverity: "high" },
    { cwe: "CWE-639", tag: "IDOR Risk", minSeverity: "medium" },
    { cwe: "CWE-444", tag: "Request Smuggling Risk", minSeverity: "high" },
    { cwe: "CWE-644", tag: "Host Header Injection", minSeverity: "high" },
    { cwe: "CWE-918", tag: "SSRF Risk", minSeverity: "medium" },
    { cwe: "CWE-942", tag: "Overly Permissive CORS", minSeverity: "medium" },
    { cwe: "CWE-346", tag: "Origin Validation Error", minSeverity: "medium" },
    { cwe: "CWE-1021", tag: "Clickjacking Risk", minSeverity: "medium" },
    { cwe: "CWE-352", tag: "CSRF Risk", minSeverity: "medium" },
    { cwe: "CWE-601", tag: "Open Redirect", minSeverity: "medium" },
    { cwe: "CWE-1022", tag: "Tabnabbing Risk", minSeverity: "medium" },
    { cwe: "CWE-434", tag: "Unrestricted File Upload", minSeverity: "medium" },
    { cwe: "CWE-208", tag: "Timing Attack Risk", minSeverity: "medium" },
    { cwe: "CWE-319", tag: "Cleartext Transmission", minSeverity: "medium" },
    { cwe: "CWE-327", tag: "Weak TLS Cipher Suite", minSeverity: "medium" },
    { cwe: "CWE-326", tag: "Weak Encryption Strength", minSeverity: "medium" },
    { cwe: "CWE-350", tag: "Subdomain Takeover Risk", minSeverity: "high" },
    { cwe: "CWE-489", tag: "Debug Mode Exposed", minSeverity: "medium" },
    {
      cwe: "CWE-614",
      tag: "Cookie Missing Secure Flag",
      minSeverity: "medium",
    },
    { cwe: "CWE-1004", tag: "Cookie Missing HttpOnly", minSeverity: "medium" },
    { cwe: "CWE-1275", tag: "Cookie Missing SameSite", minSeverity: "medium" },
    { cwe: "CWE-548", tag: "Directory Listing Enabled", minSeverity: "high" },
    { cwe: "CWE-598", tag: "Sensitive Data in URL", minSeverity: "medium" },
    { cwe: "CWE-522", tag: "Exposed Auth Tokens", minSeverity: "high" },
    { cwe: "CWE-209", tag: "Verbose Error Messages", minSeverity: "medium" },
    {
      cwe: "CWE-615",
      tag: "Sensitive Comments Exposed",
      minSeverity: "medium",
    },
    { cwe: "CWE-540", tag: "Exposed Source Maps", minSeverity: "medium" },
    {
      cwe: "CWE-353",
      tag: "Missing Subresource Integrity",
      minSeverity: "medium",
    },
    { cwe: "CWE-799", tag: "Missing Rate Limiting", minSeverity: "medium" },
    { cwe: "CWE-521", tag: "Weak Password Policy", minSeverity: "medium" },
  ];

  it.each(SIMPLE_CWE_RULES)(
    "tags $tag from $cwe at $minSeverity+, not below it",
    ({ cwe, tag, minSeverity }) => {
      expect(computeAutoTags([withCwe(cwe, minSeverity)])).toContain(tag);
      expect(
        computeAutoTags([withCwe(cwe, oneBelow(minSeverity))]),
      ).not.toContain(tag);
    },
  );

  it("covers exactly the 43 single-CWE rules the current taxonomy ships (guards against a silent drop)", () => {
    expect(SIMPLE_CWE_RULES).toHaveLength(43);
    // Every tag name is unique -- a duplicate would mean two rules
    // accidentally collapsed onto the same label.
    expect(new Set(SIMPLE_CWE_RULES.map((r) => r.tag)).size).toBe(43);
  });
});

describe("computeAutoTags: multi-signal and category rules", () => {
  it("tags Secrets Exposed from CWE-798, CWE-312, CWE-538, or the secrets-extended category alone", () => {
    for (const cwe of ["CWE-798", "CWE-312", "CWE-538"]) {
      expect(computeAutoTags([withCwe(cwe, "high", "code")])).toContain(
        "Secrets Exposed",
      );
    }
    const tags = computeAutoTags([
      mkFinding({
        category: "secrets-extended",
        severity: "medium",
        cwe: undefined,
      }),
    ]);
    expect(tags).toContain("Secrets Exposed");
  });

  it("does not tag Secrets Exposed below the medium severity threshold", () => {
    expect(
      computeAutoTags([withCwe("CWE-798", "low", "secrets-extended")]),
    ).not.toContain("Secrets Exposed");
  });

  it("tags Broken Access Control from CWE-284, CWE-862, or CWE-602 at high+", () => {
    for (const cwe of ["CWE-284", "CWE-862", "CWE-602"]) {
      expect(computeAutoTags([withCwe(cwe, "high")])).toContain(
        "Broken Access Control",
      );
      expect(computeAutoTags([withCwe(cwe, "medium")])).not.toContain(
        "Broken Access Control",
      );
    }
  });

  it("tags Certificate Validation Issues from CWE-295 or CWE-298 at high+, but never from CWE-299 (info-only, excluded on purpose)", () => {
    expect(computeAutoTags([withCwe("CWE-295", "high", "tls")])).toContain(
      "Certificate Validation Issues",
    );
    expect(computeAutoTags([withCwe("CWE-298", "high", "tls")])).toContain(
      "Certificate Validation Issues",
    );
    expect(
      computeAutoTags([withCwe("CWE-299", "critical", "tls")]),
    ).not.toContain("Certificate Validation Issues");
  });

  it("tags Info Disclosure from CWE-200, CWE-204, or the information-disclosure category alone", () => {
    expect(
      computeAutoTags([withCwe("CWE-200", "medium", "content")]),
    ).toContain("Info Disclosure");
    expect(
      computeAutoTags([withCwe("CWE-204", "medium", "content")]),
    ).toContain("Info Disclosure");
    expect(
      computeAutoTags([
        mkFinding({
          category: "information-disclosure",
          severity: "medium",
          cwe: undefined,
        }),
      ]),
    ).toContain("Info Disclosure");
  });

  it("tags Missing Security Headers only for headers-category CWE-693, not other categories", () => {
    expect(
      computeAutoTags([withCwe("CWE-693", "medium", "headers")]),
    ).toContain("Missing Security Headers");
    expect(
      computeAutoTags([withCwe("CWE-693", "medium", "client-side")]),
    ).not.toContain("Missing Security Headers");
  });

  it("tags Supply Chain Exposure from the supply-chain category or CWE-829 alone", () => {
    expect(
      computeAutoTags([
        mkFinding({
          category: "supply-chain",
          severity: "medium",
          cwe: undefined,
        }),
      ]),
    ).toContain("Supply Chain Exposure");
    expect(computeAutoTags([withCwe("CWE-829", "high", "content")])).toContain(
      "Supply Chain Exposure",
    );
  });

  it("tags Email Spoofing Risk and Vibe-Code Smells purely by category", () => {
    expect(
      computeAutoTags([
        mkFinding({ category: "email", severity: "high", cwe: undefined }),
      ]),
    ).toContain("Email Spoofing Risk");
    expect(
      computeAutoTags([
        mkFinding({
          category: "vibe-code",
          severity: "medium",
          cwe: undefined,
        }),
      ]),
    ).toContain("Vibe-Code Smells");
  });

  it("does not tag Email Spoofing Risk below high severity", () => {
    const tags = computeAutoTags([
      mkFinding({ category: "email", severity: "medium", cwe: undefined }),
    ]);
    expect(tags).not.toContain("Email Spoofing Risk");
  });

  it("combines multiple distinct tags from a mixed findings set", () => {
    const tags = computeAutoTags([
      withCwe("CWE-798", "critical", "secrets-extended"),
      withCwe("CWE-79", "high", "content"),
    ]);
    expect(tags).toEqual(
      expect.arrayContaining([
        "Critical Exposure",
        "Secrets Exposed",
        "XSS Risk",
      ]),
    );
  });

  it("caps the number of auto tags returned even when many rules match", () => {
    const manyFindings = [
      withCwe("CWE-798", "critical", "secrets-extended"),
      withCwe("CWE-79", "high", "content"),
      withCwe("CWE-89", "critical", "code"),
      withCwe("CWE-78", "high", "code"),
      withCwe("CWE-942", "high", "headers"),
      withCwe("CWE-1021", "medium", "headers"),
      withCwe("CWE-352", "medium", "content"),
      withCwe("CWE-918", "high", "code"),
    ];
    const tags = computeAutoTags(manyFindings);
    expect(tags.length).toBeLessThanOrEqual(6);
    // Critical Exposure and the earliest-priority rule matches survive the cut.
    expect(tags[0]).toBe("Critical Exposure");
    expect(tags).toContain("Secrets Exposed");
  });
});

describe("computeAutoTags: extraRules (admin-promoted rules merge)", () => {
  it("matches a finding against an extraRules entry the hardcoded taxonomy doesn't cover", () => {
    const promoted = [
      {
        tag: "Custom Promoted Tag",
        cwes: ["CWE-16"],
        minSeverity: "medium" as Severity,
      },
    ];
    const tags = computeAutoTags(
      [withCwe("CWE-16", "medium", "api")],
      promoted,
    );
    expect(tags).toContain("Custom Promoted Tag");
  });

  it("evaluates hardcoded rules before extraRules (priority order for the MAX_AUTO_TAGS cap)", () => {
    const promoted = [
      { tag: "Extra 1", cwes: ["CWE-16"], minSeverity: "info" as Severity },
    ];
    const tags = computeAutoTags(
      [
        withCwe("CWE-798", "critical", "secrets-extended"),
        withCwe("CWE-16", "info", "api"),
      ],
      promoted,
    );
    expect(tags.indexOf("Secrets Exposed")).toBeLessThan(
      tags.indexOf("Extra 1"),
    );
  });

  it("an empty extraRules array behaves identically to omitting the parameter", () => {
    const finding = withCwe("CWE-798", "critical", "secrets-extended");
    expect(computeAutoTags([finding])).toEqual(computeAutoTags([finding], []));
  });
});

describe("saveAutoTags", () => {
  it("inserts every computed tag with source='auto', scoped to the scan and user, and returns the computed tags", async () => {
    const tags = await saveAutoTags(5, 42, [
      withCwe("CWE-798", "critical", "secrets-extended"),
    ]);

    expect(tags).toEqual(
      expect.arrayContaining(["Critical Exposure", "Secrets Exposed"]),
    );

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_tags"),
    );
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall!;
    expect(sql).toContain("ON CONFLICT (scan_id, tag) DO NOTHING");
    expect(sql).toContain("'auto'");
    // scanId, userId, tag repeated once per computed tag.
    expect(params).toContain(5);
    expect(params).toContain(42);
    expect(params).toContain("Secrets Exposed");
    expect(params).toContain("Critical Exposure");
  });

  it("writes one row per tag for a scan that matches multiple rules", async () => {
    await saveAutoTags(7, 1, [
      withCwe("CWE-798", "critical", "secrets-extended"),
      withCwe("CWE-79", "high", "content"),
    ]);

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_tags"),
    );
    // Critical Exposure + Secrets Exposed + XSS Risk = 3 value tuples.
    expect((insertCall![0].match(/\(\$/g) ?? []).length).toBe(3);
  });

  it("still tags a scan as Needs Hardening when nothing qualifies for a specific rule", async () => {
    const tags = await saveAutoTags(5, 42, [
      mkFinding({ severity: "medium", category: "dns", cwe: undefined }),
    ]);
    expect(tags).toEqual(["Needs Hardening"]);
  });

  it("still tags a zero-finding scan as Clean", async () => {
    const tags = await saveAutoTags(5, 42, []);
    expect(tags).toEqual(["Clean"]);
  });

  it("swallows a query failure instead of throwing, and still returns the computed tags", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT INTO scan_tags")) {
        throw new Error("db down");
      }
      return NO_PROMOTED_RULES;
    });
    await expect(saveAutoTags(5, 42, [])).resolves.toEqual(["Clean"]);
  });

  it("loads promoted rules from promoted_auto_tag_rules and merges them into the computed tags", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM promoted_auto_tag_rules")) {
        return {
          rows: [
            {
              tag: "Promoted Custom Tag",
              cwes: ["CWE-16"],
              categories: null,
              require_both: false,
              min_severity: "medium",
              min_count: 1,
            },
          ],
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const tags = await saveAutoTags(9, 3, [withCwe("CWE-16", "medium", "api")]);
    expect(tags).toContain("Promoted Custom Tag");
  });

  it("maps a promoted rule keyed by category alone (null cwes, null min_count) just as correctly as one keyed by CWE", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM promoted_auto_tag_rules")) {
        return {
          rows: [
            {
              tag: "Category-Only Promoted Tag",
              cwes: null,
              categories: ["dns"],
              require_both: false,
              min_severity: "low",
              min_count: null,
            },
          ],
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const tags = await saveAutoTags(10, 3, [
      mkFinding({ category: "dns", severity: "low", cwe: undefined }),
    ]);
    expect(tags).toContain("Category-Only Promoted Tag");
  });

  it("caches promoted rules across calls within the TTL (only queries promoted_auto_tag_rules once)", async () => {
    await saveAutoTags(1, 1, [mkFinding()]);
    await saveAutoTags(2, 1, [mkFinding()]);

    const promotedRuleCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM promoted_auto_tag_rules"),
    );
    expect(promotedRuleCalls).toHaveLength(1);
  });

  it("invalidatePromotedRulesCache forces the next saveAutoTags call to re-query", async () => {
    await saveAutoTags(1, 1, [mkFinding()]);
    invalidatePromotedRulesCache();
    await saveAutoTags(2, 1, [mkFinding()]);

    const promotedRuleCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM promoted_auto_tag_rules"),
    );
    expect(promotedRuleCalls).toHaveLength(2);
  });

  it("falls back to the hardcoded taxonomy alone (no throw) when the promoted-rules query itself fails", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM promoted_auto_tag_rules")) {
        throw new Error("db down");
      }
      return { rows: [], rowCount: 1 };
    });

    const tags = await saveAutoTags(5, 42, [
      withCwe("CWE-798", "critical", "secrets-extended"),
    ]);
    expect(tags).toContain("Secrets Exposed");
  });
});

describe("maybeSuggestAiTag", () => {
  it("is a no-op when the tags are not exactly ['Needs Hardening']", async () => {
    await maybeSuggestAiTag(5, 42, ["Clean"], []);
    await maybeSuggestAiTag(5, 42, ["Critical Exposure"], [mkFinding()]);
    await maybeSuggestAiTag(
      5,
      42,
      ["Critical Exposure", "Needs Hardening"],
      [mkFinding()],
    );
    expect(mockGenerateAutoTagSuggestions).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("calls generateAutoTagSuggestions and saves the result with source='ai' when tags are exactly ['Needs Hardening']", async () => {
    mockGenerateAutoTagSuggestions.mockResolvedValue([
      "DNS Email Hygiene Gaps",
    ]);
    const findings = [mkFinding({ category: "dns", severity: "low" })];

    await maybeSuggestAiTag(5, 42, ["Needs Hardening"], findings);

    expect(mockGenerateAutoTagSuggestions).toHaveBeenCalledWith(findings, 42);
    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_tags"),
    );
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall!;
    expect(sql).toContain("'ai'");
    expect(params).toEqual([5, 42, "DNS Email Hygiene Gaps"]);
  });

  it("saves up to two AI-suggested tags in one INSERT", async () => {
    mockGenerateAutoTagSuggestions.mockResolvedValue(["Tag One", "Tag Two"]);

    await maybeSuggestAiTag(5, 42, ["Needs Hardening"], [mkFinding()]);

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_tags"),
    );
    expect((insertCall![0].match(/\(\$/g) ?? []).length).toBe(2);
  });

  it("does nothing when generateAutoTagSuggestions returns no suggestions", async () => {
    mockGenerateAutoTagSuggestions.mockResolvedValue([]);
    await maybeSuggestAiTag(5, 42, ["Needs Hardening"], [mkFinding()]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("never throws when generateAutoTagSuggestions itself rejects", async () => {
    mockGenerateAutoTagSuggestions.mockRejectedValue(new Error("AI down"));
    await expect(
      maybeSuggestAiTag(5, 42, ["Needs Hardening"], [mkFinding()]),
    ).resolves.toBeUndefined();
  });

  it("never throws when the INSERT itself fails", async () => {
    mockGenerateAutoTagSuggestions.mockResolvedValue(["Some Tag"]);
    mockQuery.mockRejectedValue(new Error("db down"));
    await expect(
      maybeSuggestAiTag(5, 42, ["Needs Hardening"], [mkFinding()]),
    ).resolves.toBeUndefined();
  });
});
