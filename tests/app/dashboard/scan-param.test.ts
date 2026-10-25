/**
 * What /dashboard does with ?scan= (app/dashboard/scan-param.ts).
 *
 * The page cannot be mounted here, so the decision it makes in an effect lives
 * in a function and is tested through the same grant the page passes in.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  scanParamIsTarget,
  scanParamPrefill,
  scanParamToStart,
} from "@/app/dashboard/scan-param";
import { armScanAgain, consumeScanAgain } from "@/lib/ui/scan-again";

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scanParamIsTarget", () => {
  it("reads hosts and URLs as targets", () => {
    for (const value of [
      "example.com",
      "https://example.com/path",
      "203.0.113.10",
      "localhost:3000",
    ]) {
      expect(scanParamIsTarget(value)).toBe(true);
    }
  });

  it("reads a saved scan's id as not a target", () => {
    expect(scanParamIsTarget("a1b2c3d4e5f60718")).toBe(false);
    expect(scanParamIsTarget("12345")).toBe(false);
  });
});

describe("a ?scan= target without a grant", () => {
  it("sends no scan", () => {
    // The whole point: a link from another site is not a click.
    vi.stubGlobal("sessionStorage", memoryStorage());
    const consume = vi.fn(consumeScanAgain);

    expect(
      scanParamToStart("https://victim-target.test/", false, consume),
    ).toBeNull();
  });

  it("still prefills the form with the target", () => {
    expect(scanParamPrefill("https://victim-target.test/")).toBe(
      "https://victim-target.test/",
    );
  });
});

describe("a ?scan= target the person armed", () => {
  it("starts exactly that scan, once", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    armScanAgain("https://example.com/");

    expect(
      scanParamToStart("https://example.com/", false, consumeScanAgain),
    ).toBe("https://example.com/");
    // The effect runs twice in development and again on every param change.
    expect(
      scanParamToStart("https://example.com/", false, consumeScanAgain),
    ).toBeNull();
  });

  it("is not started for a different target than the one armed", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    armScanAgain("https://example.com/");

    expect(
      scanParamToStart("https://other.test/", false, consumeScanAgain),
    ).toBeNull();
  });

  it("does not spend the grant while a scan is already running", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    armScanAgain("https://example.com/");

    expect(
      scanParamToStart("https://example.com/", true, consumeScanAgain),
    ).toBeNull();
    expect(
      scanParamToStart("https://example.com/", false, consumeScanAgain),
    ).toBe("https://example.com/");
  });
});

describe("a ?scan= that is not a target", () => {
  it("never starts or prefills", () => {
    const consume = vi.fn(() => true);
    expect(scanParamToStart(null, false, consume)).toBeNull();
    expect(scanParamToStart("a1b2c3d4e5f60718", false, consume)).toBeNull();
    expect(consume).not.toHaveBeenCalled();

    expect(scanParamPrefill(null)).toBeUndefined();
    expect(scanParamPrefill("a1b2c3d4e5f60718")).toBeUndefined();
  });
});
