import { describe, it, expect } from "vitest";
import { compareVersions } from "@/lib/updater/version-compare";

describe("compareVersions", () => {
  it("reports up-to-date when current equals latest", () => {
    const result = compareVersions("3.0.1", "3.0.1");
    expect(result.status).toBe("up-to-date");
    expect(result.message).toBe("You're running the latest version.");
  });

  it("reports a patch update when only the patch number is behind", () => {
    const result = compareVersions("3.0.1", "3.0.2");
    expect(result.status).toBe("behind");
    expect(result.message).toMatch(/patch update/i);
    expect(result.message).toContain("v3.0.2");
  });

  it("reports a minor update when the minor number is behind", () => {
    const result = compareVersions("3.0.1", "3.1.0");
    expect(result.status).toBe("behind");
    expect(result.message).toMatch(/newer version/i);
    expect(result.message).toContain("v3.1.0");
  });

  it("reports strongly-recommended when a major version behind", () => {
    const result = compareVersions("3.0.1", "4.0.0");
    expect(result.status).toBe("behind");
    expect(result.message).toMatch(/1 major version behind/i);
    expect(result.message).toMatch(/strongly recommended/i);
  });

  it("pluralizes 'major versions' when more than one behind", () => {
    const result = compareVersions("3.0.1", "5.0.0");
    expect(result.status).toBe("behind");
    expect(result.message).toMatch(/2 major versions behind/i);
  });

  it("reports ahead when current is newer than latest", () => {
    const result = compareVersions("9.9.9", "3.0.1");
    expect(result.status).toBe("ahead");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("treats missing version parts as zero", () => {
    // "3.0" has no patch component -- should compare as 3.0.0.
    const result = compareVersions("3.0", "3.0.1");
    expect(result.status).toBe("behind");
  });

  it("is deterministic for equal versions regardless of call order", () => {
    expect(compareVersions("1.2.3", "1.2.3").status).toBe("up-to-date");
    expect(compareVersions("0.0.0", "0.0.0").status).toBe("up-to-date");
  });
});
