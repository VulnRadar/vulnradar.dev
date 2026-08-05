import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { hashPassword } from "@/lib/auth/password-hash";
import pool from "@/lib/database/db";
import {
  AUTH_SESSION_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE,
  AUTH_CLEANUP_INTERVAL,
} from "@/lib/config/constants";

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
    `SELECT s.user_id, s.expires_at, u.email, u.name, u.tos_accepted_at, u.disabled_at, u.role
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

  return {
    userId: session.user_id,
    email: session.email,
    name: session.name,
    tosAcceptedAt: session.tos_accepted_at || null,
    role: session.role || "user",
  };
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

  const result = await pool.query(
    `INSERT INTO users (email, password_hash, name, plan, beta_access, role)
       VALUES ($1, $2, $3, 'free', false, 'user')
       RETURNING id, email, name, plan, beta_access, role`,
    [email.toLowerCase().trim(), passwordHash, name || null],
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
