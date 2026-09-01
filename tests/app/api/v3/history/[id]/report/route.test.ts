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

vi.mock("@/lib/scanner/remediation-store", () => ({
  attachRemediation: (_u: number, _url: string, f: unknown) => f,
}));

vi.mock("@/lib/reports/sarif-report", () => ({
  generateSarifReport: () => ({ version: "2.1.0", runs: [] }),
}));
vi.mock("@/lib/reports/markdown-report", () => ({
  generateMarkdownReport: () => "# markdown report",
}));
vi.mock("@/lib/reports/compliance-report", () => ({
  generateComplianceReport: () => "# compliance report",
}));
vi.mock("@/lib/reports/pdf-report", () => ({
  generatePdfReport: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
}));

const { GET } = await import("@/app/api/v3/history/[id]/report/route");

const params = { params: Promise.resolve({ id: "pub_1" }) };
function req(format?: string, auth?: string) {
  const url = `http://localhost/api/v3/history/pub_1/report${format ? `?format=${format}` : ""}`;
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
