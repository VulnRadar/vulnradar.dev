import { parseTicketId } from "./ticket-id";

/**
 * The staff alert's link into the inbox: /admin?tab=support-tickets&ticket=<id>.
 *
 * Kept free of server-only imports because the inbox (a client component) reads
 * the parameter and ticket-notify (server) writes it, and the name is the one
 * thing they have to agree on.
 */
export const INBOX_TICKET_PARAM = "ticket";

/**
 * The ticket id a link names, or null when there is nothing usable in it.
 * Strict, the way the API reads its own id segment: "12abc" is not ticket 12.
 */
export function parseTicketParam(
  raw: string | null | undefined,
): number | null {
  if (!raw) return null;
  return parseTicketId(raw);
}

/**
 * What the inbox does once the thread request for a linked ticket has
 * answered. A ticket that is missing and one the staff member may not see look
 * the same on purpose (the route answers 404 for both): the queue opens and
 * nothing is said about the id, so the link cannot be used to probe for
 * tickets.
 */
export function deepLinkOutcome(response: { ok: boolean }): "thread" | "queue" {
  return response.ok ? "thread" : "queue";
}
