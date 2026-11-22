/**
 * The downgrade description is what an operator reads before running a
 * downgrade. It named the webhook addresses the downgrade loses but left out
 * the larger loss: 4.0.0 stores API keys only as a one-way digest and clears
 * the encrypted copy and the locator at boot, so after a downgrade no older
 * release can validate any key.
 */
import { describe, it, expect } from "vitest";

const mod = await import("@/scripts/migrate/versions/2.0.0-to-3.0.0.mjs");

describe("2.0.0-to-3.0.0 downgrade warning", () => {
  const text: string = mod.downgrade.description;

  it("says every API key stops working on an older release", () => {
    expect(text).toMatch(/EVERY API key stop working/);
    expect(text).toMatch(/one-way digest/);
  });

  it("points at the pre-upgrade backup for the keys, as it does for webhooks", () => {
    const keys = text.slice(text.indexOf("EVERY API key"));
    expect(keys).toMatch(/restore the pre-upgrade backup/);
  });
});
