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
const mockGetClientIp = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  RATE_LIMITS: {
    api: { limit: "api", maxAttempts: 30, windowSeconds: 3600 },
    contactForm: { limit: "contactForm", maxAttempts: 5, windowSeconds: 3600 },
  },
}));
// withErrorHandling (lib/api/api-utils.ts) reaches the session and the pool.
// Neither is used by this route, so they are mocked only so the wrapper loads.
vi.mock("@/lib/database/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/auth/auth", () => ({ getSession: vi.fn() }));
// The route used a deprecated getClientIP re-exported from the rate-limit
// module; it now calls the real getClientIp, so the mock moves to where the
// function actually lives.
vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: () => mockGetClientIp(),
  // Also reached by this route, and a module mock replaces the whole
  // module - omitting it makes the real one undefined at the call site.
  rateLimitIpKey: (ip: string) => ip,
}));

// The submission is now stored before either email is attempted, because
// the email WAS the record: the send is fire-and-forget with its failure
// logged and dropped, so a mail outage lost the message while telling the
// sender it had arrived. Mocked here at the same boundary as everything else.
const mockRecordSubmission = vi.fn();
const mockRecordEmailOutcome = vi.fn();
vi.mock("@/lib/support/contact-submissions", () => ({
  recordContactSubmission: (...args: unknown[]) =>
    mockRecordSubmission(...args),
  recordContactEmailOutcome: (...args: unknown[]) =>
    mockRecordEmailOutcome(...args),
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

// The route resolves NOREPLY_EMAIL live via the settings resolver, which
// otherwise pulls in the real DB pool (and DATABASE_URL) at module load.
// This route never touched the database before that, so mock the resolver
// directly rather than the whole pool -- no test here asserts on the
// resolved from-address itself.
const mockGetSettingImpl = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (key: string) => mockGetSettingImpl(key),
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
const { SUPPORT_EMAIL } = await import("@/lib/config/constants");
const CONTACT_NAME_MAX = 120;
const CONTACT_SUBJECT_MAX = 160;
const TURNSTILE_UNAVAILABLE_MESSAGE =
  "We could not verify the captcha just now. Please try again.";

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
  mockGetClientIp.mockReset();
  mockSendEmail.mockReset();
  mockRecordSubmission.mockReset();
  mockRecordEmailOutcome.mockReset();
  mockRecordSubmission.mockResolvedValue(7);
  mockRecordEmailOutcome.mockResolvedValue(undefined);
  mockContactEmail.mockReset();
  mockContactConfirmationEmail.mockReset();
  mockFetch.mockClear();
  turnstileSuccess = true;
  mockGetSettingImpl.mockReset();
  mockGetSettingImpl.mockImplementation(async (key: string) =>
    key === "CONTACT_MESSAGE_MAX_LENGTH" ? 5000 : "noreply@example.com",
  );

  mockGetClientIp.mockResolvedValue("203.0.113.7");
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

  it("limits on the contact form's own bucket, not the 100-an-hour one every API route shares", async () => {
    await POST(postRequest(VALID_BODY));
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "contact:203.0.113.7",
        limit: "contactForm",
      }),
    );
  });

  // "All fields are required." named none of them, so the sender had to work
  // out which of five fields the server meant.
  it.each([
    ["name", "Name is required."],
    ["email", "Email is required."],
    ["subject", "Subject is required."],
    ["message", "Message is required."],
    ["category", "Category is required."],
  ])("names the missing %s", async (field, error) => {
    const res = await POST(postRequest({ ...VALID_BODY, [field]: "   " }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(error);
    expect(mockRecordSubmission).not.toHaveBeenCalled();
  });

  // "Message is too long." gave neither the field, the limit nor how far over
  // it was, on the form a security reporter is most likely to write at length.
  it.each([
    ["name", () => CONTACT_NAME_MAX],
    ["subject", () => CONTACT_SUBJECT_MAX],
    ["message", () => 5000],
  ])("says how long the %s is and what the limit is", async (field, max) => {
    const limit = max();
    const res = await POST(
      postRequest({ ...VALID_BODY, [field]: "a".repeat(limit + 1) }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(
      `Your ${field} is ${limit + 1} characters; the limit is ${limit}. Shorten it or email ${SUPPORT_EMAIL}.`,
    );
    expect(mockRecordSubmission).not.toHaveBeenCalled();
  });

  it("accepts every field at exactly its limit", async () => {
    const res = await POST(
      postRequest({
        ...VALID_BODY,
        name: "a".repeat(CONTACT_NAME_MAX),
        subject: "a".repeat(CONTACT_SUBJECT_MAX),
        message: "a".repeat(5000),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("measures the message against the live setting, not a fixed number", async () => {
    mockGetSettingImpl.mockImplementation(async (key: string) =>
      key === "CONTACT_MESSAGE_MAX_LENGTH" ? 200 : "noreply@example.com",
    );
    const res = await POST(
      postRequest({ ...VALID_BODY, message: "a".repeat(201) }),
    );
    expect((await res.json()).error).toContain("the limit is 200.");
  });

  it("maps a known category to its label", async () => {
    await POST(postRequest({ ...VALID_BODY, category: "security" }));
    await flushMicrotasks();

    expect(mockContactEmail).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Security Issue" }),
    );
  });

  // A plain-object lookup resolves Object.prototype members, so
  // CATEGORY_LABELS["constructor"] was the Object function itself: truthy, so
  // the `|| "Other"` never ran and a function went to the email builders.
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "labels the inherited key %s as 'Other', never as an Object.prototype member",
    async (category) => {
      const res = await POST(postRequest({ ...VALID_BODY, category }));
      expect(res.status).toBe(200);
      await flushMicrotasks();

      expect(mockContactEmail).toHaveBeenCalledWith(
        expect.objectContaining({ category: "Other" }),
      );
      expect(mockContactConfirmationEmail).toHaveBeenCalledWith({
        category: "Other",
      });
    },
  );

  it("falls back to 'Other' for an unrecognized category", async () => {
    await POST(postRequest({ ...VALID_BODY, category: "mystery" }));
    await flushMicrotasks();

    expect(mockContactEmail).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Other" }),
    );
  });

  // The staff alert went to the no-reply sender, a mailbox nobody reads, so a
  // security report surfaced only if someone happened to open the admin inbox.
  it("sends the staff alert to the support address, not the no-reply sender", async () => {
    await POST(postRequest(VALID_BODY));
    await flushMicrotasks();

    const staffCall = mockSendEmail.mock.calls.find(
      (c) => c[0].subject === "[Contact] Found a bug",
    );
    expect(staffCall).toBeDefined();
    expect(staffCall?.[0].to).toBe(SUPPORT_EMAIL);
    expect(
      mockSendEmail.mock.calls.some((c) => c[0].to === "noreply@example.com"),
    ).toBe(false);
  });

  it("normalizes the email to lowercase before sending", async () => {
    await POST(postRequest(VALID_BODY));
    await flushMicrotasks();

    const confirmationCall = mockSendEmail.mock.calls.find(
      (c) => c[0].to === "alex.morgan@example.com",
    );
    expect(confirmationCall).toBeDefined();
  });

  it("gives the staff email only the submission id and a category label, never what the sender typed", async () => {
    await POST(postRequest(VALID_BODY));
    await flushMicrotasks();

    // The id is the stored submission's, so the pointer opens the right row.
    expect(mockContactEmail).toHaveBeenCalledWith({
      submissionId: 7,
      category: "Bug Report",
    });
  });

  it("gives the confirmation a category label and no name to greet", async () => {
    await POST(
      postRequest({
        ...VALID_BODY,
        name: "Claim your payout at example.tld/x",
      }),
    );
    await flushMicrotasks();

    expect(mockContactConfirmationEmail).toHaveBeenCalledWith({
      category: "Bug Report",
    });
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
    // No Reply-To on either: a sender's free-mail address as Reply-To on mail
    // from our own domain is a spam rule of its own, and staff reply from the
    // admin inbox instead.
    for (const call of mockSendEmail.mock.calls) {
      expect(call[0].replyTo).toBeUndefined();
    }
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

  // A new address someone gives us, so the strict rule signup and staff
  // invites use, not the form's own looser pattern: that one let control
  // characters and a domain starting with a dot through, and the route mails
  // a confirmation to whatever passes.
  it.each([
    ["a domain that starts with a dot", "alex@.example.com"],
    ["a domain that ends with a dot", "alex@example.com."],
    ["a C0 control character", "al\u0001ex@example.com"],
    ["a C1 control character", "al\u0085ex@example.com"],
    ["no dot in the domain", "alex@localhost"],
    ["two @ signs", "alex@one@example.com"],
  ])("refuses an address with %s and sends nothing", async (_label, email) => {
    const res = await POST(postRequest({ ...VALID_BODY, email }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Please enter a valid email address.",
    );
    await flushMicrotasks();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockRecordSubmission).not.toHaveBeenCalled();
  });

  it.each([
    ["a JSON null", "null"],
    ["a JSON array", "[]"],
    ["a JSON string", '"hello"'],
  ])("answers %s with a 400 and sends nothing", async (_label, raw) => {
    const res = await POST(postRawRequest(raw));
    expect(res.status).toBe(400);
    await flushMicrotasks();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("answers a malformed JSON body with a 400, not a server error", async () => {
    const res = await POST(postRawRequest("{not valid json"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Invalid request body.");
    expect(mockRecordSubmission).not.toHaveBeenCalled();
  });

  it("turns an unexpected failure into a 500 through the shared wrapper", async () => {
    mockCheckRateLimit.mockRejectedValue(new Error("rate limiter down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(postRequest(VALID_BODY));

    expect(res.status).toBe(500);
    spy.mockRestore();
  });

  it("stores the message before attempting to send anything", async () => {
    await POST(postRequest(VALID_BODY));

    expect(mockRecordSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "contact",
        name: "Alex Morgan",
        // Normalised, matching the address the confirmation is sent to.
        email: "alex.morgan@example.com",
        subject: "Found a bug",
        category: "bug",
        message: "The scan endpoint 500s on a bare IP.",
      }),
    );
    // Order matters: the row is what survives a mail outage, so it has to
    // exist before the send is even queued.
    expect(mockRecordSubmission).toHaveBeenCalledBefore(mockSendEmail);
  });

  it("records that the send succeeded", async () => {
    await POST(postRequest(VALID_BODY));
    await flushMicrotasks();

    expect(mockRecordEmailOutcome).toHaveBeenCalledWith(7, {
      delivered: true,
    });
  });

  it("records that the send failed, and still keeps the message", async () => {
    // This is the whole point. Before, a mail failure was a console.error and
    // the sender was thanked; the message existed nowhere.
    mockSendEmail.mockRejectedValue(new Error("smtp: 535 auth failed"));

    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(200);
    await flushMicrotasks();

    expect(mockRecordSubmission).toHaveBeenCalledTimes(1);
    expect(mockRecordEmailOutcome).toHaveBeenCalledWith(7, {
      delivered: false,
      error:
        "staff notification: smtp: 535 auth failed; confirmation to the sender: smtp: 535 auth failed",
    });
  });

  it("says which of the two messages was refused when only one is", async () => {
    // They used to share a Promise.all, so the first rejection won and the
    // stored error never said whether it was the staff copy or the sender's.
    mockSendEmail.mockImplementation(async (opts: { to: string }) => {
      if (opts.to === "alex.morgan@example.com") {
        throw new Error("550 5.7.0 Blocked by SpamAssassin");
      }
    });

    await POST(postRequest(VALID_BODY));
    await flushMicrotasks();

    // The staff copy went through, so the submission counts as delivered and
    // the failed confirmation is recorded beside it.
    expect(mockRecordEmailOutcome).toHaveBeenCalledWith(7, {
      delivered: true,
      error: "confirmation to the sender: 550 5.7.0 Blocked by SpamAssassin",
    });
  });

  it("marks the submission failed when the staff copy is the one refused", async () => {
    mockSendEmail.mockImplementation(async (opts: { to: string }) => {
      if (opts.to !== "alex.morgan@example.com") {
        throw new Error("535 auth failed");
      }
    });

    await POST(postRequest(VALID_BODY));
    await flushMicrotasks();

    expect(mockRecordEmailOutcome).toHaveBeenCalledWith(7, {
      delivered: false,
      error: "staff notification: 535 auth failed",
    });
  });

  it("attempts the second message even though the first was refused", async () => {
    mockSendEmail.mockRejectedValueOnce(new Error("staff mailbox rejected"));

    await POST(postRequest(VALID_BODY));
    await flushMicrotasks();

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it("does not thank the sender when nothing could be stored", async () => {
    // At this point the message is held nowhere, so "we will get back to you"
    // would be untrue. Tell them, so they can reach us another way.
    mockRecordSubmission.mockRejectedValue(new Error("db down"));

    const res = await POST(postRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toMatch(/could not record your message/i);
    expect(mockSendEmail).not.toHaveBeenCalled();
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

  // The siteverify call had no timeout, so a Cloudflare that accepted the
  // connection and went quiet held the request (and the sender) open for as
  // long as the socket lived.
  it("answers within the timeout with a 503 when siteverify never responds", async () => {
    const gatedPOST = await importGatedPOST();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // AbortSignal.timeout runs on Node's internal timers, which fake timers
      // do not reach: the same signal, built on the faked setTimeout.
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
      mockFetch.mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
          }),
      );

      let res: Response | undefined;
      void gatedPOST(
        postRequest({ ...VALID_BODY, turnstileToken: "good-token" }),
      ).then((r) => {
        res = r;
      });
      await vi.advanceTimersByTimeAsync(10_000);

      expect(res).toBeDefined();
      expect(res?.status).toBe(503);
      expect((await (res as Response).json()).error).toBe(
        TURNSTILE_UNAVAILABLE_MESSAGE,
      );
      expect(mockRecordSubmission).not.toHaveBeenCalled();
      expect(mockSendEmail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("answers a non-JSON siteverify reply with a 503, not a 500", async () => {
    const gatedPOST = await importGatedPOST();
    mockFetch.mockResolvedValueOnce(
      new Response("<html>cloudflare error</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const res = await gatedPOST(
      postRequest({ ...VALID_BODY, turnstileToken: "good-token" }),
    );

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(TURNSTILE_UNAVAILABLE_MESSAGE);
    expect(mockRecordSubmission).not.toHaveBeenCalled();
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
