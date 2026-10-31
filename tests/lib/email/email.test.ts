import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTemplateCorpus } from "./_template-corpus";
import { APP_URL } from "@/lib/config/constants";
import { FROZEN } from "@/lib/api/frozen-paths";
import { VALID_TABS } from "@/components/admin/nav";

/**
 * Tests for lib/email/email.ts.
 *
 * sendEmail's real network boundary is nodemailer's transport (whatever
 * `nodemailer.createTransport(...).sendMail(...)` does), not the template
 * builder functions, so that's what's mocked here -- the template
 * builders themselves are exercised for real. This covers:
 *
 *  - buildSmtpTransport's port-based TLS selection (a real fix landed
 *    this session: `secure: false` alone falls back to plaintext if a
 *    server strips STARTTLS, so port 587/25 must set `requireTLS: true`).
 *  - sendEmail's SMTP-not-configured branch (dev no-ops, production
 *    throws) and that a send body is never logged, even truncated.
 *  - that a transport failure propagates as a normal rejection, which is
 *    what every caller's existing `.catch((err) => console.error(...))`
 *    pattern (see app/api/v3/auth/forgot-password/route.ts,
 *    app/api/v3/auth/login/route.ts) depends on to avoid an unhandled
 *    rejection crashing the request.
 *  - the highest-stakes templates: password reset, the 2FA code, the
 *    password-changed security alert, and the new-login alert.
 *
 * Notification-preference gating (a user who opted out doesn't get sent
 * the email) lives one layer up, in lib/notifications/notifications.ts's
 * sendNotificationEmail, which wraps this file's sendEmail. That's
 * already covered by tests/lib/notifications/notifications.test.ts.
 */

type TransportConfig = Record<string, unknown>;

let transportConfigCalls: TransportConfig[] = [];
const sendMailMock = vi.fn();
const createTransportMock = vi.fn((config: TransportConfig) => {
  transportConfigCalls.push(config);
  return { sendMail: sendMailMock };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: (config: TransportConfig) => createTransportMock(config),
  },
}));

// email_logs (AUDIT-010): sendEmail's own best-effort write to
// email_logs, via a lazy `await import("@/lib/database/db")` inside
// logEmailAttempt (not a top-level import -- this module must not gain a
// hard load-time dependency on DATABASE_URL, the same reasoning as this
// session's earlier lib/admin/staff-invites.ts fix). Mocked here so the
// insert itself can be asserted on; every test above this point already
// proved sendEmail's own send/reject behavior is unaffected even with NO
// mock at all (the dynamic import rejects, logEmailAttempt's own
// try/catch swallows it).
let emailLogInserts: unknown[][] = [];
// sendEmail also resolves the NOREPLY_EMAIL runtime setting, which reads
// system_settings through lib/config/runtime-config. Rows are served from a
// mutable list so a test can pretend an operator edited the admin field.
let systemSettingsRows: { key: string; value: string }[] = [];
const mockDbQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  if (sql.includes("system_settings")) {
    return { rows: systemSettingsRows };
  }
  if (sql.trim().startsWith("INSERT INTO email_logs")) {
    emailLogInserts.push(params);
  }
  return { rows: [] };
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockDbQuery(sql, params),
  },
}));

const ORIGINAL_ENV = { ...process.env };
const SMTP_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "SMTP_EHLO_NAME",
];

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  for (const key of SMTP_KEYS) delete process.env[key];
}

function configureSmtp(
  overrides: Partial<Record<(typeof SMTP_KEYS)[number], string>> = {},
) {
  process.env.SMTP_HOST = overrides.SMTP_HOST ?? "smtp.example.com";
  process.env.SMTP_PORT = overrides.SMTP_PORT ?? "587";
  process.env.SMTP_USER = overrides.SMTP_USER ?? "user@example.com";
  process.env.SMTP_PASS = overrides.SMTP_PASS ?? "app-password";
  if (overrides.SMTP_FROM) process.env.SMTP_FROM = overrides.SMTP_FROM;
}

beforeEach(() => {
  vi.resetModules();
  transportConfigCalls = [];
  sendMailMock.mockReset();
  createTransportMock.mockClear();
  emailLogInserts = [];
  systemSettingsRows = [];
  mockDbQuery.mockClear();
  resetEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllEnvs();
});

function loadEmail() {
  return import("@/lib/email/email");
}

describe("buildSmtpTransport (TLS pinning regression)", () => {
  it("uses implicit TLS (secure: true) for port 465", async () => {
    configureSmtp({ SMTP_PORT: "465" });
    await loadEmail();
    expect(createTransportMock).toHaveBeenCalledTimes(1);
    const config = transportConfigCalls[0];
    expect(config.secure).toBe(true);
    expect(config.requireTLS).toBeUndefined();
    expect((config.tls as { minVersion: string }).minVersion).toBe("TLSv1.2");
  });

  it("requires STARTTLS (never silently falls back to plaintext) for port 587", async () => {
    configureSmtp({ SMTP_PORT: "587" });
    await loadEmail();
    const config = transportConfigCalls[0];
    expect(config.secure).toBe(false);
    expect(config.requireTLS).toBe(true);
    expect((config.tls as { minVersion: string }).minVersion).toBe("TLSv1.2");
  });

  it("also requires STARTTLS for port 25", async () => {
    configureSmtp({ SMTP_PORT: "25" });
    await loadEmail();
    const config = transportConfigCalls[0];
    expect(config.secure).toBe(false);
    expect(config.requireTLS).toBe(true);
  });

  it("never constructs a transport when SMTP is not fully configured", async () => {
    // SMTP_HOST left unset.
    await loadEmail();
    expect(createTransportMock).not.toHaveBeenCalled();
  });
});

