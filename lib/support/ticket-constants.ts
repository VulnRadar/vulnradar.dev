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

/** A ticket the user can still add messages to (not resolved/closed). */
export const OPEN_TICKET_STATUSES: readonly TicketStatus[] = [
  "open",
  "awaiting_staff",
  "awaiting_user",
];

export const TICKET_SUBJECT_MAX = 200;
export const TICKET_MESSAGE_MAX = 5000;
