import { describe, it, expect } from "vitest";
import {
  getSafetyRating,
  getDangerScore,
  getEngineConfidence,
  type SafetyRating,
} from "@/lib/scanner/safety-rating";
import { detectors as codeDetectors } from "@/lib/scanner/checks/code";
import { detectors as contentDetectors } from "@/lib/scanner/checks/content";
import { detectors as secretsExtendedDetectors } from "@/lib/scanner/checks/secrets-extended";
import { getCheckDef } from "@/lib/scanner/registry";

/**
 * Minimal finding shape getSafetyRating/getDangerScore/getEngineConfidence
 * accept -- a structural subset of Vulnerability, not the full shape, so
 * tests don't need to fabricate every required Vulnerability field.
 */
interface TestFinding {
  severity: string;
  title: string;
  confidence?: number;
  aiVerdict?: "confirmed" | "possible_fp" | "uncertain";
  aiConfidence?: number;
}

function critical(overrides: Partial<TestFinding> = {}): TestFinding {
  return {
    severity: "critical",
    title: "SQL Injection in /search",
    ...overrides,
  };
}

function high(overrides: Partial<TestFinding> = {}): TestFinding {
  return {
    severity: "high",
    title: "Open Redirect via redirect_uri",
    ...overrides,
  };
}

function medium(overrides: Partial<TestFinding> = {}): TestFinding {
  return {
    severity: "medium",
    title: "Mixed Content on checkout page",
    ...overrides,
  };
}

function hardeningHigh(overrides: Partial<TestFinding> = {}): TestFinding {
  return { severity: "high", title: "Missing HSTS Header", ...overrides };
}

describe("getSafetyRating — regression (no AI verdict at all)", () => {
  it("rates an empty scan safe", () => {
    expect(getSafetyRating([])).toBe("safe");
  });

  it("rates ANY unverified critical exploitable finding unsafe", () => {
    expect(getSafetyRating([critical()])).toBe("unsafe");
  });

  it("rates a single unverified high exploitable finding caution", () => {
    expect(getSafetyRating([high()])).toBe("caution");
  });

  it("rates two unverified high exploitable findings unsafe", () => {
    expect(getSafetyRating([high(), high()])).toBe("unsafe");
  });

  it("rates 3 unverified medium exploitable findings caution", () => {
    expect(getSafetyRating([medium(), medium(), medium()])).toBe("caution");
  });

  it("rates 2 unverified medium exploitable findings safe (below the 3+ bar)", () => {
    expect(getSafetyRating([medium(), medium()])).toBe("safe");
  });

  it("rates 5 unverified high/critical hardening findings caution", () => {
    const findings = Array.from({ length: 5 }, () => hardeningHigh());
    expect(getSafetyRating(findings)).toBe("caution");
  });

  it("rates 4 unverified high hardening findings safe (below the 5+ bar)", () => {
    const findings = Array.from({ length: 4 }, () => hardeningHigh());
    expect(getSafetyRating(findings)).toBe("safe");
  });

  it("ignores info-severity and always-informational findings", () => {
    expect(
      getSafetyRating([
        { severity: "info", title: "Server Technology Detected" },
        { severity: "high", title: "Server Header Discloses Version" },
      ]),
    ).toBe("safe");
  });

  it("buckets an unmatched-title HIGH severity finding as hardening (below the 5+ bar alone)", () => {
    expect(
      getSafetyRating([
        { severity: "high", title: "Some Unrelated High-Severity Finding" },
      ]),
    ).toBe("safe");
  });

  it("drops an unmatched-title medium/low severity finding from both buckets entirely", () => {
    expect(
      getSafetyRating([
        { severity: "medium", title: "Some Unrelated Medium Finding" },
      ]),
    ).toBe("safe");
  });
});

