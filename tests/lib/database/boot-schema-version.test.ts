import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";

vi.mock("@/lib/admin/alert-webhook", () => ({
  sendAdminAlert: vi.fn(async () => {}),
}));

import { sendAdminAlert } from "@/lib/admin/alert-webhook";
import {
  ensureSchemaVersion,
  normalizeSchemaVersion,
} from "@/lib/database/boot/schema-version";

/**
 * The schema gate decides whether the process may start against a database,
 * so what it compares has to be right. The comparison is lib/updater/semver.ts
 * (it was a private compareVersions here, one of six copies); these tests pin
 * the decisions the gate makes with it. The pool is a fake, so this proves the
 * gate's logic, not what PostgreSQL stores.
 */

const CONTEXT = {
  appName: "VulnRadar",
  appVersion: "4.0.0",
  minSchemaVersion: "3.0.0",
};

function fakePool(storedSchema: string | null) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT schema_version")) {
      return {
        rows:
          storedSchema === null
            ? []
            : [
                {
                  schema_version: storedSchema,
                  app_version: "3.9.1",
                  applied_at: new Date("2026-01-01T00:00:00Z"),
                },
              ],
      };
    }
    return { rows: [], rowCount: 0 };
  });
  return { pool: { query } as unknown as Pool, query };
}

let logs: string[];
let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  // The real process.exit never returns. Throwing keeps the code after it
  // from running, as it would not in production.
  exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
  vi.mocked(sendAdminAlert).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeSchemaVersion", () => {
  it("leaves a version that exists alone", () => {
    expect(normalizeSchemaVersion("3.0.0")).toBe("3.0.0");
    expect(normalizeSchemaVersion("1.0.0")).toBe("1.0.0");
  });

  it("rounds an app version that reached the column down to the newest real schema", () => {
    expect(normalizeSchemaVersion("3.5.0")).toBe("3.0.0");
    expect(normalizeSchemaVersion("2.4.1")).toBe("2.0.0");
  });

  it("never rounds up, and leaves a version older than every schema as it is", () => {
    expect(normalizeSchemaVersion("0.9.0")).toBe("0.9.0");
  });

  it("leaves anything that is not a plain x.y.z alone", () => {
    expect(normalizeSchemaVersion("")).toBe("");
    expect(normalizeSchemaVersion("garbage")).toBe("garbage");
    expect(normalizeSchemaVersion("3.9.1-rc.1")).toBe("3.9.1-rc.1");
  });

  it("finds the newest known version whatever order the list is in", () => {
    expect(normalizeSchemaVersion("2.5.0", ["2.0.0", "1.0.0", "3.0.0"])).toBe(
      "2.0.0",
    );
    expect(normalizeSchemaVersion("9.9.9", ["1.0.0", "2.0.0"])).toBe("2.0.0");
  });
});

describe("ensureSchemaVersion", () => {
  it("lets a database at the required version through", async () => {
    const { pool, query } = fakePool("3.0.0");
    await ensureSchemaVersion(pool, CONTEXT);

    expect(exit).not.toHaveBeenCalled();
    expect(sendAdminAlert).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain(
      "Schema version: v3.0.0 (required: v3.0.0)",
    );
    // Nothing to rewrite: the stored value was already a real schema.
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("UPDATE")),
    ).toBe(false);
  });

  it("reads an app version stored as the schema as the schema it stands for, and fixes the row", async () => {
    const { pool, query } = fakePool("3.5.0");
    await ensureSchemaVersion(pool, CONTEXT);

    expect(exit).not.toHaveBeenCalled();
    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE vulnradar_schema_meta"),
    );
    expect(update?.[1]).toEqual(["3.0.0"]);
  });

  it("lets a database that is ahead of the requirement through, release candidate or not", async () => {
    for (const stored of ["3.1.0", "4.0.0", "4.0.0-rc.1"]) {
      const { pool } = fakePool(stored);
      await ensureSchemaVersion(pool, CONTEXT);
    }
    expect(exit).not.toHaveBeenCalled();
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it("refuses to start on a database older than the requirement, and says why", async () => {
    const { pool } = fakePool("2.0.0");

    await expect(ensureSchemaVersion(pool, CONTEXT)).rejects.toThrow(
      "process.exit(1)",
    );

    expect(exit).toHaveBeenCalledWith(1);
    // The first alert is the mismatch itself. (Because the fake exit throws,
    // the function's own catch raises a second one; the real exit would not.)
    expect(vi.mocked(sendAdminAlert).mock.calls[0][0]).toMatchObject({
      event: "boot_schema_version_mismatch",
      severity: "critical",
    });
    expect(
      String(vi.mocked(sendAdminAlert).mock.calls[0][0].message),
    ).toContain("v2.0.0");
  });
});
