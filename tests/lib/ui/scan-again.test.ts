/**
 * The grant that lets a /dashboard?scan= link start a scan by itself
 * (lib/ui/scan-again.ts).
 *
 * The property that matters is the negative one: a link that did not come from
 * a control the person clicked must not be able to spend their scans. Every
 * case below is a way of arriving without the grant, or with one that should
 * not count.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { armScanAgain, consumeScanAgain } from "@/lib/ui/scan-again";

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    size: () => store.size,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const TARGET = "https://example.com/";

describe("scan-again grant", () => {
  it("does not cover a link nobody armed", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    expect(consumeScanAgain(TARGET)).toBe(false);
  });

  it("covers the target that was armed, once", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    armScanAgain(TARGET, 1_000);

    expect(consumeScanAgain(TARGET, 2_000)).toBe(true);
    // Spent. A reload, a second effect run or a replayed link finds nothing.
    expect(consumeScanAgain(TARGET, 2_001)).toBe(false);
  });

  it("does not cover a different target, and is spent by looking", () => {
    // An armed grant for one site must not authorise a link to another, and a
    // mismatch must not leave the grant behind for a later link to pick up.
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    armScanAgain(TARGET, 1_000);

    expect(consumeScanAgain("https://attacker.test/", 1_500)).toBe(false);
    expect(storage.size()).toBe(0);
    expect(consumeScanAgain(TARGET, 1_600)).toBe(false);
  });

  it("lapses if the navigation it was armed for never happened", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    armScanAgain(TARGET, 1_000);

    expect(consumeScanAgain(TARGET, 1_000 + 31_000)).toBe(false);
  });

  it("still covers a slow navigation inside the window", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    armScanAgain(TARGET, 1_000);

    expect(consumeScanAgain(TARGET, 1_000 + 10_000)).toBe(true);
  });

  it("treats a garbled entry as no grant instead of throwing", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    storage.setItem("vulnradar:scan-again", "{not json");
    expect(consumeScanAgain(TARGET)).toBe(false);

    storage.setItem(
      "vulnradar:scan-again",
      JSON.stringify({ url: TARGET, expiresAt: "never" }),
    );
    expect(consumeScanAgain(TARGET)).toBe(false);
  });

  it("falls back to no grant when storage throws", () => {
    // A private window or blocked site data: the link still lands on a
    // prefilled form, which is the safe outcome, so neither call may throw.
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("sessionStorage", throwing);

    expect(() => armScanAgain(TARGET)).not.toThrow();
    expect(consumeScanAgain(TARGET)).toBe(false);
  });
});
