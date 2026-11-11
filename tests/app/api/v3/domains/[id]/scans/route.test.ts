/**
 * Route tests for /api/v3/domains/[id]/scans (tests-2): the publicly
 * reachable scans of a verified domain, and taking them off /host or killing
 * their share links.
 *
 * Both handlers gate on resolveOwnedDomain (the row's own user_id and
 * status = 'verified'). PATCH writes across OTHER accounts' scan rows, so the
 * gate is the whole of its authorization: a dropped session check or a
 * lookup that forgot the caller's id would let anyone unpublish anyone's
 * scans of a domain, and this file is what fails when that happens.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Nothing here may reach the pool: every read goes through owner-control,
// which is mocked below. A query that slipped past it fails the test.
vi.mock("@/lib/database/db", () => ({
  default: {
    query: async () => {
      throw new Error("unexpected database query");
    },
  },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>()),
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockResolveOwnedDomain = vi.fn();
const mockListDomainScans = vi.fn();
const mockApplyDomainScanAction = vi.fn();
vi.mock("@/lib/domains/owner-control", () => ({
  resolveOwnedDomain: (...args: unknown[]) => mockResolveOwnedDomain(...args),
  listDomainScans: (...args: unknown[]) => mockListDomainScans(...args),
  applyDomainScanAction: (...args: unknown[]) =>
    mockApplyDomainScanAction(...args),
}));

const { GET, PATCH } = await import("@/app/api/v3/domains/[id]/scans/route");

const SCAN = {
  publicId: "a1b2c3",
  url: "https://app.example.com/",
  scannedAt: "2026-11-01T00:00:00.000Z",
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/domains/5/scans", {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(100); // HISTORY_LIST_MAX_ROWS
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterSeconds: 0,
  });
  mockResolveOwnedDomain.mockReset();
  mockResolveOwnedDomain.mockResolvedValue({ id: 5, domain: "example.com" });
  mockListDomainScans.mockReset();
  mockListDomainScans.mockResolvedValue([SCAN]);
  mockApplyDomainScanAction.mockReset();
  mockApplyDomainScanAction.mockResolvedValue({ affected: 1 });
});

describe("GET /api/v3/domains/[id]/scans", () => {
  it("answers 401 without a session", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET(request("GET"), params("5"));

    expect(res.status).toBe(401);
    expect(mockResolveOwnedDomain).not.toHaveBeenCalled();
    expect(mockListDomainScans).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-1", "1.5", "1e3", "99999999999"])(
    "answers 400 for the id %s before any lookup",
    async (id) => {
      const res = await GET(request("GET"), params(id));

      expect(res.status).toBe(400);
      expect(mockResolveOwnedDomain).not.toHaveBeenCalled();
    },
  );

  it("answers 404 for a domain the caller does not own, and lists nothing", async () => {
    mockResolveOwnedDomain.mockResolvedValue(null);

    const res = await GET(request("GET"), params("5"));

    expect(res.status).toBe(404);
    expect(mockResolveOwnedDomain).toHaveBeenCalledWith(5, 42);
    expect(mockListDomainScans).not.toHaveBeenCalled();
  });

  it("lists the owned domain's public scans, capped by the list setting", async () => {
    const res = await GET(request("GET"), params("5"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ domain: "example.com", scans: [SCAN] });
    expect(mockGetSetting).toHaveBeenCalledWith("HISTORY_LIST_MAX_ROWS");
    expect(mockListDomainScans).toHaveBeenCalledWith("example.com", 42, 100);
  });
});

describe("PATCH /api/v3/domains/[id]/scans", () => {
  it("answers 401 without a session", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await PATCH(
      request("PATCH", { action: "unpublish" }),
      params("5"),
    );

    expect(res.status).toBe(401);
    expect(mockApplyDomainScanAction).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "1e3"])(
    "answers 400 for the id %s before any lookup",
    async (id) => {
      const res = await PATCH(
        request("PATCH", { action: "unpublish" }),
        params(id),
      );

      expect(res.status).toBe(400);
      expect(mockResolveOwnedDomain).not.toHaveBeenCalled();
    },
  );

  it("answers 404 for a domain the caller does not own, and changes nothing", async () => {
    mockResolveOwnedDomain.mockResolvedValue(null);

    const res = await PATCH(
      request("PATCH", { action: "revoke-shares" }),
      params("5"),
    );

    expect(res.status).toBe(404);
    expect(mockResolveOwnedDomain).toHaveBeenCalledWith(5, 42);
    expect(mockApplyDomainScanAction).not.toHaveBeenCalled();
  });

  it("refuses an action it does not know", async () => {
    const res = await PATCH(
      request("PATCH", { action: "delete" }),
      params("5"),
    );

    expect(res.status).toBe(400);
    expect(mockApplyDomainScanAction).not.toHaveBeenCalled();
  });

  it("applies the action to every covered scan when no ids are named", async () => {
    const res = await PATCH(
      request("PATCH", { action: "unpublish" }),
      params("5"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ affected: 1 });
    expect(mockApplyDomainScanAction).toHaveBeenCalledWith(
      "example.com",
      "unpublish",
      null,
    );
  });

  it("applies it to only the named scans, ignoring entries that are not ids", async () => {
    await PATCH(
      request("PATCH", {
        action: "revoke-shares",
        publicIds: ["a1b2c3", 7, null],
      }),
      params("5"),
    );

    expect(mockApplyDomainScanAction).toHaveBeenCalledWith(
      "example.com",
      "revoke-shares",
      ["a1b2c3"],
    );
  });

  it("does nothing for an explicitly empty list rather than everything", async () => {
    const res = await PATCH(
      request("PATCH", { action: "unpublish", publicIds: [] }),
      params("5"),
    );

    expect(await res.json()).toEqual({ affected: 0 });
    expect(mockApplyDomainScanAction).not.toHaveBeenCalled();
  });

  it("is rate limited per caller", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });

    const res = await PATCH(
      request("PATCH", { action: "unpublish" }),
      params("5"),
    );

    expect(res.status).toBe(429);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "domain-scan-action:42" }),
    );
    expect(mockApplyDomainScanAction).not.toHaveBeenCalled();
  });
});