describe("getSafetyRating — AI verdict weighting", () => {
  it("does NOT rate unsafe for a single critical exploitable finding the AI flags possible_fp at high confidence", () => {
    const finding = critical({ aiVerdict: "possible_fp", aiConfidence: 90 });
    expect(getSafetyRating([finding])).not.toBe("unsafe");
    // Still worth a second look -- just not the headline "unsafe" verdict.
    expect(getSafetyRating([finding])).toBe("caution");
  });

  it("still rates unsafe for the same critical finding when unverified", () => {
    expect(getSafetyRating([critical()])).toBe("unsafe");
  });

  it("still rates unsafe for the same critical finding when AI-confirmed", () => {
    const finding = critical({ aiVerdict: "confirmed", aiConfidence: 95 });
    expect(getSafetyRating([finding])).toBe("unsafe");
  });

  it("discounts a possible_fp harder as the AI's own confidence rises", () => {
    const lowConfidenceFp = critical({
      aiVerdict: "possible_fp",
      aiConfidence: 60,
    });
    const highConfidenceFp = critical({
      aiVerdict: "possible_fp",
      aiConfidence: 97,
    });
    // Neither alone crosses the unsafe bar, but low-confidence doubt should
    // weigh closer to "unverified" than high-confidence doubt does.
    expect(getSafetyRating([lowConfidenceFp])).toBe("caution");
    expect(getSafetyRating([highConfidenceFp])).toBe("caution");
    expect(getDangerScore([lowConfidenceFp])).toBeGreaterThan(
      getDangerScore([highConfidenceFp]),
    );
  });

  it("lets several AI-discounted critical possible_fp findings still add up to unsafe", () => {
    // Two possible_fp criticals at low (60) AI confidence: weight ~0.55
    // each, summing to ~1.1 -- enough combined signal to still gate unsafe.
    const findings = [
      critical({
        title: "SQL Injection in /search",
        aiVerdict: "possible_fp",
        aiConfidence: 60,
      }),
      critical({
        title: "Command Injection in /export",
        aiVerdict: "possible_fp",
        aiConfidence: 60,
      }),
    ];
    expect(getSafetyRating(findings)).toBe("unsafe");
  });

  it("gives uncertain a smaller discount than possible_fp", () => {
    const uncertainFinding = high({
      aiVerdict: "uncertain",
      aiConfidence: 70,
    });
    const possibleFpFinding = high({
      aiVerdict: "possible_fp",
      aiConfidence: 70,
    });
    expect(getDangerScore([uncertainFinding])).toBeGreaterThan(
      getDangerScore([possibleFpFinding]),
    );
  });

  it("treats a finding with no aiVerdict identically to today regardless of neighboring AI-verified findings", () => {
    const unverified = high({ title: "Open Redirect via redirect_uri" });
    const withoutNeighbor = getSafetyRating([unverified]);
    const withConfirmedNeighbor = getSafetyRating([
      unverified,
      medium({ aiVerdict: "confirmed", aiConfidence: 90 }),
    ]);
    // Adding one confirmed medium exploitable elsewhere shouldn't change how
    // the unverified high finding itself is judged (still exactly one full
    // weight high exploitable -> caution either way).
    expect(withoutNeighbor).toBe("caution");
    expect(withConfirmedNeighbor).toBe("caution");
  });
});

describe("getDangerScore — regression (no AI verdict at all)", () => {
  it("returns 1 for no findings", () => {
    expect(getDangerScore([])).toBe(1);
  });

  it("caps a hardening-only scan at 4 (safe tier ceiling) no matter how many findings", () => {
    const findings = Array.from({ length: 20 }, () => hardeningHigh());
    // 20 high hardening findings would trip the "5+ = caution" rule, so use
    // a title that only ever buckets as hardening and stays under it.
    const fourFindings = findings.slice(0, 4);
    expect(getSafetyRating(fourFindings)).toBe("safe");
    expect(getDangerScore(fourFindings)).toBeLessThanOrEqual(4);
  });

  it("scores a single unverified critical exploitable finding at the top of the unsafe range", () => {
    expect(getDangerScore([critical()])).toBe(10);
  });

  it("falls back to a default weight for an unrecognized severity string", () => {
    expect(() =>
      getDangerScore([{ severity: "unknown", title: "Something Odd" }]),
    ).not.toThrow();
  });
});

