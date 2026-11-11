import { describe, it, expect, vi } from "vitest";

const store = globalThis as unknown as Record<symbol, unknown>;

/**
 * Next bundles a server module once per runtime layer. vi.resetModules() and a
 * fresh import is the closest a unit test gets to a second bundle copy: a new
 * module instance with its own top-level scope, in the same process.
 */
async function freshCopy() {
  vi.resetModules();
  return import("@/lib/runtime/global-singleton");
}

describe("globalSingleton", () => {
  it("runs init once and hands every caller the same value", async () => {
    const { globalSingleton } = await freshCopy();
    const init = vi.fn(() => new Set<number>());
    const a = globalSingleton("vulnradar.test.once", init);
    const b = globalSingleton("vulnradar.test.once", init);
    expect(a).toBe(b);
    expect(init).toHaveBeenCalledTimes(1);
    delete store[Symbol.for("vulnradar.test.once")];
  });

  it("shares the value between two copies of the module", async () => {
    const first = await freshCopy();
    const second = await freshCopy();
    expect(first.globalSingleton).not.toBe(second.globalSingleton);

    const fromFirst = first.globalSingleton(
      "vulnradar.test.copies",
      () => new Map<string, number>(),
    );
    fromFirst.set("seen", 1);
    const fromSecond = second.globalSingleton(
      "vulnradar.test.copies",
      () => new Map<string, number>(),
    );
    expect(fromSecond).toBe(fromFirst);
    expect(fromSecond.get("seen")).toBe(1);
    delete store[Symbol.for("vulnradar.test.copies")];
  });

  it("keeps different keys apart", async () => {
    const { globalSingleton } = await freshCopy();
    const a = globalSingleton("vulnradar.test.a", () => ({ n: 1 }));
    const b = globalSingleton("vulnradar.test.b", () => ({ n: 2 }));
    expect(a).not.toBe(b);
    expect(b.n).toBe(2);
    delete store[Symbol.for("vulnradar.test.a")];
    delete store[Symbol.for("vulnradar.test.b")];
  });

  it("stores under a registered symbol, so the slot never enumerates as a string key", async () => {
    const { globalSingleton } = await freshCopy();
    const value = globalSingleton("vulnradar.test.slot", () => ({ ok: true }));
    expect(store[Symbol.for("vulnradar.test.slot")]).toBe(value);
    expect(Object.keys(globalThis)).not.toContain("vulnradar.test.slot");
    delete store[Symbol.for("vulnradar.test.slot")];
  });

  it("shares the slot with the local copies db.ts and runtime-config.ts carry until they import it", async () => {
    // Same key scheme as those copies (Symbol.for(key) on globalThis), so a
    // module that switches to this helper keeps the object already created.
    const existing = { pool: "already built" };
    store[Symbol.for("vulnradar.test.preexisting")] = existing;
    const { globalSingleton } = await freshCopy();
    const init = vi.fn(() => ({ pool: "second" }));
    expect(globalSingleton("vulnradar.test.preexisting", init)).toBe(existing);
    expect(init).not.toHaveBeenCalled();
    delete store[Symbol.for("vulnradar.test.preexisting")];
  });
});