describe("sendEmail without SMTP configured", () => {
  it("logs and resolves without sending outside production", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();
    await expect(
      sendEmail({
        to: "user@example.com",
        subject: "Hi",
        text: "body",
        html: "<p>body</p>",
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain(
      "SMTP is not configured",
    );
    expect(sendMailMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("says so in one line that names neither the recipient nor the subject", async () => {
    // The old block printed the address and the subject, under a comment
    // promising metadata only. A subject can carry a name or an address, and
    // the attempt is already recorded in Email Logs.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();
    await sendEmail({
      to: "private.person@example.com",
      subject: "Reset for private.person@example.com",
      text: "0123456789",
      html: "<p/>",
      template: "passwordReset",
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = String(warnSpy.mock.calls[0][0]);
    expect(line).toContain("passwordReset");
    expect(line).not.toContain("private.person");
    expect(line).not.toContain("@");
    warnSpy.mockRestore();
  });

  it("never logs the email body, not even truncated (reset links / 2FA codes must not hit logs)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();
    const secretText = "reset link: https://x/reset?token=super-secret-token";
    await sendEmail({
      to: "user@example.com",
      subject: "Hi",
      text: secretText,
      html: "<p/>",
    });
    for (const call of warnSpy.mock.calls) {
      expect(call.join(" ")).not.toContain("super-secret-token");
    }
    warnSpy.mockRestore();
  });

  it("records the template on the row that stands in for the send", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();
    await sendEmail({
      to: "u@x.com",
      subject: "s",
      text: "t",
      html: "<p/>",
      template: "scanComplete",
    });
    expect(emailLogInserts).toHaveLength(1);
    const params = emailLogInserts[0];
    expect(params[2]).toBe("skipped_not_configured");
    expect(params[6]).toBe("scanComplete");
    // Nothing was attempted, so there is no From, relay or reply to record.
    expect(params.slice(7)).toEqual([null, null, null, null, null, null, null]);
  });

  it("throws in production instead of silently no-op'ing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      sendEmail({
        to: "user@example.com",
        subject: "Hi",
        text: "body",
        html: "<p/>",
      }),
    ).rejects.toThrow("Email service not configured");
  });
});

describe("sendEmail with SMTP configured", () => {
  it("sends through the transporter, wrapped in the standard layout by default", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail } = await loadEmail();

    await sendEmail({
      to: "user@example.com",
      subject: "Test Subject",
      text: "plain text body",
      html: "<p>inner content</p>",
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(mailArgs.to).toBe("user@example.com");
    expect(mailArgs.subject).toBe("Test Subject");
    expect(mailArgs.text).toBe("plain text body");
    expect(mailArgs.from as string).toContain("<user@example.com>");
    expect(mailArgs.html as string).toContain("<!DOCTYPE html>");
    expect(mailArgs.html as string).toContain("<p>inner content</p>");
  });

  it("skips the layout wrapper when skipLayout is set", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail } = await loadEmail();

    await sendEmail({
      to: "user@example.com",
      subject: "Raw",
      text: "raw",
      html: "<p>raw content</p>",
      skipLayout: true,
    });

    const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(mailArgs.html).toBe("<p>raw content</p>");
  });

  it("includes an unsubscribe link built from the given token", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail } = await loadEmail();

    await sendEmail({
      to: "user@example.com",
      subject: "Digest",
      text: "digest",
      html: "<p>digest</p>",
      unsubscribeToken: "abc123",
    });

    const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(mailArgs.html as string).toContain("/unsubscribe?token=abc123");
  });

  it("omits the unsubscribe CTA when no token is given", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail } = await loadEmail();

    await sendEmail({
      to: "user@example.com",
      subject: "s",
      text: "t",
      html: "<p/>",
    });

    const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(mailArgs.html as string).not.toContain("/unsubscribe?token=");
  });

  it("prefers SMTP_FROM over SMTP_USER when both are configured", async () => {
    configureSmtp({ SMTP_FROM: "no-reply@vulnradar.dev" });
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail } = await loadEmail();
    await sendEmail({ to: "u@x.com", subject: "s", text: "t", html: "<p/>" });
    const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(mailArgs.from as string).toContain("<no-reply@vulnradar.dev>");
  });

  describe("List-Unsubscribe (RFC 8058)", () => {
    it("sets a one-click unsubscribe header scoped to the message's own category", async () => {
      configureSmtp();
      sendMailMock.mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail({
        to: "user@example.com",
        subject: "Digest",
        text: "digest",
        html: "<p>digest</p>",
        unsubscribeToken: "abc123",
        unsubscribeColumn: "email_posture_digest",
      });

      const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
      const headers = mailArgs.headers as Record<string, string>;
      // Must be the API route, not the /unsubscribe page: RFC 8058 requires
      // the https URI in the header to accept the POST, and a Next page route
      // answers 405.
      expect(headers["List-Unsubscribe"]).toBe(
        `<${APP_URL}/api/v3/account/unsubscribe?token=abc123&type=email_posture_digest>`,
      );
      expect(headers["List-Unsubscribe-Post"]).toBe(
        "List-Unsubscribe=One-Click",
      );
    });

    it("never points the one-click link at 'unsubscribe from everything'", async () => {
      // It did, and the route it pointed at switched off the sign-in,
      // password and two-factor warnings along with the newsletter.
      configureSmtp();
      sendMailMock.mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail({
        to: "user@example.com",
        subject: "Digest",
        text: "digest",
        html: "<p>digest</p>",
        unsubscribeToken: "abc123",
        unsubscribeColumn: "email_scan_complete",
      });

      const headers = (
        sendMailMock.mock.calls[0][0] as { headers: Record<string, string> }
      ).headers;
      expect(headers["List-Unsubscribe"]).not.toContain("unsubscribe_all");
    });

    it("offers no mailto: target, because nothing reads that mailbox", async () => {
      configureSmtp();
      sendMailMock.mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail({
        to: "user@example.com",
        subject: "Digest",
        text: "digest",
        html: "<p>digest</p>",
        unsubscribeToken: "abc123",
        unsubscribeColumn: "email_scan_complete",
      });

      const headers = (
        sendMailMock.mock.calls[0][0] as { headers: Record<string, string> }
      ).headers;
      expect(headers["List-Unsubscribe"]).not.toContain("mailto:");
    });

    it("sets no header when the message names no category, but still shows the footer link", async () => {
      // A token alone is the footer's "Manage email preferences" link. The
      // one-click header needs to know WHICH preference it turns off.
      configureSmtp();
      sendMailMock.mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail({
        to: "user@example.com",
        subject: "An administrator updated your account",
        text: "t",
        html: "<p/>",
        unsubscribeToken: "abc123",
      });

      const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
      expect(mailArgs.headers).toBeUndefined();
      expect(mailArgs.html as string).toContain("/unsubscribe?token=abc123");
    });

    it("adds the preferences link to the plain-text part too, so the two parts match", async () => {
      configureSmtp();
      sendMailMock.mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail({
        to: "user@example.com",
        subject: "Digest",
        text: "digest body",
        html: "<p>digest</p>",
        unsubscribeToken: "abc123",
        unsubscribeColumn: "email_posture_digest",
      });

      const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
      expect(mailArgs.text).toBe(
        `digest body\n\n--\nManage email preferences: ${APP_URL}/unsubscribe?token=abc123`,
      );
    });

    it("sends no unsubscribe header on mail with no token, so security notices stay non-optional", async () => {
      configureSmtp();
      sendMailMock.mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail({
        to: "user@example.com",
        subject: "Your password was changed",
        text: "t",
        html: "<p/>",
      });

      const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
      expect(mailArgs.headers).toBeUndefined();
    });
  });

  describe("preheader", () => {
    it("renders a hidden preview line derived from the plain-text body", async () => {
      configureSmtp();
      sendMailMock.mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail({
        to: "user@example.com",
        subject: "Scan complete",
        text: "2 critical, 5 high on https://example.com, scanned in 3.1s.\n\nFindings:\n- Critical: 2",
        html: "<p>body</p>",
      });

      const html = (sendMailMock.mock.calls[0][0] as Record<string, unknown>)
        .html as string;
      expect(html).toContain(
        "2 critical, 5 high on https://example.com, scanned in 3.1s.",
      );
      // It has to sit before the wordmark, or the preview still starts with
      // the sender name.
      expect(html.indexOf("2 critical, 5 high")).toBeLessThan(
        html.indexOf("VulnRadar</span>"),
      );
      expect(html).toContain("mso-hide: all");
    });

    it("keeps a numeric code out of the preview line", async () => {
      configureSmtp();
      sendMailMock.mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail({
        to: "user@example.com",
        subject: "112233 is your sign-in code",
        text: "Your VulnRadar sign-in code is 112233. It expires in 10 minutes.\n\nDon't share this code.",
        html: "<p>body</p>",
      });

      const html = (sendMailMock.mock.calls[0][0] as Record<string, unknown>)
        .html as string;
      const preheader = /mso-hide: all[^>]*>([^<]*)</.exec(html)?.[1] ?? "";
      expect(preheader).not.toContain("112233");
      expect(preheader).toContain("It expires in 10 minutes.");
    });

    it("uses an explicit preheader over the derived one", async () => {
      configureSmtp();
      sendMailMock.mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail({
        to: "user@example.com",
        subject: "s",
        text: "Derived sentence here.",
        html: "<p/>",
        preheader: "Explicit preview line.",
      });

      const html = (sendMailMock.mock.calls[0][0] as Record<string, unknown>)
        .html as string;
      expect(html).toContain("Explicit preview line.");
      expect(html).not.toContain("Derived sentence here.");
    });
  });

  describe("From address (NOREPLY_EMAIL)", () => {
    it("uses a configured NOREPLY_EMAIL when SMTP_FROM is unset", async () => {
      configureSmtp();
      systemSettingsRows = [
        { key: "NOREPLY_EMAIL", value: "noreply@selfhosted.test" },
      ];
      sendMailMock.mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail({ to: "u@x.com", subject: "s", text: "t", html: "<p/>" });

      const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
      expect(mailArgs.from as string).toContain("<noreply@selfhosted.test>");
    });

    it("still lets an explicit SMTP_FROM win, for relays that pin the envelope sender", async () => {
      configureSmtp({ SMTP_FROM: "verified@ses.test" });
      systemSettingsRows = [
        { key: "NOREPLY_EMAIL", value: "noreply@selfhosted.test" },
      ];
      sendMailMock.mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail({ to: "u@x.com", subject: "s", text: "t", html: "<p/>" });

      const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
      expect(mailArgs.from as string).toContain("<verified@ses.test>");
    });

    it("falls back to SMTP_USER when NOREPLY_EMAIL is left at its shipped default", async () => {
      // An operator who never touched either field must not start sending as
      // noreply@vulnradar.dev and fail their own SPF.
      configureSmtp();
      sendMailMock.mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail({ to: "u@x.com", subject: "s", text: "t", html: "<p/>" });

      const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
      expect(mailArgs.from as string).toContain("<user@example.com>");
    });
  });

  it("passes replyTo through untouched", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail } = await loadEmail();
    await sendEmail({
      to: "u@x.com",
      subject: "s",
      text: "t",
      html: "<p/>",
      replyTo: "someone@else.com",
    });
    const mailArgs = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(mailArgs.replyTo).toBe("someone@else.com");
  });
});

