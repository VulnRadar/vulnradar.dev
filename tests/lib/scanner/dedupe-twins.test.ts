import { describe, it, expect } from "vitest";
import {
  dedupeFindings,
  checkIdOf,
  LEGACY_DEDUPE_GROUPS,
} from "@/lib/scanner/dedupe";
import type { Vulnerability } from "@/lib/scanner/types";
import { allCheckDefs } from "@/lib/scanner/registry";
import { pageCheckGroups } from "@/lib/scanner/checks/page-checks";
import { ASYNC_CHECKS } from "@/lib/scanner/async-check-catalog";

function finding(
  checkId: string,
  overrides: Partial<Vulnerability> = {},
): Vulnerability {
  return {
    id: `${checkId}--abc123`,
    title: checkId,
    severity: "low",
    category: "headers",
    description: "d",
    evidence: "e",
    riskImpact: "r",
    explanation: "x",
    fixSteps: ["s"],
    codeExamples: [],
    confidence: 70,
    ...overrides,
  };
}

/** Collapse a set of check ids the way a scan does, with both group tables. */
function collapse(ids: string[], overrides: Partial<Vulnerability> = {}) {
  return dedupeFindings(
    ids.map((id) => finding(id, overrides)),
    pageCheckGroups,
  );
}

describe("twin checks that report one fact are collapsed", () => {
  it("reports one disclosed server header once, whichever checks saw it", () => {
    const ids = [
      "server-header-disclosure",
      "server-version-detailed",
      "server-info",
      "version-disclosure",
      "x-powered-by-exposed",
      "x-aspnet-version-exposed",
    ];
    const { findings, merged } = collapse(ids);
    expect(findings).toHaveLength(1);
    expect(merged).toBe(ids.length - 1);
    expect(findings[0].alsoReportedBy).toHaveLength(ids.length - 1);
  });

  it("does not fold the headers that disclose something else into it", () => {
    const { findings } = collapse([
      "server-header-disclosure",
      "via-header-exposed",
      "x-runtime-exposed",
    ]);
    expect(findings).toHaveLength(3);
  });

  it("reports a framework's default session cookie name once", () => {
    for (const twin of [
      "php-version-exposed-in-cookie",
      "rails-version-exposure",
    ]) {
      const { findings, merged } = collapse(["cookie-name-disclosure", twin]);
      expect(merged).toBe(1);
      expect(findings).toHaveLength(1);
    }
  });

  it("collapses a third-party iframe without sandbox from both detectors", () => {
    const { findings, merged } = collapse([
      "iframe-third-party-without-sandbox",
      "page-third-party-iframe-no-sandbox",
    ]);
    expect(merged).toBe(1);
    expect(findings).toHaveLength(1);
  });

  it("collapses the code- cookie checks into the cookie attribute they restate", () => {
    const pairs: [string, string][] = [
      ["code-cookie-without-httponly", "page-cookie-missing-httponly"],
      ["code-cookie-missing-secure-http", "page-cookie-missing-secure"],
      ["code-cookie-write-no-samesite", "page-cookie-missing-samesite"],
    ];
    for (const [code, page] of pairs) {
      const { findings, merged } = collapse([code, page]);
      expect({ pair: code, merged, count: findings.length }).toEqual({
        pair: code,
        merged: 1,
        count: 1,
      });
    }
  });

  it("keeps the three cookie attributes as three findings", () => {
    const { findings } = collapse([
      "code-cookie-without-httponly",
      "code-cookie-missing-secure-http",
      "code-cookie-write-no-samesite",
    ]);
    expect(findings).toHaveLength(3);
  });

  it("collapses the Allow-header and probe TRACE findings, keeping the confirmed one", () => {
    const { findings, merged } = dedupeFindings(
      [
        finding("trace-method-enabled", { severity: "low", confidence: 95 }),
        finding("async-http-trace-advertised-in-allow-header", {
          severity: "low",
        }),
        finding("async-http-trace-method-enabled", {
          severity: "low",
          confidence: 10,
        }),
      ],
      pageCheckGroups,
    );
    expect(merged).toBe(2);
    // Confirmed beats advertised whatever the two severities and confidences
    // say, the way the live GraphQL query beats the keyword matches.
    expect(checkIdOf(findings[0])).toBe("async-http-trace-method-enabled");
    expect(findings[0].alsoReportedBy).toEqual([
      "async-http-trace-advertised-in-allow-header",
      "trace-method-enabled",
    ]);
  });

  it("collapses a redirect-shaped parameter reported by the legacy and parsed checks", () => {
    const { findings, merged } = collapse([
      "open-redirect",
      "page-open-redirect-param-shape",
    ]);
    expect(merged).toBe(1);
    expect(findings).toHaveLength(1);
  });

  it("collapses a password field's autocomplete reported by both checks", () => {
    const { findings, merged } = collapse([
      "autocomplete-sensitive",
      "page-password-field-autocomplete-wrong",
    ]);
    expect(merged).toBe(1);
    expect(findings).toHaveLength(1);
  });

  it("does not fold the username autocomplete into the password one", () => {
    const { findings } = collapse([
      "autocomplete-sensitive",
      "autocomplete-username",
    ]);
    expect(findings).toHaveLength(2);
  });

  it("collapses the two inline-handler injection detectors", () => {
    const { findings, merged } = collapse([
      "html-injection-patterns",
      "dangerous-html-attrs",
    ]);
    expect(merged).toBe(1);
    expect(findings).toHaveLength(1);
  });
});

