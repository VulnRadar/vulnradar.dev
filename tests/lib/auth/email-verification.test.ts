import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * sendEmailVerification's link. The pg pool and the outbound send are mocked;
 * the settings resolver and the email template are the real code.
 */

let systemSettingsRows: { key: string; value: string }[] = [];
const mockQuery = vi.fn(async (sql: string) => {
  if (sql.includes("FROM system_settings")) return { rows: systemSettingsRows };
  return { rows: [] };
});
vi.mock("@/lib/database/db", () => ({
  default: { query: (sql: string) => mockQuery(sql) },
}));

const mockSendEmail = vi.fn(async (_params: unknown) => {});
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    sendEmail: (params: unknown) => mockSendEmail(params),
  };
});

const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { sendEmailVerification } = await import("@/lib/auth/email-verification");

const savedAppUrl = process.env.APP_URL;

beforeEach(() => {
  systemSettingsRows = [];
  mockSendEmail.mockClear();
  invalidateSettingsCache();
});

afterEach(() => {
  if (savedAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = savedAppUrl;
});

async function sentText(): Promise<string> {
  await sendEmailVerification(7, "Alex", "Alex@Example.com ");
  await new Promise((resolve) => setImmediate(resolve));
  expect(mockSendEmail).toHaveBeenCalledTimes(1);
  const sent = mockSendEmail.mock.calls[0][0] as { to: string; text: string };
  expect(sent.to).toBe("alex@example.com");
  return sent.text;
}

describe("sendEmailVerification", () => {
  // The build-time APP_URL constant was fixed when this module loaded; a
  // self-hosted container sets its own URL afterwards, at runtime.
  it("links to the URL the running process was given", async () => {
    process.env.APP_URL = "https://scanner.example.org";

    expect(await sentText()).toMatch(
      /https:\/\/scanner\.example\.org\/verify-email\?token=[0-9a-f]{64}/,
    );
  });

  // Any admin can save the row, and the token in this link verifies an
  // address, so it must not go wherever an admin points it.
  it("ignores a URL saved in the admin settings", async () => {
    process.env.APP_URL = "https://scanner.example.org";
    systemSettingsRows = [{ key: "APP_URL", value: "https://evil.example" }];

    const text = await sentText();
    expect(text).toContain("https://scanner.example.org/verify-email?token=");
    expect(text).not.toContain("evil.example");
  });
});
