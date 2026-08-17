import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

import { queryOsv } from "@/lib/scanner/osv-lookup";

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
    expect(vulns).toEqual([{ id: "GHSA-1", aliases: [], severity: [] }]);
  });
});
