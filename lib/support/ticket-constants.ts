// Shared, client-safe constants for the in-app support ticket system. Kept out
// of the API routes so the ticket UI (contact page, admin inbox) and the
// server validation reference one source of truth for categories and statuses.

export const TICKET_CATEGORIES = [
  "billing",
  "scanning",
  "account",
  "other",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  billing: "Billing",
  scanning: "Scanning",
  account: "Account",
  other: "Other",
};

// open: brand new, no staff reply yet. awaiting_staff: user replied, ball is in
// staff's court. awaiting_user: staff replied, ball is in the user's court.
// resolved: staff marked it done (user can reopen by replying). closed: no
// further replies expected.
export const TICKET_STATUSES = [
  "open",
  "awaiting_staff",
  "awaiting_user",
  "resolved",
  "closed",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Status labels as the REQUESTER reads them. "Awaiting your reply" means the
 * user owes the reply, which is why staff must not use this map: on a staff
 * screen the same string reads as the opposite of what is true. Use
 * STAFF_TICKET_STATUS_LABELS there.
 */
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  awaiting_staff: "Awaiting staff",
  awaiting_user: "Awaiting your reply",
  resolved: "Resolved",
  closed: "Closed",
};

/**
 * The same statuses as STAFF read them. `open` is a brand-new ticket nobody
 * has answered yet, which is a different queue from `awaiting_staff` (a
 * conversation the user has come back to), so the two must not collapse into
 * one word on an inbox screen.
 */
export const STAFF_TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "New",
  awaiting_staff: "Needs reply",
  awaiting_user: "Awaiting user",
  resolved: "Resolved",
  closed: "Closed",
};

/**
 * What happens NEXT, for the requester, one sentence per state. Lives beside
 * the labels because the two must never overlap: the badge names the state and
 * this sentence says what to do about it, and a ticket that said both read as
 * the same fact twice on one screen. Each of these used to open by restating
 * its own badge ("Marked resolved" under a Resolved badge), and the closed one
 * was written a third time in place of the reply box.
 *
 * `open` and `awaiting_staff` share a sentence on purpose: they differ in who
 * moved last, which the badge carries, not in what happens next.
 *
 * tests/lib/support/ticket-constants.test.ts holds the no-overlap rule.
 */
export const TICKET_STATUS_NEXT: Record<TicketStatus, string> = {
  open: "A reply comes back here, by email and in your notifications.",
  awaiting_staff:
    "A reply comes back here, by email and in your notifications.",
  awaiting_user: "Send a reply and it goes straight back to the team.",
  resolved: "Reopen it if the problem is still there.",
  closed: "No more replies here. Open a new ticket if you still need help.",
};

/** A ticket the user can still add messages to (not resolved/closed). */
export const OPEN_TICKET_STATUSES: readonly TicketStatus[] = [
  "open",
  "awaiting_staff",
  "awaiting_user",
];

export const TICKET_SUBJECT_MAX = 200;
export const TICKET_MESSAGE_MAX = 5000;
