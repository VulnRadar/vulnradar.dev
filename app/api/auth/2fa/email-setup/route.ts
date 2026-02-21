import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { Pool } from "@neondatabase/serverless"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

function getUserFromToken(): { userId: number } | null {
  try {
    const token = cookies().get("session")?.value
    if (!token) return null
    return jwt.verify(token, process.env.JWT_SECRET || "dev-secret") as { userId: number }
  } catch {
    return null
  }
}

// POST - Enable email 2FA
export async function POST(request: Request) {
  try {
    const user = getUserFromToken()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { password } = await request.json()
    if (!password) return NextResponse.json({ error: "Password is required." }, { status: 400 })

    // Verify password
    const { rows } = await pool.query("SELECT password_hash, totp_enabled, two_factor_method FROM users WHERE id = $1", [user.userId])
    if (rows.length === 0) return NextResponse.json({ error: "User not found." }, { status: 404 })

    const valid = await bcrypt.compare(password, rows[0].password_hash)
    if (!valid) return NextResponse.json({ error: "Incorrect password." }, { status: 403 })

    // Check if app 2FA is enabled
    if (rows[0].totp_enabled && rows[0].two_factor_method === "app") {
      return NextResponse.json({ error: "Disable authenticator app 2FA first." }, { status: 400 })
    }

    // Enable email 2FA
    await pool.query("UPDATE users SET totp_enabled = true, two_factor_method = 'email' WHERE id = $1", [user.userId])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Email 2FA enable error:", error)
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}

// DELETE - Disable email 2FA
export async function DELETE(request: Request) {
  try {
    const user = getUserFromToken()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { password } = await request.json()
    if (!password) return NextResponse.json({ error: "Password is required." }, { status: 400 })

    const { rows } = await pool.query("SELECT password_hash, two_factor_method FROM users WHERE id = $1", [user.userId])
    if (rows.length === 0) return NextResponse.json({ error: "User not found." }, { status: 404 })

    const valid = await bcrypt.compare(password, rows[0].password_hash)
    if (!valid) return NextResponse.json({ error: "Incorrect password." }, { status: 403 })

    if (rows[0].two_factor_method !== "email") {
      return NextResponse.json({ error: "Email 2FA is not enabled." }, { status: 400 })
    }

    await pool.query("UPDATE users SET totp_enabled = false, two_factor_method = NULL WHERE id = $1", [user.userId])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Email 2FA disable error:", error)
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}