describe("sendEmail failure propagation", () => {
  it("rejects when the transport fails, instead of swallowing the error", async () => {
    configureSmtp();
    sendMailMock.mockRejectedValueOnce(new Error("SMTP connection refused"));
    const { sendEmail } = await loadEmail();

    await expect(
      sendEmail({ to: "u@x.com", subject: "s", text: "t", html: "<p/>" }),
    ).rejects.toThrow("SMTP connection refused");
  });

  it("matches the .catch() pattern every caller relies on: a real failure is caught, not an uncaught rejection", async () => {
    // Same shape as app/api/v3/auth/forgot-password/route.ts and
    // app/api/v3/auth/login/route.ts: `sendEmail(...).catch((err) => ...)`.
    configureSmtp();
    sendMailMock.mockRejectedValueOnce(new Error("SMTP timeout"));
    const { sendEmail } = await loadEmail();

    const errorHandler = vi.fn();
    await sendEmail({
      to: "u@x.com",
      subject: "s",
      text: "t",
      html: "<p/>",
    }).catch(errorHandler);

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect((errorHandler.mock.calls[0][0] as Error).message).toBe(
      "SMTP timeout",
    );
  });
});

describe("email_logs (AUDIT-010)", () => {
  it("logs a successful send with status 'sent'", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce(undefined);
    const { sendEmail } = await loadEmail();

    await sendEmail({
      to: "u@x.com",
      subject: "Reset your password",
      text: "hello",
      html: "<p>hi</p>",
    });

    // Await a microtask turn: logEmailAttempt is awaited inside sendEmail,
    // so by the time sendEmail resolves the insert has already happened.
    expect(emailLogInserts).toHaveLength(1);
    const [recipient, subject, status, error] = emailLogInserts[0];
    expect(recipient).toBe("u@x.com");
    expect(subject).toBe("Reset your password");
    expect(status).toBe("sent");
    expect(error).toBeNull();
  });

  it("logs a failed send with status 'failed' and the error message, and still rejects", async () => {
    configureSmtp();
    sendMailMock.mockRejectedValueOnce(new Error("SMTP connection refused"));
    const { sendEmail } = await loadEmail();

    await expect(
      sendEmail({ to: "u@x.com", subject: "s", text: "t", html: "<p/>" }),
    ).rejects.toThrow("SMTP connection refused");

    expect(emailLogInserts).toHaveLength(1);
    const [, , status, error] = emailLogInserts[0];
    expect(status).toBe("failed");
    expect(error).toBe("SMTP connection refused");
  });

  it("logs 'skipped_not_configured' when SMTP isn't configured (dev no-op path)", async () => {
    const { sendEmail } = await loadEmail();
    await sendEmail({ to: "u@x.com", subject: "s", text: "t", html: "<p/>" });

    expect(emailLogInserts).toHaveLength(1);
    expect(emailLogInserts[0][2]).toBe("skipped_not_configured");
  });

  it("stores a redacted preview, never the raw body", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce(undefined);
    const { sendEmail } = await loadEmail();

    await sendEmail({
      to: "u@x.com",
      subject: "s",
      text: "Click here: https://vulnradar.dev/reset-password?token=abc123def456ghi789jkl",
      html: "<p/>",
    });

    const preview = emailLogInserts[0][4] as string;
    expect(preview).not.toContain("token=");
    expect(preview).toContain("[REDACTED LINK]");
  });

  it("stores the rendered document, so the admin viewer has something faithful to show", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce(undefined);
    const { sendEmail } = await loadEmail();

    await sendEmail({
      to: "u@x.com",
      subject: "s",
      text: "t",
      html: "<h1>Confirm your email address</h1>",
    });

    const storedHtml = emailLogInserts[0][5] as string;
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(storedHtml).toContain("<h1>Confirm your email address</h1>");
    // The branded shell, not just the fragment the template returned: what
    // the recipient saw is the whole document, so that is what is kept.
    expect(storedHtml).toContain("<!DOCTYPE html>");
    expect(sentHtml).toContain("<h1>Confirm your email address</h1>");
  });

  it("stores the rendered document on the not-configured path too", async () => {
    const { sendEmail } = await loadEmail();

    await sendEmail({
      to: "u@x.com",
      subject: "s",
      text: "t",
      html: "<p>would have been sent</p>",
    });

    expect(emailLogInserts[0][2]).toBe("skipped_not_configured");
    expect(emailLogInserts[0][5]).toContain("would have been sent");
  });

  it("redacts the stored document, never a working link", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce(undefined);
    const { sendEmail } = await loadEmail();

    await sendEmail({
      to: "u@x.com",
      subject: "s",
      text: "t",
      html: '<a href="https://vulnradar.dev/reset?token=abc123def456ghi789jkl">Choose a new password</a>',
    });

    const storedHtml = emailLogInserts[0][5] as string;
    expect(storedHtml).not.toContain("token=abc123def456ghi789jkl");
    expect(storedHtml).toContain("Choose a new password");
  });

  it("drops the rendered copy rather than storing a truncated, broken one", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce(undefined);
    const { sendEmail } = await loadEmail();

    await sendEmail({
      to: "u@x.com",
      subject: "s",
      text: "t",
      // Ordinary prose, not one long run: a single 120k-character word is a
      // token, and redaction would collapse it back under the ceiling.
      html: "<p>hello there</p>".repeat(8_000),
    });

    expect(emailLogInserts[0][5]).toBeNull();
    // The row itself is still written, with its metadata and text preview.
    expect(emailLogInserts[0][2]).toBe("sent");
  });

  it("never throws or breaks sendEmail even if the DB write itself fails", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce(undefined);
    // The first query is the From-address setting lookup. It used to be the
    // one this rejection landed on, so the INSERT was never what failed.
    mockDbQuery.mockImplementationOnce(async () => ({ rows: [] }));
    mockDbQuery.mockRejectedValueOnce(new Error("db unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();

    await expect(
      sendEmail({ to: "u@x.com", subject: "s", text: "t", html: "<p/>" }),
    ).resolves.toBeUndefined();
  });
});

describe("redactEmailPreview", () => {
  it("redacts URLs (reset/invite/verification/unsubscribe links)", async () => {
    const { redactEmailPreview } = await loadEmail();
    const result = redactEmailPreview(
      "Click https://vulnradar.dev/reset-password?token=abc123 to continue.",
    );
    expect(result).not.toContain("https://");
    expect(result).not.toContain("token=abc123");
    expect(result).toContain("[REDACTED LINK]");
  });

  it("redacts standalone numeric codes (2FA/OTP codes)", async () => {
    const { redactEmailPreview } = await loadEmail();
    const result = redactEmailPreview("Your verification code is 482913.");
    expect(result).not.toContain("482913");
    expect(result).toContain("[REDACTED CODE]");
  });

  it("redacts long opaque tokens even outside a URL", async () => {
    const { redactEmailPreview } = await loadEmail();
    const result = redactEmailPreview(
      "Your invite token: aVeryLongOpaqueRandomToken1234567890",
    );
    expect(result).not.toContain("aVeryLongOpaqueRandomToken1234567890");
    expect(result).toContain("[REDACTED TOKEN]");
  });

  it("leaves ordinary short, non-sensitive text untouched", async () => {
    const { redactEmailPreview } = await loadEmail();
    const result = redactEmailPreview(
      "Hi there, your scan of example.com is complete.",
    );
    expect(result).toBe("Hi there, your scan of example.com is complete.");
  });

  it("redacts every sensitive substring in mixed content", async () => {
    const { redactEmailPreview } = await loadEmail();
    const result = redactEmailPreview(
      "Code: 123456. Link: https://vulnradar.dev/verify?t=xyz. Thanks.",
    );
    expect(result).toContain("[REDACTED CODE]");
    expect(result).toContain("[REDACTED LINK]");
    expect(result).not.toContain("123456");
    expect(result).not.toContain("https://");
  });
});

