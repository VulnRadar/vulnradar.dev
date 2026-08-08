import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for POST /api/v3/billing/verify/send. The pg pool and
 * email delivery (the SMTP network boundary) are mocked; the route's own
 * rate-limiting, single-use-code cleanup, and email-masking logic run for
 * real, including the real crypto.randomInt/randomBytes code generation
 * (no mocking below the network/database boundary).
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockSendEmail = vi.fn();
vi.mock("@/lib/email/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  billingVerificationCodeEmail: (code: string) => ({
    subject: "Verify your billing request",
    text: `code ${code}`,
    html: `<p>${code}</p>`,
  }),
}));

// Mocked at the resolver boundary (not pool.query): the route reads
// BILLING_VERIFY_CODE_EXPIRY_MINUTES through this resolver right before the
// INSERT, and mocking it here keeps that call from consuming one of the
// queued mockQuery.mockResolvedValueOnce() slots below.
const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const { POST } = await import("@/app/api/v3/billing/verify/send/route");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockSendEmail.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockSendEmail.mockResolvedValue(undefined);
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(5);
});

function request(): NextRequest {
  return new NextRequest("http://localhost/api/v3/billing/verify/send", {
    method: "POST",
  });
}

describe("POST /api/v3/billing/verify/send", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when the user row is missing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(request());
    expect(res.status).toBe(404);
  });

  it("returns 429 when a code was already sent within the last 60 seconds, and never sends email", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ email: "john@example.com" }] }); // user lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{ created_at: new Date(Date.now() - 10_000).toISOString() }],
    }); // recent code, sent 10s ago

    const res = await POST(request());
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/wait \d+ seconds/i);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("deletes old codes, stores a fresh salted hash, emails the code, and masks the email in the response", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ email: "john@example.com" }] }); // user lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no recent code
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE old codes
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT new code

    const res = await POST(request());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.maskedEmail).toBe("jo***@example.com");

    const deleteCall = mockQuery.mock.calls[2];
    expect(String(deleteCall[0])).toContain(
      "DELETE FROM billing_verification_codes",
    );
    expect(deleteCall[1]).toEqual([42]);

    const insertCall = mockQuery.mock.calls[3];
    expect(String(insertCall[0])).toContain(
      "INSERT INTO billing_verification_codes",
    );
    expect(String(insertCall[0])).toContain("salt");
    expect(String(insertCall[0])).toContain("expires_at");
    const [userId, salt, code] = insertCall[1] as [number, string, string];
    expect(userId).toBe(42);
    expect(salt).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex-encoded
    expect(code).toMatch(/^\d{6}$/);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const emailArg = mockSendEmail.mock.calls[0][0];
    expect(emailArg.to).toBe("john@example.com");
    expect(emailArg.text).toBe(`code ${code}`);
  });

  it("returns 500 when sendEmail rejects", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ email: "john@example.com" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockSendEmail.mockRejectedValueOnce(new Error("smtp down"));

    const res = await POST(request());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to send verification code");
  });
});
