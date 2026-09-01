import { describe, it, expect } from "vitest";
import { buildCheckTitle, buildCheckDescription } from "@/lib/seo/check-meta";
import { getAllChecks } from "@/lib/seo/checks-content";

// These assert over the WHOLE check set rather than a fixture, because the
// bugs they guard against were both emergent: the old builders were fine on
// any single check and only went wrong at 749 of them. A new check that
// happens to share a title with an existing one, or one with an unusually
// long name, has to fail here rather than in Search Console.
const CHECKS = getAllChecks();

describe("buildCheckTitle", () => {
  it("covers every check", () => {
    expect(CHECKS.length).toBeGreaterThan(700);
  });

  it("never publishes the same title on two pages", () => {
    const byTitle = new Map<string, string[]>();
    for (const check of CHECKS) {
      const title = buildCheckTitle(check);
      byTitle.set(title, [...(byTitle.get(title) ?? []), check.id]);
    }
    const collisions = [...byTitle.entries()].filter(
      ([, ids]) => ids.length > 1,
    );
    expect(collisions).toEqual([]);
  });

  it("never truncates a title", () => {
    // An ellipsis in a <title> always removes the END of the check name, which
    // is the part that distinguishes one Permissions-Policy directive from
    // another. A long title is published whole instead.
    const truncated = CHECKS.filter((c) => buildCheckTitle(c).includes("..."));
    expect(truncated).toEqual([]);
  });

  it("keeps the whole check name in the title", () => {
    for (const check of CHECKS) {
      expect(buildCheckTitle(check)).toContain(
        check.title.replace(/\s+/g, " ").trim(),
      );
    }
  });
});

describe("buildCheckDescription", () => {
  it("stays inside the meta description window", () => {
    for (const check of CHECKS) {
      expect(buildCheckDescription(check).length).toBeLessThanOrEqual(155);
    }
  });

  it("gives every check a distinct description", () => {
    const seen = new Set(CHECKS.map(buildCheckDescription));
    expect(seen.size).toBe(CHECKS.length);
  });

  it("ends most descriptions on a complete sentence", () => {
    // 316 of the check descriptions are themselves over the 155-char window,
    // and roughly half of those have no sentence break early enough to keep,
    // so some truncation is unavoidable. The bar is that it is the exception:
    // the old builder ellipsised 682 of 749.
    const cut = CHECKS.filter((c) => buildCheckDescription(c).endsWith("..."));
    expect(cut.length / CHECKS.length).toBeLessThan(0.4);
  });

  it("never appends half of the risk sentence", () => {
    // The old builder concatenated the risk sentence and then clamped, so most
    // pages published two thirds of it. Now it is all or nothing: anything the
    // description carries beyond the lead-in plus the check description has to
    // be the complete riskImpact.
    for (const check of CHECKS) {
      const description = buildCheckDescription(check);
      const risk = check.riskImpact?.replace(/\s+/g, " ").trim();
      if (!risk) continue;
      const withoutRisk = description.replace(` ${risk}`, "");
      expect(withoutRisk === description || description.endsWith(risk)).toBe(
        true,
      );
      // And nothing is ever cut mid-risk: a truncated description stops before
      // the risk sentence begins, never inside it.
      if (description.endsWith("...")) {
        expect(description).not.toContain(risk.slice(0, 30));
      }
    }
  });
});
