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

// FEATURE_WEBHOOKS now gates delivery, not just registration. Mocked at
// the module boundary so it does not consume the mockQuery call sequence
// the webhook_deliveries assertions below depend on.
const mockGetSetting = vi.fn(async (_key: string) => true as unknown);
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...a: unknown[]) =>
    mockGetSetting(...(a as Parameters<typeof mockGetSetting>)),
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
  ownerUserId: 42,
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
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(true);
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

describe("deliverWebhook: delivery headers", () => {
  const DELIVERY_ID = "6f1d1c0e-8a43-4f0b-9b7e-1f1c2a3b4c5d";

  function sentHeaders(call: number) {
    return mockSafeFetch.mock.calls[call][1].headers as Record<string, string>;
  }

  it("names the delivery, the event, the attempt and the time", async () => {
    mockSafeFetch.mockResolvedValue(new Response(null, { status: 200 }));

    await deliverWebhook(webhook, "scan.completed", "{}", DELIVERY_ID);

    const headers = sentHeaders(0);
    expect(headers["X-VulnRadar-Delivery"]).toBe(DELIVERY_ID);
    expect(headers["X-VulnRadar-Event"]).toBe("scan.completed");
    expect(headers["X-VulnRadar-Attempt"]).toBe("1");
    expect(headers["X-VulnRadar-Timestamp"]).toMatch(/^[0-9]{10}$/);
  });

  it("keeps the delivery id across the retry and counts the attempt", async () => {
    vi.useFakeTimers();
    mockSafeFetch.mockImplementation(
      async () => new Response("no", { status: 500 }),
    );

    const promise = deliverWebhook(
      webhook,
      "scan.completed",
      "{}",
      DELIVERY_ID,
    );
    await vi.runAllTimersAsync();
    await promise;

    expect(sentHeaders(0)["X-VulnRadar-Delivery"]).toBe(DELIVERY_ID);
    expect(sentHeaders(1)["X-VulnRadar-Delivery"]).toBe(DELIVERY_ID);
    expect(sentHeaders(0)["X-VulnRadar-Attempt"]).toBe("1");
    expect(sentHeaders(1)["X-VulnRadar-Attempt"]).toBe("2");
    vi.useRealTimers();
  });

  it("signs timestamp.body in Signature-V2 and leaves the v1 header alone", async () => {
    mockSafeFetch.mockResolvedValue(new Response(null, { status: 200 }));
    const body = JSON.stringify({ event: "scan.completed" });

    await deliverWebhook(webhook, "scan.completed", body, DELIVERY_ID);

    const headers = sentHeaders(0);
    const timestamp = headers["X-VulnRadar-Timestamp"];
    const expectedV2 = createHmac("sha256", webhook.secret)
      .update(`${timestamp}.${body}`, "utf8")
      .digest("hex");
    expect(headers["X-VulnRadar-Signature-V2"]).toBe(
      `t=${timestamp},v1=${expectedV2}`,
    );
    expect(headers[SIGNATURE_HEADER]).toBe(
      `sha256=${signWebhookPayload(webhook.secret, body)}`,
    );
  });

  it("sends the identifying headers but no signature when there is no secret", async () => {
    mockSafeFetch.mockResolvedValue(new Response(null, { status: 200 }));

    await deliverWebhook(
      { ...webhook, secret: null },
      "scan.completed",
      "{}",
      DELIVERY_ID,
    );

    const headers = sentHeaders(0);
    expect(headers["X-VulnRadar-Delivery"]).toBe(DELIVERY_ID);
    expect(headers["X-VulnRadar-Signature-V2"]).toBeUndefined();
    expect(headers[SIGNATURE_HEADER]).toBeUndefined();
  });
});

describe("deliverWebhook: the receiver's error body is bounded", () => {
  it("stops reading at the byte cap instead of buffering the whole reply", async () => {
    vi.useFakeTimers();
    let pulls = 0;
    mockSafeFetch.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              pulls += 1;
              controller.enqueue(new TextEncoder().encode("x".repeat(400)));
              if (pulls > 1000) controller.close();
            },
          }),
          { status: 500 },
        ),
    );

    const promise = deliverWebhook(webhook, "scan.completed", "{}");
    await vi.runAllTimersAsync();
    await promise;

    const logged = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO webhook_deliveries"),
    );
    expect(logged?.[1]?.[3]).toHaveLength(500);
    expect(pulls).toBeLessThan(50);
    vi.useRealTimers();
  });

  it("does not wait on a body that never finishes", async () => {
    vi.useFakeTimers();
    mockSafeFetch.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("slow"));
            },
          }),
          { status: 500 },
        ),
    );

    const promise = deliverWebhook(webhook, "scan.completed", "{}");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});

describe("deliverWebhook: who hears about a failure", () => {
  function emailLookupAnswers() {
    mockQuery.mockImplementation(async (sql: string) =>
      String(sql).includes("SELECT email FROM users")
        ? { rows: [{ email: "creator@example.com" }] }
        : { rows: [] },
    );
  }

  it("emails the creator named on the target", async () => {
    vi.useFakeTimers();
    emailLookupAnswers();
    mockSafeFetch.mockImplementation(
      async () => new Response("down", { status: 502 }),
    );

    const promise = deliverWebhook(
      { ...webhook, ownerUserId: 1234 },
      "scan.completed",
      "{}",
    );
    await vi.runAllTimersAsync();
    await promise;

    const lookup = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SELECT email FROM users"),
    );
    expect(lookup?.[1]).toEqual([1234]);
    expect(mockSendNotificationEmail.mock.calls[0][0]).toMatchObject({
      userId: 1234,
      userEmail: "creator@example.com",
      type: "webhook_failures",
    });
    vi.useRealTimers();
  });

  it("says so when a teammate's scan is what failed to arrive", async () => {
    vi.useFakeTimers();
    emailLookupAnswers();
    mockSafeFetch.mockImplementation(
      async () => new Response("down", { status: 502 }),
    );

    const promise = deliverWebhook(
      { ...webhook, teammateScan: true },
      "scan.completed",
      "{}",
    );
    await vi.runAllTimersAsync();
    await promise;

    const { html } = mockSendNotificationEmail.mock.calls[0][0].emailContent;
    expect(html).toContain('"teammateScan":true');
    vi.useRealTimers();
  });
});

describe("FEATURE_WEBHOOKS kill switch", () => {
  it("does not POST, log, or notify when the feature is off", async () => {
    mockGetSetting.mockResolvedValue(false);

    await deliverWebhook(webhook, "scan.completed", JSON.stringify({ a: 1 }));

    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
    const deliveryLogs = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("webhook_deliveries"),
    );
    expect(deliveryLogs).toHaveLength(0);
  });
});
