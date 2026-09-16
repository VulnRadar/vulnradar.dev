import { describe, it, expect } from "vitest";
import { parseScannerSelection } from "@/lib/scanner/scanner-selection";

describe("parseScannerSelection", () => {
  it("treats an omitted or empty filter as every default category", () => {
    expect(parseScannerSelection(undefined)).toEqual({
      ok: true,
      scanners: null,
    });
    expect(parseScannerSelection(null)).toEqual({ ok: true, scanners: null });
    expect(parseScannerSelection([])).toEqual({ ok: true, scanners: null });
  });

  it("accepts categories and active-probe selectors, without duplicates", () => {
    expect(
      parseScannerSelection([
        "headers",
        "dns",
        "active-probes:xss",
        "headers",
        "active-probes",
      ]),
    ).toEqual({
      ok: true,
      scanners: ["headers", "dns", "active-probes:xss", "active-probes"],
    });
  });

  it("refuses a name that selects nothing, which used to run zero checks", () => {
    const result = parseScannerSelection(["headers", "headerz"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('"headerz"');
      expect(result.error).toContain("supply-chain");
    }
  });

  it("refuses an unknown probe and a non-string entry", () => {
    expect(parseScannerSelection(["active-probes:rce"]).ok).toBe(false);
    expect(parseScannerSelection([42]).ok).toBe(false);
  });

  it("refuses a filter that is not an array, or is absurdly long", () => {
    expect(parseScannerSelection("headers").ok).toBe(false);
    expect(parseScannerSelection(Array(65).fill("headers")).ok).toBe(false);
  });
});
