import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit"
import { contactConfirmationEmail, contactEmail, sendEmail } from "@/lib/email"

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Bug Report",
  feature: "Feature Request",
  security: "Security Issue",
  help: "General Help",
}

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
    const rl = await checkRateLimit({ key: `contact:${ip}`, ...RATE_LIMITS.api })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many contact requests. Please try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
        { status: 429 },
      )
    }

    const body = await request.json()
    const name = asTrimmedString(body?.name)
    const email = asTrimmedString(body?.email)
    const subject = asTrimmedString(body?.subject)
    const message = asTrimmedString(body?.message)
    const category = asTrimmedString(body?.category)
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

    if (!name || !email || !subject || !message || !category) {
      return NextResponse.json({ error: "All fields are required." }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase()
    const categoryLabel = CATEGORY_LABELS[category] || "Other"

    if (name.length > 120 || subject.length > 160 || message.length > 5000) {
      return NextResponse.json({ error: "Message is too long." }, { status: 400 })
    }

    const emailPayload = contactEmail({
      name,
      email: normalizedEmail,
      subject,
      message,
      category: categoryLabel,
    })

    const noreplyEmail = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@vulnradar.dev"
    const confirmationPayload = contactConfirmationEmail({ name, category: categoryLabel })

    const sendEmails = async () => {
      try {
        await Promise.all([
          sendEmail({
            to: noreplyEmail,
            subject: emailPayload.subject,
            text: emailPayload.text,
            html: emailPayload.html,
            replyTo: normalizedEmail,
          }),
          sendEmail({
            to: normalizedEmail,
            subject: confirmationPayload.subject,
            text: confirmationPayload.text,
            html: confirmationPayload.html,
          }),
        ])
      } catch (error) {
        console.error("Contact email send failed", error)
      }
    }

    queueMicrotask(() => {
      void sendEmails()
    })

    return NextResponse.json({ message: "Thanks for reaching out. We will get back to you soon." })
  } catch {
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 })
  }
}
