/**
 * lib/admin/account-email.ts: an admin's email correction, as statements. The
 * lock order itself is Postgres's to prove (tests/integration/
 * admin-email-correction.test.ts); this pins what is sent and what happens
 * when part of it fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClientQuery = vi.fn();
const mockRelease = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: {
    connect: async () => ({ query: mockClientQuery, release: mockRelease }),
  },
}));

const { replaceAccountEmail } = await import("@/lib/admin/account-email");

const sent = () =>
  mockClientQuery.mock.calls.map(([sql]) =>
    String(sql).replace(/\s+/g, " ").trim(),
  );

beforeEach(() => {
  mockClientQuery.mockReset();
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockRelease.mockReset();
});

describe("replaceAccountEmail", () => {
  it("deletes the links before it writes the address, in one transaction", async () => {
    await replaceAccountEmail(5, "new@example.com");

    expect(sent()).toEqual([
      "BEGIN",
      "DELETE FROM email_verification_tokens WHERE user_id = $1",
      "UPDATE users SET email = $1, email_verified_at = NULL, pending_email = NULL, updated_at = NOW() WHERE id = $2",
      "COMMIT",
    ]);
    expect(mockClientQuery.mock.calls[1][1]).toEqual([5]);
    expect(mockClientQuery.mock.calls[2][1]).toEqual(["new@example.com", 5]);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("rolls back and rethrows when a write fails", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("UPDATE users")) throw new Error("deadlock detected");
      return { rows: [] };
    });

    await expect(replaceAccountEmail(5, "new@example.com")).rejects.toThrow(
      "deadlock detected",
    );
    expect(sent()).toContain("ROLLBACK");
    expect(sent()).not.toContain("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("still reports the write's own error when the rollback fails on a dead connection", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("DELETE")) throw new Error("terminating connection");
      if (sql === "ROLLBACK") throw new Error("connection already closed");
      return { rows: [] };
    });

    await expect(replaceAccountEmail(5, "new@example.com")).rejects.toThrow(
      "terminating connection",
    );
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
