import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LOCALES } from "@/lib/i18n/config";
import { SECURITY_ACK_HOURS } from "@/lib/security/response-times";

/**
 * What sendEmail does when a relay says "not now", which language the shell
 * speaks, and the lifetimes and nouns the templates state. Only the transport
 * and the pool are faked: the real translator and the real shell run.
 */

const sendMailMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

let logRows: unknown[][] = [];
vi.mock("@/lib/database/db", () => ({
  default: {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.trim().startsWith("INSERT INTO email_logs")) logRows.push(params);
      return { rows: [] };
    },
  },
}));

const STATUS = 2;
const MESSAGE = { to: "u@x.com", subject: "s", text: "t", html: "<p/>" };
const LINK = "https://scanner.example.org/verify?token=abc";

function smtpError(props: Record<string, unknown>): Error {
  return Object.assign(new Error("the relay refused"), props);
}

async function loadEmail() {
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "user@example.com";
  process.env.SMTP_PASS = "app-password";
  return import("@/lib/email/email");
}

function sentMail(): { html: string; text: string; replyTo?: string } {
  return sendMailMock.mock.calls[0][0];
}

beforeEach(() => {
  vi.resetModules();
  sendMailMock.mockReset();
  logRows = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendEmail retries what a relay can still accept", () => {
  let waits: number[];

  beforeEach(() => {
    waits = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      // Only the retry waits. Module loading has timers of its own.
      if (ms !== 500 && ms !== 2000) return realSetTimeout(fn, ms);
      waits.push(ms);
      return realSetTimeout(fn, 0);
    }) as typeof setTimeout);
  });

  it("delivers after a 451, with one 'sent' row and no throw", async () => {
    sendMailMock
      .mockRejectedValueOnce(
        smtpError({ code: "EMESSAGE", responseCode: 451, command: "DATA" }),
      )
      .mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail } = await loadEmail();

    await expect(sendEmail(MESSAGE)).resolves.toBeUndefined();

    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(logRows).toHaveLength(1);
    expect(logRows[0][STATUS]).toBe("sent");
  });

  it("backs off between attempts and stops after the third", async () => {
    sendMailMock.mockRejectedValue(smtpError({ responseCode: 421 }));
    const { sendEmail } = await loadEmail();

    await expect(sendEmail(MESSAGE)).rejects.toThrow("the relay refused");

    expect(sendMailMock).toHaveBeenCalledTimes(3);
    expect(waits).toEqual(expect.arrayContaining([500, 2000]));
    expect(logRows).toHaveLength(1);
    expect(logRows[0][STATUS]).toBe("failed");
  });

  it.each(["ECONNECTION", "ETIMEDOUT", "ESOCKET"])(
    "retries %s, a connection that broke or never formed",
    async (code) => {
      sendMailMock
        .mockRejectedValueOnce(smtpError({ code }))
        .mockResolvedValueOnce({ messageId: "1" });
      const { sendEmail } = await loadEmail();

      await sendEmail(MESSAGE);

      expect(sendMailMock).toHaveBeenCalledTimes(2);
      expect(logRows.map((row) => row[STATUS])).toEqual(["sent"]);
    },
  );

  it("does not repeat a 550", async () => {
    sendMailMock.mockRejectedValue(
      smtpError({ code: "EENVELOPE", responseCode: 550 }),
    );
    const { sendEmail } = await loadEmail();

    await expect(sendEmail(MESSAGE)).rejects.toThrow();

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(logRows.map((row) => row[STATUS])).toEqual(["failed"]);
  });

  it("lets the relay's 5xx decide, even under a connection code", async () => {
    sendMailMock.mockRejectedValue(
      smtpError({ code: "ECONNECTION", responseCode: 554 }),
    );
    const { sendEmail } = await loadEmail();

    await expect(sendEmail(MESSAGE)).rejects.toThrow();

    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failure it knows nothing about", async () => {
    sendMailMock.mockRejectedValue(new Error("bad address list"));
    const { sendEmail } = await loadEmail();

    await expect(sendEmail(MESSAGE)).rejects.toThrow("bad address list");

    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("starts no new attempt once a hung relay has used the budget", async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    sendMailMock.mockImplementation(async () => {
      now += 31_000;
      throw smtpError({ code: "ETIMEDOUT" });
    });
    const { sendEmail } = await loadEmail();

    await expect(sendEmail(MESSAGE)).rejects.toThrow();

    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});

describe("the shell speaks the message's language", () => {
  it("renders a German verification mail with no English service sentence", async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail, emailVerificationEmail } = await loadEmail();
    const mail = await emailVerificationEmail("Sam", LINK, "de");

    await sendEmail({ to: "u@x.com", ...mail });

    const { html } = sentMail();
    expect(html).toContain('<html lang="de"');
    expect(html).toContain("Servicemitteilung");
    expect(html).toContain("Oder füge diesen Link");
    expect(html).not.toContain("service notice");
    expect(html).not.toContain("Or paste this link");
    expect(html).not.toContain("getting this because");
  });

  it("translates the preferences link in both parts", async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail, emailVerificationEmail } = await loadEmail();
    const mail = await emailVerificationEmail("Sam", LINK, "de");

    await sendEmail({ to: "u@x.com", ...mail, unsubscribeToken: "tok" });

    const { html, text } = sentMail();
    expect(html).toContain("E-Mail-Einstellungen verwalten");
    expect(html).toContain("weil du ein");
    expect(html).not.toContain("Manage email preferences");
    expect(text).toContain("--\nE-Mail-Einstellungen verwalten: http");
    expect(text).not.toContain("Manage email preferences");
  });

  it.each(LOCALES)("%s resolves every footer key", async (locale) => {
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail, emailVerificationEmail } = await loadEmail();
    const mail = await emailVerificationEmail("Sam", LINK, locale);

    await sendEmail({ to: "u@x.com", ...mail, unsubscribeToken: "tok" });

    const { html, text } = sentMail();
    expect(html).toContain(`<html lang="${locale}"`);
    expect(`${html}${text}`).not.toMatch(/email\.(layout|verify)\./);
  });

  it("stays English for a message that names no language", async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail } = await loadEmail();

    await sendEmail(MESSAGE);

    const { html } = sentMail();
    expect(html).toContain('<html lang="en"');
    expect(html).toContain("This is a service notice about your");
  });

  it("omits the greeting for an empty name, in the reader's language", async () => {
    const { emailVerificationEmail } = await loadEmail();

    const mail = await emailVerificationEmail("", LINK, "de");

    expect(mail.html).not.toContain("Hallo");
    expect(mail.text).not.toContain("Hallo");
    expect(mail.text.startsWith("Bestätige diese E-Mail-Adresse")).toBe(true);
  });

  it("separates the footer links with space and no middle dot", async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { sendEmail } = await loadEmail();

    await sendEmail({ ...MESSAGE, unsubscribeToken: "tok" });

    const { html } = sentMail();
    expect(html).not.toContain("&middot;");
    expect(html).not.toContain(String.fromCharCode(0xb7));
    expect(html).toMatch(/<\/a> &nbsp;&nbsp; <a /);
  });
});

