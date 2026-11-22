/**
 * The single-use TOTP step lock lives in one place. It used to exist twice: a
 * copy in POST /auth/2fa/verify and a second one written for the staff second
 * factor, kept identical by a comment. If the copies drifted, a code spent at
 * sign-in could be replayed for an update or an impersonation, or the reverse.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";

let lastCounter: string | null = null;
const queries: string[] = [];
const client = {
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    queries.push(sql.split(/\s+/)[0]);
    if (sql.startsWith("SELECT")) {
      return { rows: [{ totp_last_counter: lastCounter }] };
    }
    if (sql.startsWith("UPDATE")) lastCounter = String(params?.[0]);
    return { rows: [] };
  }),
  release: vi.fn(),
};
vi.mock("@/lib/database/db", () => ({
  default: { connect: vi.fn(async () => client) },
}));

const { consumeTotpStep } = await import("@/lib/auth/totp-step");

const read = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

beforeEach(() => {
  lastCounter = null;
  queries.length = 0;
  client.release.mockClear();
});

describe("consumeTotpStep", () => {
  it("records the first use of a step and refuses the same step again", async () => {
    expect(await consumeTotpStep(1, 100)).toBe(true);
    expect(lastCounter).toBe("100");
    expect(await consumeTotpStep(1, 100)).toBe(false);
  });

  it("refuses an older step and accepts a later one", async () => {
    lastCounter = "100";
    expect(await consumeTotpStep(1, 99)).toBe(false);
    expect(await consumeTotpStep(1, 101)).toBe(true);
    expect(lastCounter).toBe("101");
  });

  it("locks the row and always releases the connection", async () => {
    await consumeTotpStep(1, 5);
    expect(queries).toEqual(["BEGIN", "SELECT", "UPDATE", "COMMIT"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe("one copy of the rule", () => {
  const sources = [
    "app/api/v3/auth/2fa/verify/route.ts",
    "lib/auth/staff-step-up.ts",
  ];

  it.each(sources)("%s spends the step through consumeTotpStep", (file) => {
    const src = read(file);
    expect(src).toMatch(/from "@\/lib\/auth\/totp-step"/);
    expect(src).toMatch(/consumeTotpStep\(/);
  });

  it.each(sources)("%s has no private copy of the lock", (file) => {
    expect(read(file)).not.toMatch(/SET totp_last_counter/);
  });
});
