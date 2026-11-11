/**
 * A CWE on a check page is a claim about what kind of weakness it is, and the
 * compliance report routes the finding to a control family from that number
 * alone. Three pages carried one that had nothing to do with them (an oversized
 * cookie tagged "improper SameSite", an OIDC PKCE gap tagged "clickjacking", a
 * long CNAME chain tagged "unmaintained component"), so the SARIF and
 * compliance output for them was wrong in a way no reader would catch.
 *
 * The cheap guard is textual: a page tagged with a CWE whose whole meaning is
 * one specific mechanism has to mention that mechanism somewhere in its prose.
 */

import { describe, expect, it } from "vitest";

import { getControlsForFinding } from "@/lib/reports/compliance-mappings";
import type { Vulnerability } from "@/lib/scanner/types";

import { type CheckPage, loadCheckPages } from "./_page-prose";

type TaggedPage = CheckPage & { cwe?: string };

const PAGES = loadCheckPages() as TaggedPage[];

const prose = (page: TaggedPage) =>
  [page.title, page.description, page.riskImpact, page.explanation]
    .filter(Boolean)
    .join(" ");

/** CWE id to the words a page carrying it must use. */
const MECHANISM: Readonly<Record<string, RegExp>> = {
  "CWE-1275": /samesite/i,
  "CWE-1021": /frame|clickjack/i,
};

describe("CWE tags match what the page is about", () => {
  for (const [cwe, mechanism] of Object.entries(MECHANISM)) {
    it(`${cwe} appears only on pages that mention ${mechanism.source}`, () => {
      const wrong = PAGES.filter(
        (page) => page.cwe === cwe && !mechanism.test(prose(page)),
      ).map((page) => page.id);
      expect(wrong).toEqual([]);
    });
  }

  const byId = new Map(PAGES.map((page) => [page.id, page]));

  it("tags a cookie that is merely too large with no CWE", () => {
    expect(byId.get("cookie-too-large")?.cwe).toBeUndefined();
  });

  it("tags a missing PKCE advertisement with a capture-replay CWE", () => {
    expect(byId.get("api-oidc-discovery-pkce-not-advertised")?.cwe).toBe(
      "CWE-294",
    );
  });

  it("tags a long CNAME chain with no CWE", () => {
    expect(byId.get("dns-cname-chain-too-long")?.cwe).toBeUndefined();
  });
});

describe("compliance routing of the re-tagged pages", () => {
  const finding = (id: string, patch: Partial<Vulnerability> = {}) => {
    const page = PAGES.find((p) => p.id === id);
    if (!page) throw new Error(`no page ${id}`);
    return { ...page, ...patch } as unknown as Vulnerability;
  };
  const controlIds = (f: Vulnerability) =>
    getControlsForFinding(f).map((ref) => `${ref.framework}:${ref.id}`);

  it("keeps the PKCE gap out of the clickjacking control family", () => {
    const retagged = controlIds(
      finding("api-oidc-discovery-pkce-not-advertised"),
    );
    const clickjacking = controlIds(
      finding("api-oidc-discovery-pkce-not-advertised", {
        cwe: "CWE-1021",
        owasp: undefined,
      }),
    );
    expect(retagged).not.toEqual(clickjacking);
  });

  it("still maps an untagged oversized cookie through its category", () => {
    expect(controlIds(finding("cookie-too-large")).length).toBeGreaterThan(0);
  });
});
