/**
 * Route-level tests for POST /api/v3/landing-contact.
 *
 * Mocked at the network boundary only (see tests/README.md): rate limiting,
 * outbound email, and the outbound fetch to Cloudflare's Turnstile
 * siteverify endpoint.
 *
 * Unlike app/api/v3/contact/route.ts, this route does not check
 * TURNSTILE_ENABLED at all - it unconditionally requires and verifies a
 * turnstileToken on every submission, so there is no "gating" describe
 * block here: the Turnstile path is simply the only path.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

const mockCheckRateLimit = vi.fn();
const mockGetClientIP = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIP: () => mockGetClientIP(),
  RATE_LIMITS: { api: { limit: "api", maxAttempts: 30, windowSeconds: 3600 } },
}));

const mockSendEmail = vi.fn();
const mockLandingContactEmail = vi.fn();
const mockLandingContactConfirmationEmail = vi.fn();
vi.mock("@/lib/email/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  landingContactEmail: (...args: unknown[]) => mockLandingContactEmail(...args),
  landingContactConfirmationEmail: (...args: unknown[]) =>
    mockLandingContactConfirmationEmail(...args),
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

const { POST } = await import("@/app/api/v3/landing-contact/route");

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/landing-contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postRawRequest(rawBody: string): NextRequest {
  return new NextRequest("http://localhost/api/v3/landing-contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody,
  });
}

const VALID_BODY = {
  email: "Visitor@Example.com",
  message: "Do you support self-hosted Postgres?",
  turnstileToken: "good-token",
};

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

let previousSecretKey: string | undefined;

beforeAll(() => {
  previousSecretKey = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = "test-secret-key";
});

afterAll(() => {
  if (previousSecretKey === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = previousSecretKey;
});

beforeEach(() => {
  mockCheckRateLimit.mockReset();
  mockGetClientIP.mockReset();
  mockSendEmail.mockReset();
  mockLandingContactEmail.mockReset();
  mockLandingContactConfirmationEmail.mockReset();
  mockFetch.mockClear();
  turnstileSuccess = true;

  mockGetClientIP.mockResolvedValue("203.0.113.9");
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 29,
    retryAfterSeconds: 0,
  });
  mockSendEmail.mockResolvedValue(undefined);
  mockLandingContactEmail.mockReturnValue({
    subject: "[Landing Page] New Inquiry",
    text: "text",
    html: "<p>html</p>",
  });
  mockLandingContactConfirmationEmail.mockReturnValue({
    subject: "We received your message",
    text: "text",
    html: "<p>html</p>",
  });
});

describe("POST /api/v3/landing-contact", () => {
  it("returns 429 without touching validation or email when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 90,
    });

    const res = await POST(postRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toContain("2 minute(s)");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("rejects the submission when no captcha token is provided, before calling Cloudflare", async () => {
    const res = await POST(postRequest({ email: "a@b.com", message: "hi" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Captcha verification required.");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects the submission when Cloudflare reports the token invalid", async () => {
    turnstileSuccess = false;

    const res = await POST(postRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Captcha verification failed. Please try again.");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("verifies the token against Cloudflare's siteverify endpoint with the server secret and caller ip", async () => {
    await POST(postRequest(VALID_BODY));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody).toEqual({
      secret: "test-secret-key",
      response: "good-token",
      remoteip: "203.0.113.9",
    });
  });

  it("requires email and message once the captcha passes", async () => {
    const res = await POST(
      postRequest({ turnstileToken: "good-token", email: "", message: "" }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Email and message are required.");
  });

  it("rejects a message over 5000 characters", async () => {
    const res = await POST(
      postRequest({ ...VALID_BODY, message: "a".repeat(5001) }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Message is too long.");
  });

  it("normalizes the email to lowercase before sending", async () => {
    await POST(postRequest(VALID_BODY));
    await flushMicrotasks();

    expect(mockLandingContactEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "visitor@example.com" }),
    );
    const confirmationCall = mockSendEmail.mock.calls.find(
      (c) => c[0].to === "visitor@example.com",
    );
    expect(confirmationCall).toBeDefined();
  });

  it("sends both the internal and confirmation emails and returns a success message", async () => {
    const res = await POST(postRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBe(
      "Thanks for reaching out. We'll get back to you soon!",
    );

    await flushMicrotasks();
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    const replyToCall = mockSendEmail.mock.calls.find(
      (c) => c[0].replyTo === "visitor@example.com",
    );
    expect(replyToCall).toBeDefined();
  });

  it("still returns success even if the background email send fails", async () => {
    mockSendEmail.mockRejectedValue(new Error("smtp down"));

    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(200);

    await flushMicrotasks();
  });

  it("returns 500 on a malformed JSON body", async () => {
    const res = await POST(postRawRequest("{not valid json"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("Something went wrong.");
  });
});
