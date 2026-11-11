/**
 * The account's "AI off" switch, read in one place.
 *
 * Five readers each had a copy of the same lookup wrapped in a catch that
 * answered "AI is on" when the query failed, so a database blip sent the
 * findings of someone who had switched AI off to the AI provider anyway. The
 * helper does not catch: a read that fails is the caller's error, and every
 * caller turns it into a refusal.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { clearAiProviderConfig, isAiDisabledForUser } =
  await import("@/lib/ai/user-ai-config");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("isAiDisabledForUser", () => {
  it("is true when the account switched AI off", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ai_disabled: true }] });
    await expect(isAiDisabledForUser(7)).resolves.toBe(true);
    expect(mockQuery.mock.calls[0][1]).toEqual([7]);
  });

  it("is false when the switch is on", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ai_disabled: false }] });
    await expect(isAiDisabledForUser(7)).resolves.toBe(false);
  });

  it("is false for an account that never saved an AI setting", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(isAiDisabledForUser(7)).resolves.toBe(false);
  });

  it("rejects when the read fails instead of answering that AI is on", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection reset"));
    await expect(isAiDisabledForUser(7)).rejects.toThrow("connection reset");
  });
});

describe("clearAiProviderConfig", () => {
  it("clears the provider columns and never touches ai_disabled", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ai_disabled: true }] });
    await expect(clearAiProviderConfig(7)).resolves.toEqual({
      aiDisabled: true,
    });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([7]);
    expect(sql).toMatch(/^\s*UPDATE user_ai_configs/);
    expect(sql).not.toMatch(/DELETE/i);
    for (const column of [
      "use_vulnradar_ai = TRUE",
      "provider = NULL",
      "model_id = NULL",
      "api_key_encrypted = NULL",
      "base_url = NULL",
    ]) {
      expect(sql).toContain(column);
    }
    const setClause = sql.slice(sql.indexOf("SET"), sql.indexOf("WHERE"));
    expect(setClause).not.toContain("ai_disabled");
  });

  it("reports AI as on for an account with no saved row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(clearAiProviderConfig(7)).resolves.toEqual({
      aiDisabled: false,
    });
  });
});
