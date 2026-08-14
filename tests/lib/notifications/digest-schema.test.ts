import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for lib/notifications/digest-schema.ts -- the additive schema for
 * the posture-digest feature, kept out of instrumentation.ts's boot-time
 * CREATE TABLE block (see that module's header comment for why) but meant
 * to be called from it once at startup.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { ensureDigestSchema } =
  await import("@/lib/notifications/digest-schema");

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe("ensureDigestSchema", () => {
  it("issues a single idempotent query adding all three columns", async () => {
    await ensureDigestSchema();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0] as string;

    expect(sql).toContain(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_email_enabled BOOLEAN NOT NULL DEFAULT false",
    );
    expect(sql).toContain(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_digest_sent_at TIMESTAMPTZ",
    );
    expect(sql).toContain(
      "ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS email_posture_digest BOOLEAN NOT NULL DEFAULT true",
    );
  });

  it("propagates a query failure instead of swallowing it", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(ensureDigestSchema()).rejects.toThrow("db unavailable");
  });
});
