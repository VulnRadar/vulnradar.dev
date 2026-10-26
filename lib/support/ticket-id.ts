const TICKET_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

// support_tickets.id is a SERIAL, so anything above the int4 ceiling cannot
// exist and would only reach Postgres as an out-of-range parameter.
const MAX_TICKET_ID = 2_147_483_647;

/**
 * The [id] segment of /api/v3/support-tickets/[id], read strictly.
 *
 * Number.parseInt takes the digits off the front and ignores the rest, so
 * "12.png", "12abc" and "1.5" all came out as a ticket id. That is how a
 * request for /support-tickets/12.png was served as ticket 12 on a path the
 * middleware matcher used to skip. Only plain decimal digits with no leading
 * zero are a ticket id; everything else is null, which every caller already
 * answers as an invalid id.
 */
export function parseTicketId(raw: string): number | null {
  if (!TICKET_ID_PATTERN.test(raw)) return null;
  const id = Number(raw);
  return id <= MAX_TICKET_ID ? id : null;
}
