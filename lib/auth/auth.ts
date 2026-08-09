import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { hashPassword } from "@/lib/auth/password-hash";
import pool from "@/lib/database/db";
import {
  AUTH_SESSION_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE,
  AUTH_CLEANUP_INTERVAL,
} from "@/lib/config/constants";
import {
  getClientIp,
  getUserAgent,
  ipsInSameSubnet,
} from "@/lib/api/request-utils";
import { getSettings } from "@/lib/config/runtime-config";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { newLoginEmail } from "@/lib/email/email";

const SESSION_COOKIE = AUTH_SESSION_COOKIE_NAME;
const SESSION_MAX_AGE = AUTH_SESSION_MAX_AGE * 1000; // AUTH_SESSION_MAX_AGE is in seconds
const CLEANUP_INTERVAL = AUTH_CLEANUP_INTERVAL;

let lastCleanupTime = 0;

// Password hashing lives in ./password-hash so it can be unit tested against
// the real scrypt primitive. Re-exported here to keep existing imports stable.
export {
  hashPassword,
  verifyPassword,
  needsRehash,
} from "@/lib/auth/password-hash";

// Session management
function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

export async function createSession(
  userId: number,
  ipAddress?: string,
  userAgent?: string,
): Promise<string> {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE);

  await pool.query(
    "INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)",
    [sessionId, userId, expiresAt, ipAddress || null, userAgent || null],
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_MAX_AGE / 1000),
  });

  return sessionId;
}

export async function getSession(): Promise<{
  userId: number;
  email: string;
  name: string | null;
  tosAcceptedAt: string | null;
  role: string;
} | null> {
  // Run cleanup every 24 hours
  const now = Date.now();
  if (now - lastCleanupTime > CLEANUP_INTERVAL) {
    lastCleanupTime = now;
    cleanupExpiredSessions().catch((err) =>
      console.error("Session cleanup error:", err),
    );
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;

  if (!sessionId) return null;

  const result = await pool.query(
    `SELECT s.user_id, s.expires_at, s.ip_address, u.email, u.name, u.tos_accepted_at, u.disabled_at, u.role
       FROM sessions s
              JOIN users u ON s.user_id = u.id
       WHERE s.id = $1`,
    [sessionId],
  );

  if (result.rows.length === 0) {
    cookieStore.delete(SESSION_COOKIE);
    return null;
  }

  const session = result.rows[0];

  // If account is disabled or session expired, nuke the session + cookie
  if (session.disabled_at || new Date(session.expires_at) < new Date()) {
    await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
    cookieStore.delete(SESSION_COOKIE);
    return null;
  }

  // ip-binding: optional defense against a stolen session cookie being
  // replayed from a different network (off by default; see
  // lib/config/config-values.ts). A mismatch is handled exactly like an
  // expired session above — the session row and cookie are cleared and
  // the caller has to log in again — never a permanent lock. The account
  // owner is notified in case it genuinely wasn't them.
  const ipOk = await checkSessionIpBinding(sessionId, session);
  if (!ipOk) {
    cookieStore.delete(SESSION_COOKIE);
    return null;
  }

  return {
    userId: session.user_id,
    email: session.email,
    name: session.name,
    tosAcceptedAt: session.tos_accepted_at || null,
    role: session.role || "user",
  };
}

/**
 * ip-binding: returns false (and deletes the session row) when the
 * current request's IP is not in the same subnet as the IP the session
 * was created with. Returns true (no-op) when the feature is disabled,
 * when no IP was recorded at creation (older sessions, or a client IP
 * that could not be determined), or when the current IP can't be
 * determined either — this is a defense-in-depth check layered on top of
 * the session cookie itself, not the primary auth boundary, so it fails
 * open rather than locking users out on infrastructure it can't read.
 */
export async function checkSessionIpBinding(
  sessionId: string,
  session: { user_id: number; ip_address: string | null; email: string },
): Promise<boolean> {
  const settings = await getSettings([
    "SESSION_IP_BINDING_ENABLED",
    "SESSION_IP_BINDING_IPV4_PREFIX",
    "SESSION_IP_BINDING_IPV6_PREFIX",
  ] as const);
  if (!settings.SESSION_IP_BINDING_ENABLED) return true;

  const boundIp = session.ip_address;
  if (!boundIp || boundIp === "unknown") return true;

  const currentIp = await getClientIp();
  if (!currentIp || currentIp === "unknown") return true;

  if (
    ipsInSameSubnet(
      currentIp,
      boundIp,
      Number(settings.SESSION_IP_BINDING_IPV4_PREFIX),
      Number(settings.SESSION_IP_BINDING_IPV6_PREFIX),
    )
  ) {
    return true;
  }

  await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);

  const userAgent = await getUserAgent();
  await notifySessionIpMismatch({
    userId: session.user_id,
    userEmail: session.email,
    previousIp: boundIp,
    currentIp,
    userAgent,
  });

  return false;
}

