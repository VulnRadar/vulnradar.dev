/**
 * VulnRadar — Schema migration v3.0.0 → v3.5.0.
 *
 * Adds the `user_avatars` table (uploaded profile pictures stored as BYTEA,
 * one row per user) so there is a single image-storage mechanism in the
 * app: Postgres, exactly like scan_screenshots. See
 * lib/uploads/avatar-storage.ts and app/api/v3/avatar/[userId]/route.ts.
 *
 * It also carries the DATA half of that move, as a pure-database step so it
 * runs anywhere the migrator can reach the database (production is
 * serverless and has no filesystem): every user whose `avatar_url` is a
 * legacy `data:image/(png|jpeg);base64,...` value (the old serverless
 * fallback) has that base64 decoded, magic-byte/size-validated the same way
 * lib/uploads/avatar.ts validates an upload, written into user_avatars, and
 * their avatar_url normalized to `/api/v3/avatar/<id>?v=<ts>`.
 *
 * The conversion is idempotent and robust:
 *   - a user that already has a user_avatars row is skipped;
 *   - a converted row's avatar_url no longer matches the `data:image/%`
 *     filter, so a re-run finds it again zero times;
 *   - a single malformed/oversized/wrong-signature data URL is skipped
 *     (logged via RAISE WARNING) inside a per-row exception block, so one
 *     bad row never aborts the whole migration.
 *
 * The legacy self-hosted-Docker case (avatars stored as files at
 * data/avatars/<id>.png, never as base64 in the column) is imported
 * separately and best-effort at boot -- see
 * lib/uploads/avatar-migration.ts -- because that path needs the
 * filesystem, which a versioned SQL migration deliberately never touches.
 */

export const from = "3.0.0";
export const to = "3.5.0";

const USER_AVATARS_SQL = `
  CREATE TABLE IF NOT EXISTS user_avatars (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    image_data BYTEA NOT NULL,
    content_type TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

// Pure-database conversion of legacy base64 data-URL avatars into the
// user_avatars BYTEA table. Runs after CREATE TABLE user_avatars (addTables
// are expanded before dataUpdates) in the same transaction. Each row is
// processed in its own BEGIN ... EXCEPTION block so an invalid base64 payload
// is skipped rather than rolling back every other conversion.
const CONVERT_BASE64_AVATARS_SQL = `
DO $migrate_avatars$
DECLARE
  r RECORD;
  raw_bytes bytea;
  b64 text;
  detected_mime text;
BEGIN
  FOR r IN
    SELECT id, avatar_url
    FROM users
    WHERE avatar_url LIKE 'data:image/png;base64,%'
       OR avatar_url LIKE 'data:image/jpeg;base64,%'
  LOOP
    -- Idempotent: never overwrite an avatar that was already imported.
    IF EXISTS (SELECT 1 FROM user_avatars a WHERE a.user_id = r.id) THEN
      CONTINUE;
    END IF;

    BEGIN
      IF r.avatar_url LIKE 'data:image/png;base64,%' THEN
        detected_mime := 'image/png';
      ELSE
        detected_mime := 'image/jpeg';
      END IF;

      -- The base64 payload is everything after the single comma in a data:
      -- URL (base64 itself never contains a comma).
      b64 := split_part(r.avatar_url, ',', 2);
      raw_bytes := decode(b64, 'base64');

      -- Size cap (5 MiB) + magic-byte allowlist: the exact checks
      -- lib/uploads/avatar.ts enforces on upload. A row failing any of them
      -- is skipped -- never inserted, never fatal to the migration.
      IF octet_length(raw_bytes) = 0 OR octet_length(raw_bytes) > 5242880 THEN
        RAISE WARNING 'avatar migration: user % skipped (empty or over 5 MiB)', r.id;
      ELSIF detected_mime = 'image/png' AND NOT (
              octet_length(raw_bytes) >= 8
              AND get_byte(raw_bytes, 0) = 137 AND get_byte(raw_bytes, 1) = 80
              AND get_byte(raw_bytes, 2) = 78  AND get_byte(raw_bytes, 3) = 71
              AND get_byte(raw_bytes, 4) = 13  AND get_byte(raw_bytes, 5) = 10
              AND get_byte(raw_bytes, 6) = 26  AND get_byte(raw_bytes, 7) = 10) THEN
        RAISE WARNING 'avatar migration: user % skipped (PNG signature mismatch)', r.id;
      ELSIF detected_mime = 'image/jpeg' AND NOT (
              octet_length(raw_bytes) >= 3
              AND get_byte(raw_bytes, 0) = 255
              AND get_byte(raw_bytes, 1) = 216
              AND get_byte(raw_bytes, 2) = 255) THEN
        RAISE WARNING 'avatar migration: user % skipped (JPEG signature mismatch)', r.id;
      ELSE
        INSERT INTO user_avatars (user_id, image_data, content_type, updated_at)
          VALUES (r.id, raw_bytes, detected_mime, NOW())
          ON CONFLICT (user_id) DO NOTHING;
        UPDATE users
          SET avatar_url =
            '/api/v3/avatar/' || r.id::text || '?v=' ||
            (extract(epoch FROM now()) * 1000)::bigint::text
          WHERE id = r.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One invalid/undecodable row must not abort the whole migration.
      RAISE WARNING 'avatar migration: user % skipped (%)', r.id, SQLERRM;
    END;
  END LOOP;
END
$migrate_avatars$;
`;

export const upgrade = {
  description:
    "Add the user_avatars table (uploaded profile pictures as BYTEA, one " +
    "row per user, ON DELETE CASCADE) so avatars share the single " +
    "Postgres image-storage mechanism scan_screenshots already uses, then " +
    "convert every legacy base64 data:image avatar_url into a user_avatars " +
    "row and normalize that avatar_url to /api/v3/avatar/<id>?v=<ts>. The " +
    "conversion is pure-database (no filesystem), idempotent (skips a user " +
    "that already has a row, and a normalized url no longer matches the " +
    "data:image filter), and robust (a malformed/oversized/wrong-signature " +
    "data URL is skipped per-row, never aborting the migration).",

  addTables: [{ name: "user_avatars", sql: USER_AVATARS_SQL }],

  dataUpdates: [
    {
      sql: CONVERT_BASE64_AVATARS_SQL,
      label:
        "Convert legacy base64 data:image avatar_url values into " +
        "user_avatars rows and normalize avatar_url (idempotent, per-row " +
        "validated + skipped on failure)",
      destructive: false,
    },
  ],
};

export const downgrade = {
  description:
    "Drop the user_avatars table. Every uploaded avatar stored there is " +
    "lost, and any avatar_url normalized to /api/v3/avatar/<id> by the " +
    "upgrade will 404 -- the original base64 data URL is not restored.",

  dropTables: ["user_avatars"],
};