describe("script and stylesheet SRI", () => {
  it("collapses the stylesheet twins into one finding", () => {
    const { findings, merged } = collapse([
      "sri-stylesheet-missing",
      "page-stylesheet-missing-sri",
    ]);
    expect(merged).toBe(1);
    expect(findings).toHaveLength(1);
  });

  it("collapses the script detectors into one finding", () => {
    const { findings } = collapse([
      "sri-missing",
      "third-party-script-no-sri",
      "supply-chain-sri-external-script",
      "page-script-missing-sri",
    ]);
    expect(findings).toHaveLength(1);
  });

  it("keeps an unprotected script and an unprotected stylesheet as two findings", () => {
    const { findings, merged } = collapse([
      "sri-missing",
      "page-script-missing-sri",
      "sri-stylesheet-missing",
      "page-stylesheet-missing-sri",
    ]);
    expect(merged).toBe(2);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => checkIdOf(f)).sort()).toEqual([
      "page-script-missing-sri",
      "page-stylesheet-missing-sri",
    ]);
  });
});

/**
 * The survivor of a group is the highest severity, so the least reliable
 * member of a group used to set the severity of what the user saw: a regex
 * heuristic rated high survived a parsed-DOM check rated medium for the same
 * fact. A group whose members disagree on severity is a calibration bug in
 * one of them, and the fix is to calibrate it, not to let the survivor rule
 * paper over it.
 *
 * This is a ratchet. The groups below disagreed when the guard was written
 * and each says why; a new group, or a new member that disagrees with its
 * group, fails here until it is calibrated or added to the list with a
 * reason. An entry that no longer disagrees is harmless and can be removed.
 */
const MIXED_SEVERITY_ALLOWED: Record<string, string> = {
  // Credentials and tokens: how bad the finding is depends on what was found.
  "secret-aws-key": "an access key id alone is rated below a secret key",
  "client-storage-sensitive":
    "rated by what is stored, from tokens to passwords",

  // Confirmed against a live source outranks inferred from the page, by
  // design (CONFIRMING_CHECKS in lib/scanner/dedupe.ts).
  "graphql-introspection": "the live query is confirmed, the keywords infer",
  "symfony-profiler": "the profiler probe is confirmed, the header infers",
  "trace-method":
    "the TRACE request echoed back is confirmed, the Allow header infers",

  // Legacy wording rated differently from its PageCheck twin. Each is a
  // severity to calibrate in the check that owns it, not a reason to split
  // the group.
  "sri-missing": "legacy third-party wording rated medium, PageCheck low",
  "document-write-sink": "four legacy detectors rated low to critical",
  "eval-usage": "four legacy detectors rated medium to critical",
  "postmessage-wildcard": "legacy rated high, the others medium",
  "source-map-exposed": "legacy rated low, the other medium",
  "referrer-policy-weak": "one rated medium, the other low",
  "mixed-content": "passive mixed content is rated below active",
  "form-missing-csrf": "legacy vibe check rated high, the parsed check medium",
  "form-over-http": "legacy rated high and critical, the parsed check critical",
  "cookie-missing-secure": "legacy low, the parsed and code twins medium",
  "cookie-missing-httponly": "the generic twins medium, the parsed one high",
  "cookie-missing-samesite": "the parsed twin low, the legacy ones medium",
  "cookie-prefix-violation":
    "attribute mismatch rated below the other prefix rules",
  "csp-http-sources": "legacy medium, the parsed check high",
  "open-redirect-param":
    "legacy medium for the shape the parsed check rates low",
};

describe("dedupe groups agree on severity", () => {
  it("no group mixes severities unless it is listed with a reason", () => {
    const severityOf = new Map<string, string>();
    for (const def of allCheckDefs) severityOf.set(def.id, def.severity);
    for (const def of Object.values(ASYNC_CHECKS)) {
      severityOf.set(def.checkId, def.severity);
    }

    const bySeverity = new Map<string, Set<string>>();
    for (const [id, group] of Object.entries({
      ...LEGACY_DEDUPE_GROUPS,
      ...pageCheckGroups,
    })) {
      const severity = severityOf.get(id);
      if (!severity) continue;
      if (!bySeverity.has(group)) bySeverity.set(group, new Set());
      bySeverity.get(group)!.add(severity);
    }

    const mixed = [...bySeverity]
      .filter(
        ([group, set]) => set.size > 1 && !(group in MIXED_SEVERITY_ALLOWED),
      )
      .map(([group, set]) => `${group}: ${[...set].sort().join(", ")}`);
    expect(mixed).toEqual([]);
  });

  it("every allowlisted group still exists", () => {
    const groups = new Set(
      Object.values({ ...LEGACY_DEDUPE_GROUPS, ...pageCheckGroups }),
    );
    const gone = Object.keys(MIXED_SEVERITY_ALLOWED).filter(
      (g) => !groups.has(g),
    );
    expect(gone).toEqual([]);
  });
});
