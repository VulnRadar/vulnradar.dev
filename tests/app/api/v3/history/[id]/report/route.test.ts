/**
 * Route tests for GET /api/v3/history/[id]/report. Auth, access, and the
 * generators are mocked so this exercises the route's format dispatch +
 * content types, not the (separately pure) report generators.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

const mockValidateApiKey = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockRecordUsage = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...a: unknown[]) => mockValidateApiKey(...a),
  checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
  recordUsage: (...a: unknown[]) => mockRecordUsage(...a),
}));

// FEATURE_PDF_REPORTS now gates ?format=pdf server-side. Mocked at the
// module boundary so the route never pulls in the real resolver (which
// imports the pg pool at module load and needs DATABASE_URL).
const mockGetSetting = vi.fn(async (_key: string) => true as unknown);
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...a: unknown[]) =>
    mockGetSetting(...(a as Parameters<typeof mockGetSetting>)),
}));

// The session branch is now metered too (the API-key branch always was), so
// a signed-in user cannot loop a synchronous PDF build and pin the event
// loop. Mocked at the module boundary for the same reason as the resolver
// above: lib/rate-limiting/rate-limit imports the pg pool at module load.
const mockSessionRateLimit = vi.fn(async () => ({
  allowed: true,
  retryAfterSeconds: 0,
}));
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) =>
    mockSessionRateLimit(...(a as Parameters<typeof mockSessionRateLimit>)),
  RATE_LIMITS: { api: { limit: "api", maxAttempts: 100, windowMinutes: 15 } },
}));

const mockResolveScanRow = vi.fn();
vi.mock("@/lib/history/resolve-scan", () => ({
  resolveScanRow: (...a: unknown[]) => mockResolveScanRow(...a),
}));

const mockTeamAccess = vi.fn();
vi.mock("@/lib/teams/scan-teams", () => ({
  getScanResourceAccess: (...a: unknown[]) => mockTeamAccess(...a),
}));

// The suppressed ids the owner has marked false_positive, as the store
// helper would attach them. Mocked at the module boundary (it imports the pg
// pool); the flag it sets is what the route filters on.
const mockSuppressedIds = new Set<string>();
vi.mock("@/lib/scanner/remediation-store", () => ({
  attachRemediation: (_u: number, _url: string, f: unknown) => f,
  attachFalsePositiveVerdicts: (_u: number, f: unknown) =>
    (f as { id: string }[]).map((finding) =>
      mockSuppressedIds.has(finding.id)
        ? { ...finding, suppressed: true }
        : finding,
    ),
}));

const mockSarif = vi.fn((..._a: unknown[]) => ({
  version: "2.1.0",
  runs: [],
}));
vi.mock("@/lib/reports/sarif-report", () => ({
  generateSarifReport: (...a: unknown[]) => mockSarif(...a),
}));
const mockMarkdown = vi.fn((..._a: unknown[]) => "# markdown report");
vi.mock("@/lib/reports/markdown-report", () => ({
  generateMarkdownReport: (...a: unknown[]) => mockMarkdown(...a),
}));
vi.mock("@/lib/reports/compliance-report", () => ({
  generateComplianceReport: () => "# compliance report",
}));
vi.mock("@/lib/reports/pdf-report", () => ({
  generatePdfReport: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
}));

const { GET } = await import("@/app/api/v3/history/[id]/report/route");

const params = { params: Promise.resolve({ id: "pub_1" }) };
function req(format?: string, auth?: string, query = "") {
  const url = `http://localhost/api/v3/history/pub_1/report${format ? `?format=${format}` : "?"}${query}`;
  return new NextRequest(url, {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  });
}

const SCAN = {
  id: 1,
  url: "https://example.com",
  user_id: 7,
  team_id: null,
  findings: [{ id: "a", severity: "high", title: "X" }],
  result_meta: { dangerScore: 5 },
  scanned_at: "2026-01-01T00:00:00.000Z",
  duration: 1200,
  summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
  response_headers: {},
  authenticated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSuppressedIds.clear();
  mockSarif.mockReturnValue({ version: "2.1.0", runs: [] });
  mockMarkdown.mockReturnValue("# markdown report");
  mockGetSession.mockResolvedValue({ userId: 7, role: "user" });
  mockResolveScanRow.mockResolvedValue(SCAN);
  mockTeamAccess.mockResolvedValue({ canRead: false });
  mockGetSetting.mockResolvedValue(true);
  mockSessionRateLimit.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
});

describe("GET /api/v3/history/[id]/report", () => {
  it("rate-limits the session path and never builds the report when the cap is hit", async () => {
    mockSessionRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 300,
    });

    const res = await GET(req("pdf"), params);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("300");
    // Rejected before the scan is even looked up, so the expensive
    // synchronous build is never reached.
    expect(mockResolveScanRow).not.toHaveBeenCalled();
  });

  it("401s with no session and no API key", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await GET(req("sarif"), params);
    expect(res.status).toBe(401);
  });

  it("400s on an unsupported format", async () => {
    const res = await GET(req("docx"), params);
    expect(res.status).toBe(400);
  });

  it("returns SARIF for the owner", async () => {
    const res = await GET(req("sarif"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/sarif+json");
    expect(res.headers.get("content-disposition")).toContain(".sarif");
  });

  it("returns a PDF for the owner", async () => {
    const res = await GET(req("pdf"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  // FEATURE_PDF_REPORTS used to hide only the download menu item, leaving
  // ?format=pdf fully served to anyone who asked for it directly.
  it("refuses ?format=pdf when FEATURE_PDF_REPORTS is off, before any scan lookup", async () => {
    mockGetSetting.mockResolvedValueOnce(false);
    const res = await GET(req("pdf"), params);
    expect(res.status).toBe(403);
    expect(mockResolveScanRow).not.toHaveBeenCalled();
  });

  it("still serves the other formats when only PDF reports are off", async () => {
    mockGetSetting.mockResolvedValue(false);
    const res = await GET(req("sarif"), params);
    expect(res.status).toBe(200);
    mockGetSetting.mockResolvedValue(true);
  });

  it("returns markdown and compliance", async () => {
    expect(
      (await GET(req("md"), params)).headers.get("content-type"),
    ).toContain("text/markdown");
    const comp = await GET(req("compliance"), params);
    expect(comp.headers.get("content-disposition")).toContain("-compliance.md");
  });

  it("defaults to JSON when no format is given", async () => {
    const res = await GET(req(), params);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("404s for a non-owner without team access", async () => {
    mockGetSession.mockResolvedValue({ userId: 8, role: "user" });
    mockTeamAccess.mockResolvedValue({ canRead: false });
    const res = await GET(req("sarif"), params);
    expect(res.status).toBe(404);
  });

  it("allows a non-owner WITH team read access", async () => {
    mockGetSession.mockResolvedValue({ userId: 8, role: "user" });
    mockTeamAccess.mockResolvedValue({ canRead: true });
    const res = await GET(req("sarif"), params);
    expect(res.status).toBe(200);
  });

  it("accepts a scan:read API key and records usage", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 100,
      scopes: ["scan:read"],
      needsTermsAcceptance: false,
    });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    const res = await GET(req("sarif", "Bearer vr_live_x"), params);
    expect(res.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalledWith(3);
  });

  // ── Triage in exports ────────────────────────────────────────────────
  //
  // The route attached remediation and threw the result away, never attached
  // false-positive verdicts at all, and passed the STORED summary alongside
  // an unfiltered findings list. Since lib/scanner/recompute-scan-score.ts
  // rewrites that stored summary to exclude false positives, one export could
  // print a headline count that disagreed with the findings printed under it.

  it("recomputes summary from the findings actually exported, so the two agree", async () => {
    mockResolveScanRow.mockResolvedValue({
      ...SCAN,
      // What storage holds after a false-positive verdict: a summary counting
      // one finding, over a findings array still holding two.
      summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0, total: 1 },
      findings: [
        { id: "real", severity: "high", title: "Real" },
        { id: "bogus", severity: "high", title: "Bogus" },
      ],
    });
    mockSuppressedIds.add("bogus");

    const res = await GET(req(), params);
    const body = await res.json();

    expect(body.findings.map((f: { id: string }) => f.id)).toEqual(["real"]);
    expect(body.summary).toEqual({
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
      info: 0,
      total: 1,
    });
    expect(body.summary.total).toBe(body.findings.length);
  });

  it("keeps summary and findings consistent with ?includeSuppressed=true too", async () => {
    mockResolveScanRow.mockResolvedValue({
      ...SCAN,
      summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0, total: 1 },
      findings: [
        { id: "real", severity: "high", title: "Real" },
        { id: "bogus", severity: "high", title: "Bogus" },
      ],
    });
    mockSuppressedIds.add("bogus");

    const res = await GET(req(undefined, undefined, "includeSuppressed=1"), {
      params: Promise.resolve({ id: "pub_1" }),
    });
    const body = await res.json();

    expect(body.findings).toHaveLength(2);
    expect(body.summary.high).toBe(2);
    expect(body.summary.total).toBe(2);
  });

  it("hands the same filtered list to the markdown generator", async () => {
    mockResolveScanRow.mockResolvedValue({
      ...SCAN,
      findings: [
        { id: "real", severity: "high", title: "Real" },
        { id: "bogus", severity: "critical", title: "Bogus" },
      ],
    });
    mockSuppressedIds.add("bogus");

    await GET(req("md"), params);

    const passed = mockMarkdown.mock.calls[0][0] as {
      findings: { id: string }[];
      summary: { total: number; critical: number };
    };
    expect(passed.findings.map((f) => f.id)).toEqual(["real"]);
    expect(passed.summary.critical).toBe(0);
    expect(passed.summary.total).toBe(1);
  });

  // A team-read viewer sees the stored findings as scanned: triage belongs to
  // the owner who did it, and leaking "the owner called this a false
  // positive" across the team boundary is the thing remediation-store's
  // owner-only contract exists to prevent.
  it("does not apply the owner's triage to a team-read viewer's export", async () => {
    mockGetSession.mockResolvedValue({ userId: 8, role: "user" });
    mockTeamAccess.mockResolvedValue({ canRead: true });
    mockResolveScanRow.mockResolvedValue({
      ...SCAN,
      findings: [
        { id: "real", severity: "high", title: "Real" },
        { id: "bogus", severity: "high", title: "Bogus" },
      ],
    });
    mockSuppressedIds.add("bogus");

    const body = await (await GET(req(), params)).json();
    expect(body.findings).toHaveLength(2);
    expect(body.summary.total).toBe(2);
  });

  // Suppression in SARIF is what a CI gate reads, so it stays opt-in.
  it("leaves SARIF suppressions off unless ?applyTriage says otherwise", async () => {
    await GET(req("sarif"), params);
    expect(mockSarif.mock.calls[0][1]).toEqual({ applySuppressions: false });

    mockSarif.mockClear();
    await GET(req("sarif", undefined, "&applyTriage=true"), {
      params: Promise.resolve({ id: "pub_1" }),
    });
    expect(mockSarif.mock.calls[0][1]).toEqual({ applySuppressions: true });
  });

  it("serves CSV, which used to be browser-only", async () => {
    const res = await GET(req("csv"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(".csv");
    // Byte-order mark first, so Excel on Windows reads the file as UTF-8
    // rather than falling back to the system code page. Asserted on the raw
    // bytes: Response.text() performs a UTF-8 decode, which strips a leading
    // BOM by spec, so a string comparison here would pass even without one.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toContain(
      "Finding ID,Title,Severity",
    );
  });

  it("403s an API key lacking scan:read", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 100,
      scopes: ["scan:write"],
      needsTermsAcceptance: false,
    });
    const res = await GET(req("sarif", "Bearer vr_live_x"), params);
    expect(res.status).toBe(403);
  });
});
