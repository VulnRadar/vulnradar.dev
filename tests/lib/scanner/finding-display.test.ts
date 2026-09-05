/**
 * lib/scanner/finding-display.ts: the metadata a finding has always carried
 * and the UI never read.
 *
 * These three fields all had producers and export consumers and no on-screen
 * consumer at all: CWE/OWASP hand-authored on 721 check definitions,
 * alsoReportedBy written by dedupe, and location written by the repo scans.
 * The rendering itself is asserted in
 * tests/components/scanner/finding-metadata-render.test.ts; this suite is
 * the logic underneath it.
 */
import { describe, it, expect } from "vitest";
import {
  corroborationCount,
  corroborationLabel,
  cweRef,
  findingLocationLabel,
  owaspRef,
} from "@/lib/scanner/finding-display";

describe("cweRef", () => {
  it("links a CWE id to its MITRE definition page", () => {
    expect(cweRef("CWE-79")).toEqual({
      label: "CWE-79",
      name: "",
      url: "https://cwe.mitre.org/data/definitions/79.html",
    });
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(cweRef("  cwe-352 ")?.label).toBe("CWE-352");
    expect(cweRef("CWE-0079")?.url).toBe(
      "https://cwe.mitre.org/data/definitions/79.html",
    );
  });

  it("refuses to build a URL out of anything that is not a CWE id", () => {
    // A finding can come straight out of scan_history JSON written by an
    // older engine, so the id is validated rather than interpolated.
    expect(cweRef("CWE-79/../../evil")).toBeNull();
    expect(cweRef("javascript:alert(1)")).toBeNull();
    expect(cweRef("")).toBeNull();
    expect(cweRef(undefined)).toBeNull();
    expect(cweRef(null)).toBeNull();
  });
});

describe("owaspRef", () => {
  it("resolves an OWASP Top 10 (2021) id to its name and page", () => {
    expect(owaspRef("A03:2021")).toEqual({
      label: "A03:2021",
      name: "Injection",
      url: "https://owasp.org/Top10/A03_2021-Injection/",
    });
  });

  it("accepts the unpadded and bare forms the data has used", () => {
    expect(owaspRef("A3:2021")?.label).toBe("A03:2021");
    expect(owaspRef("a05")?.name).toBe("Security Misconfiguration");
  });

  it("covers every category the check data actually tags", () => {
    // lib/scanner/checks-data/*.json uses A01 through A10 and nothing else.
    for (let n = 1; n <= 10; n++) {
      const id = `A${String(n).padStart(2, "0")}:2021`;
      const ref = owaspRef(id);
      expect(ref, id).not.toBeNull();
      expect(ref!.name.length).toBeGreaterThan(0);
      expect(ref!.url).toContain("https://owasp.org/Top10/");
    }
  });

  it("returns null for an id outside the Top 10", () => {
    expect(owaspRef("A11:2021")).toBeNull();
    expect(owaspRef("A00")).toBeNull();
    expect(owaspRef("nonsense")).toBeNull();
    expect(owaspRef(undefined)).toBeNull();
  });
});

describe("corroborationLabel", () => {
  it("says how many other checks agreed", () => {
    expect(corroborationLabel(["a", "b"])).toBe("Also found by 2 other checks");
  });

  it("stays singular for one", () => {
    expect(corroborationLabel(["a"])).toBe("Also found by 1 other check");
  });

  it("is absent when nothing was merged", () => {
    // The common case, and the one that must render nothing at all rather
    // than an empty row.
    expect(corroborationLabel(undefined)).toBeNull();
    expect(corroborationLabel(null)).toBeNull();
    expect(corroborationLabel([])).toBeNull();
    expect(corroborationLabel(["", "   "])).toBeNull();
  });

  it("counts each check once", () => {
    expect(corroborationCount(["a", "a", " a ", "b"])).toBe(2);
  });

  it("ignores a non-array payload from an older stored scan", () => {
    expect(corroborationCount("a,b" as unknown as string[])).toBe(0);
  });
});

describe("findingLocationLabel", () => {
  it("prints file and line for a repo finding", () => {
    expect(findingLocationLabel({ file: "src/config.ts", line: 42 })).toBe(
      "src/config.ts:42",
    );
  });

  it("prints just the file when the detector tracked no position", () => {
    expect(findingLocationLabel({ file: "src/config.ts" })).toBe(
      "src/config.ts",
    );
  });

  it("is absent for a finding that came from a live URL", () => {
    expect(findingLocationLabel(undefined)).toBeNull();
    expect(findingLocationLabel(null)).toBeNull();
    expect(findingLocationLabel({})).toBeNull();
  });

  it("drops a line number that is not a usable position", () => {
    expect(findingLocationLabel({ file: "a.ts", line: 0 })).toBe("a.ts");
    expect(findingLocationLabel({ file: "a.ts", line: -3 })).toBe("a.ts");
    expect(findingLocationLabel({ file: "a.ts", line: 1.5 })).toBe("a.ts");
    expect(
      findingLocationLabel({ file: "a.ts", line: "12" as unknown as number }),
    ).toBe("a.ts");
  });

  it("strips control characters out of a third party's path", () => {
    // The path comes from someone else's repository. Nothing here builds
    // markup, but a newline or an escape sequence has no business reaching
    // the DOM either.
    expect(findingLocationLabel({ file: "src/\u001b[31mevil\n.ts" })).toBe(
      "src/[31mevil.ts",
    );
  });

  it("keeps non-ASCII path characters, which are legal in a repository", () => {
    expect(findingLocationLabel({ file: "src/café/ünicode.ts" })).toBe(
      "src/café/ünicode.ts",
    );
  });

  it("bounds a very long path, keeping the filename", () => {
    const long = `${"nested/".repeat(40)}secrets.ts`;
    const label = findingLocationLabel({ file: long, line: 7 })!;
    expect(label.length).toBeLessThanOrEqual(96 + ":7".length);
    expect(label.startsWith("...")).toBe(true);
    expect(label.endsWith("secrets.ts:7")).toBe(true);
  });

  it("returns null when the path was nothing but control characters", () => {
    expect(findingLocationLabel({ file: "\u0000\u0001\u007f" })).toBeNull();
  });
});
