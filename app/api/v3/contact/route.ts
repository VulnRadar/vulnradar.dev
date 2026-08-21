import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientIP,
  RATE_LIMITS,
} from "@/lib/rate-limiting/rate-limit";
import {
  contactConfirmationEmail,
  contactEmail,
  sendEmail,
} from "@/lib/email/email";
import { TURNSTILE_ENABLED } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Bug Report",
  feature: "Feature Request",
  security: "Security Issue",
  help: "General Help",
  staff_application: "Staff Application",
};

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
      key: `contact:${ip}`,
      ...RATE_LIMITS.api,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: `Too many contact requests. Please try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
        },
        { status: 429 },
      );
    }

    const body = await request.json();
    const name = asTrimmedString(body?.name);
    const email = asTrimmedString(body?.email);
    const subject = asTrimmedString(body?.subject);
    const message = asTrimmedString(body?.message);
    const category = asTrimmedString(body?.category);
    const turnstileToken = asTrimmedString(body?.turnstileToken);

    // Verify Turnstile token only if enabled
    if (TURNSTILE_ENABLED) {
      if (!turnstileToken) {
        return NextResponse.json(
          { error: "Captcha verification required." },
          { status: 400 },
        );
      }

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

    if (!name || !email || !subject || !message || !category) {
      return NextResponse.json(
        { error: "All fields are required." },
        { status: 400 },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    // Validate the address shape before we send anything. This route emails a
    // branded confirmation to whatever address is supplied and sets it as the
    // support copy's replyTo, so accepting an unvalidated string let an
    // unauthenticated caller point that confirmation at any garbage or
    // malformed value. Require a real local@domain.tld shape (rate limiting +
    // Turnstile above already bound volume).
    if (
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 },
      );
    }
    const categoryLabel = CATEGORY_LABELS[category] || "Other";

    const contactMessageMaxLength = await getSetting(
      "CONTACT_MESSAGE_MAX_LENGTH",
    );
    if (
      name.length > 120 ||
      subject.length > 160 ||
      message.length > contactMessageMaxLength
    ) {
      return NextResponse.json(
        { error: "Message is too long." },
        { status: 400 },
      );
    }

    const emailPayload = contactEmail({
      name,
      email: normalizedEmail,
      subject,
      message,
      category: categoryLabel,
    });

    const noreplyEmail =
      process.env.SMTP_FROM ||
      process.env.SMTP_USER ||
      (await getSetting("NOREPLY_EMAIL"));
    const confirmationPayload = contactConfirmationEmail({
      name,
      category: categoryLabel,
    });

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
        ]);
      } catch (error) {
        console.error("Contact email send failed", error);
      }
    };

    queueMicrotask(() => {
      void sendEmails();
    });

    return NextResponse.json({
      message: "Thanks for reaching out. We will get back to you soon.",
    });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 },
    );
  }
}
