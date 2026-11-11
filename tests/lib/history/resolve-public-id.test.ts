import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveScanRow = vi.fn();
vi.mock("@/lib/history/resolve-scan", () => ({
  resolveScanRow: (...args: unknown[]) => mockResolveScanRow(...args),
}));

const mockGetScanResourceAccess = vi.fn();
vi.mock("@/lib/teams/scan-teams", () => ({
  getScanResourceAccess: (...args: unknown[]) =>
    mockGetScanResourceAccess(...args),
}));

const { resolvePublicIdForCaller } =
  await import("@/lib/history/resolve-public-id");

const PUBLIC_ID = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 456,
    public_id: PUBLIC_ID,
    user_id: 7,
    team_id: null,
    is_public: true,
    ...overrides,
  };
}

beforeEach(() => {
  mockResolveScanRow.mockReset();
  mockGetScanResourceAccess.mockReset();
});

describe("resolvePublicIdForCaller", () => {
  it("returns the public id of a scan the caller can read", async () => {
    mockResolveScanRow.mockResolvedValue(row());
    mockGetScanResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: true,
    });

    expect(await resolvePublicIdForCaller(7, "456")).toBe(PUBLIC_ID);
    expect(mockGetScanResourceAccess).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ id: 456, user_id: 7 }),
    );
  });

  it("returns it for a team reader who cannot write", async () => {
    mockResolveScanRow.mockResolvedValue(row({ user_id: 9, team_id: 4 }));
    mockGetScanResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: false,
    });

    expect(await resolvePublicIdForCaller(7, "456")).toBe(PUBLIC_ID);
  });

  it("returns null for a stranger even when the scan is public", async () => {
    mockResolveScanRow.mockResolvedValue(row({ user_id: 9, is_public: true }));
    mockGetScanResourceAccess.mockResolvedValue({
      canRead: false,
      canWrite: false,
    });

    expect(await resolvePublicIdForCaller(7, "456")).toBeNull();
  });

  it("answers a missing scan exactly as it answers a scan that is not the caller's", async () => {
    mockResolveScanRow.mockResolvedValue(null);
    const missing = await resolvePublicIdForCaller(7, "456");

    mockResolveScanRow.mockResolvedValue(row({ user_id: 9 }));
    mockGetScanResourceAccess.mockResolvedValue({
      canRead: false,
      canWrite: false,
    });
    const notYours = await resolvePublicIdForCaller(7, "456");

    expect(missing).toBeNull();
    expect(notYours).toBe(missing);
  });

  it("returns null for a row that has no public id", async () => {
    mockResolveScanRow.mockResolvedValue(row({ public_id: null }));
    mockGetScanResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: true,
    });

    expect(await resolvePublicIdForCaller(7, "456")).toBeNull();
  });

  it("does not look anything up for a value that is neither id shape", async () => {
    for (const junk of ["", "abc", "12.png", "../keys", "0", "007", "1e3"]) {
      expect(await resolvePublicIdForCaller(7, junk), junk).toBeNull();
    }
    expect(mockResolveScanRow).not.toHaveBeenCalled();
  });

  it("accepts the public id itself and hands it back to its reader", async () => {
    mockResolveScanRow.mockResolvedValue(row());
    mockGetScanResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: true,
    });

    expect(await resolvePublicIdForCaller(7, PUBLIC_ID)).toBe(PUBLIC_ID);
    expect(mockResolveScanRow).toHaveBeenCalledWith(PUBLIC_ID);
  });
});
