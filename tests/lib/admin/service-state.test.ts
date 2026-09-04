/**
 * The operational kill switches (lib/admin/service-state.ts).
 *
 * Four things this file is really pinning down, in rough order of how badly
 * they hurt if they regress:
 *
 *  1. Staff are exempt from the login pause. Break this and turning the
 *     switch on locks the operator out of their own instance, with no way
 *     back short of a psql prompt.
 *  2. /login stays reachable during maintenance for everyone, staff or not,
 *     because a signed-out staff member is indistinguishable from anyone
 *     else until they have signed in. Same lockout, one step earlier.
 *  3. MAINTENANCE_MODE implies the other three, so an operator who declares
 *     maintenance does not also have to remember to stop the scanner.
 *  4. The operator's own message reaches the person being refused.
 *
 * runtime-config is mocked at the module boundary rather than through
 * pool.query, so these assertions are about the gate's logic and not about
 * the resolver's caching, which has its own suite.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type SettingOverrides = Record<string, string | number | boolean>;
const overrides: SettingOverrides = {};

vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  const resolve = (key: string) =>
    key in overrides
      ? overrides[key]
      : (SETTINGS_REGISTRY as Record<string, { default: unknown }>)[key]
          ?.default;
  return {
    getSetting: vi.fn(async (key: string) => resolve(key)),
    getSettings: vi.fn(async (keys: readonly string[]) =>
      Object.fromEntries(keys.map((k) => [k, resolve(k)])),
    ),
  };
});

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const {
  getServiceState,
  scanningPausedResponse,
  scanningPausedReason,
  signupsPausedResponse,
  signupsPausedReason,
  loginsPausedReasonFor,
  loginsPausedResponseFor,
  maintenanceGate,
} = await import("@/lib/admin/service-state");

beforeEach(() => {
  for (const key of Object.keys(overrides)) delete overrides[key];
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue(null);
});

describe("defaults", () => {
  it("is fully open on a fresh install", async () => {
    const state = await getServiceState();
    expect(state).toMatchObject({
      maintenance: false,
      signupsPaused: false,
      loginsPaused: false,
      scanningPaused: false,
    });
    expect(await scanningPausedResponse()).toBeNull();
    expect(await scanningPausedReason()).toBeNull();
    expect(await signupsPausedResponse()).toBeNull();
    expect(await signupsPausedReason()).toBeNull();
    expect(await loginsPausedResponseFor("user")).toBeNull();
    expect(await maintenanceGate("/dashboard")).toEqual({ active: false });
  });
});

describe("PAUSE_SCANNING", () => {
  it("refuses with 503 and Retry-After, not 403", async () => {
    overrides.PAUSE_SCANNING = true;
    const res = await scanningPausedResponse();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    expect(res!.headers.get("Retry-After")).toBe("300");
    await expect(res!.json()).resolves.toMatchObject({ paused: true });
  });

  it("returns the operator's own message when one is set", async () => {
    overrides.PAUSE_SCANNING = true;
    overrides.PAUSE_SCANNING_MESSAGE = "Back at 09:00 UTC.";
    const res = await scanningPausedResponse();
    await expect(res!.json()).resolves.toMatchObject({
      error: "Back at 09:00 UTC.",
    });
    expect(await scanningPausedReason()).toBe("Back at 09:00 UTC.");
  });

  it("falls back to built-in wording when the message is blank", async () => {
    overrides.PAUSE_SCANNING = true;
    overrides.PAUSE_SCANNING_MESSAGE = "   ";
    expect(await scanningPausedReason()).toMatch(/Scanning is paused/i);
  });

  it("leaves signups and logins alone", async () => {
    overrides.PAUSE_SCANNING = true;
    expect(await signupsPausedResponse()).toBeNull();
    expect(await loginsPausedResponseFor("user")).toBeNull();
  });
});

describe("PAUSE_SIGNUPS", () => {
  it("refuses new accounts but not existing logins", async () => {
    overrides.PAUSE_SIGNUPS = true;
    const res = await signupsPausedResponse();
    expect(res!.status).toBe(503);
    expect(await loginsPausedResponseFor("user")).toBeNull();
    expect(await scanningPausedResponse()).toBeNull();
  });

  it("hands the reason to redirect-based callers as a bare string", async () => {
    overrides.PAUSE_SIGNUPS = true;
    overrides.PAUSE_SIGNUPS_MESSAGE = "Invite only for now.";
    expect(await signupsPausedReason()).toBe("Invite only for now.");
  });
});

describe("PAUSE_LOGINS", () => {
  it("refuses a normal user", async () => {
    overrides.PAUSE_LOGINS = true;
    const res = await loginsPausedResponseFor("user");
    expect(res!.status).toBe(503);
  });

  it("refuses an account with no role at all", async () => {
    overrides.PAUSE_LOGINS = true;
    expect(await loginsPausedReasonFor(null)).not.toBeNull();
    expect(await loginsPausedReasonFor(undefined)).not.toBeNull();
    expect(await loginsPausedReasonFor("")).not.toBeNull();
  });

  // The one that matters: a login pause that catches staff is unrecoverable.
  it.each(["support", "moderator", "admin", "super_admin"])(
    "never blocks a %s account",
    async (role) => {
      overrides.PAUSE_LOGINS = true;
      expect(await loginsPausedReasonFor(role)).toBeNull();
      expect(await loginsPausedResponseFor(role)).toBeNull();
    },
  );

  it("keeps staff signing in during full maintenance too", async () => {
    overrides.MAINTENANCE_MODE = true;
    expect(await loginsPausedReasonFor("admin")).toBeNull();
    expect(await loginsPausedReasonFor("user")).not.toBeNull();
  });
});

describe("MAINTENANCE_MODE implies the rest", () => {
  it("pauses scanning, signups and non-staff logins on its own", async () => {
    overrides.MAINTENANCE_MODE = true;
    const state = await getServiceState();
    expect(state).toMatchObject({
      maintenance: true,
      signupsPaused: true,
      loginsPaused: true,
      scanningPaused: true,
    });
  });

  it("carries the maintenance message into every refusal", async () => {
    overrides.MAINTENANCE_MODE = true;
    overrides.MAINTENANCE_MESSAGE = "Database migration, back by 03:00.";
    // The per-switch messages are deliberately ignored while maintenance is
    // on: a user told "scanning is paused" during a maintenance window has
    // been told the less useful of the two true things.
    overrides.PAUSE_SCANNING_MESSAGE = "should not be used";
    expect(await scanningPausedReason()).toBe(
      "Database migration, back by 03:00.",
    );
    expect(await signupsPausedReason()).toBe(
      "Database migration, back by 03:00.",
    );
    expect(await loginsPausedReasonFor("user")).toBe(
      "Database migration, back by 03:00.",
    );
  });
});

describe("maintenanceGate", () => {
  function staffSession(role: string) {
    mockGetSession.mockResolvedValue({ userId: 7 });
    mockQuery.mockResolvedValue({ rows: [{ role }] });
  }

  it("shows the screen to a signed-out visitor", async () => {
    overrides.MAINTENANCE_MODE = true;
    overrides.MAINTENANCE_MESSAGE = "Back shortly.";
    expect(await maintenanceGate("/dashboard")).toEqual({
      active: true,
      message: "Back shortly.",
    });
  });

  it("shows the screen to a signed-in non-staff user", async () => {
    overrides.MAINTENANCE_MODE = true;
    staffSession("user");
    expect(await maintenanceGate("/dashboard")).toMatchObject({
      active: true,
    });
  });

  it.each(["support", "admin", "super_admin"])(
    "lets a %s through to every page, including /admin",
    async (role) => {
      overrides.MAINTENANCE_MODE = true;
      staffSession(role);
      expect(await maintenanceGate("/admin")).toEqual({ active: false });
      expect(await maintenanceGate("/dashboard")).toEqual({ active: false });
    },
  );

  // Without this, maintenance mode locks out the signed-out operator: they
  // cannot become staff without signing in and cannot sign in without /login.
  it("leaves /login reachable for everyone", async () => {
    overrides.MAINTENANCE_MODE = true;
    expect(await maintenanceGate("/login")).toEqual({ active: false });
    expect(await maintenanceGate("/login/whatever")).toEqual({
      active: false,
    });
  });

  it("does not treat a path that merely starts with the same letters as exempt", async () => {
    overrides.MAINTENANCE_MODE = true;
    expect(await maintenanceGate("/loginsomething")).toMatchObject({
      active: true,
    });
  });

  it("treats a missing pathname header as non-exempt", async () => {
    overrides.MAINTENANCE_MODE = true;
    expect(await maintenanceGate(null)).toMatchObject({ active: true });
  });

  // The database being down is the situation the switch exists for, so the
  // gate has to survive the role lookup throwing rather than 500 the page it
  // is supposed to be standing in for.
  it("treats a failed role lookup as not-staff instead of throwing", async () => {
    overrides.MAINTENANCE_MODE = true;
    mockGetSession.mockResolvedValue({ userId: 7 });
    mockQuery.mockRejectedValue(new Error("connection refused"));
    expect(await maintenanceGate("/dashboard")).toMatchObject({
      active: true,
    });
  });

  it("does nothing at all while maintenance is off", async () => {
    staffSession("user");
    expect(await maintenanceGate("/dashboard")).toEqual({ active: false });
    // No role lookup when the switch is off: the gate must not add a query to
    // every page render on a healthy deployment.
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
