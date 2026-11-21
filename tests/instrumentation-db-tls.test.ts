import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * enc-6 at the boot path: register() says so when production reaches a remote
 * Postgres without TLS, and DATABASE_SSL_REQUIRED=true refuses to start
 * before anything has opened a connection. The rule itself is tested in
 * tests/lib/database/pg-ssl.test.ts; this pins that register() uses it.
 */

const h = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [{ n: 0 }] })),
  installErrorLogCapture: vi.fn(),
  reportRunningVersion: vi.fn(async () => {}),
}));

vi.mock("@/lib/config/env", () => ({ validateEnv: vi.fn() }));
vi.mock("@/lib/database/db", () => ({
  default: { end: vi.fn(), query: h.query },
}));
vi.mock("@/lib/database/error-log-capture", () => ({
  installErrorLogCapture: h.installErrorLogCapture,
}));
vi.mock("@/lib/database/boot/release-check", () => ({
  reportRunningVersion: h.reportRunningVersion,
}));
vi.mock("@/lib/database/boot/schema-lock", () => ({
  acquireBootSchemaLock: vi.fn(async () => ({ fake: "lock" })),
  releaseBootSchemaLock: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/boot/schema-version", () => ({
  ensureSchemaVersion: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/boot/apply-boot-schema", () => ({
  applyBootSchema: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/boot/backfills", () => ({
  runBootBackfills: vi.fn(async () => {}),
  carryOverLegacyTriage: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/boot/workers", () => ({
  runInitialCleanup: vi.fn(async () => {}),
  startBackgroundWorkers: vi.fn(async () => {}),
  stopBackgroundWorkers: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/boot/safety-nets", () => ({
  runBootSafetyNets: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/boot/app-url-drift", () => ({
  reportAppUrlDrift: vi.fn(async () => {}),
}));
vi.mock("@/lib/admin/alert-webhook", () => ({ sendAdminAlert: vi.fn() }));

const { register } = await import("@/instrumentation");
const { databaseTlsWarning } = await import("@/lib/database/pg-ssl.mjs");

const REMOTE = "postgresql://vr:secret@db.example.com:5432/vulnradar";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.query.mockClear();
  h.installErrorLogCapture.mockClear();
  h.reportRunningVersion.mockClear();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", REMOTE);
  vi.stubEnv("DATABASE_SSL", "false");
  vi.stubEnv("DATABASE_SSL_REQUIRED", "");
  vi.stubEnv("NEXT_MANUAL_SIG_HANDLE", "");
  vi.stubEnv("HOST_BIND", "");
  vi.stubEnv("ALLOW_INSECURE_HTTP", "");
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function loggedLines(): string[] {
  return consoleError.mock.calls.map((call: unknown[]) => String(call[0]));
}

describe("register(): database TLS", () => {
  it("logs the warning when production reaches a remote database in plaintext", async () => {
    const warning = databaseTlsWarning(process.env) as string;
    expect(warning).toBeTruthy();

    await register();

    expect(loggedLines().some((line) => line.includes(warning))).toBe(true);
  });

  it("logs nothing about it once DATABASE_SSL=true", async () => {
    vi.stubEnv("DATABASE_SSL", "true");

    await register();

    expect(loggedLines().some((line) => line.includes("DATABASE_SSL"))).toBe(
      false,
    );
  });

  it("refuses to boot with DATABASE_SSL_REQUIRED=true, before any phase reaches the database", async () => {
    vi.stubEnv("DATABASE_SSL_REQUIRED", "true");
    const warning = databaseTlsWarning(process.env) as string;

    await expect(register()).rejects.toThrow(warning);

    // The refusal must not first send the password over the very connection
    // it is refusing: the error-log capture writes every console.error to
    // the database, and the release check is the first phase after it.
    expect(h.installErrorLogCapture).not.toHaveBeenCalled();
    expect(h.reportRunningVersion).not.toHaveBeenCalled();
    expect(h.query).not.toHaveBeenCalled();
  });

  it("boots with DATABASE_SSL_REQUIRED=true when the connection is encrypted", async () => {
    vi.stubEnv("DATABASE_SSL_REQUIRED", "true");
    vi.stubEnv("DATABASE_URL", `${REMOTE}?sslmode=verify-full`);

    await expect(register()).resolves.toBeUndefined();
    expect(h.reportRunningVersion).toHaveBeenCalled();
  });
});
