import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/v3/scan/screenshot/[id] deliberately serves a PUBLIC scan's
 * screenshot with no session (it backs the public /host/[hostname] report).
 * What it must not do is let that anonymous branch be walked: resolveScanRow
 * still accepts the legacy sequential numeric primary key alongside the
 * opaque public_id, so an anonymous caller with a counter could otherwise
 * enumerate every public scan's screenshot.
 */
const mockResolveScanRow = vi.fn();
const mockScanNumericId = vi.fn();
vi.mock("@/lib/history/resolve-scan", () => ({
  resolveScanRow: (...a: unknown[]) => mockResolveScanRow(...a),
  scanNumericId: (...a: unknown[]) => mockScanNumericId(...a),
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

const mockTeamAccess = vi.fn();
vi.mock("@/lib/teams/scan-teams", () => ({
  getScanResourceAccess: (...a: unknown[]) => mockTeamAccess(...a),
}));

const mockReadScreenshot = vi.fn();
vi.mock("@/lib/scanner/page-screenshot", () => ({
  readScanScreenshot: (...a: unknown[]) => mockReadScreenshot(...a),
}));

const { GET } = await import("@/app/api/v3/scan/screenshot/[id]/route");

function req() {
  return new NextRequest("http://localhost/api/v3/scan/screenshot/x");
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const PUBLIC_SCAN = {
  id: 42,
  user_id: 7,
  team_id: null,
  is_public: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  mockResolveScanRow.mockResolvedValue(PUBLIC_SCAN);
  mockTeamAccess.mockResolvedValue({ canRead: false });
  mockReadScreenshot.mockResolvedValue({
    data: Buffer.from([1, 2, 3]),
    contentType: "image/png",
  });
  // Default: the id looks like an opaque public_id, not a legacy number.
  mockScanNumericId.mockReturnValue(null);
});

describe("GET /api/v3/scan/screenshot/[id]", () => {
  it("serves a public scan's screenshot to an anonymous caller by public_id", async () => {
    const res = await GET(req(), ctx("scan_abc123"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("refuses a legacy sequential id from an anonymous caller", async () => {
    mockScanNumericId.mockReturnValue(42);

    const res = await GET(req(), ctx("42"));

    expect(res.status).toBe(404);
    expect(mockReadScreenshot).not.toHaveBeenCalled();
  });

  it("still accepts a legacy sequential id from a signed-in caller", async () => {
    mockScanNumericId.mockReturnValue(42);
    mockGetSession.mockResolvedValue({ userId: 7 });

    const res = await GET(req(), ctx("42"));

    expect(res.status).toBe(200);
  });

  it("404s a private scan for an anonymous caller", async () => {
    mockResolveScanRow.mockResolvedValue({ ...PUBLIC_SCAN, is_public: false });

    const res = await GET(req(), ctx("scan_abc123"));

    expect(res.status).toBe(404);
    expect(mockReadScreenshot).not.toHaveBeenCalled();
  });

  it("serves a private scan to a team member who may read it", async () => {
    mockResolveScanRow.mockResolvedValue({
      ...PUBLIC_SCAN,
      is_public: false,
      team_id: 3,
    });
    mockGetSession.mockResolvedValue({ userId: 99 });
    mockTeamAccess.mockResolvedValue({ canRead: true });

    const res = await GET(req(), ctx("scan_abc123"));

    expect(res.status).toBe(200);
    // The whole scan row is handed over now, not just its team_id: a scan can
    // be shared with several teams, and the set is resolved from the scan id.
    expect(mockTeamAccess).toHaveBeenCalledWith(
      99,
      expect.objectContaining({ user_id: 7, team_id: 3 }),
    );
  });
});
