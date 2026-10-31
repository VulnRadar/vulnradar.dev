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

  it("words a missing minor or patch the same way as a 0", () => {
    expect(compareVersions("3", "3.1").message).toMatch(/newer version/i);
    expect(compareVersions("3", "5").message).toMatch(
      /2 major versions behind/i,
    );
    expect(compareVersions("3.1", "3.1.1").message).toMatch(/patch update/i);
  });
});

// The check used to read only the first three dot-separated numbers, so the
// "-rc.1" in 4.0.0-rc.1 became part of a patch number that parsed as 0 and a
// release candidate was told it was up to date when 4.0.0 shipped.
describe("compareVersions with prerelease versions", () => {
  it("reports a release candidate as behind the release it leads up to", () => {
    const result = compareVersions("4.0.0-rc.1", "4.0.0");
    expect(result.status).toBe("behind");
    // The numbers are the same; only the tag moved, so it is a patch update.
    expect(result.message).toMatch(/patch update/i);
    expect(result.message).toContain("v4.0.0");
  });

  it("reports the release as ahead of its own release candidate", () => {
    expect(compareVersions("4.0.0", "4.0.0-rc.1").status).toBe("ahead");
  });

  it("orders two release candidates", () => {
    expect(compareVersions("4.0.0-rc.1", "4.0.0-rc.2").status).toBe("behind");
    expect(compareVersions("4.0.0-rc.2", "4.0.0-rc.1").status).toBe("ahead");
    expect(compareVersions("4.0.0-rc.2", "4.0.0-rc.2").status).toBe(
      "up-to-date",
    );
  });

  it("counts a major version behind from the numbers, ignoring the tag", () => {
    const result = compareVersions("3.9.1", "4.0.0-rc.1");
    expect(result.status).toBe("behind");
    expect(result.message).toMatch(/1 major version behind/i);
  });

  it("does not let a tag on the running version hide a newer minor", () => {
    const result = compareVersions("3.9.0-rc.1", "3.10.0");
    expect(result.status).toBe("behind");
    expect(result.message).toMatch(/newer version/i);
  });

  it("accepts a leading v on either side", () => {
    expect(compareVersions("v4.0.0", "4.0.0").status).toBe("up-to-date");
    expect(compareVersions("4.0.0", "v4.0.1").status).toBe("behind");
  });
});