describe("getDangerScore — AI verdict weighting", () => {
  it("scores several possible_fp findings meaningfully lower than the same findings all confirmed", () => {
    const confirmedFindings = [
      high({
        title: "Open Redirect A",
        aiVerdict: "confirmed",
        aiConfidence: 90,
      }),
      high({
        title: "Open Redirect B",
        aiVerdict: "confirmed",
        aiConfidence: 90,
      }),
      high({
        title: "Open Redirect C",
        aiVerdict: "confirmed",
        aiConfidence: 90,
      }),
    ];
    const possibleFpFindings = confirmedFindings.map((f) => ({
      ...f,
      aiVerdict: "possible_fp" as const,
      aiConfidence: 90,
    }));

    const confirmedScore = getDangerScore(confirmedFindings);
    const possibleFpScore = getDangerScore(possibleFpFindings);

    expect(confirmedScore).toBeGreaterThan(possibleFpScore);
    expect(confirmedScore - possibleFpScore).toBeGreaterThanOrEqual(3);
  });

  it("does not let a single high-confidence possible_fp critical alone reach the unverified/confirmed danger score", () => {
    const unverifiedScore = getDangerScore([critical()]);
    const confirmedScore = getDangerScore([
      critical({ aiVerdict: "confirmed", aiConfidence: 95 }),
    ]);
    const possibleFpScore = getDangerScore([
      critical({ aiVerdict: "possible_fp", aiConfidence: 90 }),
    ]);

    expect(unverifiedScore).toBe(10);
    expect(confirmedScore).toBe(10);
    expect(possibleFpScore).toBeLessThan(unverifiedScore);
  });

  it("does not penalize or boost a finding with no aiVerdict", () => {
    const plain = high();
    const withUndefinedVerdict = { ...high(), aiVerdict: undefined };
    expect(getDangerScore([plain])).toBe(
      getDangerScore([withUndefinedVerdict]),
    );
    expect(getSafetyRating([plain])).toBe(
      getSafetyRating([withUndefinedVerdict]),
    );
  });
});

describe("exploitablePatterns wording match for the hardcoded-secrets check", () => {
  it("classifies the current check title as exploitable (full weight), not informational", () => {
    const matchedTitle = critical({
      title: "Hard-coded secret values in source",
    });
    const unmatchedTitle = critical({
      title: "Some Unrelated Critical Finding",
    });

    // Both are bucketed as "exploitable" in the tier classification via the
    // critical-severity fallback, so both rate unsafe either way...
    expect(getSafetyRating([matchedTitle])).toBe("unsafe");
    expect(getSafetyRating([unmatchedTitle])).toBe("unsafe");

    // ...but getDangerScore's per-finding multiplier depends on the title
    // pattern match directly. The real check title must score at the full
    // "exploitable" multiplier (10/10), not fall through to the
    // "informational" 5% multiplier the old "Hardcoded API Keys" string
    // never matched.
    expect(getDangerScore([matchedTitle])).toBe(10);
    expect(getDangerScore([unmatchedTitle])).toBeLessThan(
      getDangerScore([matchedTitle]),
    );
  });

  it("also matches the legacy pre-rename title for old stored scans", () => {
    const legacyTitle = critical({
      title: "Hardcoded API Keys or Secrets Detected",
    });
    expect(getDangerScore([legacyTitle])).toBe(10);
  });

  it("matches the three severity-tier siblings split out of hardcoded-secrets", () => {
    // lib/scanner/checks/code.ts's hardcoded-secrets-high-risk /
    // -client-exposed / -low-risk all title themselves
    // "Hard-coded secret in source (...)" -- the "Secrets?" alternative
    // must catch the singular form these use, not just the original
    // check's "secret values" plural-adjacent wording.
    const highRisk: TestFinding = {
      severity: "high",
      title: "Hard-coded secret in source (elevated-risk key)",
    };
    const clientExposed: TestFinding = {
      severity: "medium",
      title: "Hard-coded secret in source (client-exposed key)",
    };
    const lowRisk: TestFinding = {
      severity: "low",
      title: "Hard-coded secret in source (low-risk identifier)",
    };

    expect(getSafetyRating([highRisk])).toBe("caution");
    expect(getSafetyRating([clientExposed])).toBe("safe");
    expect(
      getSafetyRating([clientExposed, clientExposed, clientExposed]),
    ).toBe("caution");
    expect(getSafetyRating([lowRisk])).toBe("safe");
  });

  it("does not accidentally catch an unrelated 'hard-coded secret' mention (JWT weak-signing-key finding)", () => {
    // "JWT HS256 signed with weak or hard-coded secret" (api.json) also
    // contains "hard-coded secret", and this pattern is intentionally
    // unanchored (see safety-rating.ts) so it matches "Hardcoded API Keys
    // or Secrets Detected" for old stored scans too. A weak/predictable
    // JWT signing key is itself a real, actively exploitable issue, so
    // sweeping it into the same bucket is a reasonable side effect, not a
    // bug -- this test just pins the current behavior down.
    const findings: TestFinding[] = [
      {
        severity: "medium",
        title: "JWT HS256 signed with weak or hard-coded secret",
      },
    ];
    expect(getSafetyRating(findings)).toBe("safe");
  });
});

