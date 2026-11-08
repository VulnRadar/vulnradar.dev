/**
 * The Permissions-Policy pages are pasted from. Ten of them shipped
 * `feature=('self')`, which is not the header's syntax (a browser drops the
 * entry), and more named one value in the fix step and another in the code.
 * Their riskImpact was a copy of the fix step, so the "what could go wrong"
 * box told the reader what to type instead.
 */

import { describe, expect, it } from "vitest";
import headers from "@/lib/scanner/checks-data/headers.json";

interface CheckDef {
  id: string;
  description: string;
  riskImpact?: string;
  explanation?: string;
  fixSteps: string[];
  codeExamples: { label: string; language: string; code: string }[];
}

const all = headers as CheckDef[];
const policyPages = all.filter((c) =>
  /^permissions-policy-.*-blocked$/.test(c.id),
);

const featureOf = (id: string) =>
  id.replace(/^permissions-policy-/, "").replace(/-blocked$/, "");

const configValue = (c: CheckDef) => {
  const match = c.codeExamples[0].code.match(
    /key: "Permissions-Policy", value: "([^"]*)"/,
  );
  return match ? match[1] : null;
};

const ALLOWLIST_TOKEN = /[a-z-]+=[(][^)]*[)]/g;

describe("Permissions-Policy check pages", () => {
  it("covers all 26 feature pages", () => {
    expect(policyPages).toHaveLength(26);
  });

  it("never puts a quote inside an allowlist, anywhere in headers.json", () => {
    for (const check of all) {
      for (const example of check.codeExamples) {
        expect(example.code, `${check.id}: ${example.label}`).not.toMatch(
          /=[(][ ]*'/,
        );
      }
    }
  });

  for (const check of policyPages) {
    const feature = featureOf(check.id);

    describe(feature, () => {
      it("has a config value with no single quote", () => {
        const value = configValue(check);
        expect(value).not.toBeNull();
        expect(value).not.toContain("'");
      });

      it("does not teach the quoted form in a code comment", () => {
        expect(check.codeExamples[0].code).not.toContain("'self'");
      });

      it("recommends one value, and the code ships it", () => {
        const tokens = new Set(
          check.fixSteps.flatMap((s) => s.match(ALLOWLIST_TOKEN) ?? []),
        );
        const forFeature = [...tokens].filter((t) =>
          t.startsWith(`${feature}=`),
        );
        expect(forFeature).toHaveLength(1);
        expect(configValue(check)).toContain(forFeature[0]);
      });

      it("describes what actually triggers the finding", () => {
        expect(check.description).toContain(`${feature}=*`);
      });

      it("explains the page instead of repeating the description", () => {
        expect(check.explanation).toBeTruthy();
        expect(check.explanation).not.toBe(check.description);
      });

      it("states a risk rather than an instruction", () => {
        expect(check.riskImpact).toBeTruthy();
        expect(check.riskImpact).not.toMatch(/^Set Permissions-Policy/);
      });
    });
  }

  it.each(["browsing-topics", "attribution-reporting", "interest-cohort"])(
    "says %s is withdrawn and the directive harmless",
    (feature) => {
      const check = policyPages.find((c) => featureOf(c.id) === feature);
      expect(check?.description).toMatch(/withdraw/i);
      expect(check?.description).toMatch(/harmless/i);
    },
  );

  it("does not claim Chrome has finished removing the Privacy Sandbox APIs", () => {
    for (const feature of ["browsing-topics", "attribution-reporting"]) {
      const check = policyPages.find((c) => featureOf(c.id) === feature);
      expect(check?.description).not.toMatch(/has been removed|was removed/i);
    }
  });
});

describe("riskImpact across headers.json", () => {
  it("never repeats a fix step", () => {
    const repeats = all
      .filter((c) => c.riskImpact && c.fixSteps.includes(c.riskImpact))
      .map((c) => c.id);
    expect(repeats).toEqual([]);
  });
});
