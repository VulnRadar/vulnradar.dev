import { describe, it, expect } from "vitest";
import {
  CATEGORY_SEO,
  SEO_CATEGORIES,
  getAllChecks,
  getCheckById,
  getChecksInCategory,
  getRelatedChecks,
} from "@/lib/seo/checks-content";
import {
  FEATURED_API_CHECK_IDS,
  getFeaturedApiChecks,
} from "@/app/tools/api-scanner/featured-checks";
import { LEGACY_DEDUPE_GROUPS } from "@/lib/scanner/dedupe";
import { pageCheckGroups } from "@/lib/scanner/checks/page-checks";

const CHECKS = getAllChecks();

describe("getRelatedChecks", () => {
  it("never links a check to itself and stays inside its category", () => {
    for (const check of CHECKS) {
      const related = getRelatedChecks(check, 8);
      expect(related.length, check.id).toBeLessThanOrEqual(8);
      expect(
        related.map((c) => c.id),
        check.id,
      ).not.toContain(check.id);
      for (const peer of related) {
        expect(peer.category, check.id).toBe(check.category);
      }
    }
  });

  it("leaves no check without a sibling linking to it", () => {
    // It took the first 8 in the file, so 652 of 804 pages were never linked
    // from a sibling and depended on the index pages for any internal link.
    const linked = new Set(
      CHECKS.flatMap((check) => getRelatedChecks(check, 8)).map((c) => c.id),
    );
    const orphans = CHECKS.filter(
      (c) => !linked.has(c.id) && getChecksInCategory(c.category).length > 1,
    ).map((c) => c.id);
    expect(orphans).toEqual([]);
  });

  it("fills the window for every check in a category large enough", () => {
    for (const cat of SEO_CATEGORIES) {
      const members = getChecksInCategory(cat);
      const expected = Math.min(8, members.length - 1);
      for (const check of members) {
        expect(getRelatedChecks(check, 8).length, check.id).toBe(expected);
      }
    }
  });

  it("picks the file-order neighbours around the check", () => {
    const members = getChecksInCategory("headers");
    const window = [
      ...members.slice(36, 40).map((c) => c.id),
      ...members.slice(41, 45).map((c) => c.id),
    ].sort();
    expect(
      getRelatedChecks(members[40]!, 8)
        .map((c) => c.id)
        .sort(),
    ).toEqual(window);
  });

  it("puts same-CWE neighbours first", () => {
    let reordered = 0;
    for (const check of CHECKS.filter((c) => c.cwe)) {
      const related = getRelatedChecks(check, 8);
      const firstOther = related.findIndex((c) => c.cwe !== check.cwe);
      if (firstOther === -1) continue;
      if (firstOther > 0) reordered++;
      expect(
        related.slice(firstOther).some((c) => c.cwe === check.cwe),
        check.id,
      ).toBe(false);
    }
    expect(reordered).toBeGreaterThan(0);
  });

  it("does not treat two checks with no CWE as a match", () => {
    const members = getChecksInCategory("headers");
    const check = members.find((c) => !c.cwe);
    expect(check).toBeDefined();
    const index = members.indexOf(check!);
    const distances = getRelatedChecks(check!, 8).map((c) =>
      Math.abs(members.indexOf(c) - index),
    );
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("honours a smaller limit", () => {
    expect(getRelatedChecks(CHECKS[0]!, 3)).toHaveLength(3);
  });
});

describe("the api-scanner tool's curated checks", () => {
  it("resolves every curated id to a real page", () => {
    const missing = FEATURED_API_CHECK_IDS.filter((id) => !getCheckById(id));
    expect(missing).toEqual([]);
    expect(getFeaturedApiChecks()).toHaveLength(FEATURED_API_CHECK_IDS.length);
  });

  it("lists each one once", () => {
    expect(new Set(FEATURED_API_CHECK_IDS).size).toBe(
      FEATURED_API_CHECK_IDS.length,
    );
  });

  it("does not spend two slots on what the engine reports as one finding", () => {
    const groupOf = { ...LEGACY_DEDUPE_GROUPS, ...pageCheckGroups };
    const groups = FEATURED_API_CHECK_IDS.flatMap((id) => groupOf[id] ?? []);
    expect(groups).toEqual([...new Set(groups)]);
  });

  it("crosses categories, which is why it is not a slice of one", () => {
    const categories = new Set(getFeaturedApiChecks().map((c) => c.category));
    expect(categories.size).toBeGreaterThan(1);
  });
});

describe("CATEGORY_SEO copy matches what each category contains", () => {
  const copy = (cat: keyof typeof CATEGORY_SEO) =>
    [
      CATEGORY_SEO[cat].heading,
      CATEGORY_SEO[cat].intro,
      ...CATEGORY_SEO[cat].keywords,
    ].join(" ");

  it("puts certificates under tls, where the certificate checks are", () => {
    expect(
      getChecksInCategory("tls").some((c) => c.id === "tls-certificate-expiry"),
    ).toBe(true);
    expect(CATEGORY_SEO.tls.intro).toMatch(/expiry/i);
    expect(CATEGORY_SEO.tls.intro).toMatch(/chain/i);
    expect(CATEGORY_SEO.tls.heading).toMatch(/certificate/i);
    expect(copy("tls")).toMatch(/ssl certificate checker/i);
  });

  it("puts HTTPS and mixed content under ssl, and no certificate promise", () => {
    expect(getChecksInCategory("ssl").some((c) => /mixed/i.test(c.title))).toBe(
      true,
    );
    expect(CATEGORY_SEO.ssl.heading).toMatch(/HTTPS/);
    expect(CATEGORY_SEO.ssl.intro).toMatch(/mixed content/i);
    expect(copy("ssl")).not.toMatch(/certificate/i);
  });

  it("does not promise mail authentication under dns", () => {
    expect(copy("dns")).not.toMatch(/SPF|DMARC|DKIM/i);
    expect(
      getChecksInCategory("dns").filter((c) =>
        /\b(spf|dmarc|dkim)\b/i.test(c.title),
      ),
    ).toEqual([]);
  });

  it("leaves the mail-authentication promise on email, where it is true", () => {
    expect(copy("email")).toMatch(/SPF/);
    expect(
      getChecksInCategory("email").some((c) => /\bspf\b/i.test(c.title)),
    ).toBe(true);
  });
});
