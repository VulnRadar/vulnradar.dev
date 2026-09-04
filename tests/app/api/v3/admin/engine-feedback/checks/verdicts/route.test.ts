/**
 * Route-level tests for GET /api/v3/admin/engine-feedback/checks/verdicts:
 * the individual verdicts behind one Check Accuracy row (URL, verdict,
 * note, timestamp), which scan_finding_feedback has always stored and the
 * panel used to throw away in favour of counts alone.
 *
 * Same mocking boundary as the sibling checks/route.test.ts: getSession
 * plus the pool.query role lookup.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn(async (key: string) =>
    key === "ENFORCE_STAFF_2FA" ? false : undefined,
  ),
}));

const { GET } =
  await import("@/app/api/v3/admin/engine-feedback/checks/verdicts/route");

function withAdmin(userId = 7, role = "admin") {
  mockGetSession.mockResolvedValue({ userId });
  mockQuery.mockResolvedValueOnce({ rows: [{ id: userId, role }] });
}

function getRequest(query: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/v3/admin/engine-feedback/checks/verdicts${query}`,
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
});

describe("GET /api/v3/admin/engine-feedback/checks/verdicts", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest("?checkId=a"));
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a caller below the engine-feedback permission", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "support" }] });
    const res = await GET(getRequest("?checkId=a"));
    expect(res.status).toBe(403);
  });

  it("rejects a request that names no check", async () => {
    withAdmin();
    const res = await GET(getRequest(""));
    expect(res.status).toBe(400);
  });

  it("returns the URL, verdict, note and timestamp for a check", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 9,
          finding_id: "credit-card-pattern--aa",
          finding_url: "https://shop.example.com/orders/4111111111111111",
          verdict: "false_positive",
          notes: "order id, not a card number",
          created_at: "2026-09-02T09:00:00Z",
        },
      ],
    });

    const res = await GET(getRequest("?checkId=credit-card-pattern"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.verdicts["credit-card-pattern"]).toEqual([
      {
        id: 9,
        checkId: "credit-card-pattern",
        findingUrl: "https://shop.example.com/orders/4111111111111111",
        verdict: "false_positive",
        notes: "order id, not a card number",
        createdAt: "2026-09-02T09:00:00.000Z",
      },
    ]);
  });

  it("returns newest first and caps how many rows it will read", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await GET(getRequest("?checkId=a&checkId=b&perCheck=10"));
    const [sql, params] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("ORDER BY created_at DESC");
    expect(sql).toContain("LIMIT");
    expect(params[0]).toEqual(["a", "b"]);
    expect(typeof params[2]).toBe("number");
  });

  it("clamps perCheck to a sane maximum and falls back on nonsense", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(getRequest("?checkId=a&perCheck=100000"));
    expect((await res.json()).perCheck).toBe(100);

    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res2 = await GET(getRequest("?checkId=a&perCheck=banana"));
    expect((await res2.json()).perCheck).toBe(25);
  });

  it("de-duplicates repeated ids and bounds how many checks it will accept", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const many = Array.from({ length: 150 }, (_, i) => `checkId=c${i}`).join(
      "&",
    );
    await GET(getRequest(`?checkId=a&checkId=a&${many}`));
    const [, params] = mockQuery.mock.calls[1] as [string, unknown[]];
    const ids = params[0] as string[];
    expect(ids).toHaveLength(100);
    expect(ids.filter((id) => id === "a")).toHaveLength(1);
  });

  it("returns a graceful 500 when the query fails", async () => {
    withAdmin();
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));
    const res = await GET(getRequest("?checkId=a"));
    expect(res.status).toBe(500);
  });
});
