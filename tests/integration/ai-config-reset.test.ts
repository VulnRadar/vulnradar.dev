import { beforeEach, expect, it, vi } from "vitest";
import pool from "@/lib/database/db";
import { describeIntegration, createUser } from "./_db";

/**
 * Removing a saved AI provider keeps the account's "AI off" switch, against
 * the real schema.
 *
 * Both live on the one user_ai_configs row. DELETE used to remove the row, and
 * an account with no row is AI-on by default, so the reset quietly turned AI
 * back on for someone who had switched it off. The unit tier sees only the
 * statement; whether ai_disabled survives it, and whether a column named in
 * the SET exists at all, is Postgres's answer.
 */

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: () => mockGetSession() };
});

const { DELETE, GET } = await import("@/app/api/v3/account/ai-config/route");
const { isAiDisabledForUser } = await import("@/lib/ai/user-ai-config");

async function storedRow(userId: number) {
  const { rows } = await pool.query<{
    use_vulnradar_ai: boolean;
    ai_disabled: boolean;
    provider: string | null;
    model_id: string | null;
    api_key_encrypted: string | null;
    base_url: string | null;
  }>(
    `SELECT use_vulnradar_ai, ai_disabled, provider, model_id, api_key_encrypted, base_url
     FROM user_ai_configs WHERE user_id = $1`,
    [userId],
  );
  return rows[0];
}

describeIntegration("resetting the AI provider", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
  });

  it("clears the provider and keeps AI switched off", async () => {
    const user = await createUser();
    mockGetSession.mockResolvedValue({ userId: user.id });
    await pool.query(
      `INSERT INTO user_ai_configs
         (user_id, use_vulnradar_ai, ai_disabled, provider, model_id, api_key_encrypted, base_url)
       VALUES ($1, FALSE, TRUE, 'openai', 'gpt-4o', 'not-a-ciphertext', 'https://api.openai.com/v1')`,
      [user.id],
    );

    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ aiDisabled: true });

    expect(await storedRow(user.id)).toEqual({
      use_vulnradar_ai: true,
      ai_disabled: true,
      provider: null,
      model_id: null,
      api_key_encrypted: null,
      base_url: null,
    });
    await expect(isAiDisabledForUser(user.id)).resolves.toBe(true);

    const json = await (await GET()).json();
    expect(json.aiDisabled).toBe(true);
    expect(json.apiKeyLast4).toBeNull();
  });

  it("does not create a row for an account that never saved one", async () => {
    const user = await createUser();
    mockGetSession.mockResolvedValue({ userId: user.id });

    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ aiDisabled: false });
    expect(await storedRow(user.id)).toBeUndefined();
  });
});
