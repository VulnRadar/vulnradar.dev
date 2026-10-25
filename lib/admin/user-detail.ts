import pool from "@/lib/database/db";

/**
 * Everything the admin user panel shows about one account, in one statement.
 *
 * The user-detail request used to run eleven queries in a single Promise.all:
 * the user row, then one query each for scans, keys, webhooks, schedules,
 * sessions, badges, notes, Discord, the GitHub connection and credits. The pool
 * holds ten connections and serves every other request in the process, so
 * opening one account took the whole pool for as long as its slowest query, and
 * anything queued behind it failed at the five second connection timeout. The
 * dashboard route records the same lesson in its own comment: three blocked
 * every other request in the process, login included.
 *
 * The small lookups are scalar json_agg subselects of the one user row now.
 * Postgres plans each as an independent subquery on indexed columns, so the
 * work is the same and the connection count is one.
 *
 * What a caller may see is still decided by the route, which holds the
 * permission checks (a role without the grant for a card does not get that
 * card's data). The flags below only decide which subselects are PRESENT in the
 * statement: a fragment that is not asked for is not in the SQL at all, so the
 * rows it would return are never read, rather than read and then dropped.
 */

export interface UserDetailFlags {
  /** Recent scans, scheduled scans and the public-host-report count. */
  scans: boolean;
  apiKeys: boolean;
  webhooks: boolean;
  sessions: boolean;
  /** The purchased balances. */
  credits: boolean;
}

export interface UserDetailBundle {
  user: Record<string, unknown>;
  recentScans: unknown[];
  apiKeys: unknown[];
  webhooks: unknown[];
  schedules: unknown[];
  activeSessions: unknown[];
  badges: unknown[];
  notes: unknown[];
  discordConnection: unknown | null;
  githubRepoConnection: unknown | null;
  credits: {
    aiCreditBalance: number;
    githubCreditBalance: number;
    browserbaseCreditSecondsBalance: number;
  } | null;
}

/** A json array of the rows of `select`, ordered, or [] when there are none. */
function jsonList(alias: string, select: string, orderBy: string): string {
  return `(SELECT COALESCE(json_agg(${alias} ORDER BY ${orderBy}), '[]'::json) FROM (${select}) ${alias})`;
}

/** A json object for the single row of `select`, or null when there is none. */
function jsonRow(alias: string, select: string): string {
  return `(SELECT row_to_json(${alias}) FROM (${select}) ${alias})`;
}

// Columns the bundle adds beside the user row. Named once so the shaping below
// can pull exactly these back out and leave `user` as the plain account.
const COLUMN = {
  recentScans: "recent_scans",
  schedules: "schedules",
  apiKeys: "api_keys",
  webhooks: "webhooks",
  sessions: "active_sessions",
  badges: "badges",
  notes: "notes",
  discord: "discord_connection",
  githubRepo: "github_repo_connection",
  credits: "credits",
} as const;

const BUNDLE_COLUMNS = Object.values(COLUMN);

