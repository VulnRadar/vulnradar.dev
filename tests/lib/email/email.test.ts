import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
    expect(warnSpy).toHaveBeenCalledWith(
      "SMTP not configured. Email not sent:",
    );
    expect(sendMailMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("logs only the character length of the body, never its content", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendEmail } = await loadEmail();
    await sendEmail({
      to: "user@example.com",
      subject: "Hi",
      text: "0123456789",
      html: "<p/>",
    });
    expect(warnSpy).toHaveBeenCalledWith("  Length: 10 chars");
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
    it("sets a one-click unsubscribe header when a token is given", async () => {
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
      const headers = mailArgs.headers as Record<string, string>;
      // Must be the API route, not the /unsubscribe page: RFC 8058 requires
      // the https URI in the header to accept the POST, and a Next page route
      // answers 405.
      expect(headers["List-Unsubscribe"]).toContain(
        "/api/v3/account/unsubscribe?token=abc123&action=unsubscribe_all",
      );
      expect(headers["List-Unsubscribe"]).toContain("mailto:");
      expect(headers["List-Unsubscribe-Post"]).toBe(
        "List-Unsubscribe=One-Click",
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

  it("never throws or breaks sendEmail even if the DB write itself fails", async () => {
    configureSmtp();
    sendMailMock.mockResolvedValueOnce(undefined);
    mockDbQuery.mockRejectedValueOnce(new Error("db unavailable"));
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
    it("carries the verification code in the subject and both bodies", () => {
      const result = email.email2FACodeEmail("482913");
      expect(result.subject).toContain("482913");
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
  it("escapes a malicious name/message instead of injecting raw HTML", async () => {
    const email = await loadEmail();
    const result = email.contactEmail({
      name: "<script>steal()</script>",
      email: "attacker@example.com",
      subject: "hi",
      message: "line1\nline2",
      category: "bug",
    });
    expect(result.html).not.toContain("<script>steal()</script>");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("line1<br />line2");
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

  // KNOWN BUG (not fixed here -- flagged in the test-session report):
  // lib/email/email.ts's teamInviteEmail guards the button's `href` with
  // safeInviteLink (http/https only, "#invalid" otherwise) but the
  // "copy this link" fallback paragraph a few lines below interpolates
  // the RAW `inviteLink` -- neither escaped via escapeHtml() nor passed
  // through the same http(s) guard. Every other user-influenced field in
  // this file goes through escapeHtml(); this one field doesn't, so a
  // caller that ever passes an inviteLink containing markup (e.g.
  // `<script>...`) would have it render unescaped in the email body. The
  // one current caller (app/api/v3/teams/members/route.ts, ~line 179)
  // builds inviteLink itself from APP_URL + a server-generated token, so
  // it isn't exploitable today, but the function has no defense of its
  // own if that ever changes.
  it("documents a real bug: the 'copy this link' fallback text is neither escaped nor guarded", async () => {
    const email = await loadEmail();
    const result = email.teamInviteEmail(
      "Acme",
      "<script>alert(1)</script>",
      "Alice",
    );
    // The button href IS guarded (falls back to #invalid)...
    expect(result.html).toContain('href="#invalid"');
    // ...but the raw, un-escaped value still appears verbatim elsewhere
    // in the HTML body, in the copy-link fallback paragraph.
    expect(result.html).toContain("<script>alert(1)</script>");
  });
});

describe("remaining templates build without throwing and return a well-formed envelope", () => {
  it("builds every remaining template with representative input", async () => {
    const email = await loadEmail();
    const details = { ipAddress: "203.0.113.1", userAgent: "test-agent" };
    const builders: Array<
      () => { subject: string; text: string; html: string }
    > = [
      () => email.contactConfirmationEmail({ name: "Alice", category: "bug" }),
      () => email.emailVerificationEmail("Alice", "https://x/verify?token=1"),
      () => email.landingContactEmail({ email: "a@x.com", message: "hi" }),
      () => email.landingContactConfirmationEmail("hi"),
      () => email.profileNameChangedEmail("Old", "New", details),
      () => email.profileEmailChangedEmail("old@x.com", "new@x.com", details),
      () => email.profilePasswordChangedEmail(details),
      () => email.twoFactorEnabledEmail(details),
      () => email.twoFactorDisabledEmail(details),
      () => email.backupCodesRegeneratedEmail(details),
      () => email.apiKeyCreatedEmail("My Key", "vr_abc", details),
      () => email.apiKeyDeletedEmail("My Key", details),
      () =>
        email.webhookCreatedEmail(
          "My Webhook",
          "https://x/hook",
          "discord",
          details,
        ),
      () => email.webhookDeletedEmail("My Webhook", details),
      () => email.scheduleCreatedEmail("https://x.com", "daily", details),
      () => email.scheduleDeletedEmail("https://x.com", details),
      () => email.dataRequestCreatedEmail("export", details),
      () => email.failedLoginAttemptsEmail(5, "203.0.113.1", details),
      () => email.rateLimitedEmail("203.0.113.1", details),
      () => email.apiKeyRotationEmail("My Key", "2026-01-01", details),
      () => email.billingVerificationCodeEmail("112233"),
      () => email.email2FAEnabledEmail(details),
      () => email.email2FADisabledEmail(details),
      () =>
        email.adminNotificationEmail({
          userName: "Alice",
          adminName: "Admin",
          title: "Notice",
          message: "hello",
          timestamp: new Date("2026-01-01T00:00:00Z"),
        }),
      () =>
        email.scanCompleteEmail(
          "https://x.com",
          { critical: 1, high: 2, medium: 0, low: 0, info: 0, total: 3 },
          1500,
          42,
        ),
      () =>
        email.criticalFindingsEmail(
          "https://x.com",
          [{ title: "New critical issue", severity: "critical" }],
          [{ title: "Older high issue", severity: "high" }],
          42,
        ),
      () =>
        email.scheduledScanCompleteEmail(
          "Nightly",
          "https://x.com",
          { critical: 0, high: 0, medium: 1, low: 0, info: 0, total: 1 },
          800,
          7,
        ),
      () =>
        email.adminAccountChangeEmail({
          userName: "Alice",
          adminName: "Admin",
          changes: [{ field: "plan", oldValue: "free", newValue: "pro" }],
          timestamp: new Date("2026-01-01T00:00:00Z"),
        }),
      () =>
        email.postureDigestEmail({
          siteCount: 3,
          newFindings: [
            {
              title: "Missing CSP",
              severity: "critical",
              url: "https://a.com",
            },
          ],
          newFindingsTotal: 1,
          newCriticalCount: 1,
          newHighCount: 0,
          currentOpenCount: 4,
          previousOpenCount: 3,
          trend: "up",
          windowDays: 7,
        }),
      () =>
        email.paymentReceiptEmail({
          planName: "Pro Supporter",
          amountCents: 1000,
          currency: "usd",
          date: "August 18, 2026",
          invoiceUrl: "https://invoice.stripe.com/i/abc123",
        }),
      () =>
        email.paymentFailedEmail({
          planName: "Pro Supporter",
          amountCents: 1000,
          currency: "usd",
          nextAttempt: "August 21, 2026",
        }),
      () =>
        email.subscriptionChangedEmail({
          kind: "upgraded",
          planName: "Elite Supporter",
          previousPlanName: "Pro Supporter",
        }),
      () =>
        email.subscriptionChangedEmail({
          kind: "downgraded",
          planName: "Core Supporter",
          previousPlanName: "Pro Supporter",
        }),
      () =>
        email.subscriptionChangedEmail({
          kind: "canceled",
          planName: "Pro Supporter",
        }),
      () =>
        email.subscriptionChangedEmail({
          kind: "renewed",
          planName: "Core Supporter",
        }),
      () => email.accountDeletedEmail("Alice"),
      () => email.accountDeletedEmail(null),
      () => email.sessionRevokedEmail(details),
      () => email.teamMemberRemovedEmail("Acme"),
      () => email.teamRoleChangedEmail("Acme", "viewer", "admin"),
    ];

    for (const build of builders) {
      const result = build();
      expect(typeof result.subject).toBe("string");
      expect(result.subject.length).toBeGreaterThan(0);
      expect(result.html).toContain("<h1");
      expect(result.text.length).toBeGreaterThan(0);
    }
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
