import pool from "@/lib/database/db";
import { escapeLikePattern } from "@/lib/history/list-filter";
import {
  OPEN_TICKET_STATUSES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketStatus,
} from "./ticket-constants";

/**
 * The staff inbox query, as a module of its own.
 *
 * It sat inline in the route, ending in `LIMIT 200` with no offset and no
 * search, so once a deployment had more than 200 tickets in a view the older
 * ones could not be reached at all, and finding "that billing ticket from the
 * person on the free plan" meant scrolling. It lives here because every
 * property worth checking is a property of what PostgreSQL does with it (the
 * cursor comparison, the escaped ILIKE), and the unit tier fakes the pool.
 * tests/integration/admin-ticket-list.test.ts runs this against a real one.
 */

/** Tickets per page. The inbox asks for more with the cursor it was given. */
export const ADMIN_TICKET_PAGE_SIZE = 50;

/** Longest search the inbox will run. A subject is 200; nobody types more. */
export const ADMIN_TICKET_SEARCH_MAX = 100;

export type AdminTicketView = "active" | "all" | TicketStatus;

export function isAdminTicketView(value: string): value is AdminTicketView {
  return (
    value === "active" ||
    value === "all" ||
    TICKET_STATUSES.includes(value as TicketStatus)
  );
}

export interface AdminTicketFilter {
  /** "active" is the default queue: everything still open. */
  view: AdminTicketView;
  /** Free text: matched against the subject, the owner's email, or `#<id>`. */
  q?: string | null;
  /** Only tickets assigned to this staff member. */
  assignedTo?: number | null;
  cursor?: TicketCursor | null;
  limit?: number;
}

export interface AdminTicketRow {
  id: number;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  created_at: string;
  last_message_at: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  owner_id: number;
  owner_email: string;
  owner_name: string | null;
  message_count: number;
  last_message: string | null;
}

/**
 * Where the next page starts. The timestamp is carried as the text Postgres
 * printed, not as a JavaScript Date: a Date holds milliseconds and the column
 * holds microseconds, so a cursor round-tripped through one would skip every
 * ticket that shares its millisecond.
 */
export interface TicketCursor {
  ts: string;
  id: number;
}

const CURSOR_TS =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

export function encodeTicketCursor(cursor: TicketCursor): string {
  return Buffer.from(JSON.stringify([cursor.ts, cursor.id])).toString(
    "base64url",
  );
}

/** Null for anything this module did not produce, so a bad cursor is a 400. */
export function decodeTicketCursor(raw: string): TicketCursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [ts, id] = parsed;
    if (typeof ts !== "string" || !CURSOR_TS.test(ts)) return null;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

export interface AdminTicketPage {
  tickets: AdminTicketRow[];
  nextCursor: string | null;
}

export async function listAdminTickets(
  filter: AdminTicketFilter,
): Promise<AdminTicketPage> {
  const limit = filter.limit ?? ADMIN_TICKET_PAGE_SIZE;
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const where: string[] = [];

  if (filter.view === "active") {
    where.push(`t.status = ANY(${bind([...OPEN_TICKET_STATUSES])}::text[])`);
  } else if (filter.view !== "all") {
    where.push(`t.status = ${bind(filter.view)}`);
  }

  if (filter.assignedTo != null) {
    where.push(`t.assigned_to = ${bind(filter.assignedTo)}`);
  }

  const term = (filter.q ?? "").trim().slice(0, ADMIN_TICKET_SEARCH_MAX);
  if (term) {
    // A % or _ typed into the box is a literal, not "every ticket".
    const like = bind(`%${escapeLikePattern(term)}%`);
    const matches = [
      `t.subject ILIKE ${like} ESCAPE '\\'`,
      `u.email ILIKE ${like} ESCAPE '\\'`,
    ];
    // "#412" is how a ticket is named in the audit log and in emails.
    const asId = /^#?(\d{1,9})$/.exec(term);
    if (asId) matches.push(`t.id = ${bind(Number(asId[1]))}`);
    where.push(`(${matches.join(" OR ")})`);
  }

  if (filter.cursor) {
    // Row-value comparison against the pair the ORDER BY uses. The id breaks
    // ties, so two tickets with the same last_message_at are neither repeated
    // nor skipped across a page boundary.
    where.push(
      `(t.last_message_at, t.id) < (${bind(filter.cursor.ts)}::timestamptz, ${bind(filter.cursor.id)}::int)`,
    );
  }

  // One extra row says whether there is a next page without a COUNT(*).
  const limitParam = bind(limit + 1);

  const result = await pool.query<AdminTicketRow & { cursor_ts: string }>(
    `SELECT t.id, t.subject, t.category, t.status, t.created_at, t.last_message_at,
            t.last_message_at::text AS cursor_ts,
            t.assigned_to, au.name AS assigned_to_name,
            u.id AS owner_id, u.email AS owner_email, u.name AS owner_name,
            (SELECT COUNT(*)::int FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count,
            (SELECT m2.body FROM support_ticket_messages m2 WHERE m2.ticket_id = t.id ORDER BY m2.created_at DESC LIMIT 1) AS last_message
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN users au ON au.id = t.assigned_to
       ${where.length ? `WHERE ${where.join("\n         AND ")}` : ""}
      ORDER BY t.last_message_at DESC, t.id DESC
      LIMIT ${limitParam}`,
    params,
  );

  const page = result.rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    result.rows.length > limit && last
      ? encodeTicketCursor({ ts: last.cursor_ts, id: last.id })
      : null;

  return {
    tickets: page.map(({ cursor_ts: _cursorTs, ...row }) => row),
    nextCursor,
  };
}

export interface TicketQueueCounts {
  /** Every status, over the whole table: not the page, not the filter. */
  counts: Record<string, number>;
  /** Active tickets assigned to the asking staff member. */
  mine: number;
}

/**
 * The numbers on the filter chips. One GROUP BY, with the caller's own
 * assignments counted in the same pass so the "Mine" chip costs no second
 * trip.
 */
export async function ticketQueueCounts(
  staffId: number,
): Promise<TicketQueueCounts> {
  const result = await pool.query<{
    status: TicketStatus;
    n: number;
    mine: number;
  }>(
    `SELECT status, COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE assigned_to = $1)::int AS mine
       FROM support_tickets
      GROUP BY status`,
    [staffId],
  );
  const counts: Record<string, number> = {};
  let mine = 0;
  for (const row of result.rows) {
    counts[row.status] = row.n;
    if (OPEN_TICKET_STATUSES.includes(row.status)) mine += row.mine;
  }
  return { counts, mine };
}