/**
 * ip-binding: best-effort notification for a session IP mismatch — a
 * security_alerts row for the admin-facing alert surface, plus the same
 * "new login" email already sent on a fresh login (see
 * app/api/v3/auth/login/route.ts), reused here rather than adding a new
 * template for what is, from the account owner's point of view, the same
 * event: "your account was just accessed from somewhere new." Awaited by
 * the caller (the mismatch path is rare, so the extra latency is an
 * acceptable trade for not having a dangling background promise) but
 * never throws itself, so a notification failure cannot turn into an
 * unhandled rejection or change whether the request is treated as
 * authenticated.
 */
async function notifySessionIpMismatch(params: {
  userId: number;
  userEmail: string;
  previousIp: string;
  currentIp: string;
  userAgent: string;
}): Promise<void> {
  const { userId, userEmail, previousIp, currentIp, userAgent } = params;

  await pool
    .query(
      `INSERT INTO security_alerts
         (user_id, alert_type, severity, description, details, ip_address, user_agent)
       VALUES ($1, 'session_ip_mismatch', 'medium', $2, $3, $4, $5)`,
      [
        userId,
        "Session used from a different network than it was created on. The session was ended and the user will need to log in again.",
        JSON.stringify({ previousIp, currentIp }),
        currentIp,
        userAgent,
      ],
    )
    .catch((err) =>
      console.error("[auth] Failed to record session_ip_mismatch alert:", err),
    );

  try {
    const emailContent = newLoginEmail("A new network", currentIp, {
      ipAddress: currentIp,
      userAgent,
    });
    await sendNotificationEmail({
      userId,
      userEmail,
      type: "login_alerts",
      emailContent,
    });
  } catch (err) {
    console.error("[auth] Failed to send session_ip_mismatch email:", err);
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;

  if (sessionId) {
    await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
    cookieStore.delete(SESSION_COOKIE);
  }
}

// User management
export async function createUser(
  email: string,
  password: string,
  name?: string,
) {
  const passwordHash = await hashPassword(password);

  // super-admin: the very first account ever created is automatically
  // promoted, so a fresh self-hosted install always ends up with exactly
  // one super_admin without any manual step. The "is the table empty"
  // check runs as a subquery inside the same INSERT (rather than a
  // separate SELECT COUNT(*) beforehand) so there's no gap between
  // "check" and "insert" for a second concurrent signup to also observe
  // zero rows. That's not airtight under true concurrency (two INSERTs can
  // both evaluate the subquery before either commits), the
  // 5.5.0-to-5.6.0 migration exists as a self-healing, idempotent sweep
  // that pins the role to whichever row ends up with MIN(id), covering
  // both that theoretical race and upgrading an existing production
  // database that already has users.
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, name, plan, beta_access, role, auth_provider)
       VALUES ($1, $2, $3, 'free', false,
         CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 'super_admin' ELSE 'user' END,
         'password')
       RETURNING id, email, name, plan, beta_access, role`,
    [email.toLowerCase().trim(), passwordHash, name || null],
  );

  return result.rows[0];
}

/**
 * Create an account from a successful OAuth sign-up (Google/GitHub/Discord
 * -- see app/api/v3/auth/oauth/[provider]/callback/route.ts). Two
 * differences from createUser() above:
 *
 *   - password_hash is NULL. There is no password to hash; the account may
 *     never have one. lib/auth/password-hash.ts's verifyPassword() treats a
 *     null hash as "no match" rather than throwing, and
 *     app/api/v3/auth/update/route.ts's re-auth gate skips the
 *     current-password check for a user in this state so they are never
 *     locked out of their own profile.
 *   - email_verified_at is set immediately: the provider already verified
 *     this address, so sending our own verification email would be asking
 *     the user to prove something we already know.
 *
 * Same super_admin bootstrap subquery as createUser(): the very first
 * account in an empty database is promoted automatically, regardless of
 * which path created it.
 */
// Column names for storing the provider's own identity alongside a
// freshly-created account, keyed by provider id. Not user input -- always
// looked up from this fixed map, never interpolated from a request.
// Exported so app/api/v3/auth/oauth/[provider]/callback/route.ts's
// provider-id-first account lookup uses this exact same mapping, rather
// than a second, independently-maintained copy that could drift.
export const OAUTH_IDENTITY_COLUMNS: Record<
  string,
  { id: string; email: string; name: string; avatarUrl: string }
> = {
  google: {
    id: "google_id",
    email: "google_email",
    name: "google_name",
    avatarUrl: "google_avatar_url",
  },
  github: {
    id: "github_id",
    email: "github_email",
    name: "github_name",
    avatarUrl: "github_avatar_url",
  },
  discord: {
    id: "discord_id",
    email: "discord_email",
    name: "discord_username",
    avatarUrl: "discord_avatar_url",
  },
};

export async function createOAuthUser(
  email: string,
  name: string | null,
  provider: string,
  // Sign-up-time identity to store alongside the new account, same shape
  // handleOAuthLink() writes for an existing account
  // (app/api/v3/auth/oauth/[provider]/callback/route.ts). Without this, an
  // account created by signing up with a provider had no record of that
  // provider's id at all -- the NEXT "sign in with X" had nothing to match
  // against except email, and the Connections tab showed it as never
  // connected despite having been created by that exact sign-in.
  providerIdentity?: { id: string; avatarUrl: string | null },
) {
  const normalizedEmail = email.toLowerCase().trim();
  const columns = OAUTH_IDENTITY_COLUMNS[provider];

  if (columns && providerIdentity?.id) {
    const result = await pool.query(
      `INSERT INTO users (
         email, password_hash, name, plan, beta_access, role, auth_provider, email_verified_at,
         ${columns.id}, ${columns.email}, ${columns.name}, ${columns.avatarUrl}
       )
       VALUES ($1, NULL, $2, 'free', false,
         CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 'super_admin' ELSE 'user' END,
         $3, NOW(), $4, $5, $6, $7)
       RETURNING id, email, name, plan, beta_access, role`,
      [
        normalizedEmail,
        name || null,
        provider,
        providerIdentity.id,
        normalizedEmail,
        name || null,
        providerIdentity.avatarUrl || null,
      ],
    );
    return result.rows[0];
  }

  const result = await pool.query(
    `INSERT INTO users (email, password_hash, name, plan, beta_access, role, auth_provider, email_verified_at)
       VALUES ($1, NULL, $2, 'free', false,
         CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 'super_admin' ELSE 'user' END,
         $3, NOW())
       RETURNING id, email, name, plan, beta_access, role`,
    [normalizedEmail, name || null, provider],
  );

  return result.rows[0];
}

export { getUserByEmail } from "@/lib/database/db-utils";

// Cleanup expired sessions
export async function cleanupExpiredSessions(): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE expires_at < NOW()");
}

// Delete all sessions for a user (force logout all devices)
export async function deleteAllSessions(userId: number): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}