export function buildUserDetailSql(flags: UserDetailFlags): string {
  const extra: string[] = [];

  if (flags.scans) {
    extra.push(
      // status and failure_kind are what keep a failed, cancelled or
      // still-pending scan from reading as "0 findings", the same as a clean
      // one. public_id is what the scan inspector's URL takes.
      `${jsonList(
        "s",
        `SELECT id, public_id, url, status, failure_kind, findings_count, source, scanned_at FROM scan_history WHERE user_id = u.id ORDER BY scanned_at DESC LIMIT 10`,
        "s.scanned_at DESC",
      )} AS ${COLUMN.recentScans}`,
      `${jsonList(
        "sc",
        `SELECT id, url, frequency, active, last_run_at, next_run_at FROM scheduled_scans WHERE user_id = u.id`,
        "sc.id",
      )} AS ${COLUMN.schedules}`,
    );
  }
  if (flags.apiKeys) {
    extra.push(
      `${jsonList(
        "k",
        `SELECT id, key_prefix, name, daily_limit, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = u.id`,
        "k.created_at DESC",
      )} AS ${COLUMN.apiKeys}`,
    );
  }
  if (flags.webhooks) {
    extra.push(
      // The host, not the path. Identifying which service a hook points at is
      // what the panel is for; the path segments are the bearer token, and
      // staff have no reason to hold one.
      `${jsonList(
        "w",
        `SELECT id, name, split_part(url, '/', 3) AS url_host, type, active FROM webhooks WHERE user_id = u.id`,
        "w.id",
      )} AS ${COLUMN.webhooks}`,
    );
  }
  if (flags.sessions) {
    extra.push(
      // Session rows carry the target's last-known IPs, so they ride on
      // VIEW_USER_SESSIONS rather than VIEW_USERS.
      `${jsonList(
        "se",
        `SELECT id, created_at, expires_at, ip_address, user_agent FROM sessions WHERE user_id = u.id AND expires_at > NOW()`,
        "se.created_at DESC",
      )} AS ${COLUMN.sessions}`,
    );
  }
  extra.push(
    `${jsonList(
      "bd",
      `SELECT b.id, b.name, b.display_name, b.description, b.icon, b.color, b.priority, b.is_limited, ub.awarded_at
         FROM user_badges ub JOIN badges b ON ub.badge_id = b.id
         WHERE ub.user_id = u.id`,
      "bd.priority DESC",
    )} AS ${COLUMN.badges}`,
    `${jsonList(
      "nt",
      `SELECT n.id, n.note, n.created_at, a.id AS admin_id, a.email AS admin_email, a.name AS admin_name, a.avatar_url AS admin_avatar_url
         FROM admin_user_notes n
         JOIN users a ON n.admin_id = a.id
         WHERE n.user_id = u.id`,
      "nt.created_at DESC",
    )} AS ${COLUMN.notes}`,
    // Connected socials: Discord is the only OAuth-style connection this app
    // stores server-side (discord_connections). access_token/refresh_token are
    // deliberately never selected -- an admin has no legitimate need to see or
    // act with a user's live Discord credentials, only whether/when they
    // connected.
    `${jsonRow(
      "dc",
      `SELECT discord_id, discord_username, discord_discriminator, discord_avatar, guild_joined, connected_at
         FROM discord_connections WHERE user_id = u.id LIMIT 1`,
    )} AS ${COLUMN.discord}`,
    // Separate from the users.github_id sign-in link above: this is the
    // distinct repo-read-access feature (code scanning), keyed by
    // github_user_id with its own OAuth scopes/token. access_token_encrypted is
    // deliberately never selected.
    `${jsonRow(
      "gc",
      `SELECT github_username, scopes, connected_at FROM github_connections WHERE user_id = u.id LIMIT 1`,
    )} AS ${COLUMN.githubRepo}`,
  );
  if (flags.credits) {
    extra.push(
      `json_build_object(
          'ai_credit_balance', u.ai_credit_balance,
          'github_credit_balance', u.github_credit_balance,
          'browserbase_credit_seconds_balance', u.browserbase_credit_seconds_balance
        ) AS ${COLUMN.credits}`,
    );
  }

  // How many public host pages are built from this user's scans, so the Delete
  // All Scans confirmation can say that the action reaches them. Behind the
  // same grant as the scan list: it is a fact about their scans.
  const publicHostReportCount = flags.scans
    ? `(SELECT COUNT(*) FROM host_reputation hr
          WHERE hr.source_scan_id IN (SELECT sh.id FROM scan_history sh WHERE sh.user_id = u.id))::int`
    : "NULL::int";

  return `SELECT u.id, u.email, u.name, u.role, u.avatar_url, u.totp_enabled, u.tos_accepted_at, u.created_at, u.disabled_at,
          u.email_verified_at, u.plan, u.stripe_customer_id, u.subscription_status, u.ai_chat_banned,
          u.google_id, u.google_email, u.google_name,
          u.github_id, u.github_email, u.github_name, u.github_login,
          u.discord_id, u.discord_username, u.discord_email,
          (SELECT COUNT(*) FROM scan_history WHERE user_id = u.id)::int as scan_count,
          (SELECT COUNT(*) FROM api_keys WHERE user_id = u.id AND revoked_at IS NULL)::int as api_key_count,
          (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND expires_at > NOW())::int as session_count,
          ${publicHostReportCount} as public_host_report_count,
          -- schema: users.backup_codes is TEXT holding a JSON array, so this
          -- flag is a string comparison rather than a structural one. It used
          -- to test inequality against the two characters [] exactly, which
          -- reported "has backup codes" for any serialization that emitted a
          -- spaced empty array, the word null, or an empty string.
          -- Trimmed and regex-matched rather than cast to jsonb: a corrupted
          -- value would make a ::jsonb cast raise and 500 this whole admin
          -- page, which is the case the 2FA repair scripts exist for.
          (u.backup_codes IS NOT NULL
            AND btrim(u.backup_codes) !~ '^\\[\\s*\\]$'
            AND btrim(u.backup_codes) NOT IN ('', 'null')) as has_backup_codes,
          gs.plan as gifted_plan,
          gs.expires_at as gift_end_date,
          ${extra.join(",\n          ")}
        FROM users u
        LEFT JOIN gifted_subscriptions gs ON gs.user_id = u.id AND gs.revoked_at IS NULL AND gs.expires_at > NOW()
        WHERE u.id = $1`;
}

/**
 * The account record, or null when there is no such user.
 *
 * The one extra connection a caller should budget for is this one: the usage
 * read runs beside it and stays under four in all (see lib/admin/user-usage.ts).
 */
export async function fetchUserDetailBundle(
  userId: number,
  flags: UserDetailFlags,
): Promise<UserDetailBundle | null> {
  const result = await pool.query(buildUserDetailSql(flags), [userId]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const user: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!(BUNDLE_COLUMNS as readonly string[]).includes(key)) {
      user[key] = value;
    }
  }
  const list = (column: string): unknown[] =>
    Array.isArray(row[column]) ? (row[column] as unknown[]) : [];
  const credits = row[COLUMN.credits] as
    | {
        ai_credit_balance?: string | number | null;
        github_credit_balance?: string | number | null;
        browserbase_credit_seconds_balance?: string | number | null;
      }
    | undefined;

  return {
    user,
    recentScans: list(COLUMN.recentScans),
    apiKeys: list(COLUMN.apiKeys),
    webhooks: list(COLUMN.webhooks),
    schedules: list(COLUMN.schedules),
    activeSessions: list(COLUMN.sessions),
    badges: list(COLUMN.badges),
    notes: list(COLUMN.notes),
    discordConnection: row[COLUMN.discord] ?? null,
    githubRepoConnection: row[COLUMN.githubRepo] ?? null,
    credits: flags.credits
      ? {
          aiCreditBalance: Number(credits?.ai_credit_balance ?? 0),
          githubCreditBalance: Number(credits?.github_credit_balance ?? 0),
          browserbaseCreditSecondsBalance: Number(
            credits?.browserbase_credit_seconds_balance ?? 0,
          ),
        }
      : null,
  };
}
