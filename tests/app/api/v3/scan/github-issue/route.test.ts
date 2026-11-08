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
vi.mock("@/lib/github/github-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/github-api")>()),
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
  is_public: true,
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
    expect((await res.json()).error).not.toMatch(/may have been created/i);
  });

  it("504s on a timeout and warns the issue may already exist", async () => {
    // The POST reached GitHub before the clock ran out, so "try again" is how
    // a repo ends up with the same issue twice.
    mockCreateIssue.mockRejectedValueOnce(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    const res = await POST(req({ scanId: "p1", repo: "o/r" }));
    expect(res.status).toBe(504);
    const { error } = await res.json();
    expect(error).toMatch(/may have been created/i);
    expect(error).toMatch(/check the repository/i);
  });
});

describe("POST /api/v3/scan/github-issue: the report link in the issue", () => {
  async function filedBody(scan: Record<string, unknown>): Promise<string> {
    mockResolveScanRow.mockResolvedValueOnce({ ...SCAN, ...scan });
    const res = await POST(req({ scanId: "p1", repo: "o/r" }));
    expect(res.status).toBe(200);
    return mockCreateIssue.mock.calls[0][3].body as string;
  }

  const manyFindings = Array.from({ length: 51 }, (_, i) => ({
    id: String(i),
    severity: "low",
    title: `Finding ${i}`,
  }));

  it("separates the severity counts with commas, not a middle dot", async () => {
    const body = await filedBody({});
    expect(body).toContain("1 critical, 0 high, 2 medium, 0 low, 1 info");
  });

  it("links the host report for a public URL scan", async () => {
    const body = await filedBody({ url: "https://www.example.com/app" });
    expect(body).toMatch(/Full report: \S+\/host\/example\.com$/);
  });

  it("carries no report link for a private URL scan", async () => {
    const body = await filedBody({ is_public: false });
    expect(body).toContain("GitHub Scanner.");
    expect(body).not.toContain("/host/");
    expect(body).not.toContain("Full report");
  });

  it("treats a missing visibility as private", async () => {
    const body = await filedBody({ is_public: null });
    expect(body).not.toContain("Full report");
  });

  it("carries no report link for a repo scan, even one marked public", async () => {
    // A repo scan's url is "owner/name", which parses as a host called
    // "owner", so the link would point at somebody else's report.
    const body = await filedBody({
      url: "octocat/hello-world",
      scan_type: "github",
      is_public: true,
    });
    expect(body).not.toContain("/host/");
    expect(body).not.toContain("Full report");
  });

  it("titles a repo scan with the whole repository name", async () => {
    await filedBody({ url: "octocat/hello-world", scan_type: "github" });
    expect(mockCreateIssue.mock.calls[0][3].title).toContain(
      "for octocat/hello-world (",
    );
  });

  it("only points at the full report when there is one", async () => {
    expect(await filedBody({ findings: manyFindings })).toContain(
      "...and 1 more (see the full report).",
    );
    mockCreateIssue.mockClear();
    const body = await filedBody({ findings: manyFindings, is_public: false });
    expect(body).toContain("...and 1 more.");
    expect(body).not.toContain("see the full report");
  });
});
