import { cookies } from "next/headers"
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import pool from "./db"

const SESSION_COOKIE = "vulnradar_session"
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours

let lastCleanupTime = 0

// Password hashing using scrypt (built-in, no extra dependency)
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":")
  const hashBuffer = Buffer.from(hash, "hex")
  const suppliedBuffer = scryptSync(password, salt, 64)
  return timingSafeEqual(hashBuffer, suppliedBuffer)
}

// Session management
function generateSessionId(): string {
  return randomBytes(32).toString("hex")
}

export async function createSession(userId: number, ipAddress?: string, userAgent?: string): Promise<string> {
  const sessionId = generateSessionId()
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE)

  await pool.query(
      "INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)",
      [sessionId, userId, expiresAt, ipAddress || null, userAgent || null],
  )

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE / 1000,
  })

  return sessionId
}

export async function getSession(): Promise<{ userId: number; email: string; name: string | null; tosAcceptedAt: string | null } | null> {
  // Run cleanup every 24 hours
  const now = Date.now()
  if (now - lastCleanupTime > CLEANUP_INTERVAL) {
    lastCleanupTime = now
    cleanupExpiredSessions().catch((err) => console.error("Session cleanup error:", err))
  }

  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value

  if (!sessionId) return null

  const result = await pool.query(
      `SELECT s.user_id, s.expires_at, u.email, u.name, u.tos_accepted_at, u.disabled_at
       FROM sessions s
              JOIN users u ON s.user_id = u.id
       WHERE s.id = $1`,
      [sessionId],
  )

  if (result.rows.length === 0) {
    cookieStore.delete(SESSION_COOKIE)
    return null
  }

  const session = result.rows[0]

  // If account is disabled or session expired, nuke the session + cookie
  if (session.disabled_at || new Date(session.expires_at) < new Date()) {
    await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId])
    cookieStore.delete(SESSION_COOKIE)
    return null
  }

  return {
    userId: session.user_id,
    email: session.email,
    name: session.name,
    tosAcceptedAt: session.tos_accepted_at || null,
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value

  if (sessionId) {
    await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId])
    cookieStore.delete(SESSION_COOKIE)
  }
}

// User management
export async function createUser(email: string, password: string, name?: string) {
  const passwordHash = hashPassword(password)

  const result = await pool.query(
      "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name",
      [email.toLowerCase().trim(), passwordHash, name || null],
  )

  return result.rows[0]
}

export async function getUserByEmail(email: string) {
  const result = await pool.query(
      "SELECT id, email, password_hash, name FROM users WHERE email = $1",
      [email.toLowerCase().trim()],
  )

  return result.rows[0] || null
}

// Cleanup expired sessions
export async function cleanupExpiredSessions(): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE expires_at < NOW()")
}