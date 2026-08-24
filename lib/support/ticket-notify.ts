import "server-only";

import { sendEmail } from "@/lib/email";
import { createUserNotification } from "@/lib/notifications/user-notifications";
import { APP_URL, SUPPORT_EMAIL } from "@/lib/config/constants";
import type { TicketCategory } from "./ticket-constants";

// User-supplied ticket text goes into HTML email bodies, so it must be escaped
// (email.ts has its own private escaper; this mirrors it for the support paths).
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toHtmlParagraph(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

/**
 * A new ticket or a user reply: notify the staff support inbox. Best-effort;
 * callers fire it without awaiting so it never blocks the HTTP response, and it
 * swallows its own errors (an email hiccup must not fail creating the ticket).
 */
export async function notifyStaffOfTicketActivity(opts: {
  ticketId: number;
  subject: string;
  category: TicketCategory;
  fromEmail: string;
  body: string;
  isNew: boolean;
}): Promise<void> {
  const verb = opts.isNew ? "New" : "New reply on";
  try {
    await sendEmail({
      to: SUPPORT_EMAIL,
      subject: `[Ticket #${opts.ticketId}] ${opts.subject}`,
      text: `${verb} ${opts.category} support ticket #${opts.ticketId} from ${opts.fromEmail}\n\n${opts.body}\n\nOpen the admin support inbox: ${APP_URL}/admin`,
      html: `<p>${verb} <strong>${escapeHtml(opts.category)}</strong> support ticket <strong>#${opts.ticketId}</strong> from ${escapeHtml(opts.fromEmail)}.</p><p><strong>${escapeHtml(opts.subject)}</strong></p><p>${toHtmlParagraph(opts.body)}</p><p><a href="${APP_URL}/admin">Open the admin support inbox</a></p>`,
      // Let staff reply straight to the user from their mail client too.
      replyTo: opts.fromEmail,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * A staff reply: drop an in-app bell notification for the ticket owner and email
 * them. Transactional (the user opened the ticket), so it is sent directly
 * rather than through the marketing notification-preference gate.
 */
export async function notifyUserOfStaffReply(opts: {
  ticketId: number;
  subject: string;
  ownerUserId: number;
  ownerEmail: string;
  body: string;
}): Promise<void> {
  const url = `${APP_URL}/contact?ticket=${opts.ticketId}`;
  try {
    await createUserNotification({
      userId: opts.ownerUserId,
      type: "support_reply",
      title: "Support replied to your ticket",
      message: `Ticket #${opts.ticketId}: ${opts.subject}`,
      actionLabel: "View ticket",
      actionUrl: url,
      relatedType: "support_ticket",
      relatedId: opts.ticketId,
    });
  } catch {
    /* best-effort: the bell is a convenience, the email below is the real notice */
  }
  try {
    await sendEmail({
      to: opts.ownerEmail,
      subject: `Re: [Ticket #${opts.ticketId}] ${opts.subject}`,
      text: `Our team replied to your support ticket #${opts.ticketId}.\n\n${opts.body}\n\nView and reply: ${url}`,
      html: `<p>Our team replied to your support ticket <strong>#${opts.ticketId}</strong>.</p><p>${toHtmlParagraph(opts.body)}</p><p><a href="${url}">View and reply to your ticket</a></p>`,
    });
  } catch {
    /* best-effort */
  }
}
