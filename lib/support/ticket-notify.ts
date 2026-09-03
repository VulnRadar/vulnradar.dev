import "server-only";

import { sendEmail } from "@/lib/email";
import {
  supportTicketReceivedEmail,
  supportTicketReplyEmail,
  supportTicketStaffAlertEmail,
  supportTicketStatusChangedEmail,
} from "@/lib/email/email";
import { createUserNotification } from "@/lib/notifications/user-notifications";
import { APP_URL, SUPPORT_EMAIL } from "@/lib/config/constants";
import type { TicketCategory } from "./ticket-constants";

// The bodies used to be built here, as bare `<p>` strings with a fourth
// private copy of escapeHtml, and were sent with no layout: no wordmark, no
// heading, no button, no footer. They were the only messages in the product
// that did not look like the product. They are templates in lib/email/email.ts
// now, like everything else.

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
  try {
    await sendEmail({
      to: SUPPORT_EMAIL,
      ...supportTicketStaffAlertEmail(opts),
      // Let staff reply straight to the user from their mail client too.
      replyTo: opts.fromEmail,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * A new ticket: confirm it to the person who opened it.
 *
 * The public contact form has always sent a confirmation; the in-app ticket
 * form sent nothing, so a user had no record of the ticket number and no
 * evidence it had been received at all. Transactional, same as the contact
 * form's confirmation.
 */
export async function confirmTicketToUser(opts: {
  ticketId: number;
  subject: string;
  category: TicketCategory;
  ownerEmail: string;
  body: string;
}): Promise<void> {
  try {
    await sendEmail({
      to: opts.ownerEmail,
      ...supportTicketReceivedEmail(opts),
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
      ...supportTicketReplyEmail(opts),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Staff resolved, closed, or reopened the ticket.
 *
 * A reply emailed the owner; a status change did not, so the most common way a
 * ticket ends (staff mark it resolved without a final reply) was silent, and
 * the owner never learned they could reopen it by replying.
 */
export async function notifyUserOfTicketStatus(opts: {
  ticketId: number;
  subject: string;
  ownerEmail: string;
  status: string;
}): Promise<void> {
  try {
    await sendEmail({
      to: opts.ownerEmail,
      ...supportTicketStatusChangedEmail(opts),
    });
  } catch {
    /* best-effort */
  }
}
