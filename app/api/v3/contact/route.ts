import { NextRequest, NextResponse } from "next/server";
import {
  recordContactSubmission,
  recordContactEmailOutcome,
} from "@/lib/support/contact-submissions";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  contactConfirmationEmail,
  contactEmail,
  sendEmail,
} from "@/lib/email/email";
import { TURNSTILE_ENABLED } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { getClientIp, rateLimitIpKey } from "@/lib/api/request-utils";
import { withErrorHandling } from "@/lib/api/api-utils";
import { logError } from "@/lib/logging/log";

// One label per category the form actually offers (components/contact/
// contact-types.ts's CATEGORIES). billing, enterprise and feedback used to be
// missing here, so a message sent under any of those three fell through the
// `|| "Other"` below and arrived in the support inbox with the sender's own
// choice discarded. "ticket" is deliberately absent: that option opens a
// tracked support thread through a different route, never this one.
const CATEGORY_LABELS: Record<string, string> = {
  bug: "Bug Report",
  feature: "Feature Request",
  security: "Security Issue",
  help: "General Help",
  billing: "Billing Issue",
  enterprise: "Enterprise",
  staff_application: "Staff Application",
  feedback: "Feedback",
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function reasonOf(result: PromiseRejectedResult): string {
  const reason: unknown = result.reason;
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * What to write on the submission once both messages have settled.
 *
 * They are two separate sends to two separate people, and one of them failing
 * says nothing about the other: the staff notification can be refused while
 * the confirmation goes through, or the reverse. They used to share one
 * Promise.all, so the first rejection won and the stored error never said
 * which of the two it was. Each message has its own Email Logs row as well, so
 * this is the summary on the submission, not the only record.
 *
 * `delivered` follows the staff notification, because that is what gets the
 * message read. A failed confirmation alone leaves the submission marked sent
 * and puts the reason in the error column.
 */
function emailOutcome(
  staff: PromiseSettledResult<unknown>,
  confirmation: PromiseSettledResult<unknown>,
): { delivered: boolean; error?: string } {
  const problems: string[] = [];
  if (staff.status === "rejected") {
    problems.push(`staff notification: ${reasonOf(staff)}`);
  }
  if (confirmation.status === "rejected") {
    problems.push(`confirmation to the sender: ${reasonOf(confirmation)}`);
  }
  return {
    delivered: staff.status === "fulfilled",
    ...(problems.length > 0 ? { error: problems.join("; ") } : {}),
  };
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ip = await getClientIp();
  // Its own bucket (5 an hour per IP by default), not the 100-an-hour one
  // every API route shares: every submission here sends two emails, from a
  // form that needs no account.
  const rl = await checkRateLimit({
    key: `contact:${rateLimitIpKey(ip)}`,
    ...RATE_LIMITS.contactForm,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Too many contact requests. Please try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429 },
    );
  }

  let body: Record<string, unknown> | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }
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
  // branded confirmation to whatever address is supplied, so accepting an
  // unvalidated string let an unauthenticated caller point that confirmation
  // at any garbage or malformed value. Require a real local@domain.tld shape
  // (rate limiting + Turnstile above already bound volume).
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

  const noreplyEmail =
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    (await getSetting("NOREPLY_EMAIL"));
  const confirmationPayload = contactConfirmationEmail({
    category: categoryLabel,
  });

  // Stored before anything is sent, because the email WAS the record.
  //
  // The block below fires two emails and swallows any failure, and this route
  // then answers "we will get back to you soon". A DNS failure at the mail
  // host, an expired SMTP credential, a bounce or a spam filter lost the
  // message outright while telling the sender it had arrived, and one of the
  // categories on this form is "Security Issue". Nothing else recorded it and
  // nothing could. It is also why the staff email can be only a pointer: the
  // submission itself is read in the admin contact inbox.
  let submissionId: number;
  try {
    submissionId = await recordContactSubmission({
      source: "contact",
      name,
      email: normalizedEmail,
      subject,
      category,
      message,
      ipAddress: ip || null,
    });
  } catch (error) {
    logError("contact", "could not record the submission", error);
    // Not thanked. At this point nothing holds their message, and the
    // honest answer is the one that lets them try another way.
    return NextResponse.json(
      {
        error:
          "We could not record your message just now. Please try again, or email us directly.",
      },
      { status: 503 },
    );
  }

  const emailPayload = contactEmail({
    submissionId,
    category: categoryLabel,
  });

  const sendEmails = async () => {
    // allSettled, so each message is attempted and judged on its own. The
    // staff copy deliberately has no replyTo and none of the sender's text:
    // see contactEmail.
    const [staff, confirmation] = await Promise.allSettled([
      sendEmail({ to: noreplyEmail, ...emailPayload }),
      sendEmail({ to: normalizedEmail, ...confirmationPayload }),
    ]);
    await recordContactEmailOutcome(
      submissionId,
      emailOutcome(staff, confirmation),
    );
  };

  queueMicrotask(() => {
    void sendEmails();
  });

  return NextResponse.json({
    message: "Thanks for reaching out. We will get back to you soon.",
  });
});
