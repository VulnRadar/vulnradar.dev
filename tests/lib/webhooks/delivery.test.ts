/**
 * Tests for lib/webhooks/delivery.ts: HMAC signing, the webhook_deliveries
 * audit log, the retry-once policy, and the webhook_failures notification
 * that fires only when BOTH attempts fail.
 *
 * The pg pool, safeFetch/validateScanTarget, and sendNotificationEmail are
 * all mocked at the boundary; nothing here touches a real network or
 * database.
 */
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockSafeFetch = vi.fn();
const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
}));

const mockSendNotificationEmail = vi.fn();
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (...args: unknown[]) =>
    mockSendNotificationEmail(...args),
}));

vi.mock("@/lib/email/email", () => ({
  webhookDeliveryFailedEmail: (url: string, details: unknown) => ({
    subject: "Webhook Delivery Failed - VulnRadar",
    text: `failed: ${url}`,
    html: `<p>${JSON.stringify(details)}</p>`,
  }),
}));

const { deliverWebhook, signWebhookPayload, SIGNATURE_HEADER } =
  await import("@/lib/webhooks/delivery");

const webhook = {
  id: 10,
  userId: 42,
  url: "https://example.com/hook",
  type: "generic",
  secret: "test-secret-abc123",
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockSafeFetch.mockReset();
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
  mockSendNotificationEmail.mockReset();
  vi.useRealTimers();
});

describe("signWebhookPayload", () => {
  it("is a verifiable HMAC-SHA256 of the exact body, hex-encoded", () => {
    const body = JSON.stringify({ event: "scan.completed" });
    const signature = signWebhookPayload("my-secret", body);

    const expected = createHmac("sha256", "my-secret")
      .update(body, "utf8")
      .digest("hex");
    expect(signature).toBe(expected);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes if the body changes (tamper-evident)", () => {
    const a = signWebhookPayload("secret", JSON.stringify({ a: 1 }));
    const b = signWebhookPayload("secret", JSON.stringify({ a: 2 }));
    expect(a).not.toBe(b);
  });

  it("changes if the secret changes", () => {
    const body = JSON.stringify({ a: 1 });
    expect(signWebhookPayload("secret-a", body)).not.toBe(
      signWebhookPayload("secret-b", body),
    );
  });

  it("SIGNATURE_HEADER follows the sha256=<hex> convention (GitHub/Stripe-style)", () => {
    expect(SIGNATURE_HEADER).toBe("X-VulnRadar-Signature");
  });
});

describe("deliverWebhook: signing header", () => {
  it("signs the exact body sent and attaches it as sha256=<hex>", async () => {
    mockSafeFetch.mockResolvedValue(new Response(null, { status: 200 }));

    const body = JSON.stringify({ event: "scan.completed", data: {} });
    await deliverWebhook(webhook, "scan.completed", body);

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockSafeFetch.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    const expectedSig = `sha256=${signWebhookPayload(webhook.secret, body)}`;
    expect(headers[SIGNATURE_HEADER]).toBe(expectedSig);
    expect(init.body).toBe(body);
  });

  it("omits the signature header entirely for a legacy webhook with no secret", async () => {
    mockSafeFetch.mockResolvedValue(new Response(null, { status: 200 }));

    await deliverWebhook({ ...webhook, secret: null }, "scan.completed", "{}");

    const [, init] = mockSafeFetch.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers[SIGNATURE_HEADER]).toBeUndefined();
  });
});

