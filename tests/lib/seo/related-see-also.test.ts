import { describe, it, expect } from "vitest";
import { getCheckById, getAllChecks } from "@/lib/seo/checks-content";
import {
  RELATED_BUT_SEPARATE,
  getCheckSeeAlso,
} from "@/lib/seo/check-see-also";
import { LEGACY_DEDUPE_GROUPS } from "@/lib/scanner/dedupe";
import { pageCheckGroups } from "@/lib/scanner/checks/page-checks";

function seeAlso(id: string) {
  const check = getCheckById(id);
  if (!check) throw new Error(`no such check: ${id}`);
  return getCheckSeeAlso(check);
}

describe("getCheckSeeAlso: reported as one finding", () => {
  it("lists every other member of the document.write family", () => {
    expect(seeAlso("document-write-usage").merged.map((m) => m.id)).toEqual([
      "document-write-sink",
      "cs-document-write-usage",
      "code-xss-documentwrite-jsonparse",
    ]);
  });

  it("names exactly the checks the engine folds together", () => {
    const groups = { ...LEGACY_DEDUPE_GROUPS, ...pageCheckGroups };
    for (const check of getAllChecks()) {
      const group = groups[check.id];
      const expected = group
        ? Object.entries(groups)
            .filter(([id, g]) => g === group && id !== check.id)
            .map(([id]) => id)
            .sort()
        : [];
      expect(
        getCheckSeeAlso(check)
          .merged.map((m) => m.id)
          .sort(),
        check.id,
      ).toEqual(expected);
    }
  });

  it("includes a PageCheck that shares the group, as an id without a page", () => {
    const pageCheck = seeAlso("csp-unsafe-eval-detected").merged.find(
      (m) => m.id === "page-csp-unsafe-eval-effective",
    );
    expect(pageCheck).toBeDefined();
    expect(pageCheck?.check).toBeUndefined();
  });

  it("links a member that has a page", () => {
    expect(seeAlso("document-write-usage").merged[0]?.check?.id).toBe(
      "document-write-sink",
    );
  });

  it("never lists the check itself", () => {
    for (const check of getAllChecks()) {
      const { merged, related } = getCheckSeeAlso(check);
      expect([
        ...merged.map((m) => m.id),
        ...related.map((c) => c.id),
      ]).not.toContain(check.id);
    }
  });

  it("leaves a check outside every group alone", () => {
    expect(seeAlso("cors-origin-reflection")).toEqual({
      merged: [],
      related: [],
    });
  });
});

describe("getCheckSeeAlso: related but reported separately", () => {
  it("does not call a pair merged when the engine keeps them apart", () => {
    // meta-referrer-unsafe has no dedupe group, so a page saying these are
    // "reported as one finding" would be false.
    const meta = seeAlso("meta-referrer-unsafe");
    expect(meta.merged).toEqual([]);
    expect(meta.related.map((c) => c.id)).toEqual(["referrer-policy-unsafe"]);
    expect(seeAlso("referrer-policy-unsafe").related.map((c) => c.id)).toEqual([
      "meta-referrer-unsafe",
    ]);
  });

  it("links the no-origin-check receiver to the wildcard senders", () => {
    const related = seeAlso("postmessage-no-origin-check").related.map(
      (c) => c.id,
    );
    expect(related).toContain("postmessage-wildcard");
    expect(related).toContain("postmessage-star-origin");
  });

  it("does not repeat a merged sibling as related", () => {
    const { merged, related } = seeAlso("postmessage-wildcard");
    expect(merged.map((m) => m.id)).toContain("postmessage-star-origin");
    expect(related.map((c) => c.id)).toEqual(["postmessage-no-origin-check"]);
  });

  it("keeps every curated family linkable", () => {
    for (const family of RELATED_BUT_SEPARATE) {
      expect(
        family.filter((id) => getCheckById(id)).length,
        family.join(", "),
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
