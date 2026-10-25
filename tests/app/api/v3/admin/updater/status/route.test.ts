/**
 * Route-level tests for GET /api/v3/admin/updater/status.
 *
 * Every /admin load called this to light one nav dot, and the route asked
 * GitHub live (60 unauthenticated requests an hour per IP) and forked
 * `cosign version` and `tar --version`. `?summary=1` is the cheap form: the
 * release comes from an hour-long memo and neither probe runs. The Updater tab
 * does not pass it and still gets the live answer and the capability probes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRequireAdmin = vi.fn();
vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: () => mockRequireAdmin(),
}));

const mockFetchLatest = vi.fn();
vi.mock("@/lib/updater/github-release", () => ({
  fetchLatestRelease: (...args: unknown[]) => mockFetchLatest(...args),
}));

const mockCosign = vi.fn();
vi.mock("@/lib/updater/cosign", () => ({
  isCosignAvailable: () => mockCosign(),
}));

const mockCommand = vi.fn();
vi.mock("@/lib/updater/exec", () => ({
  commandAvailable: (...args: unknown[]) => mockCommand(...args),
}));

vi.mock("@/lib/updater/environment", () => ({
  isUpdaterSupported: () => ({ supported: true }),
}));

vi.mock("@/lib/updater/job-store", () => ({
  getActiveJobId: () => null,
}));

const { GET } = await import("@/app/api/v3/admin/updater/status/route");
const { resetCachedLatestRelease } =
  await import("@/lib/updater/release-summary");
const { APP_VERSION } = await import("@/lib/config/constants");

const release = {
  tagName: "v99.0.0",
  version: "99.0.0",
  htmlUrl: "https://example.test/releases/v99.0.0",
  body: "a long set of release notes",
  assets: [],
};

function get(query = "") {
  return GET(
    new NextRequest(`http://localhost/api/v3/admin/updater/status${query}`),
  );
}

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockResolvedValue({ id: 1, role: "admin" });
  mockFetchLatest.mockReset();
  mockFetchLatest.mockResolvedValue(release);
  mockCosign.mockReset();
  mockCosign.mockResolvedValue(true);
  mockCommand.mockReset();
  mockCommand.mockResolvedValue(true);
  resetCachedLatestRelease();
});

describe("GET /api/v3/admin/updater/status", () => {
  it("is admin only", async () => {
    mockRequireAdmin.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(403);
    expect(mockFetchLatest).not.toHaveBeenCalled();
  });

  describe("the full form, which the Updater tab uses", () => {
    it("asks GitHub live and probes cosign and tar", async () => {
      const json = await (await get()).json();
      expect(mockFetchLatest).toHaveBeenCalledTimes(1);
      expect(mockFetchLatest).toHaveBeenCalledWith();
      expect(mockCosign).toHaveBeenCalledTimes(1);
      expect(mockCommand).toHaveBeenCalledWith("tar", ["--version"]);
      expect(json).toMatchObject({
        current: APP_VERSION,
        latest: "99.0.0",
        status: "behind",
        cosignAvailable: true,
        tarAvailable: true,
        releaseNotes: "a long set of release notes",
      });
    });

    it("does not reuse an answer from a summary call", async () => {
      await get("?summary=1");
      await get();
      // One for the summary's memo, one live for the full form.
      expect(mockFetchLatest).toHaveBeenCalledTimes(2);
    });
  });

  describe("?summary=1, which the nav dot uses", () => {
    it("runs neither probe", async () => {
      const json = await (await get("?summary=1")).json();
      expect(mockCosign).not.toHaveBeenCalled();
      expect(mockCommand).not.toHaveBeenCalled();
      expect(json).not.toHaveProperty("cosignAvailable");
      expect(json).not.toHaveProperty("tarAvailable");
    });

    it("still answers whether an update is available", async () => {
      const json = await (await get("?summary=1")).json();
      expect(json).toMatchObject({
        current: APP_VERSION,
        latest: "99.0.0",
        status: "behind",
        supported: true,
        activeJobId: null,
      });
    });

    it("leaves out the release notes, which the dot never reads", async () => {
      const json = await (await get("?summary=1")).json();
      expect(json.releaseNotes).toBeNull();
    });

    it("asks GitHub once however many times the panel loads", async () => {
      await get("?summary=1");
      await get("?summary=1");
      await get("?summary=1");
      expect(mockFetchLatest).toHaveBeenCalledTimes(1);
    });

    it("reports 'unknown' when GitHub cannot be reached", async () => {
      mockFetchLatest.mockRejectedValue(new Error("rate limited"));
      const json = await (await get("?summary=1")).json();
      expect(json).toMatchObject({ latest: null, status: "unknown" });
      expect(json).not.toHaveProperty("cosignAvailable");
    });
  });

  it("only the exact value 1 selects the summary", async () => {
    await get("?summary=true");
    expect(mockCosign).toHaveBeenCalledTimes(1);
  });
});