describe("redactEmailHtml", () => {
  it("strips the token out of an href without disturbing the tag", async () => {
    const { redactEmailHtml } = await loadEmail();
    const result = redactEmailHtml(
      '<a href="https://vulnradar.dev/reset?token=abc123" style="color: #93c5fd;">Reset</a>',
    );
    expect(result).not.toContain("token=abc123");
    expect(result).toContain('style="color: #93c5fd;"');
    expect(result).toContain(">Reset</a>");
  });

  it("handles an unquoted href", async () => {
    const { redactEmailHtml } = await loadEmail();
    const result = redactEmailHtml(
      "<a href=https://vulnradar.dev/verify?t=secretvalue >Verify</a>",
    );
    expect(result).not.toContain("secretvalue");
  });

  it("redacts a one-time code that is readable in the body", async () => {
    const { redactEmailHtml } = await loadEmail();
    const result = redactEmailHtml(
      '<div style="font-size: 34px;">482913</div>',
    );
    expect(result).not.toContain("482913");
    expect(result).toContain("[REDACTED CODE]");
    // The presentation survives, which is the whole point of a second pass.
    expect(result).toContain('style="font-size: 34px;"');
  });

  it("redacts a copy-paste fallback URL printed as body text", async () => {
    const { redactEmailHtml } = await loadEmail();
    const result = redactEmailHtml(
      "<p>Or paste this link: https://vulnradar.dev/verify?token=abc123def456ghi</p>",
    );
    expect(result).not.toContain("token=");
    expect(result).toContain("[REDACTED LINK]");
  });

  it("leaves numeric attribute values and inline styles alone", async () => {
    const { redactEmailHtml } = await loadEmail();
    const result = redactEmailHtml(
      '<table width="600" style="border-radius: 9999px; max-width: 1200px;"><tr><td>Hi</td></tr></table>',
    );
    expect(result).toContain('width="600"');
    expect(result).toContain("border-radius: 9999px");
    expect(result).toContain("max-width: 1200px");
  });

  it("leaves character references alone", async () => {
    const { redactEmailHtml } = await loadEmail();
    // The hidden preheader filler. Not content, and not a secret; the plain
    // numeric rule would turn every one of these into &#[REDACTED CODE];.
    const result = redactEmailHtml("<div>&#8199;&#65279;&#8199;</div>");
    expect(result).toBe("<div>&#8199;&#65279;&#8199;</div>");
  });

  it("leaves a message with nothing sensitive in it byte-identical", async () => {
    const { redactEmailHtml } = await loadEmail();
    const html =
      '<p style="color: #e5e7eb;">Your scan of example.com is complete.</p>';
    expect(redactEmailHtml(html)).toBe(html);
  });

  it("leaves src alone, which the viewer blocks instead", async () => {
    const { redactEmailHtml } = await loadEmail();
    const result = redactEmailHtml(
      '<img src="https://vulnradar.dev/logo.svg" width="30" />',
    );
    expect(result).toContain('src="https://vulnradar.dev/logo.svg"');
  });
});

describe("high-stakes templates", () => {
  let email: Awaited<ReturnType<typeof loadEmail>>;

  beforeEach(async () => {
    email = await loadEmail();
  });

  describe("passwordResetEmail", () => {
    it("carries the reset link in both bodies and names the app in the subject", () => {
      const result = email.passwordResetEmail(
        "https://vulnradar.dev/reset?token=xyz",
      );
      expect(result.subject).toContain("Reset your");
      expect(result.text).toContain("https://vulnradar.dev/reset?token=xyz");
      expect(result.html).toContain(
        'href="https://vulnradar.dev/reset?token=xyz"',
      );
    });

    it("states the link's expiry window", () => {
      const result = email.passwordResetEmail(
        "https://vulnradar.dev/reset?token=xyz",
      );
      expect(result.text).toContain("works for one hour");
    });
  });

  describe("email2FACodeEmail", () => {
    it("carries the verification code in both bodies, never the subject", () => {
      const result = email.email2FACodeEmail("482913");
      expect(result.subject).not.toContain("482913");
      expect(result.text).toContain("482913");
      expect(result.html).toContain("482913");
      expect(result.text).toContain("expires in 10 minutes");
    });

    it("HTML-escapes the code so it cannot break out of the markup", () => {
      const result = email.email2FACodeEmail("<img src=x onerror=alert(1)>");
      expect(result.html).not.toContain("<img src=x onerror=alert(1)>");
      expect(result.html).toContain("&lt;img");
    });
  });

  describe("passwordChangedEmail (security alert)", () => {
    const details = { ipAddress: "203.0.113.5", userAgent: "Mozilla/5.0" };

    it("names two-factor requirement when the account has 2FA enabled", () => {
      const result = email.passwordChangedEmail(true, details);
      expect(result.subject).toContain("password was changed");
      expect(result.text).toContain("Two-factor authentication");
      expect(result.html).toContain(details.ipAddress);
    });

    it("mentions session logout when the account has no 2FA", () => {
      const result = email.passwordChangedEmail(false, details);
      expect(result.text).toContain("signed out");
    });

    it("goes to the account's own address only via the caller -- the body carries no recipient, only IP/device metadata", () => {
      const result = email.passwordChangedEmail(false, details);
      expect(result.text).toContain(details.ipAddress);
      expect(result.text).toContain(details.userAgent);
    });

    it("HTML-escapes a malicious user-agent instead of injecting it verbatim", () => {
      const result = email.passwordChangedEmail(false, {
        ipAddress: "203.0.113.5",
        userAgent: "<script>alert(1)</script>",
      });
      expect(result.html).not.toContain("<script>alert(1)</script>");
      expect(result.html).toContain("&lt;script&gt;");
    });

    it("never states the new password itself", () => {
      const result = email.passwordChangedEmail(false, details);
      expect(result.text.toLowerCase()).not.toContain("your new password is");
    });
  });

  describe("newLoginEmail (security alert)", () => {
    it("includes location, IP, and device in both bodies", () => {
      const result = email.newLoginEmail("Austin, US", "203.0.113.9", {
        ipAddress: "203.0.113.9",
        userAgent: "curl/8.0",
      });
      expect(result.subject).toContain("New sign-in");
      expect(result.text).toContain("Austin, US");
      expect(result.text).toContain("203.0.113.9");
      expect(result.html).toContain("Austin, US");
      expect(result.html).toContain("203.0.113.9");
    });

    it("HTML-escapes the location field", () => {
      const result = email.newLoginEmail("<b>Injected</b>", "203.0.113.9", {
        ipAddress: "203.0.113.9",
        userAgent: "curl/8.0",
      });
      expect(result.html).not.toContain("<b>Injected</b>");
      expect(result.html).toContain("&lt;b&gt;Injected&lt;/b&gt;");
    });
  });
});

describe("escapeHtml (via contactEmail)", () => {
  it("escapes a category label instead of injecting raw HTML", async () => {
    const email = await loadEmail();
    const result = email.contactEmail({
      submissionId: 9,
      category: "<script>steal()</script>",
    });
    expect(result.html).not.toContain("<script>steal()</script>");
    expect(result.html).toContain("&lt;script&gt;");
  });
});

/**
 * The contact form's two messages. The staff copy used to forward the
 * submission (the sender's subject as ours, their message quoted, their
 * address as Reply-To) from our own sender to our own mailbox, and the
 * confirmation greeted whatever name was typed. Both went out through the
 * relay's spam scoring as our mail. See the notes on contactEmail.
 */
describe("the contact form emails", () => {
  it("makes the staff copy a pointer: an id, a category and a link, none of the submission", async () => {
    const { contactEmail } = await loadEmail();
    const mail = contactEmail({
      submissionId: 128,
      category: "Security Issue",
    });

    expect(mail.subject).toBe("New contact submission #128 (Security Issue)");
    expect(mail.text).toContain("#128");
    expect(mail.text).toContain("/admin?tab=support-tickets&view=contact");
    // The href is escaped in the document, so check both parts for the link.
    expect(mail.html).toContain("/admin?tab=support-tickets&amp;view=contact");
    // Nothing a sender typed has anywhere to appear: the builder is not even
    // given it, and it offers no Reply-To to pass on. The shape of the input
    // is the guarantee.
    expect((mail as Record<string, unknown>).replyTo).toBeUndefined();
  });

  it("confirms to the sender with no greeting and nothing they typed", async () => {
    const { contactConfirmationEmail } = await loadEmail();
    // It takes a category from our own fixed list and nothing else, which is
    // what makes a name like "Claim your payout at example.tld/x" harmless.
    const mail = contactConfirmationEmail({ category: "Bug Report" });

    expect(mail.text).not.toMatch(/^Hi\b/);
    expect(mail.html).not.toMatch(/Hi [A-Z]/);
    expect(mail.text).toContain("bug report request");
  });
});

/**
 * Where the two staff alerts send the reader. The contact alert said
 * `tab=support` and the ticket alert said bare `/admin`; the first is not a tab
 * the admin page knows (it opened Overview and never read `view`), the second
 * is Overview on purpose. Both now name the id components/admin/nav.ts routes
 * on, and the second is checked against that table so a rename cannot leave
 * the mail pointing at nothing again.
 */
