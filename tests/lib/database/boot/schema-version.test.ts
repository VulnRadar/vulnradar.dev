import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";

vi.mock("@/lib/admin/alert-webhook", () => ({
  sendAdminAlert: vi.fn(async () => {}),
}));
// Two schema versions either side of the single-to-double-digit boundary, so
// the gate's comparison is exercised where a text comparison goes wrong.
vi.mock("@/lib/config/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/constants")>()),
  KNOWN_SCHEMA_VERSIONS: ["1.0.0", "2.0.0", "3.0.0", "3.9.0", "3.10.0"],
}));

import { sendAdminAlert } from "@/lib/admin/alert-webhook";
import {
  ensureSchemaVersion,
  normalizeSchemaVersion,
} from "@/lib/database/boot/schema-version";
import { META_TABLE_SQL } from "@/lib/database/schema/index.mjs";
import { compareSemver } from "@/lib/updater/semver";

/**
 * The paths of the schema gate tests/lib/database/boot-schema-version.test.ts
 * does not reach (tests-7): the comparison past single digits, a database with
 * no meta row at all, either empty or populated, and the gate's own failure.
 * Each of these ends a boot, so a regression in any of them either refuses
 * every upgrade or lets the app start against a database it will break.
 */

const CONTEXT = {
  appName: "VulnRadar",
  appVersion: "4.0.0",
  minSchemaVersion: "3.0.0",
};

function fakePool(opts: {
  stored?: string | null;
  usersTables?: number;
  failOn?: RegExp;
}) {
  const sent: string[] = [];
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    sent.push(sql);
    if (opts.failOn?.test(sql)) throw new Error("connection reset");
    if (sql.includes("SELECT schema_version")) {
      return {
        rows:
          opts.stored == null
            ? []
            : [
                {
                  schema_version: opts.stored,
                  app_version: "3.9.1",
                  applied_at: new Date(),
                },
              ],
      };
    }
    if (sql.includes("information_schema.tables")) {
      return { rows: [{ n: opts.usersTables ?? 0 }] };
    }
    return { rows: [], rowCount: 1 };
  });
  return { pool: { query } as unknown as Pool, query, sent };
}

let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
  vi.mocked(sendAdminAlert).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the version comparison", () => {
  it.each([
    ["3.10.0", "3.9.0", 1],
    ["3.9.0", "3.10.0", -1],
    ["10.0.0", "9.99.99", 1],
    ["3.0.0", "3.0.0", 0],
    ["3.0.1", "3.0.0", 1],
  ])("compares %s with %s numerically, not as text", (a, b, sign) => {
    expect(Math.sign(compareSemver(a, b))).toBe(sign);
  });

  it("lets a 3.10.0 database through a 3.9.0 requirement", async () => {
    const { pool } = fakePool({ stored: "3.10.0" });
    await ensureSchemaVersion(pool, {
      ...CONTEXT,
      minSchemaVersion: "3.9.0",
    });
    expect(exit).not.toHaveBeenCalled();
  });

  it("refuses a 3.9.0 database under a 3.10.0 requirement", async () => {
    const { pool } = fakePool({ stored: "3.9.0" });
    await expect(
      ensureSchemaVersion(pool, { ...CONTEXT, minSchemaVersion: "3.10.0" }),
    ).rejects.toThrow("process.exit(1)");
    expect(vi.mocked(sendAdminAlert).mock.calls[0][0]).toMatchObject({
      event: "boot_schema_version_mismatch",
    });
  });
});

describe("normalizeSchemaVersion past single digits", () => {
  it("rounds 3.12.4 down to 3.10.0, not to 3.9.0", () => {
    expect(normalizeSchemaVersion("3.12.4", ["3.0.0", "3.9.0", "3.10.0"])).toBe(
      "3.10.0",
    );
  });
});

describe("a database with no meta row", () => {
  it("creates the meta table first, under the boot lock register() holds", async () => {
    const { pool, sent } = fakePool({ stored: "3.0.0" });
    await ensureSchemaVersion(pool, CONTEXT);
    // bug-db-9: the meta table's CREATE is the gate's first statement, so it
    // runs inside the advisory lock register() takes before calling it,
    // where two first boots cannot race it.
    expect(sent[0]).toBe(META_TABLE_SQL);
  });

  it("stamps an empty database at the required version and lets it boot", async () => {
    const { pool, query } = fakePool({ stored: null, usersTables: 0 });
    await ensureSchemaVersion(pool, CONTEXT);
    expect(exit).not.toHaveBeenCalled();
    const insert = query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO vulnradar_schema_meta"),
    );
    expect(insert?.[1]).toEqual(["3.0.0", "4.0.0"]);
    expect(insert?.[0]).toContain("ON CONFLICT (id) DO NOTHING");
  });

  it("refuses a populated database with no version, and alerts", async () => {
    const { pool, query } = fakePool({ stored: null, usersTables: 1 });
    await expect(ensureSchemaVersion(pool, CONTEXT)).rejects.toThrow(
      "process.exit(1)",
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(vi.mocked(sendAdminAlert).mock.calls[0][0]).toMatchObject({
      event: "boot_schema_version_unset",
      severity: "critical",
    });
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("INSERT INTO vulnradar_schema_meta"),
      ),
    ).toBe(false);
  });
});

describe("the gate failing", () => {
  it("exits and alerts when the meta table cannot even be read", async () => {
    const { pool } = fakePool({ failOn: /SELECT schema_version/ });
    await expect(ensureSchemaVersion(pool, CONTEXT)).rejects.toThrow(
      "process.exit(1)",
    );
    expect(vi.mocked(sendAdminAlert).mock.calls[0][0]).toMatchObject({
      event: "boot_schema_check_failed",
      severity: "critical",
    });
  });
});
