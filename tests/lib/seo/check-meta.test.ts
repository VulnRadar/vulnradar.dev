import { describe, it, expect } from "vitest";
import { APP_NAME } from "@/lib/config/constants";
import { buildCheckTitle, buildCheckDescription } from "@/lib/seo/check-meta";
import { getAllChecks, type SeoCheck } from "@/lib/seo/checks-content";
import baseline from "./check-meta-baseline.json";

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

  it("leads with the check's own description, not a shared lead-in", () => {
    // Every snippet used to open "<Severity>-severity <category> finding.",
    // so ~800 results began with one of a handful of identical phrases.
    for (const check of CHECKS) {
      if (check.seoDescription) continue;
      const description = buildCheckDescription(check);
      expect(description, check.id).not.toMatch(/^\w+-severity /);
      expect(description.slice(0, 20), check.id).toBe(
        check.description.replace(/\s+/g, " ").trim().slice(0, 20),
      );
    }
  });

  it("never appends half of the risk sentence", () => {
    // The old builder concatenated the risk sentence and then clamped, so most
    // pages published two thirds of it. Now it is all or nothing: anything the
    // description carries beyond the lead-in plus the check description has to
    // be the complete riskImpact (or the short severity note).
    for (const check of CHECKS) {
      if (check.seoDescription) continue;
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

const sample = (patch: Partial<SeoCheck>): SeoCheck => ({
  ...CHECKS[0],
  ...patch,
});

describe("seoDescription and shortTitle", () => {
  it("publishes a check's seoDescription as its description", () => {
    const check = sample({
      description: "x".repeat(400),
      seoDescription: "  The   server sends a header it should not.  ",
    });
    expect(buildCheckDescription(check)).toBe(
      "The server sends a header it should not.",
    );
  });

  it("falls back to the built description without one", () => {
    const check = sample({ seoDescription: undefined });
    expect(buildCheckDescription(check)).toBe(
      buildCheckDescription({ ...check }),
    );
    expect(buildCheckDescription(check).length).toBeGreaterThan(0);
  });

  it("puts shortTitle in the <title> and keeps the full title elsewhere", () => {
    const check = sample({
      title: "A Very Long Check Title That Overruns The Search Result Width",
      shortTitle: "Short Check Name",
    });
    expect(buildCheckTitle(check)).toBe("How to fix: Short Check Name");
    expect(check.title).toContain("Overruns");
  });

  it("keeps the whole shortTitle when it does not fit the fix phrasing", () => {
    const check = sample({
      title: "Another Overlong Title That Keeps Going For A While Yet",
      shortTitle: "A Short Name That Still Has Many Words In It Today",
    });
    expect(buildCheckTitle(check)).toContain(
      "A Short Name That Still Has Many Words In It Today",
    );
  });

  it("holds every authored seoDescription to 90-150 characters", () => {
    for (const check of CHECKS) {
      if (!check.seoDescription) continue;
      const length = check.seoDescription.replace(/\s+/g, " ").trim().length;
      expect(length, check.id).toBeGreaterThanOrEqual(90);
      expect(length, check.id).toBeLessThanOrEqual(150);
    }
  });

  it("holds every authored shortTitle to something shorter than the title", () => {
    for (const check of CHECKS) {
      if (!check.shortTitle) continue;
      expect(check.shortTitle.length, check.id).toBeLessThan(
        check.title.length,
      );
    }
  });
});

// A search result shows about 60 characters of title and 155 of description.
// Both lists below are the pages that miss today (a title over 70 characters
// once the site suffix is added, and a description cut mid-clause with an
// ellipsis). They only shrink: fix a page by giving it a shortTitle or a
// seoDescription, then delete its id here. A page that is not listed must fit.
describe("search-result limits", () => {
  const suffix = ` | ${APP_NAME}`;
  const listedTitles = new Set<string>(baseline.longTitles);
  const listedDescriptions = new Set<string>(baseline.cutDescriptions);
  const ids = new Set(CHECKS.map((c) => c.id));

  it("keeps every unlisted title within 70 characters with the suffix", () => {
    const over = CHECKS.filter(
      (c) =>
        !listedTitles.has(c.id) && (buildCheckTitle(c) + suffix).length > 70,
    ).map((c) => c.id);
    expect(over).toEqual([]);
  });

  it("keeps every description within 160 characters", () => {
    const over = CHECKS.filter(
      (c) => buildCheckDescription(c).length > 160,
    ).map((c) => c.id);
    expect(over).toEqual([]);
  });

  it("does not cut an unlisted description with an ellipsis", () => {
    const cut = CHECKS.filter(
      (c) =>
        !listedDescriptions.has(c.id) &&
        buildCheckDescription(c).endsWith("..."),
    ).map((c) => c.id);
    expect(cut).toEqual([]);
  });

  it("takes a listed title off the list once it fits", () => {
    const fixed = baseline.longTitles.filter((id) => {
      const check = CHECKS.find((c) => c.id === id);
      return !check || (buildCheckTitle(check) + suffix).length <= 70;
    });
    expect(fixed).toEqual([]);
  });

  it("takes a listed description off the list once it is no longer cut", () => {
    const fixed = baseline.cutDescriptions.filter((id) => {
      const check = CHECKS.find((c) => c.id === id);
      return !check || !buildCheckDescription(check).endsWith("...");
    });
    expect(fixed).toEqual([]);
  });

  it("lists only ids that exist", () => {
    const unknown = [...listedTitles, ...listedDescriptions].filter(
      (id) => !ids.has(id),
    );
    expect(unknown).toEqual([]);
  });

  it("keeps both lists sorted", () => {
    expect(baseline.longTitles).toEqual([...baseline.longTitles].sort());
    expect(baseline.cutDescriptions).toEqual(
      [...baseline.cutDescriptions].sort(),
    );
  });
});
