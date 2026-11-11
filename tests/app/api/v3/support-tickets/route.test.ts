/**
 * Route tests for GET/POST /api/v3/support-tickets (list own + create).
 * pool and getSession are mocked; the outbound staff notification is stubbed so
 * no email is attempted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

// Reached only on the Turnstile path, to send the caller's address along.
vi.mock("@/lib/api/request-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/request-utils")>()),
  getClientIp: async () => "203.0.113.7",
}));

vi.mock("@/lib/support/ticket-notify", () => ({
  notifyStaffOfTicketActivity: vi.fn(),
  notifyUserOfStaffReply: vi.fn(),
  confirmTicketToUser: vi.fn(),
  notifyUserOfTicketStatus: vi.fn(),
}));

// The limiter goes through the (mocked) pool, so left real it would take the
// first positional mockQuery answer and shift every assertion below. Default:
// allow. A test flips it to deny, and reads the args to see which bucket the
// route asked for.
const mockCheckRateLimit = vi.fn(async (..._args: unknown[]) => ({
  allowed: true,
  remaining: 4,
  retryAfterSeconds: 0,
}));
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  RATE_LIMITS: {
    supportTicketCreate: { limit: "supportTicketCreate" },
  },
}));

const { GET, POST } = await import("@/app/api/v3/support-tickets/route");
const { ERROR_MESSAGES } = await import("@/lib/config/constants");

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/support-tickets", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockCheckRateLimit.mockClear();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 4,
    retryAfterSeconds: 0,
  });
  mockGetSession.mockResolvedValue({
    userId: 7,
    email: "user@example.com",
    name: "User",
    role: "user",
  });
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("GET /api/v3/support-tickets", () => {
  it("401s when not signed in", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  // A bare "Unauthorized" reached the page as that one word when a session
  // expired, which tells the person nothing about signing back in.
  it("says to sign in rather than answering a bare 'Unauthorized'", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const body = await (await GET()).json();
    expect(body.error).toBe(ERROR_MESSAGES.UNAUTHORIZED);
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("returns only the caller's own tickets", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, subject: "Help", status: "open", message_count: 2 }],
    });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tickets).toHaveLength(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE t.user_id = $1");
    // The row cap is a bound parameter now, and the response reports it, so a
    // truncated ticket history is visible instead of just stopping
    // (AUDIT-014#magic-20).
    expect(params).toEqual([7, 101]);
    expect(body.limit).toBe(100);
    expect(body.truncated).toBe(false);
  });
});

describe("POST /api/v3/support-tickets", () => {
  it("401s when not signed in", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await POST(postRequest({ subject: "x", message: "y" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe(ERROR_MESSAGES.UNAUTHORIZED);
  });

  it("400s on a missing subject or message", async () => {
    expect((await POST(postRequest({ message: "hi" }))).status).toBe(400);
    expect((await POST(postRequest({ subject: "hi" }))).status).toBe(400);
  });

  it("400s on an unknown category", async () => {
    const res = await POST(
      postRequest({ subject: "s", message: "m", category: "nope" }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a ticket + first message and returns 201", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ n: 0 }] }) // open-ticket count
      .mockResolvedValueOnce({
        rows: [
          {
            id: 42,
            subject: "Billing help",
            category: "billing",
            status: "open",
          },
        ],
      }) // insert ticket
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }); // insert message

    const res = await POST(
      postRequest({
        subject: "Billing help",
        message: "I was double charged",
        category: "billing",
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.ticket.id).toBe(42);
    // The first message is stored as a non-staff message by the ticket owner.
    const [msgSql, msgParams] = mockQuery.mock.calls[2];
    expect(msgSql).toContain("INSERT INTO support_ticket_messages");
    expect(msgParams).toEqual([42, 7, "I was double charged"]);
  });

  it("429s when the user already has too many open tickets", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 20 }] });
    const res = await POST(postRequest({ subject: "s", message: "m" }));
    expect(res.status).toBe(429);
  });

  it("counts tickets closed in the last day toward that cap, so closing one does not free its slot", async () => {
    // open, close, open, close: the open count never moved, so the loop was
    // bounded only by how fast somebody could click. The count now includes
    // anything resolved or closed within CLOSED_TICKET_SLOT_HOURS.
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 20 }] });
    await POST(postRequest({ subject: "s", message: "m" }));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = ANY($2::text[])");
    expect(sql).toContain(
      "updated_at > NOW() - make_interval(hours => $3::int)",
    );
    expect(params).toEqual([
      7,
      ["open", "awaiting_staff", "awaiting_user"],
      24,
    ]);
  });
});

describe("POST /api/v3/support-tickets rate limit", () => {
  it("429s a user who is opening tickets too fast, before paying for anything else", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1800,
    });
    const res = await POST(postRequest({ subject: "s", message: "m" }));
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.error).toContain("30 minute(s)");
    // No count, no insert: the throttled request touched nothing.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("limits per account, in the supportTicketCreate bucket", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ n: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await POST(postRequest({ subject: "s", message: "m" }));
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
    expect(mockCheckRateLimit).toHaveBeenCalledWith({
      key: "ticket-create:7",
      limit: "supportTicketCreate",
    });
  });

  it("does not rate limit an anonymous request into existence", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await POST(postRequest({ subject: "s", message: "m" }));
    expect(res.status).toBe(401);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/support-tickets (Turnstile gating)", () => {
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecretKey = process.env.TURNSTILE_SECRET_KEY;
  const realFetch = globalThis.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalSiteKey === undefined) {
      delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    } else {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalSiteKey;
    }
    if (originalSecretKey === undefined) {
      delete process.env.TURNSTILE_SECRET_KEY;
    } else {
      process.env.TURNSTILE_SECRET_KEY = originalSecretKey;
    }
    vi.resetModules();
  });

  // TURNSTILE_ENABLED is read once at module load, so the route is imported
  // fresh with the site key set.
  async function importGatedPOST() {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "test-site-key";
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";
    vi.resetModules();
    const mod = await import("@/app/api/v3/support-tickets/route");
    return mod.POST;
  }

  const BODY = {
    subject: "Billing help",
    message: "I was double charged",
    category: "billing",
    turnstileToken: "good-token",
  };

  it("asks for a captcha token before calling Cloudflare", async () => {
    const gatedPOST = await importGatedPOST();
    const res = await gatedPOST(
      postRequest({ ...BODY, turnstileToken: undefined }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Captcha verification required.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a token Cloudflare says is invalid", async () => {
    const gatedPOST = await importGatedPOST();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    const res = await gatedPOST(postRequest(BODY));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // No timeout on siteverify meant a quiet Cloudflare held the request open
  // for as long as the socket lived.
  it("answers within the timeout with a 503 when siteverify never responds", async () => {
    const gatedPOST = await importGatedPOST();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // AbortSignal.timeout runs on Node's internal timers, which fake timers do
    // not reach: the same signal, built on the faked setTimeout.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      const controller = new AbortController();
      setTimeout(
        () =>
          controller.abort(
            new DOMException("The operation timed out.", "TimeoutError"),
          ),
        ms,
      );
      return controller.signal;
    });
    fetchMock.mockImplementationOnce(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );

    let res: Response | undefined;
    void gatedPOST(postRequest(BODY)).then((r) => {
      res = r;
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(res).toBeDefined();
    expect(res?.status).toBe(503);
    expect((await (res as Response).json()).error).toBe(
      "We could not verify the captcha just now. Please try again.",
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("answers a non-JSON siteverify reply with a 503, not a 500", async () => {
    const gatedPOST = await importGatedPOST();
    fetchMock.mockResolvedValueOnce(
      new Response("<html>cloudflare error</html>", { status: 200 }),
    );
    const res = await gatedPOST(postRequest(BODY));
    expect(res.status).toBe(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("opens the ticket once Cloudflare verifies the token", async () => {
    const gatedPOST = await importGatedPOST();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    mockQuery
      .mockResolvedValueOnce({ rows: [{ n: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const res = await gatedPOST(postRequest(BODY));
    expect(res.status).toBe(201);
    const sent = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sent).toMatchObject({
      secret: "test-secret-key",
      response: "good-token",
    });
  });
});

describe("withErrorHandling", () => {
  it("answers a database failure with a 500 instead of throwing out of the route", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await GET();
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});
