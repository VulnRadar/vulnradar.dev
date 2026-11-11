/**
 * Route-level tests for POST /api/v3/admin/updater/apply: the re-auth gate.
 *
 * A super admin created through Google, GitHub or Discord has no password,
 * and lib/auth/reauth.ts asks such an account for the code mailed to its
 * address. This route answered that refusal with `{ error }` alone, so the
 * update dialog had no `stepUp` to switch on and could only show a password
 * field the account had nothing to type into.
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
vi.mock("@/lib/database/db", () => ({
  default: {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("SELECT password_hash FROM users")) {
        return { rows: [{ password_hash: passwordHash }] };
      }
      return { rows: [] };
    }),
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

function apply(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/v3/admin/updater/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  passwordHash = null;
  mockCreateJob.mockReset();
  mockLogAction.mockReset();
});

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
    passwordHash = await hashPassword("the-right-password");
    for (const body of [{}, { currentAdminPassword: "not-it" }]) {
      const res = await apply(body);
      expect(res.status).toBe(403);
      expect((await res.json()).stepUp).toBeUndefined();
    }
    expect(mockCreateJob).not.toHaveBeenCalled();
  }, 20000);
});
