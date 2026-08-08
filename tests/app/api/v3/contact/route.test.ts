/**
 * Route-level tests for POST /api/v3/contact.
 *
 * Mocked at the network boundary only (see tests/README.md): rate limiting,
 * outbound email, and the outbound fetch to Cloudflare's Turnstile
 * siteverify endpoint. TURNSTILE_ENABLED is computed once at module load
 * from `!!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY` (lib/config/constants.ts),
 * so the "Turnstile gating" describe block below sets that env var and
 * re-imports the route fresh via vi.resetModules(), matching the pattern in
 * tests/app/api/v3/auth/signup/route.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCheckRateLimit = vi.fn();
const mockGetClientIP = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIP: () => mockGetClientIP(),
  RATE_LIMITS: { api: { limit: "api", maxAttempts: 30, windowSeconds: 3600 } },
}));

const mockSendEmail = vi.fn();
const mockContactEmail = vi.fn();
const mockContactConfirmationEmail = vi.fn();
vi.mock("@/lib/email/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  contactEmail: (...args: unknown[]) => mockContactEmail(...args),
  contactConfirmationEmail: (...args: unknown[]) =>
    mockContactConfirmationEmail(...args),
}));

let turnstileSuccess = true;
vi.stubGlobal("fetch", vi.fn());
const mockFetch = vi.mocked(fetch);
mockFetch.mockImplementation(async () => {
  return new Response(JSON.stringify({ success: turnstileSuccess }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

const { POST } = await import("@/app/api/v3/contact/route");

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postRawRequest(rawBody: string): NextRequest {
  return new NextRequest("http://localhost/api/v3/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody,
  });
}

const VALID_BODY = {
  name: "Alex Morgan",
  email: "Alex.Morgan@Example.com",
  subject: "Found a bug",
  message: "The scan endpoint 500s on a bare IP.",
  category: "bug",
};

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  mockCheckRateLimit.mockReset();
  mockGetClientIP.mockReset();
  mockSendEmail.mockReset();
  mockContactEmail.mockReset();
  mockContactConfirmationEmail.mockReset();
  mockFetch.mockClear();
  turnstileSuccess = true;

  mockGetClientIP.mockResolvedValue("203.0.113.7");
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 29,
    retryAfterSeconds: 0,
  });
  mockSendEmail.mockResolvedValue(undefined);
  mockContactEmail.mockReturnValue({
    subject: "[Contact] Found a bug",
    text: "text",
    html: "<p>html</p>",
  });
  mockContactConfirmationEmail.mockReturnValue({
    subject: "We received your message",
    text: "text",
    html: "<p>html</p>",
  });
});

describe("POST /api/v3/contact (Turnstile disabled, the default test env state)", () => {
  it("returns 429 without touching validation or email when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 125,
    });

    const res = await POST(postRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toContain("3 minute(s)");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("requires all fields", async () => {
    const res = await POST(postRequest({ ...VALID_BODY, message: "   " }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("All fields are required.");
  });

  it("rejects a name over 120 characters", async () => {
    const res = await POST(
      postRequest({ ...VALID_BODY, name: "a".repeat(121) }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a subject over 160 characters", async () => {
    const res = await POST(
      postRequest({ ...VALID_BODY, subject: "a".repeat(161) }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a message over 5000 characters", async () => {
    const res = await POST(
      postRequest({ ...VALID_BODY, message: "a".repeat(5001) }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Message is too long.");
  });

  it("maps a known category to its label", async () => {
    await POST(postRequest({ ...VALID_BODY, category: "security" }));
    await flushMicrotasks();

    expect(mockContactEmail).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Security Issue" }),
    );
  });

  it("falls back to 'Other' for an unrecognized category", async () => {
    await POST(postRequest({ ...VALID_BODY, category: "mystery" }));
    await flushMicrotasks();

    expect(mockContactEmail).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Other" }),
    );
  });

  it("normalizes the email to lowercase before sending", async () => {
    await POST(postRequest(VALID_BODY));
    await flushMicrotasks();

    expect(mockContactEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "alex.morgan@example.com" }),
    );
    const confirmationCall = mockSendEmail.mock.calls.find(
      (c) => c[0].to === "alex.morgan@example.com",
    );
    expect(confirmationCall).toBeDefined();
  });

  it("sends both the internal and confirmation emails and returns a success message", async () => {
    const res = await POST(postRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBe(
      "Thanks for reaching out. We will get back to you soon.",
    );

    await flushMicrotasks();
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    const replyToCall = mockSendEmail.mock.calls.find(
      (c) => c[0].replyTo === "alex.morgan@example.com",
    );
    expect(replyToCall).toBeDefined();
  });

  it("still returns success even if the background email send fails", async () => {
    mockSendEmail.mockRejectedValue(new Error("smtp down"));

    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(200);

    await flushMicrotasks();
    // The failure is swallowed inside the queued sendEmails() - it must
    // not surface as an unhandled rejection or change the response already
    // sent to the client.
  });

  it("returns 500 on a malformed JSON body", async () => {
    const res = await POST(postRawRequest("{not valid json"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("Something went wrong.");
  });
});

describe("POST /api/v3/contact (Turnstile gating)", () => {
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecretKey = process.env.TURNSTILE_SECRET_KEY;

  afterEach(() => {
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

  async function importGatedPOST() {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "test-site-key";
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";
    vi.resetModules();
    const { POST: gatedPOST } = await import("@/app/api/v3/contact/route");
    return gatedPOST;
  }

  it("rejects the submission when no captcha token is provided", async () => {
    const gatedPOST = await importGatedPOST();

    const res = await gatedPOST(postRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Captcha verification required.");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("rejects the submission when Cloudflare reports the token invalid", async () => {
    const gatedPOST = await importGatedPOST();
    turnstileSuccess = false;

    const res = await gatedPOST(
      postRequest({ ...VALID_BODY, turnstileToken: "bad-token" }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Captcha verification failed. Please try again.");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("verifies the token against Cloudflare's siteverify endpoint with the server secret and caller ip", async () => {
    const gatedPOST = await importGatedPOST();

    await gatedPOST(
      postRequest({ ...VALID_BODY, turnstileToken: "good-token" }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody).toEqual({
      secret: "test-secret-key",
      response: "good-token",
      remoteip: "203.0.113.7",
    });
  });

  it("accepts the submission once Cloudflare verifies the token", async () => {
    const gatedPOST = await importGatedPOST();
    turnstileSuccess = true;

    const res = await gatedPOST(
      postRequest({ ...VALID_BODY, turnstileToken: "good-token" }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBe(
      "Thanks for reaching out. We will get back to you soon.",
    );
  });
});
