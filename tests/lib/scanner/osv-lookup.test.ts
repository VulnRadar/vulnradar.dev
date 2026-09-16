import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

import { fixedVersionFor, queryOsv } from "@/lib/scanner/osv-lookup";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(5000);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("queryOsv", () => {
  it("posts the package + version to OSV.dev's query endpoint", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ vulns: [] }),
    });

    await queryOsv("npm", "jquery", "1.8.2");

    expect(fetch).toHaveBeenCalledWith(
      "https://api.osv.dev/v1/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          version: "1.8.2",
          package: { name: "jquery", ecosystem: "npm" },
        }),
      }),
    );
  });

  it("parses vulns with aliases and CVSS severity from a real-shaped response", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          vulns: [
            {
              id: "GHSA-gxr4-xjj5-5px2",
              aliases: ["CVE-2020-11022"],
              summary: "jQuery XSS via .html()",
              details: "Full details here.",
              severity: [
                {
                  type: "CVSS_V3",
                  score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N",
                },
              ],
            },
          ],
        }),
    });

    const vulns = await queryOsv("npm", "jquery", "1.8.2");
    expect(vulns).toHaveLength(1);
    expect(vulns[0].id).toBe("GHSA-gxr4-xjj5-5px2");
    expect(vulns[0].aliases).toEqual(["CVE-2020-11022"]);
    expect(vulns[0].summary).toBe("jQuery XSS via .html()");
    expect(vulns[0].severity).toEqual([
      {
        type: "CVSS_V3",
        score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N",
      },
    ]);
  });

  it("returns [] when OSV.dev finds nothing for this version", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const vulns = await queryOsv("npm", "jquery", "3.7.1");
    expect(vulns).toEqual([]);
  });

  it("returns [] on a non-ok response", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });
    const vulns = await queryOsv("npm", "jquery", "1.8.2");
    expect(vulns).toEqual([]);
  });

  it("fails open (returns []) when the request throws", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error"),
    );
    const vulns = await queryOsv("npm", "jquery", "1.8.2");
    expect(vulns).toEqual([]);
  });

  it("fails open when the response body is malformed (vulns is not an array)", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ vulns: "not-an-array" }),
    });
    const vulns = await queryOsv("npm", "jquery", "1.8.2");
    expect(vulns).toEqual([]);
  });

  it("skips a vuln entry with no id rather than throwing", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          vulns: [{ summary: "no id here" }, { id: "GHSA-1" }],
        }),
    });
    const vulns = await queryOsv("npm", "jquery", "1.8.2");
    expect(vulns).toEqual([
      { id: "GHSA-1", aliases: [], severity: [], affected: [] },
    ]);
  });
});

describe("affected intervals", () => {
  // The shape api.osv.dev/v1/query returned for jquery@1.12.4 on
  // GHSA-rmxg-73gg-4p98 (CVE-2015-9251): two SEMVER ranges for jquery, plus
  // an entry for a different package that must not leak in.
  const RAW = {
    id: "GHSA-rmxg-73gg-4p98",
    aliases: ["CVE-2015-9251"],
    affected: [
      {
        package: { name: "jquery", ecosystem: "npm" },
        ranges: [
          {
            type: "SEMVER",
            events: [{ introduced: "0" }, { fixed: "1.12.2" }],
          },
          {
            type: "SEMVER",
            events: [{ introduced: "1.12.3" }, { fixed: "3.0.0" }],
          },
          { type: "GIT", events: [{ introduced: "abc123" }, { fixed: "def" }] },
        ],
      },
      {
        package: { name: "jquery-rails", ecosystem: "RubyGems" },
        ranges: [
          {
            type: "ECOSYSTEM",
            events: [{ introduced: "0" }, { fixed: "9.9.9" }],
          },
        ],
      },
    ],
  };

  async function parsed(raw: unknown, packageName = "jquery") {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ vulns: [raw] }),
    });
    const [vuln] = await queryOsv("npm", packageName, "1.12.4");
    return vuln;
  }

  it("keeps only the queried package's version ranges", async () => {
    const vuln = await parsed(RAW);
    expect(vuln.affected).toEqual([
      { introduced: "0", fixed: "1.12.2" },
      { introduced: "1.12.3", fixed: "3.0.0" },
    ]);
  });

  it("finds the release that fixes the interval a version falls in", async () => {
    const vuln = await parsed(RAW);
    expect(fixedVersionFor(vuln, "1.12.4")).toBe("3.0.0");
    expect(fixedVersionFor(vuln, "1.9.1")).toBe("1.12.2");
    // 1.12.2 is the fix for the first interval and before the second.
    expect(fixedVersionFor(vuln, "1.12.2")).toBeUndefined();
  });

  it("reads last_affected as affected with no fixed release", async () => {
    const vuln = await parsed(
      {
        id: "GHSA-x",
        affected: [
          {
            package: { name: "tinymce", ecosystem: "npm" },
            ranges: [
              {
                type: "ECOSYSTEM",
                events: [{ introduced: "0" }, { last_affected: "5.10.9" }],
              },
            ],
          },
        ],
      },
      "tinymce",
    );
    expect(vuln.affected).toEqual([
      { introduced: "0", lastAffected: "5.10.9" },
    ]);
    expect(fixedVersionFor(vuln, "5.10.9")).toBeNull();
    expect(fixedVersionFor(vuln, "5.10.10")).toBeUndefined();
  });

  it("treats an interval that never closes as unfixed", async () => {
    const vuln = await parsed({
      id: "GHSA-open",
      affected: [
        {
          package: { name: "jquery", ecosystem: "npm" },
          ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.0" }] }],
        },
      ],
    });
    expect(fixedVersionFor(vuln, "1.12.4")).toBeNull();
    expect(fixedVersionFor(vuln, "0.9.0")).toBeUndefined();
  });
});