describe("the staff alerts' links into the admin panel", () => {
  const ticketAlert = {
    ticketId: 3182,
    subject: "Scheduled scan stopped running",
    category: "help",
    fromEmail: "dana@example.dev",
    body: "The nightly sweep has not produced a report.",
  };

  function adminUrls(text: string): URL[] {
    const found = text.match(/https?:\/\/\S+\/admin\?\S+/g) ?? [];
    return found.map((raw) => new URL(raw));
  }

  it("opens the ticket queue for a new ticket", async () => {
    const { supportTicketStaffAlertEmail } = await loadEmail();
    const mail = supportTicketStaffAlertEmail({ ...ticketAlert, isNew: true });

    expect(mail.text).toContain(`${APP_URL}/admin?tab=support-tickets`);
    expect(mail.html).toContain(`${APP_URL}/admin?tab=support-tickets"`);
    expect(mail.text).not.toMatch(/\/admin\s*$/);
    expect(mail.html).not.toContain(`href="${APP_URL}/admin"`);
  });

  it("opens the same place for a reply on a ticket", async () => {
    const { supportTicketStaffAlertEmail } = await loadEmail();
    const mail = supportTicketStaffAlertEmail({ ...ticketAlert, isNew: false });

    expect(mail.text).toContain(`${APP_URL}/admin?tab=support-tickets`);
    expect(mail.html).toContain(`${APP_URL}/admin?tab=support-tickets"`);
  });

  it("opens the contact view of the same tab for a contact submission", async () => {
    const { contactEmail } = await loadEmail();
    const mail = contactEmail({ submissionId: 7, category: "Bug Report" });

    const [url] = adminUrls(mail.text);
    expect(url.searchParams.get("tab")).toBe("support-tickets");
    expect(url.searchParams.get("view")).toBe("contact");
  });

  it("only ever names a tab the admin page routes on", async () => {
    const { contactEmail, supportTicketStaffAlertEmail } = await loadEmail();
    const urls = [
      ...adminUrls(contactEmail({ submissionId: 7, category: "Other" }).text),
      ...adminUrls(
        supportTicketStaffAlertEmail({ ...ticketAlert, isNew: true }).text,
      ),
    ];

    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(VALID_TABS).toContain(url.searchParams.get("tab"));
    }
  });
});

describe("the one-click unsubscribe URL", () => {
  it("is the permalink every sent message already carries, byte for byte", async () => {
    const { unsubscribeApiUrl } = await loadEmail();

    expect(unsubscribeApiUrl("abc123", "email_scan_complete")).toBe(
      `${APP_URL}/api/v3/account/unsubscribe?token=abc123&type=email_scan_complete`,
    );
  });

  it("is built from FROZEN.UNSUBSCRIBE rather than a path of its own", async () => {
    const { unsubscribeApiUrl } = await loadEmail();

    expect(
      unsubscribeApiUrl("t", "email_scan_complete").startsWith(
        `${APP_URL}${FROZEN.UNSUBSCRIBE}?`,
      ),
    ).toBe(true);
  });

  it("encodes a token that is not URL safe", async () => {
    const { unsubscribeApiUrl } = await loadEmail();

    expect(unsubscribeApiUrl("a+b/c d&e", "email_scan_complete")).toContain(
      "token=a%2Bb%2Fc%20d%26e&type=",
    );
  });

  it("is what the List-Unsubscribe header carries", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail, unsubscribeApiUrl } = await loadEmail();

    await sendEmail({
      to: "user@example.com",
      subject: "Digest",
      text: "digest",
      html: "<p>digest</p>",
      unsubscribeToken: "abc123",
      unsubscribeColumn: "email_posture_digest",
    });

    const headers = (
      sendMailMock.mock.calls[0][0] as { headers: Record<string, string> }
    ).headers;
    expect(headers["List-Unsubscribe"]).toBe(
      `<${unsubscribeApiUrl("abc123", "email_posture_digest")}>`,
    );
  });
});

describe("names printed to an address nobody has verified", () => {
  const SPAM_NAME = "Claim your payout at example.tld/x";
  const VERIFY_LINK = "https://vulnradar.dev/verify-email?token=abc";

  it("greets a real name in the verification email", async () => {
    const { emailVerificationEmail } = await loadEmail();
    const mail = await emailVerificationEmail("Ada Lovelace", VERIFY_LINK);
    expect(mail.text).toContain("Hi Ada Lovelace,");
    expect(mail.html).toContain("Hi Ada Lovelace,");
  });

  it.each([
    ["a link", SPAM_NAME],
    ["an address", "call.me@evil.test"],
    ["a scheme", "see https://evil.test now"],
    ["a long run of digits", "Agent 5551234567"],
    ["a phone number", "Call 1-800-555-0199"],
  ])(
    "leaves a name carrying %s out of the verification email",
    async (_label, name) => {
      const { emailVerificationEmail } = await loadEmail();
      const mail = await emailVerificationEmail(name, VERIFY_LINK);
      expect(mail.text).not.toContain(name);
      expect(mail.html).not.toContain(name);
      expect(mail.text).not.toMatch(/^Hi /);
      // The mail still does its job: the link and the button are there.
      expect(mail.text).toContain(VERIFY_LINK);
      expect(mail.html).toContain("Verify email address");
    },
  );

  it("does not print a team name or an inviter name that carries a link", async () => {
    const { teamInviteEmail } = await loadEmail();
    const mail = teamInviteEmail(
      SPAM_NAME,
      "https://vulnradar.dev/invite/abc",
      "Visit evil.test for prizes",
    );
    for (const part of [mail.subject, mail.preheader, mail.text, mail.html]) {
      expect(part).not.toContain("example.tld");
      expect(part).not.toContain("evil.test");
    }
    expect(mail.subject).toBe("You were invited to a team on VulnRadar");
    expect(mail.text).toContain("Someone invited you to join a team");
    // The link the invitee needs is untouched.
    expect(mail.text).toContain("https://vulnradar.dev/invite/abc");
  });

  it("still names a plain team and a plain inviter", async () => {
    const { teamInviteEmail } = await loadEmail();
    const mail = teamInviteEmail(
      "Payments Platform",
      "https://vulnradar.dev/invite/abc",
      "Priya",
    );
    expect(mail.subject).toBe("Join Payments Platform on VulnRadar");
    expect(mail.text).toContain(
      'Priya invited you to join the team "Payments Platform"',
    );
  });
});

