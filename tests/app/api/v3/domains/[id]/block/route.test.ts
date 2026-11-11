/**
 * Route tests for /api/v3/domains/[id]/block (tests-2): whether a verified
 * domain is blocked from scanning, and switching that on and off.
 *
 * Every handler gates on resolveOwnedDomain, which matches the row's own
 * user_id and status = 'verified' (lib/domains/owner-control.ts has its own
 * suite and tests/integration/domain-owner-control.test.ts runs it against
 * Postgres). What this file pins is the wiring: a dropped session check or a
 * call that forgot to pass the caller's id would fail here and nowhere else.
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

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>()),
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockResolveOwnedDomain = vi.fn();
const mockReadDomainBlock = vi.fn();
const mockBlockDomain = vi.fn();
const mockUnblockDomain = vi.fn();
vi.mock("@/lib/domains/owner-control", () => ({
  resolveOwnedDomain: (...args: unknown[]) => mockResolveOwnedDomain(...args),
  readDomainBlock: (...args: unknown[]) => mockReadDomainBlock(...args),
  blockDomain: (...args: unknown[]) => mockBlockDomain(...args),
  unblockDomain: (...args: unknown[]) => mockUnblockDomain(...args),
}));

const { GET, POST, DELETE } =
  await import("@/app/api/v3/domains/[id]/block/route");

const BLOCK = {
  ruleId: 3,
  reason: "Scanning was switched off by the verified owner of example.com.",
  createdAt: "2026-11-01T00:00:00.000Z",
  liftable: true,
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function request(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/domains/5/block", {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

/** The ownership gate was never reached. */
function expectNoWork() {
  expect(mockReadDomainBlock).not.toHaveBeenCalled();
  expect(mockBlockDomain).not.toHaveBeenCalled();
  expect(mockUnblockDomain).not.toHaveBeenCalled();
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterSeconds: 0,
  });
  mockResolveOwnedDomain.mockReset();
  mockResolveOwnedDomain.mockResolvedValue({ id: 5, domain: "example.com" });
  mockReadDomainBlock.mockReset();
  mockReadDomainBlock.mockResolvedValue(null);
  mockBlockDomain.mockReset();
  mockBlockDomain.mockResolvedValue(BLOCK);
  mockUnblockDomain.mockReset();
  mockUnblockDomain.mockResolvedValue(true);
});

describe.each([
  ["GET", () => GET(request("GET"), params("5"))],
  ["POST", () => POST(request("POST"), params("5"))],
  ["DELETE", () => DELETE(request("DELETE"), params("5"))],
])("%s /api/v3/domains/[id]/block, the gate", (_method, call) => {
  it("answers 401 without a session", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(401);
    expect(mockResolveOwnedDomain).not.toHaveBeenCalled();
    expectNoWork();
  });

  it("answers 404 for a domain the caller does not own", async () => {
    // Someone else's row, or the caller's own row that is not verified: both
    // come back null, and both are answered as if the id did not exist.
    mockResolveOwnedDomain.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(404);
    expect(mockResolveOwnedDomain).toHaveBeenCalledWith(5, 42);
    expectNoWork();
  });
});

describe.each([
  ["GET", (id: string) => GET(request("GET"), params(id))],
  ["POST", (id: string) => POST(request("POST"), params(id))],
  ["DELETE", (id: string) => DELETE(request("DELETE"), params(id))],
])("%s /api/v3/domains/[id]/block, a bad id", (_method, call) => {
  it.each(["abc", "0", "-1", "1.5", "1e3", "99999999999"])(
    "answers 400 for %s before any lookup",
    async (id) => {
      const res = await call(id);

      expect(res.status).toBe(400);
      expect(mockResolveOwnedDomain).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/v3/domains/[id]/block", () => {
  it("reports no block for an owned domain that is open to scanning", async () => {
    const res = await GET(request("GET"), params("5"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ domain: "example.com", block: null });
    expect(mockReadDomainBlock).toHaveBeenCalledWith("example.com", 42);
  });

  it("reports a block, whoever created it", async () => {
    mockReadDomainBlock.mockResolvedValue({ ...BLOCK, liftable: false });

    const res = await GET(request("GET"), params("5"));

    expect(await res.json()).toEqual({
      domain: "example.com",
      block: { ...BLOCK, liftable: false },
    });
  });
});

describe("POST /api/v3/domains/[id]/block", () => {
  it("blocks the owned domain with the default reason when no body is sent", async () => {
    const res = await POST(request("POST"), params("5"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ domain: "example.com", block: BLOCK });
    expect(mockBlockDomain).toHaveBeenCalledWith(
      "example.com",
      42,
      "Scanning was switched off by the verified owner of example.com.",
    );
  });

  it("keeps a reason the owner gives, trimmed and capped", async () => {
    await POST(
      request("POST", { reason: `  ${"x".repeat(300)}  ` }),
      params("5"),
    );

    const reason = mockBlockDomain.mock.calls[0][2] as string;
    expect(reason).toBe("x".repeat(200));
  });

  it("is rate limited per caller", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });

    const res = await POST(request("POST"), params("5"));

    expect(res.status).toBe(429);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "domain-block:42" }),
    );
    expect(mockBlockDomain).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v3/domains/[id]/block", () => {
  it("lifts a block this account created", async () => {
    const res = await DELETE(request("DELETE"), params("5"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ domain: "example.com", block: null });
    expect(mockUnblockDomain).toHaveBeenCalledWith("example.com", 42);
  });

  it("answers 409 for a staff block it cannot lift", async () => {
    mockUnblockDomain.mockResolvedValue(false);
    mockReadDomainBlock.mockResolvedValue({ ...BLOCK, liftable: false });

    const res = await DELETE(request("DELETE"), params("5"));

    expect(res.status).toBe(409);
    expect((await res.json()).block).toEqual({ ...BLOCK, liftable: false });
  });

  it("reports success when there was nothing to lift", async () => {
    mockUnblockDomain.mockResolvedValue(false);

    const res = await DELETE(request("DELETE"), params("5"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ domain: "example.com", block: null });
  });
});
