/**
 * The support ticket routes read their bodies with `await request.json()` in a
 * try that only caught a parse failure, so a `null` body got past it and the
 * first `body.message` was a TypeError and a 500. The share and translate ids
 * went through Number(), which reads "12abc" as NaN but "1e3" as 1000 and
 * 9999999999 as an id Postgres cannot hold. And a throttled caller was told
 * to wait "a few minutes" with no Retry-After to act on.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: vi.fn(async () => null),
  logAction: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: async () => "203.0.113.9",
}));
vi.mock("@/lib/support/ticket-notify", () => ({
  notifyStaffOfTicketActivity: vi.fn(),
  notifyUserOfStaffReply: vi.fn(),
  confirmTicketToUser: vi.fn(),
  notifyUserOfTicketStatus: vi.fn(),
}));

const mockCheckRateLimit = vi.fn(async (..._args: unknown[]) => ({
  allowed: true,
  retryAfterSeconds: 0,
}));
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  RATE_LIMITS: {
    api: { limit: "api" },
    supportTicketCreate: { limit: "supportTicketCreate" },
    supportTicketStatus: { limit: "supportTicketStatus" },
    aiSummary: { limit: "aiSummary" },
  },
}));

const list = await import("@/app/api/v3/support-tickets/route");
const thread = await import("@/app/api/v3/support-tickets/[id]/route");
const shares = await import("@/app/api/v3/support-tickets/[id]/shares/route");
const translate =
  await import("@/app/api/v3/support-tickets/[id]/translate/route");

const ctx = { params: Promise.resolve({ id: "42" }) };

function raw(method: string, body: string, query = "") {
  return new NextRequest(`http://localhost/api/v3/support-tickets/42${query}`, {
    method,
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({
    userId: 7,
    email: "user@example.com",
    role: "user",
  });
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

const BAD_BODIES: [string, string][] = [
  ["malformed JSON", "{not json"],
  ["a JSON null", "null"],
  ["a JSON array", "[]"],
  ["a JSON string", '"hello"'],
];

const bodyRoutes: [string, (b: string) => Promise<Response>][] = [
  ["POST /support-tickets", (b) => list.POST(raw("POST", b))],
  ["POST /support-tickets/[id]", (b) => thread.POST(raw("POST", b), ctx)],
  ["PATCH /support-tickets/[id]", (b) => thread.PATCH(raw("PATCH", b), ctx)],
  [
    "POST /support-tickets/[id]/shares",
    (b) => shares.POST(raw("POST", b), ctx),
  ],
  [
    "POST /support-tickets/[id]/translate",
    (b) => translate.POST(raw("POST", b), ctx),
  ],
];

describe("support ticket bodies that are not a JSON object", () => {
  for (const [route, call] of bodyRoutes) {
    for (const [label, body] of BAD_BODIES) {
      it(`${route} answers 400 for ${label}`, async () => {
        const res = await call(body);
        expect(res.status).toBe(400);
        expect(
          mockQuery.mock.calls.some((c) =>
            /^\s*(INSERT|UPDATE|DELETE)/i.test(String(c[0])),
          ),
        ).toBe(false);
      });
    }
  }
});

describe("support ticket ids that are not one row's id", () => {
  for (const id of ["12abc", "1e3", "0x10", "1.5", "9999999999", "0", "-3"]) {
    it(`shares POST refuses userId ${id}`, async () => {
      const res = await shares.POST(
        raw("POST", JSON.stringify({ userId: id })),
        ctx,
      );
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it(`shares DELETE refuses ?userId=${id}`, async () => {
      const res = await shares.DELETE(
        raw("DELETE", "", `/shares?userId=${encodeURIComponent(id)}`),
        ctx,
      );
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it(`translate refuses messageId ${id}`, async () => {
      const res = await translate.POST(
        raw("POST", JSON.stringify({ messageId: id })),
        ctx,
      );
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  }

  it("shares POST refuses a fractional or out-of-range number too", async () => {
    for (const userId of [1.5, 9999999999, 1e21]) {
      const res = await shares.POST(
        raw("POST", JSON.stringify({ userId })),
        ctx,
      );
      expect(res.status).toBe(400);
    }
  });
});

describe("throttled ticket actions say when to retry", () => {
  const denied = { allowed: false, retryAfterSeconds: 120 };

  it("opening a ticket", async () => {
    mockCheckRateLimit.mockResolvedValueOnce(denied);
    const res = await list.POST(
      raw("POST", JSON.stringify({ subject: "s", message: "m" })),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
  });

  it("replying to one", async () => {
    mockCheckRateLimit.mockResolvedValueOnce(denied);
    const res = await thread.POST(
      raw("POST", JSON.stringify({ message: "hello" })),
      ctx,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
  });
});

describe("GET /support-tickets truncation", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, subject: `t${i}` }));

  it("asks for one row past the page, so exactly 100 tickets is not reported as truncated", async () => {
    mockQuery.mockResolvedValueOnce({ rows: rows(100) });
    const body = await (await list.GET()).json();
    expect(mockQuery.mock.calls[0][1]).toEqual([7, 101]);
    expect(body.tickets).toHaveLength(100);
    expect(body.limit).toBe(100);
    expect(body.truncated).toBe(false);
  });

  it("reports truncation and returns only the newest 100 when there are more", async () => {
    mockQuery.mockResolvedValueOnce({ rows: rows(101) });
    const body = await (await list.GET()).json();
    expect(body.tickets).toHaveLength(100);
    expect(body.tickets.at(-1).id).toBe(100);
    expect(body.truncated).toBe(true);
  });
});