describe("emailLayout without a translator (the admin preview)", () => {
  const input = {
    content: "<p>body</p>",
    appUrl: "https://scanner.example.org",
    logoSrc: "https://scanner.example.org/logo.png",
    supportEmail: "help@scanner.example.org",
  };

  it("uses the English message file", async () => {
    const { emailLayout } = await import("@/lib/email/layout");
    const en = (await import("@/lib/i18n/messages/en/email.json")).default;

    const html = emailLayout({
      ...input,
      appName: "Acme",
      unsubscribeUrl: "https://scanner.example.org/unsubscribe?token=x",
    });

    expect(html).toContain('<html lang="en"');
    expect(html).toContain(en.layout.managePreferences);
    expect(html).toContain("you have a Acme account.");
  });

  it("writes an app name literally and escaped", async () => {
    const { emailLayout } = await import("@/lib/email/layout");

    const html = emailLayout({ ...input, appName: "A$&<b>" });

    expect(html).toContain("your A$&amp;&lt;b&gt; account");
  });
});

describe("templates state the lifetime they were given", () => {
  it("passwordResetEmail defaults to the shipped window, in the singular", async () => {
    const { passwordResetEmail } = await loadEmail();

    const mail = passwordResetEmail(LINK);

    expect(mail.text).toContain("works for 1 hour,");
    expect(mail.preheader).toContain("works for 1 hour.");
  });

  it("passwordResetEmail uses the hours it is passed everywhere", async () => {
    const { passwordResetEmail } = await loadEmail();

    const mail = passwordResetEmail(LINK, 6);

    expect(mail.text).toContain("works for 6 hours,");
    expect(mail.html).toContain("works for 6 hours,");
    expect(mail.preheader).toContain("works for 6 hours.");
    expect(`${mail.text}${mail.html}`).not.toContain("1 hour");
  });

  it("emailVerificationEmail defaults to the shipped window", async () => {
    const { emailVerificationEmail } = await loadEmail();

    const mail = await emailVerificationEmail("Sam", LINK);

    expect(mail.text).toContain("next 24 hours");
    expect(mail.preheader).toContain("next 24 hours");
  });

  it("emailVerificationEmail uses the hours it is passed", async () => {
    const { emailVerificationEmail } = await loadEmail();

    const mail = await emailVerificationEmail("Sam", LINK, "en", 48);

    expect(mail.text).toContain("next 48 hours");
    expect(mail.html).toContain("next 48 hours");
    expect(mail.preheader).toContain("next 48 hours");
    expect(`${mail.text}${mail.html}`).not.toContain("24 hours");
  });

  it("emailVerificationEmail pluralises in the reader's language", async () => {
    const { emailVerificationEmail } = await loadEmail();

    expect(
      (await emailVerificationEmail("Sam", LINK, "de", 48)).text,
    ).toContain("die nächsten 48 Stunden");
    expect((await emailVerificationEmail("Sam", LINK, "de", 1)).text).toContain(
      "die nächste Stunde",
    );
    expect((await emailVerificationEmail("Sam", LINK, "en", 1)).text).toContain(
      "for the next hour.",
    );
  });

  it("email2FACodeEmail uses the minutes it is passed", async () => {
    const { email2FACodeEmail } = await loadEmail();

    const mail = email2FACodeEmail("123456", 3);

    expect(mail.text).toContain("expires in 3 minutes");
    expect(mail.html).toContain("expires in 3 minutes");
    expect(mail.preheader).toContain("expires in 3 minutes");
  });

  it("billingVerificationCodeEmail uses the minutes it is passed", async () => {
    const { billingVerificationCodeEmail } = await loadEmail();

    const mail = billingVerificationCodeEmail("123456", 7);

    expect(mail.text).toContain("expires in 7 minutes");
    expect(mail.html).toContain("expires in 7 minutes");
    expect(mail.preheader).toContain("expires in 7 minutes");
  });

  it("teamInviteEmail uses the days it is passed", async () => {
    const { teamInviteEmail } = await loadEmail();

    const mail = teamInviteEmail("Blue Team", LINK, "Sam", 30);

    expect(mail.text).toContain("expires in 30 days");
    expect(mail.html).toContain("expires in 30 days");
    expect(mail.preheader).toContain("expires in 30 days");
  });
});