describe("deliverWebhook: delivery logging", () => {
  it("logs a successful delivery with the real HTTP status and no retry", async () => {
    mockSafeFetch.mockResolvedValue(new Response(null, { status: 204 }));

    await deliverWebhook(webhook, "scan.completed", "{}");

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    const insertCalls = mockQuery.mock.calls.filter(([sql]) =>
      (sql as string).includes("INSERT INTO webhook_deliveries"),
    );
    expect(insertCalls).toHaveLength(1);
    const [, params] = insertCalls[0];
    expect(params).toEqual([10, "scan.completed", 204, null]);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("logs a failed delivery (non-2xx) with the status and a response snippet", async () => {
    vi.useFakeTimers();
    // A fresh Response per call: a Response body can only be read once, and
    // reusing one instance (mockResolvedValue) across both the first
    // attempt and the retry would make the retry's res.text() read an
    // already-consumed stream.
    mockSafeFetch.mockImplementation(
      async () => new Response("internal error", { status: 500 }),
    );

    const promise = deliverWebhook(webhook, "scan.completed", "{}");
    await vi.runAllTimersAsync();
    await promise;

    const insertCalls = mockQuery.mock.calls.filter(([sql]) =>
      (sql as string).includes("INSERT INTO webhook_deliveries"),
    );
    // First attempt + the one retry, both failed (500).
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]).toEqual([
      10,
      "scan.completed",
      500,
      "internal error",
    ]);
    expect(insertCalls[1][1]).toEqual([
      10,
      "scan.completed",
      500,
      "internal error",
    ]);
    vi.useRealTimers();
  });

  it("logs a network error with a null http_status", async () => {
    vi.useFakeTimers();
    mockSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const promise = deliverWebhook(webhook, "scan.completed", "{}");
    await vi.runAllTimersAsync();
    await promise;

    const insertCalls = mockQuery.mock.calls.filter(([sql]) =>
      (sql as string).includes("INSERT INTO webhook_deliveries"),
    );
    expect(insertCalls[0][1]).toEqual([
      10,
      "scan.completed",
      null,
      "ECONNREFUSED",
    ]);
    vi.useRealTimers();
  });

  it("logs an SSRF block at delivery time with a null http_status", async () => {
    vi.useFakeTimers();
    mockValidateScanTarget.mockResolvedValue({
      safe: false,
      reason: "Domain resolves to internal IP address.",
    });

    const promise = deliverWebhook(webhook, "scan.completed", "{}");
    await vi.runAllTimersAsync();
    await promise;

    expect(mockSafeFetch).not.toHaveBeenCalled();
    const insertCalls = mockQuery.mock.calls.filter(([sql]) =>
      (sql as string).includes("INSERT INTO webhook_deliveries"),
    );
    expect(insertCalls[0][1][2]).toBeNull();
    expect(insertCalls[0][1][3]).toMatch(/Blocked:/);
    vi.useRealTimers();
  });
});

describe("deliverWebhook: retry-once policy", () => {
  it("does not retry after a successful first attempt", async () => {
    mockSafeFetch.mockResolvedValue(new Response(null, { status: 200 }));

    await deliverWebhook(webhook, "scan.completed", "{}");

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once after a failure, then stops even if the retry also fails", async () => {
    vi.useFakeTimers();
    mockSafeFetch.mockResolvedValue(new Response("boom", { status: 503 }));

    const promise = deliverWebhook(webhook, "scan.completed", "{}");
    await vi.runAllTimersAsync();
    await promise;

    // Exactly two attempts total: the original plus one retry, never more.
    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("recovers on the retry: first attempt fails, second succeeds, no failure email", async () => {
    vi.useFakeTimers();
    mockSafeFetch
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const promise = deliverWebhook(webhook, "scan.completed", "{}");
    await vi.runAllTimersAsync();
    await promise;

    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });
});

describe("deliverWebhook: webhook_failures notification", () => {
  it("emails the owner only after BOTH attempts fail", async () => {
    vi.useFakeTimers();
    mockSafeFetch.mockResolvedValue(new Response("down", { status: 502 }));
    mockQuery.mockImplementation(async (sql: string) => {
      if ((sql as string).includes("SELECT email FROM users")) {
        return { rows: [{ email: "owner@example.com" }] };
      }
      return { rows: [] };
    });

    const promise = deliverWebhook(webhook, "scan.completed", "{}");
    await vi.runAllTimersAsync();
    await promise;

    expect(mockSendNotificationEmail).toHaveBeenCalledTimes(1);
    const call = mockSendNotificationEmail.mock.calls[0][0];
    expect(call.userId).toBe(42);
    expect(call.userEmail).toBe("owner@example.com");
    expect(call.type).toBe("webhook_failures");
    vi.useRealTimers();
  });

  it("does not email when the user row can't be found", async () => {
    vi.useFakeTimers();
    mockSafeFetch.mockResolvedValue(new Response("down", { status: 502 }));
    mockQuery.mockImplementation(async (sql: string) => {
      if ((sql as string).includes("SELECT email FROM users")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const promise = deliverWebhook(webhook, "scan.completed", "{}");
    await vi.runAllTimersAsync();
    await promise;

    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("never throws even if logging the delivery fails", async () => {
    mockSafeFetch.mockResolvedValue(new Response(null, { status: 200 }));
    mockQuery.mockRejectedValue(new Error("db down"));

    await expect(
      deliverWebhook(webhook, "scan.completed", "{}"),
    ).resolves.toBeUndefined();
  });
});
