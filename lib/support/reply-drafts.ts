/**
 * The staff reply box, one draft per ticket.
 *
 * The inbox used to hold a single `reply` string. Opening another ticket left
 * it in the box, so text written for one customer was one click from being sent
 * to a different customer. A draft belongs to the ticket it was written on:
 * switching away keeps it there, switching to a ticket with no draft shows an
 * empty box, and Send addresses the ticket the draft is keyed to and nothing
 * else.
 *
 * Pure and immutable so the rules can be tested without rendering the inbox.
 */
export type ReplyDrafts = ReadonlyMap<number, string>;

export const NO_DRAFTS: ReplyDrafts = new Map();

/** What the box shows for this ticket: its draft, or empty. */
export function readDraft(
  drafts: ReplyDrafts,
  ticketId: number | null,
): string {
  if (ticketId === null) return "";
  return drafts.get(ticketId) ?? "";
}

/** The drafts with this ticket's text replaced. Empty text drops the entry. */
export function writeDraft(
  drafts: ReplyDrafts,
  ticketId: number,
  text: string,
): ReplyDrafts {
  const next = new Map(drafts);
  if (text === "") next.delete(ticketId);
  else next.set(ticketId, text);
  return next;
}

/** True when any ticket holds text that has not been sent. */
export function hasUnsentDraft(drafts: ReplyDrafts): boolean {
  for (const text of drafts.values()) {
    if (text.trim() !== "") return true;
  }
  return false;
}

/**
 * What a send request carries: the open ticket's id and that ticket's own
 * draft. The id comes from the ticket on screen, never from anything the draft
 * store remembers, so a draft cannot be posted to another ticket.
 */
export function replyForTicket(
  drafts: ReplyDrafts,
  openTicketId: number,
): { ticketId: number; message: string } {
  return { ticketId: openTicketId, message: readDraft(drafts, openTicketId) };
}
