/**
 * What the domain routes do with a body that is not a JSON object, an id that
 * is not exactly a row id, and a dependency that throws.
 *
 * `request.json().catch(() => ({}))` covered a body that does not parse but not
 * one that parses to `null`, which then threw on the first field read. The ids
 * went through `Number()`, so "1e3" named domain 1000, "0x10" domain 16 and
 * 9999999999 a value Postgres refuses with a 500.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  const read = (key: string) =>
    key === "BILLING_ENABLED"
      ? false
      : key.startsWith("FEATURE_")
        ? true
        : SETTINGS_REGISTRY[key as keyof typeof SETTINGS_REGISTRY]?.default;
  return {
    getSetting: async (key: string) => read(key),
    getSettings: async (keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, read(key)])),
  };
});

vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>()),
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));

const mockResolveOwnedDomain = vi.fn();
const mockBlockDomain = vi.fn();
const mockApplyAction = vi.fn();
vi.mock("@/lib/domains/owner-control", () => ({
  resolveOwnedDomain: (...args: unknown[]) => mockResolveOwnedDomain(...args),
  readDomainBlock: vi.fn(async () => null),
  blockDomain: (...args: unknown[]) => mockBlockDomain(...args),
  unblockDomain: vi.fn(async () => true),
  listDomainScans: vi.fn(async () => []),
  applyDomainScanAction: (...args: unknown[]) => mockApplyAction(...args),
}));

vi.mock("@/lib/logging/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging/log")>()),
  logError: vi.fn(),
}));

const domains = await import("@/app/api/v3/domains/route");
const domain = await import("@/app/api/v3/domains/[id]/route");
const block = await import("@/app/api/v3/domains/[id]/block/route");
const scans = await import("@/app/api/v3/domains/[id]/scans/route");
const verify = await import("@/app/api/v3/domains/[id]/verify/route");

const BAD_BODIES = ["{not json", "null", "[]", '"a string"'];
const BAD_IDS = ["9999999999", "12abc", "1e3", "0x10", "1.5", "0", "-1"];

function rawRequest(method: string, body: string, path = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v3/domains${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body,
  });
}

function jsonRequest(method: string, body: unknown, path = ""): NextRequest {
  return rawRequest(method, JSON.stringify(body), path);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42, email: "me@example.com" });
  mockResolveOwnedDomain.mockReset();
  mockResolveOwnedDomain.mockResolvedValue({ domain: "example.com" });
  mockBlockDomain.mockReset();
  mockBlockDomain.mockResolvedValue({ reason: "x" });
  mockApplyAction.mockReset();
  mockApplyAction.mockResolvedValue({ affected: 0 });
});

describe("a body that is not a JSON object", () => {
  const handlers: [string, string, (r: NextRequest) => Promise<Response>][] = [
    ["POST /domains", "POST", domains.POST],
    ["PATCH /domains/[id]", "PATCH", (r) => domain.PATCH(r, params("5"))],
    ["POST /domains/[id]/block", "POST", (r) => block.POST(r, params("5"))],
    ["PATCH /domains/[id]/scans", "PATCH", (r) => scans.PATCH(r, params("5"))],
  ];
  for (const [label, method, handler] of handlers) {
    for (const body of BAD_BODIES) {
      it(`${label} answers 400 to ${JSON.stringify(body)}`, async () => {
        const res = await handler(rawRequest(method, body, "/5"));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toEqual(expect.any(String));
        expect(mockQuery).not.toHaveBeenCalled();
        expect(mockBlockDomain).not.toHaveBeenCalled();
        expect(mockApplyAction).not.toHaveBeenCalled();
      });
    }
  }

  it("POST /domains/[id]/block still takes no body at all", async () => {
    const res = await block.POST(
      new NextRequest("http://localhost/api/v3/domains/5/block", {
        method: "POST",
      }),
      params("5"),
    );
    expect(res.status).toBe(200);
    expect(mockBlockDomain).toHaveBeenCalledWith(
      "example.com",
      42,
      expect.stringContaining("example.com"),
    );
  });
});

describe("an id that is not exactly a row id", () => {
  for (const id of BAD_IDS) {
    const calls: [string, () => Promise<Response>][] = [
      [
        `PATCH /domains/${id}`,
        () => domain.PATCH(jsonRequest("PATCH", { teamId: null }), params(id)),
      ],
      [
        `GET /domains/${id}/block`,
        () => block.GET(new NextRequest("http://localhost/x"), params(id)),
      ],
      [
        `POST /domains/${id}/block`,
        () => block.POST(jsonRequest("POST", {}), params(id)),
      ],
      [
        `DELETE /domains/${id}/block`,
        () =>
          block.DELETE(
            new NextRequest("http://localhost/x", { method: "DELETE" }),
            params(id),
          ),
      ],
      [
        `GET /domains/${id}/scans`,
        () => scans.GET(new NextRequest("http://localhost/x"), params(id)),
      ],
      [
        `PATCH /domains/${id}/scans`,
        () =>
          scans.PATCH(
            jsonRequest("PATCH", { action: "unpublish" }),
            params(id),
          ),
      ],
      [
        `POST /domains/${id}/verify`,
        () =>
          verify.POST(
            new NextRequest("http://localhost/x", { method: "POST" }),
            params(id),
          ),
      ],
      [
        `DELETE /domains?id=${id}`,
        () =>
          domains.DELETE(
            new NextRequest(
              `http://localhost/api/v3/domains?id=${encodeURIComponent(id)}`,
              { method: "DELETE" },
            ),
          ),
      ],
    ];
    for (const [label, call] of calls) {
      it(`${label} answers 400`, async () => {
        const res = await call();
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/^Invalid domain id/);
        expect(mockQuery).not.toHaveBeenCalled();
        expect(mockResolveOwnedDomain).not.toHaveBeenCalled();
      });
    }
  }

  for (const teamId of [9999999999, 1.5, 0, -1, "5"]) {
    it(`PATCH /domains/[id] answers 400 to teamId ${JSON.stringify(teamId)}`, async () => {
      const res = await domain.PATCH(
        jsonRequest("PATCH", { teamId }),
        params("5"),
      );
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  }

  it("DELETE /domains still asks for an id that is missing", async () => {
    const res = await domains.DELETE(
      new NextRequest("http://localhost/api/v3/domains", { method: "DELETE" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Domain id is required.");
  });
});

describe("a dependency that throws", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["GET /domains", () => domains.GET()],
    [
      "POST /domains",
      () => domains.POST(jsonRequest("POST", { domain: "example.com" })),
    ],
    [
      "DELETE /domains",
      () =>
        domains.DELETE(
          new NextRequest("http://localhost/api/v3/domains?id=5", {
            method: "DELETE",
          }),
        ),
    ],
    [
      "PATCH /domains/[id]",
      () => domain.PATCH(jsonRequest("PATCH", { teamId: null }), params("5")),
    ],
    [
      "GET /domains/[id]/block",
      () => block.GET(new NextRequest("http://localhost/x"), params("5")),
    ],
    [
      "POST /domains/[id]/block",
      () => block.POST(jsonRequest("POST", {}), params("5")),
    ],
    [
      "DELETE /domains/[id]/block",
      () =>
        block.DELETE(
          new NextRequest("http://localhost/x", { method: "DELETE" }),
          params("5"),
        ),
    ],
    [
      "GET /domains/[id]/scans",
      () => scans.GET(new NextRequest("http://localhost/x"), params("5")),
    ],
    [
      "PATCH /domains/[id]/scans",
      () =>
        scans.PATCH(jsonRequest("PATCH", { action: "unpublish" }), params("5")),
    ],
  ];
  for (const [label, call] of calls) {
    it(`${label} answers a JSON 500`, async () => {
      mockGetSession.mockRejectedValue(new Error("session store down"));
      const res = await call();
      expect(res.status).toBe(500);
      expect((await res.json()).error).toEqual(expect.any(String));
    });
  }
});
