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

const mockQueryOsv = vi.fn();
vi.mock("@/lib/scanner/osv-lookup", () => ({
  queryOsv: (...args: unknown[]) => mockQueryOsv(...args),
}));

import { checkOsvVulnerableLibraries } from "@/lib/scanner/osv-check";

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

function cvssVuln(id: string, vector: string, aliases: string[] = []) {
  return {
    id,
    aliases,
    summary: `Summary for ${id}`,
    severity: [{ type: "CVSS_V3", score: vector }],
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

  it("returns [] when OSV.dev has no advisory for this exact version", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([]);
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings).toEqual([]);
  });

  it("builds a finding from a matching advisory, with CVE ids and a real parsed CVSS score", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([
      cvssVuln(
        "GHSA-gxr4-xjj5-5px2",
        "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N",
        ["CVE-2020-11022"],
      ),
    ]);

    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding.id).toMatch(/^osv-vulnerable-library--/);
    expect(finding.category).toBe("supply-chain");
    expect(finding.cveIds).toEqual(["CVE-2020-11022"]);
    expect(finding.cvssVector).toBe(
      "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N",
    );
    expect(typeof finding.cvssScore).toBe("number");
    expect(finding.evidence).toContain("jQuery 1.8.2");
    expect(finding.evidence).toContain("GHSA-gxr4-xjj5-5px2");
    expect(finding.evidence).toContain("CVE-2020-11022");
  });

  it("defaults to high severity when OSV gives no parseable CVSS score", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([
      { id: "GHSA-no-score", aliases: [], severity: [] },
    ]);
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].cvssVector).toBeUndefined();
  });

  it("buckets a critical-scored advisory as critical severity", async () => {
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(JQUERY_PAGE));
    mockQueryOsv.mockResolvedValue([
      cvssVuln("GHSA-critical", "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H"),
    ]);
    const findings = await checkOsvVulnerableLibraries("https://example.com");
    expect(findings[0].severity).toBe("critical");
  });

  it("caps findings per library and keeps the highest-scored ones", async () => {
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
    // 6 vulns queued, capped at MAX_VULNS_PER_LIBRARY (5), highest severity first.
    expect(findings.length).toBeLessThanOrEqual(5);
    expect(findings[0].evidence).toContain("GHSA-critical");
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