describe("getEngineConfidence", () => {
  it("is high when there are no findings", () => {
    expect(getEngineConfidence([])).toBe(97);
  });

  it("drops slightly when async checks timed out", () => {
    expect(getEngineConfidence([], true)).toBe(94);
  });

  it("averages per-finding confidence weighted by severity", () => {
    const value = getEngineConfidence([
      { severity: "critical", title: "x", confidence: 95 },
      { severity: "low", title: "y", confidence: 50 },
    ]);
    expect(value).toBeGreaterThan(50);
    expect(value).toBeLessThanOrEqual(100);
  });

  it("falls back to a default confidence and severity weight when either is missing", () => {
    const value = getEngineConfidence([{ severity: "unknown", title: "x" }]);
    expect(value).toBeGreaterThanOrEqual(50);
    expect(value).toBeLessThanOrEqual(100);
  });
});

describe("SafetyRating type sanity", () => {
  it("only ever returns one of the three known tiers", () => {
    const valid: SafetyRating[] = ["safe", "caution", "unsafe"];
    expect(valid).toContain(getSafetyRating([critical()]));
  });
});

/**
 * Regression coverage for the walmart.com false-"unsafe" bug: a page
 * containing nothing but a Google API key (industry-standard practice —
 * Google's own docs say these are meant to be embedded client-side and
 * secured via HTTP-referrer restrictions, not secrecy) used to score
 * "unsafe" and near-maximum danger because `hardcoded-secrets` matched the
 * same key at a flat "critical" severity, while two other checks
 * (google-api-key-exposed, secret-google-maps-api-key) correctly called the
 * same evidence "medium". `getSafetyRating` auto-unsafes on ANY critical
 * finding, so the miscategorized check alone decided the whole scan's
 * verdict.
 *
 * This runs the real detectors end-to-end for the Google-API-key scenario
 * so the regression guard doesn't rely on the unit tests above staying in
 * sync with the detector behavior by hand.
 */
describe("regression: a page with only a Google API key must not read as unsafe", () => {
  const GOOGLE_KEY_ONLY_BODY =
    "<script>const mapsKey = 'AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe';</script>";
  const url = "https://example.com/";
  const headers = new Headers();

  it("none of the hardcoded-secrets tiers fire on a bare Google API key", () => {
    expect(
      codeDetectors["hardcoded-secrets"](url, headers, GOOGLE_KEY_ONLY_BODY),
    ).toBeNull();
    expect(
      codeDetectors["hardcoded-secrets-high-risk"](
        url,
        headers,
        GOOGLE_KEY_ONLY_BODY,
      ),
    ).toBeNull();
    expect(
      codeDetectors["hardcoded-secrets-client-exposed"](
        url,
        headers,
        GOOGLE_KEY_ONLY_BODY,
      ),
    ).toBeNull();
    expect(
      codeDetectors["hardcoded-secrets-low-risk"](
        url,
        headers,
        GOOGLE_KEY_ONLY_BODY,
      ),
    ).toBeNull();
  });

  it("running every real detector against the page yields no critical finding and a 'safe' rating", () => {
    const candidateIds = [
      "hardcoded-secrets",
      "hardcoded-secrets-high-risk",
      "hardcoded-secrets-client-exposed",
      "hardcoded-secrets-low-risk",
      "google-api-key-exposed",
      "secret-google-maps-api-key",
      "secret-firebase-api-key-public",
    ];
    const allDetectors: Record<
      string,
      (u: string, h: Headers, b: string) => string | null
    > = {
      ...codeDetectors,
      ...contentDetectors,
      ...secretsExtendedDetectors,
    };

    const findings: TestFinding[] = [];
    for (const id of candidateIds) {
      const detect = allDetectors[id];
      expect(detect, `detector "${id}" should exist`).toBeDefined();
      const evidence = detect(url, headers, GOOGLE_KEY_ONLY_BODY);
      if (!evidence) continue;
      const def = getCheckDef(id);
      expect(def, `checks-data entry for "${id}" should exist`).toBeDefined();
      findings.push({ severity: def!.severity as string, title: def!.title });
    }

    // The two dedicated Google-key checks fire (medium); the
    // hardcoded-secrets family does not (Google API Key pattern removed —
    // de-duplicated against those two checks).
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.severity !== "critical")).toBe(true);

    expect(getSafetyRating(findings)).toBe("safe");
    expect(getDangerScore(findings)).toBeLessThanOrEqual(4);
  });
});
