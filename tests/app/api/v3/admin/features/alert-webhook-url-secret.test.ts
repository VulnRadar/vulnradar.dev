/**
 * ADMIN_ALERT_WEBHOOK_URL is a credential. A Slack or Discord incoming-webhook
 * URL carries its token in the path, so whoever can read the URL can post to
 * the operator's alert channel or delete the hook. It was the one alerting
 * setting not marked `secret`, so the settings route wrote
 *   Changed "ADMIN_ALERT_WEBHOOK_URL" from "<old url>" to "<new url>"
 * into admin_audit_log, which a moderator or security analyst can page
 * through, and kept every old value there for a year.
 *
 * Same harness as route.test.ts: the database is mocked, requireAdmin() runs
 * for real, and logAction is a spy so the audit text can be read back.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { SETTINGS_REGISTRY, isSecretSetting } from "@/lib/config/registry";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...actual,
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const mockGetSettings = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  invalidateSettingsCache: vi.fn(),
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}));

const { POST } = await import("@/app/api/v3/admin/features/route");

const KEY = "ADMIN_ALERT_WEBHOOK_URL";
const OLD_URL = "https://hooks.slack.test/services/T000/B000/oldtoken111";
const NEW_URL = "https://hooks.slack.test/services/T000/B000/newtoken222";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/admin/features", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** requireAdmin's own role lookup, which is the first query the route runs. */
function queueAdmin() {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, role: "admin" }] });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockLogAction.mockReset();
  mockGetSettings.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 1 });
});

describe("ADMIN_ALERT_WEBHOOK_URL is registered as a credential", () => {
  it("is flagged secret in the registry", () => {
    expect(isSecretSetting(KEY)).toBe(true);
    expect((SETTINGS_REGISTRY[KEY] as { secret?: true }).secret).toBe(true);
  });

  it("is still a writable runtime setting, so an operator can set and clear it", () => {
    expect(SETTINGS_REGISTRY[KEY].tier).toBe("runtime");
  });
});

describe("POST /api/v3/admin/features, system_settings, for the webhook URL", () => {
  it("set stores the URL but keeps the old and new values out of the audit log", async () => {
    queueAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [{ value: OLD_URL }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(
      post({
        section: "system_settings",
        action: "set",
        key: KEY,
        value: NEW_URL,
      }),
    );
    expect(res.status).toBe(200);

    // The value is stored: the alert sender reads it back through getSetting.
    const upsertParams = mockQuery.mock.calls[2][1] as unknown[];
    expect(upsertParams[1]).toBe(NEW_URL);

    const message = mockLogAction.mock.calls[0][3] as string;
    expect(message).toContain(KEY);
    expect(message).toContain("set");
    expect(message).not.toContain(OLD_URL);
    expect(message).not.toContain(NEW_URL);
    expect(message).not.toContain("newtoken222");
    expect(message).not.toContain("oldtoken111");
  });

  it("set with an empty value is logged as cleared, not as a blank URL", async () => {
    queueAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [{ value: OLD_URL }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(
      post({ section: "system_settings", action: "set", key: KEY, value: "" }),
    );
    expect(res.status).toBe(200);
    const message = mockLogAction.mock.calls[0][3] as string;
    expect(message).toContain("cleared");
    expect(message).not.toContain(OLD_URL);
  });

  it("reset keeps the old value out of the audit log", async () => {
    queueAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [{ value: OLD_URL }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(
      post({ section: "system_settings", action: "reset", key: KEY }),
    );
    expect(res.status).toBe(200);
    const message = mockLogAction.mock.calls[0][3] as string;
    expect(message).toContain(KEY);
    expect(message).not.toContain(OLD_URL);
    expect(message).not.toContain("oldtoken111");
  });

  it("effective reports that one is stored and never returns it", async () => {
    queueAdmin();
    mockGetSettings.mockResolvedValueOnce({
      [KEY]: NEW_URL,
      ADMIN_ALERT_WEBHOOK_SECRET: "",
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ key: KEY }] });
    const res = await POST(
      post({ section: "system_settings", action: "effective" }),
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(NEW_URL);
    expect(text).not.toContain("newtoken222");
    const json = JSON.parse(text);
    expect(json.secretsSet).toContain(KEY);
    expect(json.effective).not.toHaveProperty(KEY);
    // "Customized" still drives the reset button.
    expect(json.overridden).toContain(KEY);
  });

  it("effective does not claim one is stored when the URL is empty", async () => {
    queueAdmin();
    mockGetSettings.mockResolvedValueOnce({ [KEY]: "" });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(
      post({ section: "system_settings", action: "effective" }),
    );
    const json = await res.json();
    expect(json.secretsSet).not.toContain(KEY);
    expect(json.effective).not.toHaveProperty(KEY);
  });

  it("get and list return isSet, not the URL", async () => {
    queueAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [{ value: NEW_URL }] });
    const got = await POST(
      post({ section: "system_settings", action: "get", key: KEY }),
    );
    const gotText = await got.text();
    expect(gotText).not.toContain("newtoken222");
    expect(JSON.parse(gotText)).toEqual({ value: null, isSet: true });

    queueAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [{ key: KEY, value: NEW_URL, description: null }],
    });
    const listed = await POST(
      post({ section: "system_settings", action: "list" }),
    );
    const listText = await listed.text();
    expect(listText).not.toContain("newtoken222");
    expect(JSON.parse(listText).settings[0]).toMatchObject({
      key: KEY,
      value: null,
      isSet: true,
    });
  });
});
