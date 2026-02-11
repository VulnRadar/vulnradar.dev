import { NextRequest, NextResponse } from "next/server"
import { getUserByEmail, verifyPassword, createSession } from "@/lib/auth"
import pool from "@/lib/db"
import { checkRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  try {
    const ip = await getClientIP()
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 },
      )
    }

    // Rate limit by IP
    const rl = await checkRateLimit({ key: `login:${ip}`, ...RATE_LIMITS.login })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many login attempts. Please try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
        { status: 429 },
      )
    }

    const user = await getUserByEmail(email)
    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 },
      )
    }

    const valid = verifyPassword(password, user.password_hash)
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 },
      )
    }

    // Check if account is disabled or email not verified
    const userInfoResult = await pool.query(
      "SELECT totp_enabled, disabled_at, email_verified_at FROM users WHERE id = $1",
      [user.id],
    )
    const userInfo = userInfoResult.rows[0]
    if (userInfo?.disabled_at) {
      return NextResponse.json(
        { error: "This account has been suspended. Please contact support for assistance." },
        { status: 403 },
      )
    }

    // Check if email is verified
    if (!userInfo?.email_verified_at) {
      return NextResponse.json(
        { error: "Please verify your email address before logging in. Check your inbox for the verification link.", unverified: true },
        { status: 403 },
      )
    }

    // Check if 2FA is enabled
    const totpResult = { rows: [userInfo] }
    const has2FA = totpResult.rows[0]?.totp_enabled === true

    if (has2FA) {
      // Don't create session yet -- return pending state
      const response = NextResponse.json({
        requires2FA: true,
        userId: user.id,
      })
      // Set a short-lived cookie to validate the 2FA verification request
      response.cookies.set("vulnradar_2fa_pending", String(user.id), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 300, // 5 minutes to enter TOTP code
      })
      return response
    }

    // No 2FA -- create session directly
    const userAgent = request.headers.get("user-agent") || undefined
    await createSession(user.id, ip, userAgent)

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name },
    })
  } catch (error) {
    console.error("Login error:", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    )
  }
}
