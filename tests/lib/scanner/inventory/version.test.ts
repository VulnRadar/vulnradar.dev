import { describe, expect, it } from "vitest";
import {
  chooseVersion,
  normalizeVersion,
} from "@/lib/scanner/inventory/version";

describe("normalizeVersion", () => {
  it("calls a single number a major version", () => {
    expect(normalizeVersion("10")).toEqual({ version: "10", kind: "major" });
    expect(normalizeVersion("10", 1)).toEqual({ version: "10", kind: "major" });
  });

  it("reads 6.4 as exact for a product that needs two components and partial for three", () => {
    expect(normalizeVersion("6.4", 2)).toEqual({
      version: "6.4",
      kind: "exact",
    });
    expect(normalizeVersion("6.4", 3)).toEqual({
      version: "6.4",
      kind: "partial",
    });
    expect(normalizeVersion("6.4")).toEqual({
      version: "6.4",
      kind: "partial",
    });
  });

  it("calls three components exact by default", () => {
    expect(normalizeVersion("1.18.0")).toEqual({
      version: "1.18.0",
      kind: "exact",
    });
    expect(normalizeVersion("8.4.27")).toEqual({
      version: "8.4.27",
      kind: "exact",
    });
  });

  it("drops a prerelease suffix and says so", () => {
    expect(normalizeVersion("7.2-beta3-65106")).toEqual({
      version: "7.2",
      kind: "prerelease",
    });
    expect(normalizeVersion("8.0.0-rc.1")).toEqual({
      version: "8.0.0",
      kind: "prerelease",
    });
    expect(normalizeVersion("2.0.0alpha")).toEqual({
      version: "2.0.0",
      kind: "prerelease",
    });
    expect(normalizeVersion("1.2.3a1")).toEqual({
      version: "1.2.3",
      kind: "prerelease",
    });
  });

  it("keeps the patch letter, which is a different release", () => {
    expect(normalizeVersion("1.1.1f")).toEqual({
      version: "1.1.1f",
      kind: "exact",
    });
    expect(normalizeVersion("1.0.2k-fips")).toEqual({
      version: "1.0.2k",
      kind: "exact",
    });
  });

  it("strips a leading v", () => {
    expect(normalizeVersion("v5.3", 2)).toEqual({
      version: "5.3",
      kind: "exact",
    });
    expect(normalizeVersion("V5.3.1")).toEqual({
      version: "5.3.1",
      kind: "exact",
    });
  });

  it("treats a packaging suffix as part of the release, not a prerelease", () => {
    expect(normalizeVersion("1.18.0-0ubuntu1")).toEqual({
      version: "1.18.0",
      kind: "exact",
    });
    expect(normalizeVersion("2.4.57+deb11u2")).toEqual({
      version: "2.4.57",
      kind: "exact",
    });
  });

  it("returns null when there is no leading number", () => {
    expect(normalizeVersion("")).toBeNull();
    expect(normalizeVersion("latest")).toBeNull();
    expect(normalizeVersion("x.y.z")).toBeNull();
  });

  it("bounds the input it reads", () => {
    const result = normalizeVersion(`1.2.3${"9".repeat(10_000)}`);
    expect(result?.version.length).toBeLessThanOrEqual(64);
  });
});

describe("chooseVersion", () => {
  const v = (version: string, weight: number) => ({
    version,
    kind: "exact" as const,
    weight,
  });

  it("returns null with no candidates", () => {
    expect(chooseVersion([])).toBeNull();
  });

  it("prefers the highest weight", () => {
    expect(chooseVersion([v("6.1.0", 80), v("6.4.2", 99)])?.version).toBe(
      "6.4.2",
    );
  });

  it("takes the earlier rule on a tie", () => {
    expect(chooseVersion([v("1.0.0", 70), v("2.0.0", 70)])?.version).toBe(
      "1.0.0",
    );
  });

  it("marks the version partial when two strong rules disagree", () => {
    const chosen = chooseVersion([v("6.4.2", 99), v("6.3.1", 90)]);
    expect(chosen).toMatchObject({ version: "6.4.2", kind: "partial" });
  });

  it("does not mark a conflict when the strong rules agree", () => {
    const chosen = chooseVersion([v("6.4.2", 99), v("6.4.2", 90)]);
    expect(chosen?.kind).toBe("exact");
  });

  it("does not let a weak rule that disagrees downgrade a strong one", () => {
    const chosen = chooseVersion([v("6.4.2", 99), v("5.0.0", 50)]);
    expect(chosen).toMatchObject({ version: "6.4.2", kind: "exact" });
  });

  it("leaves the candidate's other fields alone", () => {
    const chosen = chooseVersion([{ ...v("1.2.3", 99), extra: "kept" }]);
    expect(chosen?.extra).toBe("kept");
  });
});
