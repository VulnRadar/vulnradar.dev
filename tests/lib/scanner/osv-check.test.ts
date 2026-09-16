import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSafeFetch = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/safe-fetch")>();
  return {
    ...actual,
    safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  };
});

// osv-lookup reads its timeout from runtime settings; only its pure interval
// reader is used for real here, so the settings module never needs a database.
vi.mock("@/lib/config/runtime-config", () => ({ getSetting: vi.fn() }));

const mockQueryOsv = vi.fn();
vi.mock("@/lib/scanner/osv-lookup", async (importOriginal) => ({
  // The real interval reader, so these tests cover the upgrade the finding
  // names from the same data shape OSV.dev returns.
  fixedVersionFor: (
    await importOriginal<typeof import("@/lib/scanner/osv-lookup")>()
  ).fixedVersionFor,
  queryOsv: (...args: unknown[]) => mockQueryOsv(...args),
}));

import { checkOsvVulnerableLibraries } from "@/lib/scanner/osv-check";
import { generateId } from "@/lib/scanner/_helpers";

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

const JQUERY_PAGE = `<html><body><script src="https://code.jquery.com/jquery-1.8.2.min.js"></script></body></html>`;
const TWO_LIBRARIES_PAGE = `
<html><body>
<script src="/vendor/jquery-1.12.4.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/vue@3.2.0/dist/vue.global.js"></script>
</body></html>
`;
const NO_LIBRARIES_PAGE = `<html><body><script src="/app.bundle.js"></script></body></html>`;

function cvssVuln(
  id: string,
  vector: string,
  aliases: string[] = [],
  affected: Array<{
    introduced: string;
    fixed?: string;
    lastAffected?: string;
  }> = [],
) {
  return {
    id,
    aliases,
    summary: `Summary for ${id}`,
    severity: [{ type: "CVSS_V3", score: vector }],
    affected,
  };
}

