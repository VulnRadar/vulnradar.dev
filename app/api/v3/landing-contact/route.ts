import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientIP,
  RATE_LIMITS,
} from "@/lib/rate-limiting/rate-limit";
import {
  sendEmail,
  landingContactEmail,
  landingContactConfirmationEmail,
} from "@/lib/email/email";
import { getSetting } from "@/lib/config/runtime-config";
import { rateLimitIpKey } from "@/lib/api/request-utils";
import { TURNSTILE_ENABLED } from "@/lib/config/constants";

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(request: NextRequest) {
  try {
    const ip = await getClientIP();
    const rl = await checkRateLimit({
      key: `landing-contact:${rateLimitIpKey(ip)}`,
      ...RATE_LIMITS.api,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: `Too many requests. Please try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
        },
        { status: 429 },
      );
    }

    const body = await request.json();
    const email = asTrimmedString(body?.email);
    const message = asTrimmedString(body?.message);
    const turnstileToken = asTrimmedString(body?.turnstileToken);

    // Only enforce the captcha when Turnstile is actually configured, matching
    // /contact, /signup and /support-tickets. Requiring the token
    // unconditionally broke this endpoint entirely on any deployment that has
    // not set up Turnstile.
    if (TURNSTILE_ENABLED) {
      if (!turnstileToken) {
        return NextResponse.json(
          { error: "Captcha verification required." },
          { status: 400 },
        );
      }

      // Verify Turnstile token
      const turnstileRes = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: process.env.TURNSTILE_SECRET_KEY,
            response: turnstileToken,
            remoteip: ip,
          }),
        },
      );

      const turnstileData = await turnstileRes.json();
      if (!turnstileData.success) {
        return NextResponse.json(
          { error: "Captcha verification failed. Please try again." },
          { status: 400 },
        );
      }
    }

    if (!email || !message) {
      return NextResponse.json(
        { error: "Email and message are required." },
        { status: 400 },
      );
    }

    const normalizedEmail = email.toLowerCase();

    const contactMessageMaxLength = await getSetting(
      "CONTACT_MESSAGE_MAX_LENGTH",
    );
    if (message.length > contactMessageMaxLength) {
      return NextResponse.json(
        { error: "Message is too long." },
        { status: 400 },
      );
    }

    const noreplyEmail =
      process.env.SMTP_FROM ||
      process.env.SMTP_USER ||
      (await getSetting("NOREPLY_EMAIL"));

    // Generate emails using the email module
    const adminEmail = landingContactEmail({ email: normalizedEmail, message });
    const userEmail = landingContactConfirmationEmail(message);

    const sendEmails = async () => {
      try {
        await Promise.all([
          // Send to support team
          sendEmail({
            to: noreplyEmail,
            ...adminEmail,
            replyTo: normalizedEmail,
          }),
          // Send confirmation to user
          sendEmail({
            to: normalizedEmail,
            ...userEmail,
          }),
        ]);
      } catch (error) {
        console.error("Landing page contact email send failed", error);
      }
    };

    queueMicrotask(() => {
      void sendEmails();
    });

    return NextResponse.json({
      message: "Thanks for reaching out. We'll get back to you soon!",
    });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 },
    );
  }
}
