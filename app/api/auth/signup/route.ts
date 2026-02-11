import { NextRequest, NextResponse } from "next/server"
import { createUser, getUserByEmail } from "@/lib/auth"
import { sendEmail, emailVerificationEmail, APP_URL } from "@/lib/email"
import pool from "@/lib/db"
import crypto from "crypto"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, name } = body

    if (!email || !password || !name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "Name, email, and password are required." },
        { status: 400 },
      )
    }

    if (typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 },
      )
    }

    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 },
      )
    }

    // Check if user already exists
    const existing = await getUserByEmail(email)
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      )
    }

    // Create user (without verified email)
    const user = await createUser(email, password, name)

    // Generate verification token
    const token = crypto.randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    // Delete any existing verification tokens for this user
    await pool.query("DELETE FROM email_verification_tokens WHERE user_id = $1", [user.id])

    // Store token
    await pool.query(
      "INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [user.id, token, expiresAt]
    )

    // Send verification email in background (don't block the response)
    const verifyLink = `${APP_URL}/verify-email?token=${token}`
    const emailContent = emailVerificationEmail(name.trim(), verifyLink)

    setImmediate(() => {
      sendEmail({
        to: email,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      }).catch((err) => {
        console.error("Failed to send verification email:", err)
      })
    })

    return NextResponse.json({
      message: "Account created! Please check your email to verify your account.",
      requiresVerification: true,
    })
  } catch (error) {
    console.error("Signup error:", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    )
  }
}
