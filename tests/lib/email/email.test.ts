import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTemplateCorpus } from "./_template-corpus";

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
    return buildTemplateCorpus(email);
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
  it("keeps a one-time code out of the preheader", async () => {
    const email = await loadEmail();
    const code = email.email2FACodeEmail("418246", 10);
    expect(code.subject).toContain("418246");
    expect(code.preheader).not.toContain("418246");
    const billing = email.billingVerificationCodeEmail("730914", 10);
    expect(billing.subject).toContain("730914");
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

  it("takes the light and dark palettes from lib/config/brand.ts", () => {
    const layout = read("lib/email/layout.ts");
    expect(layout).toContain('from "@/lib/config/brand"');
    expect(layout).toContain("BRAND.onLight");
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
