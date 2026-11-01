/**
 * The two staff-access refusal alerts share one writer: a refused staff
 * invite and a refused staff SSO sign-in. These pin what each row carries and
 * how each one is kept from stacking, which is all a faked pool can say;
 * tests/integration/staff-invite-verified.test.ts and
 * tests/integration/staff-sso-verified.test.ts run the statement for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const calls: { sql: string; params: unknown[] }[] = [];
let insertFails = false;
vi.mock("@/lib/database/db", () => ({
  default: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (insertFails) throw new Error("db unavailable");
      return { rows: [] };
    }),
  },
}));

const { recordUnverifiedInviteRefusal, recordUnverifiedStaffSsoRefusal } =
  await import("@/lib/auth/staff-invite-refusal");

beforeEach(() => {
  calls.length = 0;
  insertFails = false;
});

function only() {
  expect(calls).toHaveLength(1);
  return calls[0]!;
}

describe("recordUnverifiedInviteRefusal", () => {
  it("files one high-severity staff_invite_unverified_email row per invite", async () => {
    await recordUnverifiedInviteRefusal({
      userId: 3,
      inviteId: 41,
      role: "support",
    });
    const { sql, params } = only();
    expect(sql).toContain("INSERT INTO security_alerts");
    expect(sql).toContain("'high'");
    expect(sql).toContain("NOT EXISTS");
    expect(params[0]).toBe(3);
    expect(params[1]).toBe("staff_invite_unverified_email");
    expect(JSON.parse(String(params[3]))).toEqual({
      inviteId: "41",
      role: "support",
    });
    // Deduplicated on the invite: one open alert per invite and account.
    expect(params[4]).toBe("inviteId");
  });
});

describe("recordUnverifiedStaffSsoRefusal", () => {
  it("files the account-unverified row with only the issuer, as before", async () => {
    await recordUnverifiedStaffSsoRefusal({
      userId: 5,
      issuerHost: "idp.example.com",
      reason: "account_unverified",
    });
    const { sql, params } = only();
    expect(sql).toContain("NOT EXISTS");
    expect(params[0]).toBe(5);
    expect(params[1]).toBe("staff_sso_unverified_email");
    expect(JSON.parse(String(params[3]))).toEqual({
      issuer: "idp.example.com",
    });
    // One open alert per account, whatever its details say.
    expect(params[4]).toBeNull();
    expect(String(params[2])).toMatch(/has not verified its email address/);
  });

  it("says the provider did not vouch for the address when that is the reason", async () => {
    await recordUnverifiedStaffSsoRefusal({
      userId: 5,
      issuerHost: "idp.example.com",
      reason: "provider_unverified",
    });
    const { params } = only();
    expect(params[1]).toBe("staff_sso_unverified_email");
    expect(JSON.parse(String(params[3]))).toEqual({
      issuer: "idp.example.com",
      reason: "provider_unverified",
    });
    expect(params[4]).toBeNull();
    expect(String(params[2])).toMatch(/identity provider/);
  });
});

describe("the shared writer", () => {
  it("stores no IP address or user agent", async () => {
    await recordUnverifiedInviteRefusal({
      userId: 3,
      inviteId: 41,
      role: "support",
    });
    await recordUnverifiedStaffSsoRefusal({
      userId: 5,
      issuerHost: "idp.example.com",
      reason: "provider_unverified",
    });
    for (const { sql } of calls) {
      expect(sql).not.toMatch(/ip_address|user_agent/);
    }
  });

  it("never throws: the refusal is the control, the alert only reports it", async () => {
    insertFails = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        recordUnverifiedInviteRefusal({ userId: 3, inviteId: 1, role: "x" }),
      ).resolves.toBeUndefined();
      await expect(
        recordUnverifiedStaffSsoRefusal({
          userId: 5,
          issuerHost: "idp.example.com",
          reason: "account_unverified",
        }),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("uses one statement for both alerts", async () => {
    await recordUnverifiedInviteRefusal({
      userId: 3,
      inviteId: 41,
      role: "support",
    });
    await recordUnverifiedStaffSsoRefusal({
      userId: 5,
      issuerHost: "idp.example.com",
      reason: "account_unverified",
    });
    expect(calls[0]!.sql).toBe(calls[1]!.sql);
  });
});