describe("teamInviteEmail link guard", () => {
  it("keeps a real https invite link", async () => {
    const email = await loadEmail();
    const result = email.teamInviteEmail(
      "Acme",
      "https://vulnradar.dev/invite/abc",
      "Alice",
    );
    expect(result.html).toContain('href="https://vulnradar.dev/invite/abc"');
  });

  it("replaces a non-http(s) link (e.g. javascript:) with a safe placeholder in the button href", async () => {
    const email = await loadEmail();
    const result = email.teamInviteEmail(
      "Acme",
      "javascript:alert(1)",
      "Alice",
    );
    expect(result.html).toContain('href="#invalid"');
  });

  // This test used to document a bug rather than forbid it: teamInviteEmail
  // guarded the button's `href` with safeInviteLink (http/https only,
  // "#invalid" otherwise) and then printed the RAW `inviteLink` two lines
  // below in the "copy this link" fallback, neither escaped nor guarded, so
  // an inviteLink carrying markup would have rendered it. It was not
  // exploitable, because the one caller builds the URL itself from APP_URL
  // and a server-generated token, but the function had no defence of its own.
  //
  // emailFallbackLink now escapes what it prints, which is the right place
  // for it: a block that writes user-influenced text into a document should
  // not depend on knowing all of its callers. The assertion is inverted to
  // match.
  it("escapes the 'copy this link' fallback text instead of printing markup verbatim", async () => {
    const email = await loadEmail();
    const result = email.teamInviteEmail(
      "Acme",
      "<script>alert(1)</script>",
      "Alice",
    );
    // The button href is still guarded (falls back to #invalid)...
    expect(result.html).toContain('href="#invalid"');
    // ...and the fallback paragraph now renders the value as text.
    expect(result.html).not.toContain("<script>alert(1)</script>");
    expect(result.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

/**
 * The quality bar, applied to every template at once.
 *
 * The list this replaced was hand-maintained inside this file and had to be
 * remembered whenever a template was added, which is exactly the kind of list
 * that goes stale: it asserted little more than "does not throw". The corpus
 * now lives in ./_template-corpus.ts, shared with email-previews.test.ts, so
 * the previews a human looks at and the assertions CI runs are the same set.
 */
describe("every template meets the same bar", () => {
  async function corpus() {
    const email = await loadEmail();
    return await buildTemplateCorpus(email);
  }

  it("returns a subject, a preheader, a plain-text part and an HTML part", async () => {
    const templates = await corpus();
    expect(templates.length).toBeGreaterThanOrEqual(55);
    for (const t of templates) {
      expect(typeof t.subject, t.name).toBe("string");
      expect(t.subject.trim().length, t.name).toBeGreaterThan(0);
      expect(t.text.trim().length, t.name).toBeGreaterThan(40);
      expect(t.html, t.name).toContain("<h1");
      // The plain-text part is not a fallback nobody sees: some clients and
      // most screen readers prefer it, so it has to read on its own rather
      // than being a stripped copy of the markup.
      expect(t.text, t.name).not.toContain("<");
    }
  });

  it("writes a preheader that says something the subject does not", async () => {
    const templates = await corpus();
    for (const t of templates) {
      expect(typeof t.preheader, t.name).toBe("string");
      const pre = (t.preheader ?? "").trim();
      expect(pre.length, t.name).toBeGreaterThan(10);
      // An inbox shows the subject and then this. Repeating the subject
      // spends the second line saying nothing.
      expect(pre.toLowerCase(), t.name).not.toBe(t.subject.toLowerCase());
    }
  });

  // The preheader is the line a lock screen shows next to the sender, so the
  // two templates whose subject IS a one-time code must not repeat it there.
  // A blanket "no six-digit run" rule would be wrong: a credit receipt says
  // "500000 AI analysis tokens" and that is not a secret.
  // Subject and preheader are what a lock screen, an inbox list and mail
  // search show without the message being opened.
  it("keeps a one-time code out of the subject and the preheader", async () => {
    const email = await loadEmail();
    const code = email.email2FACodeEmail("418246", 10);
    expect(code.subject).not.toContain("418246");
    expect(code.preheader).not.toContain("418246");
    const billing = email.billingVerificationCodeEmail("730914", 10);
    expect(billing.subject).not.toContain("730914");
    expect(billing.preheader).not.toContain("730914");
  });

  it("uses no em dash anywhere in user-facing copy", async () => {
    const templates = await corpus();
    for (const t of templates) {
      for (const [part, value] of [
        ["subject", t.subject],
        ["preheader", t.preheader ?? ""],
        ["text", t.text],
        ["html", t.html],
      ] as const) {
        expect(value.includes("\u2014"), `${t.name}.${part}`).toBe(false);
      }
    }
  });

  it("renders inside the size email_logs will store", async () => {
    configureSmtp();
    const { sendEmail } = await loadEmail();
    const templates = await corpus();
    for (const t of templates) {
      sendMailMock.mockReset();
      sendMailMock.mockResolvedValue({ messageId: "x" });
      await sendEmail({
        to: "user@example.com",
        subject: t.subject,
        text: t.text,
        html: t.html,
        preheader: t.preheader,
        unsubscribeToken: "11111111-2222-3333-4444-555555555555",
      });
      const sent = sendMailMock.mock.calls[0][0] as { html: string };
      // EMAIL_LOG_HTML_MAX_CHARS in lib/email/email.ts. Above it the rendered
      // copy is dropped rather than truncated, so a template that grew past
      // this would silently stop being viewable in Admin > Email Logs.
      expect(sent.html.length, t.name).toBeLessThan(100_000);
    }
  });
});

/**
 * Source-level hygiene. The rendered output legitimately contains the app's
 * name and the palette's hexes; what must not exist is a second copy of
 * either, typed into a template, which is how a self-hoster ends up with our
 * brand in their mail and how the colours drifted from the product before
 * lib/config/brand.ts existed.
 */
describe("templates take the brand from config, never from a literal", () => {
  // Comments are stripped first. Both files explain in prose why the palette
  // moved into config, and quoting the values they are talking about is the
  // point of those comments rather than a breach of the rule.
  const read = (rel: string) =>
    readFileSync(join(process.cwd(), rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");

  it("hardcodes no colour in lib/email/email.ts or lib/email/layout.ts", () => {
    for (const rel of ["lib/email/email.ts", "lib/email/layout.ts"]) {
      // Not preceded by "&", so an HTML character reference such as the
      // preheader filler's &#8199; is not mistaken for a colour.
      const colours = read(rel).match(/(?<!&)#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect(colours, rel).toEqual([]);
    }
  });

  it("hardcodes the app name nowhere in lib/email/", () => {
    for (const rel of ["lib/email/email.ts", "lib/email/layout.ts"]) {
      expect(read(rel), rel).not.toMatch(/["'`]VulnRadar/);
    }
  });

  it("takes its palette from lib/config/brand.ts", () => {
    expect(read("lib/email/layout.ts")).toContain('from "@/lib/config/brand"');
  });

  it("renders dark, and says so loudly enough that clients do not invert it", () => {
    // Email used to render as a white card on a pale canvas, with the dark
    // values behind a prefers-color-scheme override. The product is dark
    // everywhere else a user sees it, so its own mail looked like it came
    // from a different company.
    //
    // A dark email's real failure mode is a client deciding to "fix" it, so
    // the declaration matters as much as the colours: color-scheme in both a
    // meta tag and CSS is what Gmail and Apple Mail read to leave it alone.
    const layout = read("lib/email/layout.ts");
    expect(layout).toContain('name="color-scheme" content="dark"');
    expect(layout).toContain('name="supported-color-schemes" content="dark"');
    expect(layout).toContain("color-scheme:dark");

    // Outlook.com does not answer the media query, it rewrites the document,
    // so it is the one client that can lighten this against its will. Those
    // rules put the palette back and must not be dropped as "redundant"
    // alongside the prefers-color-scheme block, which genuinely was.
    expect(layout).toContain('darkRules("[data-ogsc] ")');
    expect(layout).toContain('darkRules("[data-ogsb] ")');
    expect(layout).not.toContain("@media (prefers-color-scheme:dark)");
  });
});

describe("postureDigestEmail", () => {
  it("mentions the new-finding count and site count in the subject when there are new findings", async () => {
    const email = await loadEmail();
    const result = email.postureDigestEmail({
      siteCount: 2,
      newFindings: [
        { title: "Missing CSP", severity: "critical", url: "https://a.com" },
        { title: "Weak cipher", severity: "high", url: "https://b.com" },
      ],
      newFindingsTotal: 2,
      newCriticalCount: 1,
      newHighCount: 1,
      currentOpenCount: 5,
      previousOpenCount: 3,
      trend: "up",
      windowDays: 7,
    });

    expect(result.subject).toContain("2 new critical/high findings");
    expect(result.subject).toContain("2 sites");
    expect(result.html).toContain("Missing CSP");
    expect(result.html).toContain("https://a.com");
    expect(result.text).toContain("Weak cipher");
  });

  it("uses a calm 'nothing new' subject and body when there are no new findings", async () => {
    const email = await loadEmail();
    const result = email.postureDigestEmail({
      siteCount: 1,
      newFindings: [],
      newFindingsTotal: 0,
      newCriticalCount: 0,
      newHighCount: 0,
      currentOpenCount: 0,
      previousOpenCount: 0,
      trend: "flat",
      windowDays: 7,
    });

    expect(result.subject).toContain("nothing new");
    expect(result.html).toContain("No new critical or high severity findings");
  });

  it("says 'month' instead of 'week' once the window is 28+ days", async () => {
    const email = await loadEmail();
    const result = email.postureDigestEmail({
      siteCount: 1,
      newFindings: [],
      newFindingsTotal: 0,
      newCriticalCount: 0,
      newHighCount: 0,
      currentOpenCount: 0,
      previousOpenCount: 0,
      trend: "flat",
      windowDays: 30,
    });

    expect(result.subject).toContain("nothing new this month");
  });

  it("notes when the itemized list was truncated below the real total", async () => {
    const email = await loadEmail();
    const newFindings = Array.from({ length: 3 }, (_, i) => ({
      title: `Finding ${i}`,
      severity: "high",
      url: "https://a.com",
    }));
    const result = email.postureDigestEmail({
      siteCount: 1,
      newFindings,
      newFindingsTotal: 10,
      newCriticalCount: 0,
      newHighCount: 10,
      currentOpenCount: 10,
      previousOpenCount: 0,
      trend: "up",
      windowDays: 7,
    });

    expect(result.html).toContain("showing 3 of 10");
  });

  it("escapes finding titles and URLs before embedding them in HTML", async () => {
    const email = await loadEmail();
    const result = email.postureDigestEmail({
      siteCount: 1,
      newFindings: [
        {
          title: "<script>alert(1)</script>",
          severity: "critical",
          url: "https://a.com/<b>",
        },
      ],
      newFindingsTotal: 1,
      newCriticalCount: 1,
      newHighCount: 0,
      currentOpenCount: 1,
      previousOpenCount: 0,
      trend: "up",
      windowDays: 7,
    });

    expect(result.html).not.toContain("<script>alert(1)</script>");
    expect(result.html).toContain("&lt;script&gt;");
  });
});

describe("billing + account transactional templates", () => {
  let email: Awaited<ReturnType<typeof loadEmail>>;

  beforeEach(async () => {
    email = await loadEmail();
  });

  describe("paymentReceiptEmail", () => {
    it("names the plan and amount and links the invoice when present", () => {
      const result = email.paymentReceiptEmail({
        planName: "Pro Supporter",
        amountCents: 1000,
        currency: "usd",
        date: "August 18, 2026",
        invoiceUrl: "https://invoice.stripe.com/i/abc123",
      });
      expect(result.subject).toContain("payment receipt");
      expect(result.text).toContain("Pro Supporter");
      expect(result.text).toContain("$10.00");
      expect(result.html).toContain("$10.00");
      expect(result.html).toContain(
        'href="https://invoice.stripe.com/i/abc123"',
      );
    });

    it("falls back to a manage-subscription CTA when there's no invoice URL", () => {
      const result = email.paymentReceiptEmail({
        planName: "Core Supporter",
        amountCents: 500,
        currency: "usd",
        date: "August 18, 2026",
      });
      expect(result.html).toContain("Manage subscription");
      expect(result.html).toContain("/profile?tab=billing");
    });

    it("escapes an attacker-controlled plan name", () => {
      const result = email.paymentReceiptEmail({
        planName: "<script>alert(1)</script>",
        amountCents: 500,
        currency: "usd",
        date: "August 18, 2026",
      });
      expect(result.html).not.toContain("<script>alert(1)</script>");
      expect(result.html).toContain("&lt;script&gt;");
    });
  });

  describe("paymentFailedEmail", () => {
    it("states the amount, the retry date, and links the card-update page", () => {
      const result = email.paymentFailedEmail({
        planName: "Pro Supporter",
        amountCents: 1000,
        currency: "usd",
        nextAttempt: "August 21, 2026",
      });
      expect(result.subject).toContain("couldn't process your payment");
      expect(result.text).toContain("$10.00");
      expect(result.text).toContain("August 21, 2026");
      expect(result.html).toContain("Update payment method");
      expect(result.html).toContain("/profile?tab=billing");
    });

    it("still builds without a next-retry date", () => {
      const result = email.paymentFailedEmail({
        planName: "Pro Supporter",
        amountCents: 1000,
        currency: "usd",
      });
      expect(result.html).toContain("Update payment method");
    });
  });

  describe("subscriptionChangedEmail", () => {
    it("reads as an upgrade and names both plans", () => {
      const result = email.subscriptionChangedEmail({
        kind: "upgraded",
        planName: "Elite Supporter",
        previousPlanName: "Pro Supporter",
      });
      expect(result.subject).toContain("Elite Supporter");
      expect(result.html).toContain("Your plan was upgraded");
      expect(result.html).toContain("Pro Supporter");
      expect(result.html).toContain("Elite Supporter");
    });

    it("reads as a cancellation and offers reactivation", () => {
      const result = email.subscriptionChangedEmail({
        kind: "canceled",
        planName: "Pro Supporter",
      });
      expect(result.subject).toContain("canceled");
      expect(result.html).toContain("Reactivate subscription");
    });

    it("reads as a renewal", () => {
      const result = email.subscriptionChangedEmail({
        kind: "renewed",
        planName: "Core Supporter",
      });
      expect(result.subject).toContain("renewed");
    });

    it("escapes an attacker-controlled plan name", () => {
      const result = email.subscriptionChangedEmail({
        kind: "upgraded",
        planName: "<script>alert(1)</script>",
      });
      expect(result.html).not.toContain("<script>alert(1)</script>");
      expect(result.html).toContain("&lt;script&gt;");
    });
  });

  describe("accountDeletedEmail", () => {
    it("confirms an irreversible purge and greets by name", () => {
      const result = email.accountDeletedEmail("Alice");
      expect(result.subject).toContain("account was deleted");
      expect(result.text).toContain("Hi Alice");
      expect(result.text).toContain("permanently deleted");
      expect(result.html).toContain("permanently deleted");
    });

    it("builds a generic greeting when there's no name", () => {
      const result = email.accountDeletedEmail(null);
      expect(result.text).not.toContain("Hi ,");
      expect(result.html).toContain("<h1");
    });

    it("escapes a malicious display name", () => {
      const result = email.accountDeletedEmail("<script>alert(1)</script>");
      expect(result.html).not.toContain("<script>alert(1)</script>");
      expect(result.html).toContain("&lt;script&gt;");
    });
  });

  describe("sessionRevokedEmail", () => {
    it("names the sign-out and carries IP and device", () => {
      const result = email.sessionRevokedEmail({
        ipAddress: "203.0.113.5",
        userAgent: "Mozilla/5.0",
      });
      expect(result.subject).toContain("signed out");
      expect(result.text).toContain("203.0.113.5");
      expect(result.html).toContain("203.0.113.5");
    });

    it("escapes a malicious user-agent", () => {
      const result = email.sessionRevokedEmail({
        ipAddress: "203.0.113.5",
        userAgent: "<script>alert(1)</script>",
      });
      expect(result.html).not.toContain("<script>alert(1)</script>");
      expect(result.html).toContain("&lt;script&gt;");
    });
  });

  describe("team change templates", () => {
    it("teamMemberRemovedEmail names the team and escapes it", () => {
      const result = email.teamMemberRemovedEmail("<b>Acme</b>");
      expect(result.subject).toContain("removed");
      expect(result.html).not.toContain("<b>Acme</b>");
      expect(result.html).toContain("&lt;b&gt;Acme&lt;/b&gt;");
    });

    it("teamRoleChangedEmail shows the old and new role", () => {
      const result = email.teamRoleChangedEmail("Acme", "viewer", "admin");
      expect(result.subject).toContain("role in Acme changed");
      expect(result.html).toContain("viewer");
      expect(result.html).toContain("admin");
    });

    it("teamRoleChangedEmail escapes role values", () => {
      const result = email.teamRoleChangedEmail(
        "Acme",
        "<i>viewer</i>",
        "admin",
      );
      expect(result.html).not.toContain("<i>viewer</i>");
      expect(result.html).toContain("&lt;i&gt;viewer&lt;/i&gt;");
    });
  });
});

describe("maskedWebhookEndpoint", () => {
  it("keeps a webhook URL recognisable without printing its secret", async () => {
    const { maskedWebhookEndpoint } = await import("@/lib/email/email");
    expect(
      maskedWebhookEndpoint(
        "https://discord.com/api/webhooks/1234567/abcDEFsecret",
      ),
    ).toBe("discord.com/api/webhooks/…");
    expect(
      maskedWebhookEndpoint("https://hooks.slack.com/services/T0/B0/xyzSECRET"),
    ).toBe("hooks.slack.com/services/T0/…");
    expect(maskedWebhookEndpoint("https://example.com/hook?token=s3cret")).toBe(
      "example.com/…",
    );
    expect(maskedWebhookEndpoint("not a url")).toBe("(unreadable URL)");
  });

  it("is what the webhook emails print, in both parts", async () => {
    const { webhookCreatedEmail, webhookDeliveryFailedEmail } =
      await import("@/lib/email/email");
    const url = "https://discord.com/api/webhooks/1234567/abcDEFsecret";
    const details = { ipAddress: "203.0.113.9", userAgent: "Mozilla/5.0" };
    const created = webhookCreatedEmail("Alerts", url, "discord", details);
    const failed = webhookDeliveryFailedEmail(url, {
      firstStatus: 500,
      retryStatus: null,
      manageUrl: "https://vulnradar.dev/profile",
    });
    for (const part of [created.html, created.text, failed.html, failed.text]) {
      expect(part).not.toContain("abcDEFsecret");
    }
  });
});

/**
 * The EHLO name. nodemailer introduces itself with os.hostname() and swaps a
 * hostname with no dot for the literal [127.0.0.1], which is what a Docker
 * container id is, so every message said it came from the loopback address.
 */
describe("the name the transport gives in EHLO", () => {
  it("defaults to the host of the app URL, a real domain this deployment owns", async () => {
    configureSmtp({ SMTP_PORT: "587" });
    await loadEmail();
    expect(transportConfigCalls[0].name).toBe(new URL(APP_URL).hostname);
  });

  it("is SMTP_EHLO_NAME when the operator sets one, on either TLS mode", async () => {
    process.env.SMTP_EHLO_NAME = "mail.example.org";
    configureSmtp({ SMTP_PORT: "587" });
    await loadEmail();
    expect(transportConfigCalls[0].name).toBe("mail.example.org");

    vi.resetModules();
    transportConfigCalls = [];
    configureSmtp({ SMTP_PORT: "465" });
    await loadEmail();
    expect(transportConfigCalls[0].name).toBe("mail.example.org");
  });

  it("ignores a blank SMTP_EHLO_NAME instead of greeting with an empty name", async () => {
    process.env.SMTP_EHLO_NAME = "   ";
    configureSmtp();
    await loadEmail();
    expect(transportConfigCalls[0].name).toBe(new URL(APP_URL).hostname);
  });
});

describe("the logo in the header", () => {
  it("is a PNG by default, because Gmail and Outlook will not draw the SVG favicon", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail } = await loadEmail();
    await sendEmail({ to: "u@x.com", subject: "s", text: "t", html: "<p/>" });
    const html = (sendMailMock.mock.calls[0][0] as { html: string }).html;
    expect(html).toContain(`src="${APP_URL}/email-logo.png"`);
    expect(html).not.toContain("favicon.svg");
  });

  it("ships the file it points at, at 52px", () => {
    const png = readFileSync(join(process.cwd(), "public", "email-logo.png"));
    // PNG signature, then the IHDR chunk: width and height are the first two
    // big-endian 32-bit integers of its data, at byte offsets 16 and 20.
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(52);
    expect(png.readUInt32BE(20)).toBe(52);
  });
});

/**
 * What lets the next "550 5.7.0 Blocked by SpamAssassin" be traced: which
 * template, which From and relay, which command the relay refused and what it
 * said, and the Message-ID a relay's own logs are searched by.
 */
describe("email_logs delivery detail", () => {
  // [recipient, subject, status, error, preview, html, template, from, host,
  //  smtp_code, smtp_command, smtp_response, error_code, message_id]
  const COLUMNS = {
    template: 6,
    from: 7,
    host: 8,
    code: 9,
    command: 10,
    response: 11,
    errorCode: 12,
    messageId: 13,
  };

  it("records the template, the From address and the relay on a sent message", async () => {
    configureSmtp({ SMTP_FROM: "no-reply@vulnradar.dev" });
    sendMailMock.mockResolvedValueOnce({
      messageId: "<abc@vulnradar.dev>",
      response: "250 2.0.0 Ok: queued as 4F2A1",
    });
    const { sendEmail } = await loadEmail();

    await sendEmail({
      to: "u@x.com",
      subject: "s",
      text: "t",
      html: "<p/>",
      template: "passwordReset",
    });

    const row = emailLogInserts[0];
    expect(row[COLUMNS.template]).toBe("passwordReset");
    expect(row[COLUMNS.from]).toBe("no-reply@vulnradar.dev");
    expect(row[COLUMNS.host]).toBe("smtp.example.com");
    expect(row[COLUMNS.messageId]).toBe("<abc@vulnradar.dev>");
    expect(row[COLUMNS.response]).toBe("250 2.0.0 Ok: queued as 4F2A1");
    expect(row[COLUMNS.code]).toBe(250);
    expect(row[COLUMNS.command]).toBeNull();
    expect(row[COLUMNS.errorCode]).toBeNull();
  });

  it("records what the relay refused, and at which command, on a rejection", async () => {
    configureSmtp();
    const rejection = Object.assign(
      new Error("Message failed: 550 5.7.0 Blocked by SpamAssassin"),
      {
        code: "EMESSAGE",
        responseCode: 550,
        command: "DATA",
        response: "550 5.7.0 Blocked by SpamAssassin",
      },
    );
    sendMailMock.mockRejectedValueOnce(rejection);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();

    await expect(
      sendEmail({
        to: "u@x.com",
        subject: "s",
        text: "t",
        html: "<p/>",
        template: "broadcast",
      }),
    ).rejects.toBe(rejection);

    const row = emailLogInserts[0];
    expect(row[2]).toBe("failed");
    expect(row[3]).toBe("Message failed: 550 5.7.0 Blocked by SpamAssassin");
    expect(row[COLUMNS.template]).toBe("broadcast");
    expect(row[COLUMNS.code]).toBe(550);
    expect(row[COLUMNS.command]).toBe("DATA");
    expect(row[COLUMNS.response]).toBe("550 5.7.0 Blocked by SpamAssassin");
    expect(row[COLUMNS.errorCode]).toBe("EMESSAGE");
    expect(row[COLUMNS.messageId]).toBeNull();
  });

  it("keeps a plain Error working: the fields nodemailer would add are just empty", async () => {
    configureSmtp();
    sendMailMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();

    await expect(
      sendEmail({ to: "u@x.com", subject: "s", text: "t", html: "<p/>" }),
    ).rejects.toThrow("connect ECONNREFUSED");

    const row = emailLogInserts[0];
    expect(row[COLUMNS.code]).toBeNull();
    expect(row[COLUMNS.command]).toBeNull();
    expect(row[COLUMNS.response]).toBeNull();
    expect(row[COLUMNS.errorCode]).toBeNull();
  });

  it("writes one server-log line per failed send, with the template and stage but never the recipient", async () => {
    configureSmtp();
    const rejection = Object.assign(
      new Error(
        "Can't send mail - all recipients were rejected: 550 <victim@example.org>: rejected",
      ),
      { code: "EENVELOPE", responseCode: 550, command: "RCPT TO" },
    );
    sendMailMock.mockRejectedValueOnce(rejection);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();

    await expect(
      sendEmail({
        to: "victim@example.org",
        subject: "s",
        text: "t",
        html: "<p/>",
        template: "scanComplete",
      }),
    ).rejects.toBe(rejection);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const printed = errorSpy.mock.calls[0]
      .map((arg) =>
        arg instanceof Error
          ? `${arg.message}\n${arg.stack ?? ""}`
          : JSON.stringify(arg),
      )
      .join(" ");
    expect(printed).toContain("[email] send failed");
    expect(printed).toContain("scanComplete");
    expect(printed).toContain("RCPT TO");
    expect(printed).toContain("EENVELOPE");
    expect(printed).not.toContain("victim@example.org");
    // The error handed to the caller is the real one, untouched.
    expect(rejection.message).toContain("victim@example.org");
  });

  it("says so when the log row itself cannot be written, instead of going silent", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    // The first query is the From-address setting lookup, which must succeed;
    // the second is the email_logs INSERT, which is the one that fails.
    mockDbQuery.mockImplementationOnce(async () => ({ rows: [] }));
    mockDbQuery.mockRejectedValueOnce(new Error("db unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();

    await expect(
      sendEmail({
        to: "u@x.com",
        subject: "s",
        text: "t",
        html: "<p/>",
        template: "newLogin",
      }),
    ).resolves.toBeUndefined();

    const lines = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(
      lines.some((l) => l.includes("could not write the email log row")),
    ).toBe(true);
  });
});

describe("every template names itself", () => {
  it("returns a template identifier the log can store", async () => {
    const email = await loadEmail();
    const templates = await buildTemplateCorpus(email);
    for (const t of templates) {
      expect(typeof t.template, t.name).toBe("string");
      expect(t.template, t.name).toMatch(/^[a-zA-Z0-9]+$/);
      // email_logs.template is VARCHAR(64).
      expect((t.template ?? "").length, t.name).toBeLessThanOrEqual(64);
    }
  });

  it("is carried through sendEmail to the row, so a spread builder result needs no extra argument", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const email = await loadEmail();
    const content = email.passwordResetEmail("https://vulnradar.dev/reset?t=1");
    await email.sendEmail({ to: "u@x.com", ...content });
    expect(emailLogInserts[0][6]).toBe("passwordReset");
  });
});

describe("broadcastPreheader", () => {
  it("skips the heading, which is the subject again, and starts at the first sentence after it", async () => {
    const { broadcastPreheader } = await loadEmail();
    expect(
      broadcastPreheader(
        "Release notes 3.8\n\nWe made scans faster. Details below.\n\n- One\n- Two",
      ),
    ).toBe("We made scans faster.");
  });

  it("keeps the first paragraph of a message that does not open with a heading", async () => {
    const { broadcastPreheader } = await loadEmail();
    const text = "Scans got faster this week.\n\nDetails are on the changelog.";
    // Told the markup, it sees a paragraph first, and that paragraph is the
    // preview. Without the markup it assumes a heading, as it always did.
    expect(
      broadcastPreheader(
        text,
        "<p>Scans got faster this week.</p><p>Details are on the changelog.</p>",
      ),
    ).toBe("Scans got faster this week.");
    expect(broadcastPreheader(text)).toBe("Details are on the changelog.");
  });

  it("still skips a leading heading when the markup says there is one", async () => {
    const { broadcastPreheader } = await loadEmail();
    expect(
      broadcastPreheader(
        "Release notes\n\nWe made scans faster.",
        '\n  <h1 style="margin:0">Release notes</h1>\n<p>We made scans faster.</p>',
      ),
    ).toBe("We made scans faster.");
  });

  it("falls back to the whole text when there is only one paragraph", async () => {
    const { broadcastPreheader } = await loadEmail();
    expect(broadcastPreheader("Just one short announcement.")).toBe(
      "Just one short announcement.",
    );
  });

  it("is escaped exactly once on its way into the document", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail, broadcastPreheader } = await loadEmail();
    const text = "Heading\n\nIt's faster & safer.";
    await sendEmail({
      to: "u@x.com",
      subject: "s",
      text,
      html: "<p/>",
      preheader: broadcastPreheader(text),
    });
    const html = (sendMailMock.mock.calls[0][0] as { html: string }).html;
    expect(html).toContain("It&#39;s faster &amp; safer.");
    expect(html).not.toContain("&amp;#39;");
    expect(html).not.toContain("&amp;amp;");
  });
});

describe("the retired landing-contact templates", () => {
  it("are no longer exported, so nothing can mail an anonymous visitor's text back out", async () => {
    const email = (await loadEmail()) as Record<string, unknown>;
    expect(email.landingContactEmail).toBeUndefined();
    expect(email.landingContactConfirmationEmail).toBeUndefined();
  });
});
