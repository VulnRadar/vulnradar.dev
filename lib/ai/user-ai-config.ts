import pool from "@/lib/database/db";

/**
 * Whether the account switched AI off (user_ai_configs.ai_disabled). An
 * account with no row never saved a setting, and AI is on by default.
 *
 * Deliberately does not catch. Every reader used to wrap this lookup in a
 * catch that answered "AI is on", so a database error sent the findings of
 * someone who had opted out to the AI provider anyway. A read that fails says
 * nothing about what the user chose, and a privacy opt-out cannot be assumed
 * away: the error reaches the caller, and the caller refuses.
 */
export async function isAiDisabledForUser(userId: number): Promise<boolean> {
  const result = await pool.query<{ ai_disabled: boolean }>(
    `SELECT ai_disabled FROM user_ai_configs WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0]?.ai_disabled === true;
}

/**
 * Forget the account's own AI provider and go back to the built-in one.
 *
 * Only the provider columns are cleared. The row also holds ai_disabled, and
 * deleting it (what the reset used to do) turned AI back on for an account
 * that had switched it off. No row is created for an account that has none:
 * that account is already on the built-in provider.
 */
export async function clearAiProviderConfig(
  userId: number,
): Promise<{ aiDisabled: boolean }> {
  const result = await pool.query<{ ai_disabled: boolean }>(
    `UPDATE user_ai_configs SET
       use_vulnradar_ai = TRUE,
       provider = NULL,
       model_id = NULL,
       api_key_encrypted = NULL,
       base_url = NULL,
       updated_at = NOW()
     WHERE user_id = $1
     RETURNING ai_disabled`,
    [userId],
  );
  return { aiDisabled: result.rows[0]?.ai_disabled === true };
}
