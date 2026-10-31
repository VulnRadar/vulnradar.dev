import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CONFIG_CRAWL_PAGE_FETCH_TIMEOUT_MS,
  CONFIG_SCAN_FETCH_TIMEOUT_MS,
} from "@/lib/config/config-values";
import { SETTINGS_REGISTRY } from "@/lib/config/registry";

/**
 * The troubleshooting page used to say each page fetch has a 15 second
 * timeout. That is the shipped default of an admin setting
 * (SCAN_FETCH_TIMEOUT_MS), which can be raised to 120 seconds, so the page
 * now says "default" and quotes the ceiling. Every number in the sentence
 * comes from code, so a retune of either setting changes the page with it.
 */

const ROOT = path.resolve(__dirname, "../../..");
const page = readFileSync(
  path.join(ROOT, "app/docs/troubleshooting/page.tsx"),
  "utf8",
);
const flat = page.replace(/\s+/g, " ");

describe("troubleshooting: per-request timeouts", () => {
  it("both limits really are runtime admin settings", () => {
    expect(SETTINGS_REGISTRY.SCAN_FETCH_TIMEOUT_MS.tier).toBe("runtime");
    expect(SETTINGS_REGISTRY.CRAWL_PAGE_FETCH_TIMEOUT_MS.tier).toBe("runtime");
    expect(SETTINGS_REGISTRY.SCAN_FETCH_TIMEOUT_MS.default).toBe(
      CONFIG_SCAN_FETCH_TIMEOUT_MS,
    );
    expect(SETTINGS_REGISTRY.CRAWL_PAGE_FETCH_TIMEOUT_MS.default).toBe(
      CONFIG_CRAWL_PAGE_FETCH_TIMEOUT_MS,
    );
  });

  it("calls the numbers defaults and quotes the ceiling from the registry", () => {
    expect(flat).toContain(
      "The defaults are {CONFIG_SCAN_FETCH_TIMEOUT_MS / 1000}",
    );
    expect(flat).toContain("{CONFIG_CRAWL_PAGE_FETCH_TIMEOUT_MS / 1000}");
    expect(flat).toContain("both are admin settings");
    expect(flat).toContain(
      "{SETTINGS_REGISTRY.SCAN_FETCH_TIMEOUT_MS.max / 1000}",
    );
    expect(flat).toContain(
      "{SETTINGS_REGISTRY.CRAWL_PAGE_FETCH_TIMEOUT_MS.max / 1000}",
    );
  });

  it("does not hardcode a timeout number in the copy", () => {
    expect(flat).not.toMatch(/\b15 seconds\b/);
    expect(flat).not.toMatch(/\b120 seconds\b/);
  });

  it("has no em dash in the copy", () => {
    expect(page).not.toContain("—");
  });
});