describe("scan mail calls a finding a finding", () => {
  const summary = (total: number) => ({
    critical: 0,
    high: total,
    medium: 0,
    low: 0,
    info: 0,
    total,
  });
  const allOf = (mail: Record<string, unknown>) =>
    [mail.subject, mail.preheader, mail.text, mail.html].join("\n");

  it("scanCompleteEmail", async () => {
    const { scanCompleteEmail } = await loadEmail();

    const one = scanCompleteEmail("https://example.com", summary(1), 1200);
    const three = scanCompleteEmail("https://example.com", summary(3), 1200);

    expect(one.subject).toBe("example.com: scan complete, 1 finding");
    expect(three.subject).toBe("example.com: scan complete, 3 findings");
    expect(three.html).toContain("3 findings");
    expect(allOf(one)).not.toMatch(/\bissues?\b/i);
    expect(allOf(three)).not.toMatch(/\bissues?\b/i);
  });

  it("scheduledScanCompleteEmail", async () => {
    const { scheduledScanCompleteEmail } = await loadEmail();

    const mail = scheduledScanCompleteEmail(
      "Nightly",
      "https://example.com",
      summary(2),
      1200,
    );

    expect(mail.preheader).toContain("2 findings on https://example.com");
    expect(mail.html).toContain("2 findings");
    expect(allOf(mail)).not.toMatch(/\bissues?\b/i);
  });
});

describe("scheduleDisabledEmail's preheader", () => {
  const FIXED = "No further runs until the target passes the check again.";

  it("keeps one full stop after a reason that already ends in one", async () => {
    const { scheduleDisabledEmail } = await loadEmail();

    const mail = scheduleDisabledEmail(
      "https://example.com",
      "domain resolves to internal IP address.",
    );

    expect(mail.preheader).toBe(
      `Domain resolves to internal IP address. ${FIXED}`,
    );
  });

  it("adds the full stop a reason is missing", async () => {
    const { scheduleDisabledEmail } = await loadEmail();

    const mail = scheduleDisabledEmail("https://example.com", "blocked target");

    expect(mail.preheader).toBe(`Blocked target. ${FIXED}`);
  });
});

describe("the contact form confirmation", () => {
  it("gives a security report its own commitment, from the one constant", async () => {
    const { contactConfirmationEmail } = await loadEmail();

    const mail = contactConfirmationEmail({ category: "Security Issue" });

    const line = `We acknowledge security reports within ${SECURITY_ACK_HOURS} hours.`;
    expect(mail.text).toContain(line);
    expect(mail.html).toContain(line);
    expect(mail.preheader).toBe(line);
    expect(`${mail.text}${mail.html}`).not.toContain("24 to 48");
  });

  it("keeps the ordinary reply window for everything else", async () => {
    const { contactConfirmationEmail } = await loadEmail();

    const mail = contactConfirmationEmail({ category: "Bug Report" });

    expect(mail.text).toContain("We usually reply within 24 to 48 hours.");
    expect(mail.text).not.toContain("security reports");
  });

  it("sends a reply to support and promises no thread", async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    const { contactConfirmationEmail, sendEmail } = await loadEmail();
    const { SUPPORT_EMAIL } = await import("@/lib/config/constants");

    const mail = contactConfirmationEmail({ category: "Bug Report" });
    await sendEmail({ to: "u@x.com", ...mail });

    expect(sentMail().replyTo).toBe(SUPPORT_EMAIL);
    expect(`${mail.text}${mail.html}`).not.toContain("same thread");
    expect(mail.text).toContain("reaches our support inbox");
  });
});
