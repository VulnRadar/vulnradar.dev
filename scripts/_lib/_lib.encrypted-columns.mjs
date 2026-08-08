/**
 * VulnRadar — Registry of columns encrypted via lib/auth/crypto.ts's
 * encryptApiKey/decryptApiKey (the same AES-256-GCM pipeline
 * scripts/_lib/_lib.2fa-crypto-mirror.mjs already mirrors for
 * users.totp_secret).
 *
 * Found by grepping the codebase for every `encryptApiKey(`/
 * `decryptApiKey(` call site (not by guessing): lib/api/api-keys.ts,
 * lib/discord/discord-utils.ts, app/api/v3/auth/discord/callback/route.ts,
 * app/api/v3/account/ai-config/route.ts, plus lib/auth/security-migration.ts
 * and the 2FA routes (users.totp_secret, already owned by
 * scripts/db-diagnose-2fa.mjs / scripts/db-repair-2fa.mjs -- deliberately
 * NOT listed here to avoid reporting or repairing it twice; see
 * db-diagnose.mjs, which calls into the 2FA tool directly and folds its
 * summary into this tool's report instead of reimplementing it).
 *
 * `repairKind` records the ONE safe repair for each column, each
 * mirroring an already-existing, precedented app action for "this
 * credential is dead, stop pretending it works":
 *
 *   - "clear_column": the column is nullable and unrelated to any other
 *     stored auth material -- set it to NULL. Precedent:
 *     app/api/v3/account/ai-config/route.ts's own GET handler already
 *     treats a decrypt failure on api_key_encrypted as "no key" (catches
 *     the error and returns null), so clearing it changes nothing the
 *     user could already observe.
 *   - "revoke_and_clear_api_key": api_keys.key_encrypted is the ONLY
 *     verification path once key_locator is set (see
 *     lib/api/api-keys.ts's validateApiKey -- the bcrypt/key_hash
 *     fallback query explicitly excludes rows that have a key_locator),
 *     so an undecryptable key_encrypted with a key_locator means the key
 *     already cannot authenticate. Mark it honestly revoked
 *     (revoked_at = NOW() if not already set) and clear the ciphertext.
 *   - "delete_row": discord_connections.access_token is NOT NULL, so
 *     nulling isn't an option, and a connection with a dead token is
 *     useless (every read decrypts both tokens together in
 *     lib/discord/discord-utils.ts's getDiscordConnection). Precedent:
 *     app/api/v3/account/discord/route.ts's own "disconnect" action is
 *     `DELETE FROM discord_connections WHERE user_id = $1` -- a normal,
 *     already-self-service, non-security-sensitive action a user can
 *     already trigger themselves at will. Forcing the same outcome here
 *     is not a new capability, just automating what reconnecting Discord
 *     would produce anyway.
 */
export const ENCRYPTED_COLUMNS = [
  {
    table: "api_keys",
    column: "key_encrypted",
    nullable: true,
    repairKind: "revoke_and_clear_api_key",
    // When key_locator is present, cross-check the decrypted value
    // against it (see lib/api/api-keys.ts's computeKeyLocator): a
    // mismatch is a stronger signal than "decrypt succeeded" alone,
    // since it proves the plaintext isn't the key this row claims to be
    // -- exactly the "decrypts without error but isn't real" pattern the
    // 2FA tool found for totp_secret after a key rotation.
    locatorColumn: "key_locator",
    source: "lib/api/api-keys.ts",
  },
  {
    table: "discord_connections",
    column: "access_token",
    nullable: false,
    repairKind: "delete_row",
    pairedColumn: "refresh_token",
    source: "lib/discord/discord-utils.ts, app/api/v3/account/discord/route.ts",
  },
  {
    table: "discord_connections",
    column: "refresh_token",
    nullable: true,
    repairKind: "delete_row",
    pairedColumn: "access_token",
    source: "lib/discord/discord-utils.ts, app/api/v3/account/discord/route.ts",
  },
  {
    table: "user_ai_configs",
    column: "api_key_encrypted",
    nullable: true,
    repairKind: "clear_column",
    source: "app/api/v3/account/ai-config/route.ts",
  },
];
