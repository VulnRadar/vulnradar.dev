/**
 * extractCheckId moved to a module with no database import so the finding
 * page, the SARIF export and the check-page link can use it in a browser
 * bundle. check-accuracy.ts re-exports it, and everything that imported it
 * from there still has to get the same function.
 *
 * No pool mock here on purpose: importing check-id.ts must not need one.
 */
import { describe, it, expect, vi } from "vitest";
import { extractCheckId } from "@/lib/scanner/check-id";

describe("extractCheckId", () => {
  it("strips the trailing hash", () => {
    expect(extractCheckId("hsts-missing--abc123")).toBe("hsts-missing");
  });

  it("returns an id with no hash unchanged", () => {
    expect(extractCheckId("hsts-missing")).toBe("hsts-missing");
  });

  it("splits at the last separator, so a title slug ending in a dash survives", () => {
    // "Weak SPF Record (+all)" slugs to `async-weak-spf-record-all-`, and the
    // finding id appends `--<hash>` to that.
    expect(extractCheckId("async-weak-spf-record-all---k3j9")).toBe(
      "async-weak-spf-record-all-",
    );
  });

  it("opens no database connection when imported", async () => {
    vi.resetModules();
    vi.doMock("@/lib/database/db", () => {
      throw new Error("check-id.ts must not import the pool");
    });
    await expect(import("@/lib/scanner/check-id")).resolves.toBeDefined();
    vi.doUnmock("@/lib/database/db");
  });

  it("is the function check-accuracy.ts re-exports", async () => {
    vi.resetModules();
    vi.doMock("@/lib/database/db", () => ({ default: { query: vi.fn() } }));
    const accuracy = await import("@/lib/scanner/check-accuracy");
    const pure = await import("@/lib/scanner/check-id");
    expect(accuracy.extractCheckId).toBe(pure.extractCheckId);
    vi.doUnmock("@/lib/database/db");
  });
});
