import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit"
import { sendEmail, landingContactEmail, landingContactConfirmationEmail } from "@/lib/email"

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function POST(request: NextRequest) {
  try {
    const ip = await getClientIP()
    const rl = await checkRateLimit({ key: `landing-contact:${ip}`, ...RATE_LIMITS.api })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Please try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
        { status: 429 },
      )
    }

    const body = await request.json()
    const email = asTrimmedString(body?.email)
    const message = asTrimmedString(body?.message)
    const turnstileToken = asTrimmedString(body?.turnstileToken)

    if (!turnstileToken) {
      return NextResponse.json({ error: "Captcha verification required." }, { status: 400 })
    }

    // Verify Turnstile token
    const turnstileRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: ip,
      }),
    })

    const turnstileData = await turnstileRes.json()
    if (!turnstileData.success) {
      return NextResponse.json({ error: "Captcha verification failed. Please try again." }, { status: 400 })
    }

    if (!email || !message) {
      return NextResponse.json({ error: "Email and message are required." }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase()

    if (message.length > 5000) {
      return NextResponse.json({ error: "Message is too long." }, { status: 400 })
    }

    const noreplyEmail = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@vulnradar.dev"

    // Generate emails using the email module
    const adminEmail = landingContactEmail({ email: normalizedEmail, message })
    const userEmail = landingContactConfirmationEmail(message)

    const sendEmails = async () => {
      try {
        await Promise.all([
          // Send to support team
          sendEmail({
            to: noreplyEmail,
            subject: adminEmail.subject,
            text: adminEmail.text,
            html: adminEmail.html,
            replyTo: normalizedEmail,
          }),
          // Send confirmation to user
          sendEmail({
            to: normalizedEmail,
            subject: userEmail.subject,
            text: userEmail.text,
            html: userEmail.html,
          }),
        ])
      } catch (error) {
        console.error("Landing page contact email send failed", error)
      }
    }

    queueMicrotask(() => {
      void sendEmails()
    })

    return NextResponse.json({ message: "Thanks for reaching out. We'll get back to you soon!" })
  } catch {
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 })
  }
}

