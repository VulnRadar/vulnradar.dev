import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VULNRADAR } from "../../../extension/src/lib/constants";

/**
 * The privacy policy states how often the extension's Site Alerts may look a
 * site up. The number lives in extension/src/lib/constants.ts; the policy is
 * prose, so it is written out by hand, and a legal statement about data
 * collection is the last place a stale number belongs.
 */
const ROOT = path.resolve(__dirname, "..", "..", "..");

describe("privacy policy claims about the browser extension", () => {
  const policy = readFileSync(
    path.join(ROOT, "app/legal/privacy/page.tsx"),
    "utf8",
  );

  it("states the Site Alerts lookup interval the extension actually uses", () => {
    const stated = /at\s+most\s+once\s+every\s+(\d+)\s+seconds/.exec(policy);
    expect(stated, "interval sentence not found").toBeTruthy();
    expect(Number(stated![1])).toBe(VULNRADAR.reputationThrottleMs / 1000);
  });

  it("does not claim page titles are sent", () => {
    expect(policy).not.toMatch(/\(and page title\)/);
  });
});