beforeEach(() => {
  mockSafeFetch.mockReset();
  mockQueryOsv.mockReset();
  mockQueryOsv.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkOsvVulnerableLibraries", () => {
  it("returns [] when the page references no recognizable library", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(NO_LIBRARIES_PAGE));
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings).toEqual([]);
    expect(mockQueryOsv).not.toHaveBeenCalled();
  });

  it("queries OSV.dev for a detected library at its exact version", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    await checkOsvVulnerableLibraries("https://example.com");
    expect(mockQueryOsv).toHaveBeenCalledWith("npm", "jquery", "1.8.2");
  });

  it("throws when OSV.dev answered none of the lookups, so the branch reads as not checked", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue(null);
    await expect(
      checkOsvVulnerableLibraries("https://example.com"),
    ).rejects.toThrow(/OSV\.dev answered none/);
  });

  it("still reports what it found when only some lookups failed", async () => {
    mockSafeFetch.mockResolvedValueOnce(
      htmlResponse(
        '<script src="https://code.jquery.com/jquery-1.8.2.min.js"></script>' +
          '<script src="https://unpkg.com/vue@3.2.0/dist/vue.global.js"></script>',
      ),
    );
    mockQueryOsv.mockImplementation(async (_eco: string, pkg: string) =>
      pkg === "jquery"
        ? [
            cvssVuln(
              "GHSA-gxr4-xjj5-5px2",
              "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N",
              ["CVE-2020-11022"],
            ),
          ]
        : null,
    );
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings).toHaveLength(1);
    expect(findings[0].component).toBe("jquery@1.8.2");
  });

  it("returns [] when OSV.dev has no advisory for this exact version", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([]);
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings).toEqual([]);
  });

  it("builds one finding for a library version from every advisory, with CVE ids and the worst real CVSS score", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([
      cvssVuln(
        "GHSA-6c3j-c64m-qhgq",
        "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
        ["CVE-2019-11358"],
      ),
      cvssVuln(
        "GHSA-gxr4-xjj5-5px2",
        "CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:L/A:N",
        ["CVE-2020-11022"],
      ),
    ]);

    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding.id).toBe(
      generateId(
        "osv-vulnerable-library",
        "https://example.com",
        "jquery@1.8.2",
      ),
    );
    expect(finding.component).toBe("jquery@1.8.2");
    expect(finding.category).toBe("supply-chain");
    expect(finding.severity).toBe("medium");
    expect(finding.cveIds?.sort()).toEqual([
      "CVE-2019-11358",
      "CVE-2020-11022",
    ]);
    // The worst of the two: 6.9 beats 6.1.
    expect(finding.cvssVector).toBe(
      "CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:L/A:N",
    );
    expect(finding.cvssScore).toBe(6.9);
    expect(finding.evidence).toContain("jQuery 1.8.2");
    expect(finding.evidence).toContain("2 OSV advisories");
    expect(finding.evidence.indexOf("GHSA-gxr4-xjj5-5px2")).toBeLessThan(
      finding.evidence.indexOf("GHSA-6c3j-c64m-qhgq"),
    );
    expect(finding.references).toEqual(
      expect.arrayContaining([
        "https://osv.dev/vulnerability/GHSA-gxr4-xjj5-5px2",
        "https://osv.dev/vulnerability/GHSA-6c3j-c64m-qhgq",
      ]),
    );
    expect(finding.evidenceExcerpts).toEqual([
      {
        label: "script src",
        value: "https://code.jquery.com/jquery-1.8.2.min.js",
      },
    ]);
  });

  it("reports high when OSV scores none of the advisories", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([
      { id: "GHSA-no-score", aliases: [], severity: [], affected: [] },
    ]);
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].cvssVector).toBeUndefined();
  });

  it("does not let an unscored advisory raise the severity of scored ones", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([
      { id: "GHSA-v4-only", aliases: [], severity: [], affected: [] },
      cvssVuln("GHSA-low", "CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N"),
    ]);
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings[0].severity).toBe("low");
  });

  it("rates an advisory with no CVSS 3.x vector by the advisory database's own severity", async () => {
    // A GitHub advisory published with only a CVSS 4.0 vector still says
    // CRITICAL in database_specific; it must not count for nothing.
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([
      {
        id: "GHSA-v4-critical",
        aliases: [],
        severity: [],
        databaseSeverity: "critical",
        affected: [],
      },
      cvssVuln("GHSA-low", "CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N"),
    ]);
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings[0].severity).toBe("critical");
  });

  it("buckets a critical-scored advisory as critical severity", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([
      cvssVuln("GHSA-med", "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N"),
      cvssVuln("GHSA-critical", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H"),
    ]);
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings[0].severity).toBe("critical");
  });

  it("names the one upgrade that fixes every advisory", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([
      cvssVuln(
        "GHSA-a",
        "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
        [],
        [
          { introduced: "0", fixed: "1.12.2" },
          { introduced: "1.12.3", fixed: "3.0.0" },
        ],
      ),
      cvssVuln(
        "GHSA-b",
        "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
        [],
        [{ introduced: "1.0.3", fixed: "3.5.0" }],
      ),
    ]);
    const [finding] = await checkOsvVulnerableLibraries("https://example.com");
    expect(finding.evidence).toContain("3.5.0 or later fixes all of them.");
  });

  it("says so when OSV records no fixed release, rather than naming one", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([
      cvssVuln(
        "GHSA-a",
        "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
        [],
        [{ introduced: "0", fixed: "3.5.0" }],
      ),
      cvssVuln(
        "GHSA-b",
        "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
        [],
        [{ introduced: "0", lastAffected: "3.7.1" }],
      ),
    ]);
    const [finding] = await checkOsvVulnerableLibraries("https://example.com");
    expect(finding.evidence).not.toContain("or later fixes");
    expect(finding.evidence).toContain(
      "OSV records no fixed release for 1 of them",
    );
  });

  it("keeps every advisory: spells out the worst five and counts the rest", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([
      cvssVuln("GHSA-low", "CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N"),
      cvssVuln("GHSA-critical", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H"),
      cvssVuln("GHSA-med-1", "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N"),
      cvssVuln("GHSA-med-2", "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N"),
      cvssVuln("GHSA-med-3", "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N"),
      cvssVuln("GHSA-med-4", "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N"),
    ]);
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.evidence).toContain("6 OSV advisories");
    expect(finding.evidence.startsWith("jQuery 1.8.2")).toBe(true);
    expect(finding.evidence).toContain("GHSA-critical");
    expect(finding.evidence).not.toContain("GHSA-low:");
    expect(finding.evidence).toContain(
      "Plus 1 more, listed in the references.",
    );
    expect(finding.references).toContain(
      "https://osv.dev/vulnerability/GHSA-low",
    );
  });

  it("checks each distinct detected library separately", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(TWO_LIBRARIES_PAGE));
    mockQueryOsv.mockResolvedValue([]);
    await checkOsvVulnerableLibraries("https://example.com");
    expect(mockQueryOsv).toHaveBeenCalledWith("npm", "jquery", "1.12.4");
    expect(mockQueryOsv).toHaveBeenCalledWith("npm", "vue", "3.2.0");
    expect(mockQueryOsv).toHaveBeenCalledTimes(2);
  });

  it("does not confuse react-dom with react", async () => {
    mockSafeFetch.mockResolvedValueOnce(
      htmlResponse(
        `<script src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"></script>`,
      ),
    );
    await checkOsvVulnerableLibraries("https://example.com");
    expect(mockQueryOsv).not.toHaveBeenCalledWith("npm", "react", "18.2.0");
  });

  it("fails open (returns []) when the page fetch throws", async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error("network error"));
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings).toEqual([]);
  });

  it("fails open when the page fetch is not ok", async () => {
    mockSafeFetch.mockResolvedValueOnce(new Response("", { status: 404 }));
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings).toEqual([]);
  });

  it("never calls safeFetch when cancelSignal is already aborted before the check starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const findings = await checkOsvVulnerableLibraries(
      "https://example.com",
      controller.signal,
    );
    expect(findings).toEqual([]);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("rejects a private/internal hostname before ever fetching", async () => {
    const findings = await checkOsvVulnerableLibraries("http://localhost/");
    expect(findings).toEqual([]);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });
});
