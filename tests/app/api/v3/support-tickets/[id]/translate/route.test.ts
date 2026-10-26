/**
 * Route tests for POST /api/v3/support-tickets/[id]/translate. The id segment
 * is the only thing under test: it used to go through Number.parseInt, so
 * "12.png" was served as ticket 12.
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

vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  RATE_LIMITS: { aiSummary: {} },
}));

const mockResolveTicketAccess = vi.fn();
vi.mock("@/lib/support/ticket-access", () => ({
  resolveTicketAccess: (...args: unknown[]) => mockResolveTicketAccess(...args),
  viewerIsSupportStaff: async () => false,
}));

vi.mock("@/lib/support/translate", () => ({
  translateTicketMessage: async () => ({ text: "hallo", cached: true }),
}));

vi.mock("@/lib/i18n/translate", () => ({
  getUserLocale: async () => "de",
}));

const { POST } =
  await import("@/app/api/v3/support-tickets/[id]/translate/route");

function req(body: unknown = { messageId: 5 }) {
  return new NextRequest(
    "http://localhost/api/v3/support-tickets/12/translate",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

function withId(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockResolveTicketAccess.mockReset();
  mockGetSession.mockResolvedValue({
    userId: 7,
    email: "owner@example.com",
    name: "Owner",
    role: "user",
  });
  mockResolveTicketAccess.mockResolvedValue({ canView: true });
});

describe("POST translate: the ticket id in the path", () => {
  it("401s without a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(req(), withId("12"));
    expect(res.status).toBe(401);
  });

  it.each([
    "12.png",
    "12.svg",
    "12abc",
    "1e3",
    "0x10",
    "1.5",
    "012",
    "0",
    "-5",
    "2147483648",
  ])("refuses %j", async (id) => {
    const res = await POST(req(), withId(id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid ticket id.");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("still serves a plain numeric id", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] }) // ticket
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            body: "hello",
            body_locale: "en",
            translations: { de: "x" },
          },
        ],
      }); // message
    const res = await POST(req(), withId("12"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ messageId: 5, text: "hallo" });
    expect(mockQuery.mock.calls[0][1]).toEqual([12]);
    expect(mockQuery.mock.calls[1][1]).toEqual([5, 12]);
  });
});
