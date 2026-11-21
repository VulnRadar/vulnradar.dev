/**
 * Route-level tests for POST /api/v3/admin/updater/apply: the re-auth gate
 * and the second factor behind it.
 *
 * A super admin created through Google, GitHub or Discord has no password,
 * and lib/auth/reauth.ts asks such an account for the code mailed to its
 * address. This route answered that refusal with `{ error }` alone, so the
 * update dialog had no `stepUp` to switch on and could only show a password
 * field the account had nothing to type into.
 *
 * The password was also all it took: ENFORCE_STAFF_2FA ships off, so one
 * stolen super admin password installed a release on the host.
 * lib/auth/staff-step-up.ts now asks for a second factor whatever that
 * setting says, and no job is created without one.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.API_KEY_ENCRYPTION_KEY = "d".repeat(64);

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  })),
  headers: vi.fn(async () => ({ get: () => null })),
}));

let passwordHash: string | null = null;
let totpEnabled = false;
let totpSecret: string | null = null;
let lastCounter: string | null = null;
vi.mock("@/lib/database/db", () => ({
  default: {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("SELECT password_hash FROM users")) {
        return { rows: [{ password_hash: passwordHash }] };
      }
      if (sql.includes("totp_enabled") && sql.includes("FROM users")) {
        return {
          rows: [
            {
              password_hash: passwordHash,
              totp_enabled: totpEnabled,
              totp_secret: totpSecret,
              two_factor_method: totpEnabled ? "app" : null,
            },
          ],
        };
      }
      return { rows: [] };
    }),
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("SELECT totp_last_counter")) {
          return { rows: [{ totp_last_counter: lastCounter }] };
        }
        if (sql.includes("UPDATE users SET totp_last_counter")) {
          lastCounter = String(params[0]);
        }
        return { rows: [] };
      }),
      release: () => {},
    })),
  },
}));

vi.mock("@/lib/email/email", () => ({ isEmailConfigured: () => true }));

const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: async () => ({ userId: 1, role: "super_admin" }),
  isSuperAdminRole: (role: string) => role === "super_admin",
  logAction: (...args: unknown[]) => mockLogAction(...args),
}));

vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: async () => ({
    allowed: true,
    remaining: 9,
    retryAfterSeconds: 0,
  }),
  RATE_LIMITS: { adminReauth: { maxAttempts: 10, windowSeconds: 900 } },
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: async () => "203.0.113.9",
}));

vi.mock("@/lib/updater/environment", () => ({
  isUpdaterSupported: () => ({ supported: true }),
}));

const mockCreateJob = vi.fn();
vi.mock("@/lib/updater/job-store", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
  getActiveJobId: () => null,
  getJob: () => null,
}));

vi.mock("@/lib/updater/apply", () => ({
  runUpdateJob: vi.fn(async () => {}),
}));

const { POST } = await import("@/app/api/v3/admin/updater/apply/route");
const { hashPassword } = await import("@/lib/auth/password-hash");
const { encryptApiKey } = await import("@/lib/auth/crypto");
const { generateSecret, generateTOTP } = await import("@/lib/auth/totp");

const PASSWORD = "the-right-password";
const SECRET = generateSecret();
let rightHash: string | undefined;

function apply(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/v3/admin/updater/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  rightHash ??= await hashPassword(PASSWORD);
  passwordHash = null;
  totpEnabled = false;
  totpSecret = null;
  lastCounter = null;
  mockCreateJob.mockReset();
  mockCreateJob.mockReturnValue({ id: "job-1" });
  mockLogAction.mockReset();
}, 20000);

describe("POST /api/v3/admin/updater/apply re-auth", () => {
  it("asks a super admin with no password for the mailed code, with stepUp", async () => {
    const res = await apply({});
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.stepUp).toBe(true);
    expect(json.error).toMatch(/code from your email/);
    expect(mockCreateJob).not.toHaveBeenCalled();
  });

  it("keeps 403 without stepUp for a missing or wrong password", async () => {
    passwordHash = rightHash ?? null;
    for (const body of [{}, { currentAdminPassword: "not-it" }]) {
      const res = await apply(body);
      expect(res.status).toBe(403);
      expect((await res.json()).stepUp).toBeUndefined();
    }
    expect(mockCreateJob).not.toHaveBeenCalled();
  }, 20000);
});

describe("POST /api/v3/admin/updater/apply second factor", () => {
  it("refuses a super admin without two-factor, right password and all, and creates no job", async () => {
    passwordHash = rightHash ?? null;
    const res = await apply({ currentAdminPassword: PASSWORD });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("SECOND_FACTOR_REQUIRED");
    expect(json.secondFactor).toBe("none");
    expect(mockCreateJob).not.toHaveBeenCalled();
  }, 20000);

  it("checks the password before the second factor", async () => {
    passwordHash = rightHash ?? null;
    const res = await apply({ currentAdminPassword: "not-it" });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Password is incorrect.");
    expect(json.secondFactor).toBeUndefined();
    expect(mockCreateJob).not.toHaveBeenCalled();
  }, 20000);

  it("refuses a wrong or replayed authenticator code and creates no job", async () => {
    passwordHash = rightHash ?? null;
    totpEnabled = true;
    totpSecret = encryptApiKey(SECRET);
    const code = generateTOTP(SECRET);
    const wrong = code === "000000" ? "111111" : "000000";

    const bad = await apply({
      currentAdminPassword: PASSWORD,
      totpCode: wrong,
    });
    expect(bad.status).toBe(403);
    expect((await bad.json()).secondFactor).toBe("totp");
    expect(mockCreateJob).not.toHaveBeenCalled();

    // The step this code belongs to was already spent at sign-in.
    lastCounter = String(Math.floor(Date.now() / 1000 / 30));
    const replayed = await apply({
      currentAdminPassword: PASSWORD,
      totpCode: code,
    });
    expect(replayed.status).toBe(403);
    expect((await replayed.json()).secondFactor).toBe("totp");
    expect(mockCreateJob).not.toHaveBeenCalled();
  }, 20000);

  it("creates the job once on a valid code", async () => {
    passwordHash = rightHash ?? null;
    totpEnabled = true;
    totpSecret = encryptApiKey(SECRET);
    const res = await apply({
      currentAdminPassword: PASSWORD,
      totpCode: generateTOTP(SECRET),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-1" });
    expect(mockCreateJob).toHaveBeenCalledTimes(1);
  }, 20000);
});
