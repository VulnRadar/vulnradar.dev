import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  resolveCompareRegion,
  resolveCompareUrlChange,
  type CompareRegionInput,
} from "@/components/compare/compare-view";

/**
 * /compare used to render an error and nothing else when a saved comparison's
 * scan had been deleted. These pin the two decisions that fix it, which the
 * page used to make inline: which region is on screen, and what a URL change
 * does to the host and the error.
 *
 * The page itself needs a DOM this tier does not have, so the second half
 * reads its source for the wiring that is easy to break and invisible in a
 * diff.
 */

const REGIONS: CompareRegionInput[] = [];
for (const deepLinkPending of [false, true]) {
  for (const hasDiff of [false, true]) {
    for (const hasGroup of [false, true]) {
      REGIONS.push({ deepLinkPending, hasDiff, hasGroup });
    }
  }
}

describe("resolveCompareRegion", () => {
  it("answers every combination of state with exactly one region", () => {
    for (const input of REGIONS) {
      expect(["skeleton", "hosts", "scans", "diff"]).toContain(
        resolveCompareRegion(input),
      );
    }
  });

  it("falls back to the host picker when no host group is selected and there is no diff", () => {
    // The stranded state: a saved comparison 404ed, the host was backfilled
    // from the scan that survived, and that host has fewer than two scans, so
    // there is no group behind it. Nothing used to render here.
    expect(
      resolveCompareRegion({
        deepLinkPending: false,
        hasDiff: false,
        hasGroup: false,
      }),
    ).toBe("hosts");
  });

  it("shows the host's scan picker only while it has a group", () => {
    expect(
      resolveCompareRegion({
        deepLinkPending: false,
        hasDiff: false,
        hasGroup: true,
      }),
    ).toBe("scans");
  });

  it("shows the diff over a group, and the skeleton over everything", () => {
    expect(
      resolveCompareRegion({
        deepLinkPending: false,
        hasDiff: true,
        hasGroup: true,
      }),
    ).toBe("diff");
    for (const hasDiff of [false, true]) {
      for (const hasGroup of [false, true]) {
        expect(
          resolveCompareRegion({ deepLinkPending: true, hasDiff, hasGroup }),
        ).toBe("skeleton");
      }
    }
  });
});

describe("resolveCompareUrlChange", () => {
  it("runs the comparison when the URL names two scans", () => {
    expect(
      resolveCompareUrlChange({ a: "x1", b: "y2", pairWasInUrl: false }),
    ).toEqual({
      run: { a: "x1", b: "y2" },
      clearResult: false,
      resetHost: false,
    });
  });

  it("clears a stale diff and error, and sends the page back to the host picker, when a full pair leaves the URL", () => {
    // The Compare nav link, or back off a saved comparison.
    expect(
      resolveCompareUrlChange({ a: null, b: null, pairWasInUrl: true }),
    ).toEqual({ run: null, clearResult: true, resetHost: true });
  });

  it("keeps the host when the reader picks the first scan of it", () => {
    // Choosing a scan writes ?a= with no b. Resetting the host here sent the
    // reader back to the host picker on every first pick.
    expect(
      resolveCompareUrlChange({ a: "x1", b: null, pairWasInUrl: false }),
    ).toEqual({ run: null, clearResult: true, resetHost: false });
  });

  it("keeps the host when the only picked scan is deselected", () => {
    expect(
      resolveCompareUrlChange({ a: null, b: null, pairWasInUrl: false }),
    ).toEqual({ run: null, clearResult: true, resetHost: false });
  });

  it("keeps the host when one half of a pair is deselected", () => {
    expect(
      resolveCompareUrlChange({ a: null, b: "y2", pairWasInUrl: true }),
    ).toEqual({ run: null, clearResult: true, resetHost: false });
    expect(
      resolveCompareUrlChange({ a: "x1", b: null, pairWasInUrl: true }),
    ).toEqual({ run: null, clearResult: true, resetHost: false });
  });

  it("walks the failed deep link back to a usable page", () => {
    // ?a=&b= where one scan was deleted: the pair is read, the comparison is
    // run, then the nav link strips the query.
    const first = resolveCompareUrlChange({
      a: "gone",
      b: "kept",
      pairWasInUrl: false,
    });
    expect(first.run).toEqual({ a: "gone", b: "kept" });
    const second = resolveCompareUrlChange({
      a: null,
      b: null,
      pairWasInUrl: true,
    });
    expect(second.clearResult).toBe(true);
    expect(second.resetHost).toBe(true);
  });
});

describe("app/compare/page.tsx wiring", () => {
  const page = readFileSync(
    path.resolve(__dirname, "../../../app/compare/page.tsx"),
    "utf8",
  );

  it("picks its region through resolveCompareRegion, not an inline conjunction", () => {
    expect(page).toContain("resolveCompareRegion(");
    // The gating that stranded the page. A host set with no group behind it
    // matched none of these three, so nothing rendered.
    expect(page).not.toMatch(/&&\s*!selectedHost\s*&&/);
    expect(page).not.toMatch(/&&\s*selectedHost\s*&&\s*selectedGroup/);
  });

  it("applies the URL handler's reset to the host and the error", () => {
    expect(page).toContain("resolveCompareUrlChange(");
    expect(page).toMatch(
      /change\.resetHost[\s\S]{0,40}setSelectedHost\(null\)/,
    );
    expect(page).toMatch(
      /change\.clearResult[\s\S]{0,200}setCompareError\(null\)/,
    );
  });

  it("sets the chosen host after writing the URL, so the handler's reset cannot undo the pick", () => {
    const body = page.slice(page.indexOf("function handleSelectHost"));
    const fn = body.slice(0, body.indexOf("function handleChangeHost"));
    const lastUrlWrite = fn.lastIndexOf("setQueryParams(");
    const hostWrite = fn.lastIndexOf("setSelectedHost(host)");
    expect(lastUrlWrite).toBeGreaterThan(-1);
    expect(hostWrite).toBeGreaterThan(lastUrlWrite);
    // And only the once: a second, earlier call is the order this guards.
    expect(fn.match(/setSelectedHost\(host\)/g)).toHaveLength(1);
  });

  it("gives the host heading the panel-heading tier", () => {
    const h2 = page.match(/<h2 className="([^"]+)"/);
    expect(h2).not.toBeNull();
    const classes = h2![1].split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        "text-base",
        "font-semibold",
        "tracking-tight",
        "text-foreground",
      ]),
    );
    // A hostname is one unbroken token and must still wrap on a phone.
    expect(classes).toContain("break-all");
  });
});
