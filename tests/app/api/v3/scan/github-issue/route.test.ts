/**
 * Route tests for POST /api/v3/scan/github-issue (file findings to GitHub).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [] })) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

const mockResolveScanRow = vi.fn();
vi.mock("@/lib/history/resolve-scan", () => ({
  resolveScanRow: (...a: unknown[]) => mockResolveScanRow(...a),
}));

const mockGetToken = vi.fn();
vi.mock("@/lib/github/github-connections", () => ({
  getDecryptedGithubToken: (...a: unknown[]) => mockGetToken(...a),
}));

const mockCreateIssue = vi.fn();
vi.mock("@/lib/github/github-api", () => ({
  createRepoIssue: (...a: unknown[]) => mockCreateIssue(...a),
}));

const { POST } = await import("@/app/api/v3/scan/github-issue/route");

function req(body: unknown) {
  return new NextRequest("http://localhost/api/v3/scan/github-issue", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const SCAN = {
  id: 1,
  user_id: 7,
  url: "https://example.com",
  summary: { critical: 1, high: 0, medium: 2, low: 0, info: 1 },
  findings: [{ id: "a", severity: "critical", title: "Exposed .env" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ userId: 7 });
  mockGetToken.mockResolvedValue("gho_token");
  mockResolveScanRow.mockResolvedValue(SCAN);
  mockCreateIssue.mockResolvedValue({
    number: 12,
    htmlUrl: "https://github.com/o/r/issues/12",
  });
});

describe("POST /api/v3/scan/github-issue", () => {
  it("401s without a session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    expect((await POST(req({ scanId: "p1", repo: "o/r" }))).status).toBe(401);
  });

  it("400s on a malformed repo", async () => {
    expect((await POST(req({ scanId: "p1", repo: "not-a-repo" }))).status).toBe(
      400,
    );
  });

  it("400s when GitHub is not connected", async () => {
    mockGetToken.mockResolvedValueOnce(null);
    const res = await POST(req({ scanId: "p1", repo: "o/r" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/connect your github/i);
  });

  it("404s when the caller does not own the scan", async () => {
    mockResolveScanRow.mockResolvedValueOnce({ ...SCAN, user_id: 999 });
    expect((await POST(req({ scanId: "p1", repo: "o/r" }))).status).toBe(404);
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it("creates a branded issue and returns its URL", async () => {
    const res = await POST(req({ scanId: "p1", repo: "octo/site" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.url).toBe("https://github.com/o/r/issues/12");
    const [token, owner, name, issue] = mockCreateIssue.mock.calls[0];
    expect(token).toBe("gho_token");
    expect(owner).toBe("octo");
    expect(name).toBe("site");
    expect(issue.title).toContain("[VulnRadar]");
    expect(issue.body).toContain("GitHub Scanner");
    expect(issue.labels).toContain("vulnradar");
  });

  it("502s when the GitHub API rejects the issue", async () => {
    mockCreateIssue.mockRejectedValueOnce(
      new Error("GitHub issue creation HTTP 403"),
    );
    const res = await POST(req({ scanId: "p1", repo: "o/r" }));
    expect(res.status).toBe(502);
  });
});
