/**
 * Tests for lib/admin/alert-webhook.ts: the operator-configured outbound
 * alert for critical system events (AUDIT-010, production-readiness #4).
 *
 * safeFetch/validateScanTarget and the settings resolver are mocked at the
 * boundary; nothing here touches a real network.
 */
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";

// lib/admin/alert-webhook.ts imports signWebhookPayload from
// lib/webhooks/delivery.ts (a pure function -- no reason to reimplement
// HMAC signing), which transitively imports the pg pool and the
// notification/email helpers. None of those are actually called by
// sendAdminAlert, but importing the real modules would still construct a
// real Pool at module-load time, so they're mocked the same way
// tests/lib/webhooks/delivery.test.ts mocks them.
const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(),
}));
vi.mock("@/lib/email/email", () => ({
  webhookDeliveryFailedEmail: vi.fn(),
}));

const mockSafeFetch = vi.fn();
const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
}));

const SETTINGS: Record<string, string> = {
  ADMIN_ALERT_WEBHOOK_URL: "",
  ADMIN_ALERT_WEBHOOK_SECRET: "",
};
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (key: string) => Promise.resolve(SETTINGS[key]),
}));

const { sendAdminAlert } = await import("@/lib/admin/alert-webhook");

beforeEach(() => {
  mockSafeFetch.mockReset();
  mockSafeFetch.mockResolvedValue({ ok: true, status: 200 });
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
  SETTINGS.ADMIN_ALERT_WEBHOOK_URL = "";
  SETTINGS.ADMIN_ALERT_WEBHOOK_SECRET = "";
});

describe("sendAdminAlert", () => {
  it("is a no-op with no network call when no webhook URL is configured", async () => {
    await sendAdminAlert({
      event: "boot_schema_version_mismatch",
      severity: "critical",
      message: "test",
    });

    expect(mockValidateScanTarget).not.toHaveBeenCalled();
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("posts a JSON payload to the configured URL", async () => {
    SETTINGS.ADMIN_ALERT_WEBHOOK_URL = "https://hooks.example.com/alerts";

    await sendAdminAlert({
      event: "stale_scans_swept",
      severity: "warning",
      message: "3 scans were left running by a previous process.",
      context: { count: 3 },
    });

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockSafeFetch.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/alerts");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.event).toBe("stale_scans_swept");
    expect(body.severity).toBe("warning");
    expect(body.message).toBe(
      "3 scans were left running by a previous process.",
    );
    expect(body.context).toEqual({ count: 3 });
    expect(typeof body.timestamp).toBe("string");
  });

  it("re-validates the configured URL through validateScanTarget before sending (SSRF guard)", async () => {
    SETTINGS.ADMIN_ALERT_WEBHOOK_URL = "https://hooks.example.com/alerts";
    mockValidateScanTarget.mockResolvedValue({
      safe: false,
      reason: "resolves to a private IP",
    });

    await sendAdminAlert({
      event: "boot_required_tables_missing",
      severity: "critical",
      message: "test",
    });

    expect(mockValidateScanTarget).toHaveBeenCalledWith(
      "https://hooks.example.com/alerts",
    );
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("signs the payload with HMAC-SHA256 when a secret is configured", async () => {
    SETTINGS.ADMIN_ALERT_WEBHOOK_URL = "https://hooks.example.com/alerts";
    SETTINGS.ADMIN_ALERT_WEBHOOK_SECRET = "shh-secret";

    await sendAdminAlert({
      event: "boot_schema_check_failed",
      severity: "critical",
      message: "test",
    });

    const [, opts] = mockSafeFetch.mock.calls[0];
    const expectedSig = createHmac("sha256", "shh-secret")
      .update(opts.body, "utf8")
      .digest("hex");
    expect(opts.headers["X-VulnRadar-Signature"]).toBe(`sha256=${expectedSig}`);
  });

  it("omits the signature header when no secret is configured", async () => {
    SETTINGS.ADMIN_ALERT_WEBHOOK_URL = "https://hooks.example.com/alerts";

    await sendAdminAlert({
      event: "boot_schema_check_failed",
      severity: "critical",
      message: "test",
    });

    const [, opts] = mockSafeFetch.mock.calls[0];
    expect(opts.headers["X-VulnRadar-Signature"]).toBeUndefined();
  });

  // AUDIT-012#obs-11: sendAdminAlert now REPORTS the delivery outcome
  // instead of returning void, so a "Send test alert" action can tell the
  // operator why nothing arrived. It still must never throw.
  it("never throws when the fetch itself fails, and reports the reason", async () => {
    SETTINGS.ADMIN_ALERT_WEBHOOK_URL = "https://hooks.example.com/alerts";
    mockSafeFetch.mockRejectedValue(new Error("network unreachable"));

    await expect(
      sendAdminAlert({
        event: "boot_schema_check_failed",
        severity: "critical",
        message: "test",
      }),
    ).resolves.toEqual({ delivered: false, reason: "network unreachable" });
  });

  it("never throws when validateScanTarget itself fails", async () => {
    SETTINGS.ADMIN_ALERT_WEBHOOK_URL = "https://hooks.example.com/alerts";
    mockValidateScanTarget.mockRejectedValue(new Error("dns lookup failed"));

    await expect(
      sendAdminAlert({
        event: "boot_schema_check_failed",
        severity: "critical",
        message: "test",
      }),
    ).resolves.toEqual({ delivered: false, reason: "dns lookup failed" });
  });

  it("does not throw when the receiver responds with a non-2xx status, and surfaces that status", async () => {
    SETTINGS.ADMIN_ALERT_WEBHOOK_URL = "https://hooks.example.com/alerts";
    mockSafeFetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(
      sendAdminAlert({
        event: "boot_schema_check_failed",
        severity: "critical",
        message: "test",
      }),
    ).resolves.toEqual({
      delivered: false,
      reason: "The endpoint responded with HTTP 500.",
    });
  });

  it("reports success with the upstream status on a delivered alert", async () => {
    SETTINGS.ADMIN_ALERT_WEBHOOK_URL = "https://hooks.example.com/alerts";
    mockSafeFetch.mockResolvedValue({ ok: true, status: 204 });

    await expect(
      sendAdminAlert({
        event: "boot_schema_check_failed",
        severity: "warning",
        message: "test",
      }),
    ).resolves.toEqual({ delivered: true, status: 204 });
  });

  it("reports the unconfigured case rather than looking like a success", async () => {
    SETTINGS.ADMIN_ALERT_WEBHOOK_URL = "";

    const result = await sendAdminAlert({
      event: "boot_schema_check_failed",
      severity: "warning",
      message: "test",
    });

    expect(result.delivered).toBe(false);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });
});
