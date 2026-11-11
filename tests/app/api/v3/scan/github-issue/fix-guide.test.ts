/**
 * The issue body links each finding's fix guide, and the scan is found by the
 * opaque public id the API hands out, not only by the legacy numeric id.
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
const { APP_URL } = await import("@/lib/config/constants");

function req(body: unknown) {
  return new NextRequest("http://localhost/api/v3/scan/github-issue", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const SCAN = {
  id: 1,
  public_id: "Xk3pQ9aLmN",
  user_id: 7,
  url: "https://example.com",
  is_public: false,
  summary: { critical: 0, high: 1, medium: 1, low: 0, info: 1 },
  findings: [
    { id: "hsts-missing--a1b2", severity: "medium", title: "Missing HSTS" },
    {
      id: "async-missing-spf-record--c3d4",
      severity: "high",
      title: "Missing SPF Record",
    },
    {
      id: "async-environment-file-exposed--e5f6",
      severity: "info",
      title: "X",
    },
    { id: "page-no-such-check--g7h8", severity: "info", title: "Plain" },
  ],
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

describe("POST /api/v3/scan/github-issue: fix guides", () => {
  it("looks the scan up by the public id it was given", async () => {
    await POST(req({ scanId: "Xk3pQ9aLmN", repo: "octo/site" }));

    expect(mockResolveScanRow).toHaveBeenCalledWith("Xk3pQ9aLmN");
  });

  it("links the fix guide next to a finding whose check has one", async () => {
    await POST(req({ scanId: "Xk3pQ9aLmN", repo: "octo/site" }));

    const body: string = mockCreateIssue.mock.calls[0][3].body;
    expect(body).toContain(
      `- **[MEDIUM]** Missing HSTS ([fix guide](${APP_URL}/checks/hsts-missing))`,
    );
    expect(body).toContain(
      `- **[HIGH]** Missing SPF Record ([fix guide](${APP_URL}/checks/spf-record))`,
    );
  });

  it("lists a finding with no guide plainly, with no dead link", async () => {
    await POST(req({ scanId: "Xk3pQ9aLmN", repo: "octo/site" }));

    const lines = (mockCreateIssue.mock.calls[0][3].body as string).split("\n");
    expect(lines).toContain("- **[INFO]** Plain");
    expect(lines).toContain("- **[INFO]** X");
  });
});
