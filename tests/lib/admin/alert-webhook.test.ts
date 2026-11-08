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

  describe("the body each destination can read", () => {
    const SLACK = "https://hooks.slack.com/services/T000/B000/secretpart";
    const DISCORD = "https://discord.com/api/webhooks/123456/secret-token";
    const alert = {
      event: "scheduled_scans_stopped",
      severity: "critical" as const,
      message: "Scheduled scans have stopped.",
      context: { failures: 3, worker: "scheduled" },
    };

    async function sentTo(url: string, overrides = {}) {
      SETTINGS.ADMIN_ALERT_WEBHOOK_URL = url;
      await sendAdminAlert({ ...alert, ...overrides });
      const [, opts] = mockSafeFetch.mock.calls[0];
      return { opts, body: JSON.parse(opts.body) };
    }

    it("sends Slack a text field and nothing it would reject", async () => {
      const { body } = await sentTo(SLACK);

      expect(Object.keys(body)).toEqual(["text"]);
      expect(body.text).toContain("critical: scheduled_scans_stopped");
      expect(body.text).toContain("Scheduled scans have stopped.");
      expect(body.text).toContain("failures: 3");
    });

    it("sends Discord a content field", async () => {
      const { body } = await sentTo(DISCORD);

      expect(body.content).toContain("critical: scheduled_scans_stopped");
      expect(body.content).toContain("Scheduled scans have stopped.");
      expect(body.event).toBeUndefined();
    });

    it("sends Discord's /slack endpoint the Slack body", async () => {
      const { body } = await sentTo(`${DISCORD}/slack`);

      expect(Object.keys(body)).toEqual(["text"]);
    });

    it("keeps the JSON body for any other URL", async () => {
      const { body } = await sentTo("https://siem.example.com/ingest");

      expect(body).toMatchObject({
        event: alert.event,
        severity: alert.severity,
        message: alert.message,
        context: alert.context,
      });
      expect(body.text).toBeUndefined();
      expect(body.content).toBeUndefined();
    });

    it("is not fooled by a provider's name in someone else's URL", async () => {
      const { body } = await sentTo(
        "https://hooks.slack.com.example.net/services/x",
      );

      expect(body.event).toBe(alert.event);
    });

    it("cannot ping a Slack channel from the alert text", async () => {
      const { body } = await sentTo(SLACK, {
        message: "worker said <!channel> & left",
      });

      expect(body.text).toContain("worker said &lt;!channel&gt; &amp; left");
    });

    it("cannot ping anyone on Discord from the alert text", async () => {
      const { body } = await sentTo(DISCORD, { message: "@everyone look" });

      expect(body.allowed_mentions).toEqual({ parse: [] });
    });

    it("stays inside Discord's message limit", async () => {
      const { body } = await sentTo(DISCORD, { message: "x".repeat(5000) });

      expect(body.content.length).toBeLessThanOrEqual(2000);
    });

    it("signs only the JSON body", async () => {
      SETTINGS.ADMIN_ALERT_WEBHOOK_SECRET = "shh-secret";

      const slack = await sentTo(SLACK);
      expect(slack.opts.headers["X-VulnRadar-Signature"]).toBeUndefined();

      mockSafeFetch.mockClear();
      const discord = await sentTo(DISCORD);
      expect(discord.opts.headers["X-VulnRadar-Signature"]).toBeUndefined();

      mockSafeFetch.mockClear();
      const generic = await sentTo("https://siem.example.com/ingest");
      expect(generic.opts.headers["X-VulnRadar-Signature"]).toMatch(/^sha256=/);
    });
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
